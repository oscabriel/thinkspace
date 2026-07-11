import { createKeyStore } from "@thinkspace/domain/adapters/production";
import type { ModelProvider } from "@thinkspace/domain/model";
import { providerAllowlist } from "@thinkspace/domain/provider-allowlist";
import type { KeyStoreWriteError } from "@thinkspace/domain/seams/key-store";
import type { TenantContext } from "@thinkspace/domain/seams/tenant-data-access";
import { env } from "@thinkspace/env/server";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { TenantVariables } from "./tenant-context";
import { WORKSPACE_MANAGER_ROLES } from "./tenant-context";

/**
 * E3.2 / ADR 0040: the write half of the BYOK path. Owner/admin register or revoke a workspace's
 * raw provider key through the `KeyStore` port. The production default (`EnvelopeD1KeyStore`) seals
 * the key into D1's `key_ciphertext` column; the retained legacy adapter writes Cloudflare Secrets
 * Store. Either way the `workspace_provider_key` registry row records merely that a provider is
 * keyed, and the write ordering (a row never outliving stored key material) is the adapter's
 * concern — this route just calls `writeKey`/`deleteKey`.
 *
 * Redaction discipline: the raw key transits this route exactly once, in the POST body. It is never
 * logged, never echoed, and never written to D1 as plaintext (the envelope adapter seals it before
 * it touches storage) — no 4xx/5xx here carries a request body; the KeyStore's own error is
 * surfaced as `{ kind, operation }` only, its already-redaction-safe `message` dropped at this layer.
 */

/** The raw key is opaque here: a non-empty string, validated only for presence, never inspected. */
const keyBodySchema = z.object({ key: z.string().min(1) });

/** Resolve a path `:provider` segment to an allowlisted brand, or `null` for anything else. */
const allowlistedProvider = (provider: string): ModelProvider | null =>
  providerAllowlist.find((entry) => entry.provider === provider)?.provider ??
  null;

/**
 * ADR 0040: the BYOK KeyStore port. `createKeyStore` selects `EnvelopeD1KeyStore` when
 * `BYOK_MASTER_KEY` is bound (the production default — AES-256-GCM ciphertext in D1) and the legacy
 * `SecretsStoreKeyStore` otherwise. The adapter owns the write ordering the route used to sequence
 * by hand (registry row vs. stored secret) so neither can outlive the other.
 */
const buildKeyStore = (context: TenantContext) =>
  createKeyStore({ context, env });

/**
 * A key-store write/delete failure is an upstream-dependency fault, not a client error and not a
 * fault in this worker: 502. The operation is echoed (`write`/`delete`) but the underlying message
 * is dropped — the route never widens the redaction surface the adapter already sealed.
 */
const REGISTRATION_FAILURE_STATUS: ContentfulStatusCode = 502;

const registrationFailure = (error: KeyStoreWriteError) => ({
  error: { kind: error.kind, operation: error.operation },
});

/**
 * A registry row as stored: `created_at` is the epoch-millis the row was written (see the E3.2
 * `put` upsert). The row carries NO key material — the raw key lives solely in Secrets Store — so
 * this read is safe for any workspace member, not just a key manager, and needs no role gate.
 */
interface ProviderKeyRow {
  readonly created_at: number;
  readonly provider: string;
}

export const providerKeyRoutes = new Hono<{ Variables: TenantVariables }>()
  /**
   * The read half of the BYOK surface: which providers this workspace has keyed, and when. Scoped
   * to the resident tenant (`workspace_id = context.workspaceId`) exactly as the D1 model router
   * reads the same table. Returns registry facts only (provider id + ISO createdAt); the registry
   * holds no key material, so no key is ever exposed here. Any member may read (browsable key-first
   * status, ADR 0011); membership itself is enforced by the tenant middleware (401 without a
   * session, 404 for a non-member).
   */
  .get("/providers", async (c) => {
    const context = c.get("tenantContext");
    const rows = await env.DB.prepare(
      "SELECT provider, created_at FROM workspace_provider_key WHERE workspace_id = ?1 ORDER BY created_at ASC"
    )
      .bind(context.workspaceId)
      .all<ProviderKeyRow>();

    return c.json({
      providers: rows.results.map((row) => ({
        createdAt: new Date(row.created_at).toISOString(),
        provider: row.provider,
      })),
    });
  })
  .post("/providers/:provider/key", async (c) => {
    const context = c.get("tenantContext");
    if (!WORKSPACE_MANAGER_ROLES.has(context.role)) {
      return c.json({ error: { kind: "insufficient_role" } }, 403);
    }

    const provider = allowlistedProvider(c.req.param("provider"));
    if (provider === null) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    const body = keyBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      // The body carried the raw key — never echo it, even in the parse-failure answer.
      return c.json({ error: { kind: "malformed_request" } }, 400);
    }

    // The KeyStore owns the storage write AND the registry-row upsert (envelope: one D1 upsert;
    // legacy: Secrets Store secret first, then the row) — the row never exists without stored key.
    const written = await buildKeyStore(context).writeKey(
      provider,
      body.data.key
    );
    if (!written.ok) {
      return c.json(
        registrationFailure(written.error),
        REGISTRATION_FAILURE_STATUS
      );
    }

    return c.json({ provider }, 200);
  })
  .delete("/providers/:provider/key", async (c) => {
    const context = c.get("tenantContext");
    if (!WORKSPACE_MANAGER_ROLES.has(context.role)) {
      return c.json({ error: { kind: "insufficient_role" } }, 403);
    }

    const provider = allowlistedProvider(c.req.param("provider"));
    if (provider === null) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    // The KeyStore owns the delete ordering (envelope: drop the row; legacy: registry row first,
    // then the Secrets Store secret) so a row can never outlive a deleted secret. Idempotent — a
    // retry after a failed delete converges.
    const deleted = await buildKeyStore(context).deleteKey(provider);
    if (!deleted.ok) {
      return c.json(
        registrationFailure(deleted.error),
        REGISTRATION_FAILURE_STATUS
      );
    }

    return c.json({ provider }, 200);
  });
