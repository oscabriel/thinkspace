import { describe, expect, test } from "bun:test";

import { createCloudflareCustomProviderProvisioner } from "../src/adapters/production/custom-provider";

const config = {
  accountId: "account-id",
  apiToken: "api-token",
  baseUrl: "https://cloudflare.test/client/v4",
};

describe("createCloudflareCustomProviderProvisioner", () => {
  test("lists then creates a missing provider", async () => {
    const calls: { input: string; init?: RequestInit }[] = [];
    const provisioner = createCloudflareCustomProviderProvisioner({
      ...config,
      fetch: async (input, init) => {
        calls.push({ init, input: String(input) });
        return calls.length === 1
          ? Response.json({ result: [], success: true })
          : Response.json({ result: { id: "provider-id" }, success: true });
      },
    });

    const result = await provisioner.ensureProvider({
      slug: "example-provider",
      upstreamBaseUrl: "https://api.example.com/v1",
    });

    expect(result.ok).toBe(true);
    expect(calls.map((call) => call.init?.method)).toEqual(["GET", "POST"]);
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      base_url: "https://api.example.com/v1",
      enable: true,
      name: "example-provider",
      slug: "example-provider",
    });
    expect(calls[1]?.init?.headers).toEqual({
      authorization: "Bearer api-token",
      "content-type": "application/json",
    });
  });

  test("finds an existing provider on a later page without creating a duplicate", async () => {
    const calls: { input: string; init?: RequestInit }[] = [];
    const responses = [
      Response.json({
        result: [{ id: "other-id", slug: "other-provider" }],
        result_info: { page: 1, per_page: 1, total_count: 2 },
        success: true,
      }),
      Response.json({
        result: [{ id: "existing-id", slug: "example-provider" }],
        result_info: { page: 2, per_page: 1, total_count: 2 },
        success: true,
      }),
      Response.json({ result: { id: "existing-id" }, success: true }),
    ];
    const provisioner = createCloudflareCustomProviderProvisioner({
      ...config,
      fetch: async (input, init) => {
        calls.push({ init, input: String(input) });
        return responses[calls.length - 1] as Response;
      },
    });

    const result = await provisioner.ensureProvider({
      slug: "example-provider",
      upstreamBaseUrl: "https://api.example.com",
    });

    expect(result.ok).toBe(true);
    expect(calls.map((call) => call.init?.method)).toEqual([
      "GET",
      "GET",
      "PATCH",
    ]);
    expect(calls[1]?.input).toEndWith("/custom-providers?page=2&per_page=1");
    expect(calls[2]?.input).toEndWith("/custom-providers/existing-id");
  });

  test("re-asserts an existing provider route by id", async () => {
    const calls: { input: string; init?: RequestInit }[] = [];
    const provisioner = createCloudflareCustomProviderProvisioner({
      ...config,
      fetch: async (input, init) => {
        calls.push({ init, input: String(input) });
        return calls.length === 1
          ? Response.json({
              result: [{ id: "existing-id", slug: "example-provider" }],
              success: true,
            })
          : Response.json({ result: { id: "existing-id" }, success: true });
      },
    });

    const result = await provisioner.ensureProvider({
      slug: "example-provider",
      upstreamBaseUrl: "https://api.example.com",
    });

    expect(result.ok).toBe(true);
    expect(calls[1]?.input).toEndWith("/custom-providers/existing-id");
    expect(calls[1]?.init?.method).toBe("PATCH");
  });

  test("returns a redaction-safe failure for HTTP and transport faults", async () => {
    const http = createCloudflareCustomProviderProvisioner({
      ...config,
      fetch: async () =>
        new Response("secret-bearing response", { status: 403 }),
    });
    expect(
      await http.ensureProvider({
        slug: "example-provider",
        upstreamBaseUrl: "https://api.example.com",
      })
    ).toEqual({
      error: {
        kind: "custom_provider_provisioning_failed",
        message: "Cloudflare Custom Provider API returned HTTP 403",
        status: 403,
      },
      ok: false,
    });

    const network = createCloudflareCustomProviderProvisioner({
      ...config,
      fetch: async () => {
        throw new Error("token api-token");
      },
    });
    const result = await network.ensureProvider({
      slug: "example-provider",
      upstreamBaseUrl: "https://api.example.com",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe("network error");
      expect(result.error.status).toBe(0);
    }
  });
});
