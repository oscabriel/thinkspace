import { z } from "zod";

import { byokSecretAlias } from "../../byok";
import type { WorkspaceId } from "../../ids";
import type { ModelProvider } from "../../model";
import { providerAllowlist } from "../../provider-allowlist";
import { err, ok } from "../../result";
import type { AsyncResult } from "../../result";

/**
 * Cloudflare REST client for BYOK provider-key registration (E3.1, baked decision 3). Its whole
 * job is the write half of the read path: write and delete the Secrets Store secret whose NAME is
 * what AI Gateway resolves a BYOK key by at runtime.
 *
 * Design points of record (BACKLOG E3 + E1.1 spike findings §1–2, ADR 0036 §4):
 *  - the runtime lookup is by secret NAME `{gateway_id}_{provider_slug}_{alias}` (spike §1); the
 *    `secret_id` is NOT used for resolution and the `cf-aig-byok-alias` header carries only the
 *    `{alias}` component. There is therefore **no separate gateway-side "alias attach" endpoint** —
 *    naming the secret correctly IS the complete BYOK wiring. Nothing here touches the gateway.
 *  - `{provider_slug}` is the AI Gateway path segment (`gatewaySlug` in the allowlist) and
 *    `{alias}` is {@link byokSecretAlias}; {@link byokSecretName} composes the three parts.
 *  - the raw provider key transits this client exactly once, in the request body, and NEVER lands
 *    in a log, a thrown error, or a return value (baked decision 3). Error mapping copies only the
 *    Cloudflare envelope's own `errors[].message`/`code`, never the request body or response text.
 *  - the fetch is injected (mirroring {@link ../production/model-catalog}) so unit tests run
 *    without workers machinery; production defaults to the isolate's global fetch.
 *  - only the CF API subset actually used is typed — no Cloudflare SDK dependency.
 */

/** Default Cloudflare REST API origin; overridable via config for tests / alternate edges. */
export const CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4";

/** The confirmed Secrets Store scope value for AI Gateway BYOK secrets (spike §1, ADR 0036 §4). */
export const AI_GATEWAY_SECRET_SCOPE = "ai_gateway";

/** The outbound fetch shape the client rides; injectable purely so unit tests can supply a fake. */
export type ByokFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface CloudflareByokConfig {
  /** Cloudflare account id owning the Secrets Store + AI Gateway. */
  readonly accountId: string;
  /** Secrets Store id (one store per account in the open beta; spike §2). */
  readonly storeId: string;
  /** AI Gateway id — the `{gateway_id}` component of the secret name. */
  readonly gatewayId: string;
  /** Account-scoped API token; a worker secret in production (baked decision 3). */
  readonly apiToken: string;
  /** Injected fetch for tests; defaults to the isolate's global fetch (the production path). */
  readonly fetch?: ByokFetch;
  /** REST API origin; defaults to {@link CLOUDFLARE_API_BASE_URL}. */
  readonly baseUrl?: string;
}

/** Which registration call failed, for the caller's mapping to an edge status (E3.2). */
export type ByokRegistrationOperation = "write" | "delete";

/**
 * A registration failure, redaction-safe by construction: `message` is composed only from the
 * Cloudflare error envelope (or a bare `HTTP <status>`), so it can never carry key material.
 */
export interface ByokRegistrationError {
  readonly kind: "byok_registration_failed";
  readonly operation: ByokRegistrationOperation;
  /** HTTP status of the failing CF call, or `0` for a transport/network failure. */
  readonly status: number;
  /** Cloudflare's own error text (or `HTTP <status>`); never the raw key or request body. */
  readonly message: string;
}

export interface CloudflareByokClient {
  /**
   * Upsert the workspace's raw provider key into Secrets Store under {@link byokSecretName}.
   * Idempotent across re-registration: an existing secret of that name is updated in place.
   */
  readonly writeProviderKey: (
    workspaceId: WorkspaceId,
    provider: ModelProvider,
    rawKey: string
  ) => AsyncResult<undefined, ByokRegistrationError>;
  /**
   * Delete the workspace's provider-key secret. Idempotent: a missing secret is a no-op success,
   * so a retried delete converges.
   */
  readonly deleteProviderKey: (
    workspaceId: WorkspaceId,
    provider: ModelProvider
  ) => AsyncResult<undefined, ByokRegistrationError>;
}

/**
 * Compose the Secrets Store secret name `{gateway_id}_{provider_slug}_{alias}` (spike §1).
 * `{provider_slug}` is the provider's AI Gateway path segment; `{alias}` is {@link byokSecretAlias}.
 */
export const byokSecretName = (
  gatewayId: string,
  workspaceId: WorkspaceId,
  provider: ModelProvider
): string => {
  const entry = providerAllowlist.find(
    (candidate) => candidate.provider === provider
  );
  if (entry === undefined) {
    throw new Error(
      `byokSecretName: provider '${provider}' is not allowlisted`
    );
  }
  return `${gatewayId}_${entry.gatewaySlug}_${byokSecretAlias(workspaceId, provider)}`;
};

// --- Cloudflare REST boundary schema (loose: only the fields we read are typed) ----------------

