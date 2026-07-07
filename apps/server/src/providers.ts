import {
  type ByokRegistrationError,
  createCloudflareByokClient,
  createD1ProviderKeyRegistry,
} from "@thinkspace/domain/adapters/production";
import type { ModelProvider } from "@thinkspace/domain/model";
import { providerAllowlist } from "@thinkspace/domain/provider-allowlist";
import type { TenantContext } from "@thinkspace/domain/seams/tenant-data-access";
import { env } from "@thinkspace/env/server";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { TenantVariables } from "./tenant-context";

/**
 * E3.2 (baked decision 3): the write half of the BYOK read path. Owner/admin register or revoke
 * a workspace's raw provider key; the key lands ONLY in Cloudflare Secrets Store (via the E3.1
 * client) and the `workspace_provider_key` registry row records merely that a provider is keyed.
 *
 * Redaction discipline (baked decision 3): the raw key transits this route exactly once, in the
 * POST body. It is never logged, never written to D1, and never echoed — no 4xx/5xx here carries
 * a request body; even the CF client's own error is surfaced as `{ kind, operation }` only, and
 * its `message` (already redaction-safe by construction) is deliberately dropped at this layer.
 *
 * Write vs. delete ordering (the registry row must never outlive a successfully deleted secret):
 *  - POST: write the Secrets Store secret FIRST, then upsert the registry row. The row therefore
 *    only ever exists once the secret write succeeded; a failed CF write leaves no row.
 *  - DELETE: delete the registry row FIRST, then delete the secret. This is the reverse of POST
 *    on purpose — it guarantees the row can never outlive a deleted secret. Should the secret
 *    delete then fail, the route answers an error; a retry re-runs the (idempotent) row delete
 *    and the (idempotent) secret delete and converges, at worst leaving a harmless orphan secret
 *    in the transient window — never a live registry row over a dead secret.
 */

/** Owner/admin may manage provider keys; a member is 403 (insufficient_role). */
const KEY_MANAGER_ROLES: ReadonlySet<TenantContext["role"]> = new Set([
  "admin",
  "owner",
]);

/** The raw key is opaque here: a non-empty string, validated only for presence, never inspected. */
const keyBodySchema = z.object({ key: z.string().min(1) });

/** Resolve a path `:provider` segment to an allowlisted brand, or `null` for anything else. */
const allowlistedProvider = (provider: string): ModelProvider | null =>
  providerAllowlist.find((entry) => entry.provider === provider)?.provider ??
  null;

/** Per-config CF BYOK client, built from the worker's Secrets Store / AI Gateway env bindings. */
const buildByokClient = () =>
  createCloudflareByokClient({
    accountId: env.BYOK_CF_ACCOUNT_ID,
    apiToken: env.BYOK_CF_API_TOKEN,
    gatewayId: env.BYOK_CF_GATEWAY_ID,
    storeId: env.BYOK_CF_STORE_ID,
  });

const buildRegistry = (context: TenantContext) =>
  createD1ProviderKeyRegistry({ context, db: env.DB });

/**
 * A Secrets Store write/delete failure is an upstream-dependency fault, not a client error and
 * not a fault in this worker: 502. The operation is echoed (`write`/`delete`) but the CF message
 * is dropped — the route never widens the redaction surface the E3.1 client already sealed.
 */
const REGISTRATION_FAILURE_STATUS: ContentfulStatusCode = 502;

const registrationFailure = (error: ByokRegistrationError) => ({
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
    if (!KEY_MANAGER_ROLES.has(context.role)) {
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

    // Secret first: the registry row exists only if the Secrets Store write succeeded.
    const written = await buildByokClient().writeProviderKey(
      context.workspaceId,
      provider,
      body.data.key
    );
    if (!written.ok) {
      return c.json(
        registrationFailure(written.error),
        REGISTRATION_FAILURE_STATUS
      );
    }

    await buildRegistry(context).put(provider);
    return c.json({ provider }, 200);
  })
  .delete("/providers/:provider/key", async (c) => {
    const context = c.get("tenantContext");
    if (!KEY_MANAGER_ROLES.has(context.role)) {
      return c.json({ error: { kind: "insufficient_role" } }, 403);
    }

    const provider = allowlistedProvider(c.req.param("provider"));
    if (provider === null) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    // Registry row first (reverse of POST): the row can never outlive a deleted secret. Both
    // steps are idempotent, so a retry after a failed secret delete converges.
    await buildRegistry(context).remove(provider);
    const deleted = await buildByokClient().deleteProviderKey(
      context.workspaceId,
      provider
    );
    if (!deleted.ok) {
      return c.json(
        registrationFailure(deleted.error),
        REGISTRATION_FAILURE_STATUS
      );
    }

    return c.json({ provider }, 200);
  });
