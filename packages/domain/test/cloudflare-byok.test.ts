import { describe, expect, test } from "bun:test";

import {
  AI_GATEWAY_SECRET_SCOPE,
  byokSecretName,
  createCloudflareByokClient,
} from "../src/adapters/production/cloudflare-byok";
import type { ByokFetch } from "../src/adapters/production/cloudflare-byok";
import { workspaceIdSchema } from "../src/ids";
import { modelProviderSchema } from "../src/model";

const workspaceId = workspaceIdSchema.parse("workspace-1");
const provider = modelProviderSchema.parse("anthropic");
const RAW_KEY = "sk-ant-super-secret-do-not-leak-0xDEADBEEF";

const baseConfig = {
  accountId: "acct-1",
  apiToken: "cf-token-xyz",
  baseUrl: "https://cf.test/client/v4",
  gatewayId: "gw",
  storeId: "store-1",
};

const secretsUrl =
  "https://cf.test/client/v4/accounts/acct-1/secrets_store/stores/store-1/secrets";
const secretName = "gw_anthropic_ws-workspace-1-anthropic";

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: string | undefined;
  readonly headers: Record<string, string>;
}

/** A scripted fetch fake: returns queued responses in order and records every request. */
const scriptedFetch = (responses: Response[]) => {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl: ByokFetch = (input, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({
      body: typeof init?.body === "string" ? init.body : undefined,
      headers,
      method: init?.method ?? "GET",
      url: String(input),
    });
    const response = responses[i];
    i += 1;
    if (response === undefined) {
      throw new Error(`scriptedFetch: no response queued for call ${i}`);
    }
    return Promise.resolve(response);
  };
  return { calls, fetchImpl };
};

const listResult = (secrets: { id: string; name: string }[]) =>
  Response.json({ result: secrets, success: true }, { status: 200 });

/** A fetch that always rejects, to exercise the transport-failure path. */
const rejectingFetch: ByokFetch = () => Promise.reject(new Error("boom"));

describe("byokSecretName — {gateway_id}_{provider_slug}_{alias} (spike §1)", () => {
  test("composes the three underscore-delimited parts", () => {
    expect(byokSecretName("gw", workspaceId, provider)).toBe(secretName);
  });

  test("throws for a non-allowlisted provider", () => {
    expect(() =>
      byokSecretName("gw", workspaceId, modelProviderSchema.parse("openai"))
    ).toThrow(/not allowlisted/u);
  });
});