/** The Cloudflare error envelope; both `errors` and `result` are tolerated as absent/loose. */
const cfEnvelopeSchema = z.object({
  errors: z
    .array(z.object({ code: z.number().optional(), message: z.string() }))
    .optional(),
});

const cfSecretSchema = z.object({ id: z.string().min(1), name: z.string() });
const cfListEnvelopeSchema = z.object({
  result: z.array(cfSecretSchema).optional(),
});

/**
 * Distil a non-2xx CF response into a redaction-safe message: join the envelope's own
 * `errors[]` (never the request body), falling back to `HTTP <status>`. Reads the body via a
 * defensive `text()`+parse so a non-JSON error page can't throw here.
 */
const messageFromResponse = async (response: Response): Promise<string> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await response.text());
  } catch {
    return `HTTP ${response.status}`;
  }
  const envelope = cfEnvelopeSchema.safeParse(parsed);
  const messages = envelope.success
    ? (envelope.data.errors ?? []).map((e) => e.message).filter(Boolean)
    : [];
  return messages.length > 0 ? messages.join("; ") : `HTTP ${response.status}`;
};

/**
 * Build a per-config client. Production constructs one from worker env; tests construct throwaway
 * instances with an injected fetch. Holds no key material — each key is a per-call argument.
 */
export const createCloudflareByokClient = (
  config: CloudflareByokConfig
): CloudflareByokClient => {
  const fetchImpl = config.fetch ?? (globalThis.fetch as ByokFetch);
  const baseUrl = config.baseUrl ?? CLOUDFLARE_API_BASE_URL;
  const secretsUrl = `${baseUrl}/accounts/${config.accountId}/secrets_store/stores/${config.storeId}/secrets`;
  const authHeaders = { authorization: `Bearer ${config.apiToken}` };

  /** Resolve the secret id for an exact name via the list endpoint (delete/upsert need the id). */
  const findSecretId = async (
    operation: ByokRegistrationOperation,
    name: string
  ): AsyncResult<string | null, ByokRegistrationError> => {
    const response = await fetchImpl(
      `${secretsUrl}?search=${encodeURIComponent(name)}&per_page=50`,
      { headers: authHeaders, method: "GET" }
    );
    if (!response.ok) {
      return err({
        kind: "byok_registration_failed",
        message: await messageFromResponse(response),
        operation,
        status: response.status,
      });
    }
    const envelope = cfListEnvelopeSchema.safeParse(await response.json());
    // `search` is a fuzzy match over name+comment, so pick the exact-name row ourselves.
    const match = envelope.success
      ? (envelope.data.result ?? []).find((s) => s.name === name)
      : undefined;
    return ok(match?.id ?? null);
  };

  const writeProviderKey = async (
    workspaceId: WorkspaceId,
    provider: ModelProvider,
    rawKey: string
  ): AsyncResult<undefined, ByokRegistrationError> => {
    const name = byokSecretName(config.gatewayId, workspaceId, provider);
    let response: Response;
    try {
      const existing = await findSecretId("write", name);
      if (!existing.ok) {
        return existing;
      }
      // Create (bulk endpoint takes an array; we write one) when absent; upsert the value in
      // place by id when re-registering.
      response =
        existing.value === null
          ? await fetchImpl(secretsUrl, {
              body: JSON.stringify([
                { name, scopes: [AI_GATEWAY_SECRET_SCOPE], value: rawKey },
              ]),
              headers: { ...authHeaders, "content-type": "application/json" },
              method: "POST",
            })
          : await fetchImpl(`${secretsUrl}/${existing.value}`, {
              body: JSON.stringify({ value: rawKey }),
              headers: { ...authHeaders, "content-type": "application/json" },
              method: "PATCH",
            });
    } catch {
      // Transport failure: surface a status-less error whose message omits the caught error
      // entirely (a stringified fetch error could echo the request body / key).
      return err({
        kind: "byok_registration_failed",
        message: "network error",
        operation: "write",
        status: 0,
      });
    }
    if (!response.ok) {
      return err({
        kind: "byok_registration_failed",
        message: await messageFromResponse(response),
        operation: "write",
        status: response.status,
      });
    }
    return ok();
  };

  const deleteProviderKey = async (
    workspaceId: WorkspaceId,
    provider: ModelProvider
  ): AsyncResult<undefined, ByokRegistrationError> => {
    const name = byokSecretName(config.gatewayId, workspaceId, provider);
    let response: Response;
    try {
      const existing = await findSecretId("delete", name);
      if (!existing.ok) {
        return existing;
      }
      if (existing.value === null) {
        // Already gone: a retried delete converges to success.
        return ok();
      }
      response = await fetchImpl(`${secretsUrl}/${existing.value}`, {
        headers: authHeaders,
        method: "DELETE",
      });
    } catch {
      // Transport failure: same fixed message as the write path — a stringified fetch
      // error could echo the request.
      return err({
        kind: "byok_registration_failed",
        message: "network error",
        operation: "delete",
        status: 0,
      });
    }
    if (!response.ok) {
      return err({
        kind: "byok_registration_failed",
        message: await messageFromResponse(response),
        operation: "delete",
        status: response.status,
      });
    }
    return ok();
  };

  return { deleteProviderKey, writeProviderKey };
};
