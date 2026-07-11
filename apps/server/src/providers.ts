import {
  createKeyStore,
  createUnverifiedCustomProviderProvisioner,
} from "@thinkspace/domain/adapters/production";
import {
  findAllowEntry,
  isRegistrableTier,
} from "@thinkspace/domain/provider-allowlist";
import type { ProviderAllowEntry } from "@thinkspace/domain/provider-allowlist";
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

/**
 * Resolve a path `:provider` segment against the E11.9 tiered allowlist. Three outcomes the route
 * maps to distinct statuses: `unknown` (not allowlisted at all → 404), an `unsupported`-tier entry
 * (sigv4/oauth/local/per-resource → typed 422, never a 500 and never a dead 404), or a registrable
 * entry (Tier A/B → proceed).
 */
type ResolvedProviderTarget =
  | { readonly kind: "registrable"; readonly entry: ProviderAllowEntry }
  | { readonly kind: "unknown" }
  | { readonly kind: "unsupported"; readonly entry: ProviderAllowEntry };

const resolveProviderTarget = (provider: string): ResolvedProviderTarget => {
  const entry = findAllowEntry(provider);
  if (entry === undefined) {
    return { kind: "unknown" };
  }
  return isRegistrableTier(entry.tier)
    ? { entry, kind: "registrable" }
    : { entry, kind: "unsupported" };
};

/**
 * ADR 0040: the BYOK KeyStore port. `createKeyStore` selects `EnvelopeD1KeyStore` when
 * `BYOK_MASTER_KEY` is bound (the production default — AES-256-GCM ciphertext in D1) and the legacy
 * `SecretsStoreKeyStore` otherwise. The adapter owns the write ordering the route used to sequence
 * by hand (registry row vs. stored secret) so neither can outlive the other.
 */
const buildKeyStore = (context: TenantContext) =>
  createKeyStore({ context, env });

/**
 * ADR 0040 §7 (E11.9): the AI Gateway Custom Provider provisioner. The default production adapter is
 * the honest UNVERIFIED no-op stub — the CF Custom Provider write surface is not yet verified, so
 * provisioning returns a typed `unverified` result the write route logs and proceeds past. A
 * non-native provider is therefore honestly Tier-B "first run confirms" (never a false "provisioned"
 * claim); the real CF-API adapter swaps in here once the surface is verified.
 */
const customProviderProvisioner = createUnverifiedCustomProviderProvisioner();

/**
 * Best-effort Custom Provider provisioning for a non-native (`custom-provider`) entry, run lazily
 * after the key is sealed. Provisioning failure NEVER fails key registration — the key is already
 * stored; a non-native route that isn't (yet) provisioned settles as a visible first-run failure
 * (ADR 0028), which is the Tier-B contract. Holds no key material (only the public upstream URL).
 */
const provisionCustomProvider = async (
  entry: ProviderAllowEntry
): Promise<void> => {
  if (entry.routing !== "custom-provider" || entry.upstreamBaseUrl === undefined) {
    return;
  }
  const provisioned = await customProviderProvisioner.ensureProvider({
    slug: entry.gatewaySlug,
    upstreamBaseUrl: entry.upstreamBaseUrl,
  });
  if (!provisioned.ok) {
    // Redaction-safe: the provisioner's message carries no key (it never sees one).
    console.warn(
      `[providers] custom-provider provisioning for '${entry.provider}' unconfirmed: ${provisioned.error.kind}`
    );
  }
};

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

    const target = resolveProviderTarget(c.req.param("provider"));
    if (target.kind === "unknown") {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }
    if (target.kind === "unsupported") {
      // E11.9: the provider is real but its auth (sigv4/oauth/local/per-resource) isn't a static
      // header we can register — a typed 4xx, never a 500 and never a dead 404. The key never
      // reaches storage (and the body is not even read), so nothing sensitive is touched here.
      return c.json(
        {
          error: {
            kind: "provider_unsupported",
            reason: target.entry.unsupportedReason,
            tier: target.entry.tier,
          },
        },
        422
      );
    }
    const { entry } = target;

    const body = keyBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      // The body carried the raw key — never echo it, even in the parse-failure answer.
      return c.json({ error: { kind: "malformed_request" } }, 400);
    }

    // The KeyStore owns the storage write AND the registry-row upsert (envelope: one D1 upsert;
    // legacy: Secrets Store secret first, then the row) — the row never exists without stored key.
    const written = await buildKeyStore(context).writeKey(
      entry.provider,
      body.data.key
    );
    if (!written.ok) {
      return c.json(
        registrationFailure(written.error),
        REGISTRATION_FAILURE_STATUS
      );
    }

    // Lazy, idempotent, best-effort — a non-native route's provisioning never fails registration.
    await provisionCustomProvider(entry);

    return c.json({ provider: entry.provider }, 200);
  })
  .delete("/providers/:provider/key", async (c) => {
    const context = c.get("tenantContext");
    if (!WORKSPACE_MANAGER_ROLES.has(context.role)) {
      return c.json({ error: { kind: "insufficient_role" } }, 403);
    }

    // Delete resolves against the allowlist but does not gate on tier: a key can only exist for a
    // registrable provider, and `deleteKey` is an idempotent no-op otherwise, so an unsupported or
    // since-demoted provider converges to success rather than 4xx-ing a revocation.
    const entry = findAllowEntry(c.req.param("provider"));
    if (entry === undefined) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    // The KeyStore owns the delete ordering (envelope: drop the row; legacy: registry row first,
    // then the Secrets Store secret) so a row can never outlive a deleted secret. Idempotent — a
    // retry after a failed delete converges.
    const deleted = await buildKeyStore(context).deleteKey(entry.provider);
    if (!deleted.ok) {
      return c.json(
        registrationFailure(deleted.error),
        REGISTRATION_FAILURE_STATUS
      );
    }

    return c.json({ provider: entry.provider }, 200);
  });