describe("createCloudflareByokClient.writeProviderKey", () => {
  test("creates a new secret with the composed name, scope, and raw value", async () => {
    const { calls, fetchImpl } = scriptedFetch([
      listResult([]),
      Response.json({ result: [{ id: "sec-1" }], success: true }),
    ]);
    const client = createCloudflareByokClient({
      ...baseConfig,
      fetch: fetchImpl,
    });

    const result = await client.writeProviderKey(
      workspaceId,
      provider,
      RAW_KEY
    );

    expect(result.ok).toBe(true);
    // 1) list (find by name), 2) POST create.
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe(
      `${secretsUrl}?search=${encodeURIComponent(secretName)}&per_page=50`
    );
    expect(calls[1]?.method).toBe("POST");
    expect(calls[1]?.url).toBe(secretsUrl);
    expect(calls[1]?.headers.authorization).toBe("Bearer cf-token-xyz");
    expect(JSON.parse(calls[1]?.body ?? "")).toEqual([
      { name: secretName, scopes: [AI_GATEWAY_SECRET_SCOPE], value: RAW_KEY },
    ]);
  });

  test("upserts an existing secret in place via PATCH by id", async () => {
    const { calls, fetchImpl } = scriptedFetch([
      listResult([{ id: "sec-9", name: secretName }]),
      Response.json({ result: { id: "sec-9" }, success: true }),
    ]);
    const client = createCloudflareByokClient({
      ...baseConfig,
      fetch: fetchImpl,
    });

    const result = await client.writeProviderKey(
      workspaceId,
      provider,
      RAW_KEY
    );

    expect(result.ok).toBe(true);
    expect(calls[1]?.method).toBe("PATCH");
    expect(calls[1]?.url).toBe(`${secretsUrl}/sec-9`);
    expect(JSON.parse(calls[1]?.body ?? "")).toEqual({ value: RAW_KEY });
  });

  test("maps a non-2xx create to a byok_registration_failed error", async () => {
    const { fetchImpl } = scriptedFetch([
      listResult([]),
      Response.json(
        {
          errors: [{ code: 1001, message: "store not found" }],
          success: false,
        },
        { status: 404 }
      ),
    ]);
    const client = createCloudflareByokClient({
      ...baseConfig,
      fetch: fetchImpl,
    });

    const result = await client.writeProviderKey(
      workspaceId,
      provider,
      RAW_KEY
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        kind: "byok_registration_failed",
        message: "store not found",
        operation: "write",
        status: 404,
      });
    }
  });

  test("maps a transport failure to a status-0 error", async () => {
    const client = createCloudflareByokClient({
      ...baseConfig,
      fetch: rejectingFetch,
    });

    const result = await client.writeProviderKey(
      workspaceId,
      provider,
      RAW_KEY
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(0);
      expect(result.error.operation).toBe("write");
    }
  });

  test("REDACTION: the raw key never appears in a failing call's error", async () => {
    // A hostile error body that even echoes the request payload — the client must still not
    // surface the key, because it copies only the envelope's own error messages.
    const { fetchImpl } = scriptedFetch([
      listResult([]),
      new Response(`upstream rejected payload [${RAW_KEY}]`, { status: 500 }),
    ]);
    const client = createCloudflareByokClient({
      ...baseConfig,
      fetch: fetchImpl,
    });

    const result = await client.writeProviderKey(
      workspaceId,
      provider,
      RAW_KEY
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).not.toContain(RAW_KEY);
      expect(JSON.stringify(result.error)).not.toContain(RAW_KEY);
      // Non-JSON error body collapses to the bare status line.
      expect(result.error.message).toBe("HTTP 500");
    }
  });
});

describe("createCloudflareByokClient.deleteProviderKey", () => {
  test("resolves the secret id by name and DELETEs it", async () => {
    const { calls, fetchImpl } = scriptedFetch([
      listResult([{ id: "sec-3", name: secretName }]),
      new Response(null, { status: 200 }),
    ]);
    const client = createCloudflareByokClient({
      ...baseConfig,
      fetch: fetchImpl,
    });

    const result = await client.deleteProviderKey(workspaceId, provider);

    expect(result.ok).toBe(true);
    expect(calls[1]?.method).toBe("DELETE");
    expect(calls[1]?.url).toBe(`${secretsUrl}/sec-3`);
  });

  test("is a no-op success when no matching secret exists (idempotent)", async () => {
    const { calls, fetchImpl } = scriptedFetch([
      // A fuzzy-search near-miss that must NOT be treated as a match.
      listResult([{ id: "other", name: "gw_anthropic_ws-other-anthropic" }]),
    ]);
    const client = createCloudflareByokClient({
      ...baseConfig,
      fetch: fetchImpl,
    });

    const result = await client.deleteProviderKey(workspaceId, provider);

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test("maps a non-2xx delete to a byok_registration_failed error", async () => {
    const { fetchImpl } = scriptedFetch([
      listResult([{ id: "sec-3", name: secretName }]),
      Response.json(
        { errors: [{ message: "forbidden" }], success: false },
        { status: 403 }
      ),
    ]);
    const client = createCloudflareByokClient({
      ...baseConfig,
      fetch: fetchImpl,
    });

    const result = await client.deleteProviderKey(workspaceId, provider);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        kind: "byok_registration_failed",
        message: "forbidden",
        operation: "delete",
        status: 403,
      });
    }
  });
});
