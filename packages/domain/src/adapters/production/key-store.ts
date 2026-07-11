import type { D1Database } from "@cloudflare/workers-types";

import { byokSecretAlias } from "../../byok";
import { parseModelId } from "../../ids";
import { openProviderKey, sealProviderKey } from "../../key-envelope";
import type { ModelProvider } from "../../model";
import { err, ok } from "../../result";
import type {
  KeyResolveError,
  KeyStore,
  KeyStoreWriteError,
  ProviderAuthRequest,
  ResolvedProviderAuth,
} from "../../seams/key-store";
import type {
  DataAccessContext,
  TenantDataAccess,
} from "../../seams/tenant-data-access";
import type { CloudflareByokClient } from "./cloudflare-byok";
import { createCloudflareByokClient } from "./cloudflare-byok";
import { createD1ProviderKeyRegistry } from "./model-routing";
import { createD1TenantDataAccess } from "./tenant-data-access";

/**
 * ADR 0040: the two production `KeyStore` adapters plus the env selector. `EnvelopeD1KeyStore` is
 * the production default (envelope-encrypted D1, no Secrets Store cap); `SecretsStoreKeyStore` is
 * the retained legacy adapter (today's Cloudflare Secrets Store behavior verbatim). Both write the
 * `workspace_provider_key` registry row the router/curator/catalog read, so those semantics are
 * unchanged; the envelope adapter additionally seals the raw key into the `key_ciphertext` column.
 */

const writeError = (
  operation: "delete" | "write",
  message: string
): KeyStoreWriteError => ({
  kind: "byok_registration_failed",
  message,
  operation,
  status: 0,
});

// --- Legacy adapter: Cloudflare Secrets Store (today's behavior, ADR 0036 §4) -------------------

export interface SecretsStoreKeyStoreConfig {
  /** Lazily built so a resolve-only holder (the DO) never needs the Secrets Store write bindings. */
  readonly byokClient: () => CloudflareByokClient;
  readonly clock?: () => Date;
  readonly context: DataAccessContext;
  readonly db: D1Database;
}

/**
 * The retained legacy adapter. `writeKey`/`deleteKey` are today's E3.2 ordering — the CF secret and
 * the registry row are sequenced so the row never outlives a live secret — now owned by the
 * adapter instead of the edge route. `resolveProviderAuth` is pure: it returns the
 * `cf-aig-byok-alias` the gateway substitutes the stored secret by (no I/O, always succeeds), so a
 * DO can hold this adapter on the hot path without any Secrets Store binding.
 */
export const createSecretsStoreKeyStore = (
  config: SecretsStoreKeyStoreConfig
): KeyStore => {
  const { context } = config;
  const registry = createD1ProviderKeyRegistry({
    clock: config.clock,
    context,
    db: config.db,
  });

  return {
    context,
    deleteKey: async (provider) => {
      // Registry row first (reverse of write): the row can never outlive a deleted secret.
      await registry.remove(provider);
      const deleted = await config
        .byokClient()
        .deleteProviderKey(context.workspaceId, provider);
      return deleted.ok ? ok() : err(deleted.error);
    },
    resolveProviderAuth: async (input: ProviderAuthRequest) => {
      const provider = parseModelId(input.modelId).providerId as ModelProvider;
      return ok<ResolvedProviderAuth>({
        alias: byokSecretAlias(context.workspaceId, provider),
        kind: "alias",
      });
    },
    writeKey: async (provider, rawKey) => {
      // Secret first: the registry row exists only once the Secrets Store write succeeded.
      const written = await config
        .byokClient()
        .writeProviderKey(context.workspaceId, provider, rawKey);
      if (!written.ok) {
        return err(written.error);
      }
      await registry.put(provider);
      return ok();
    },
  };
};

// --- Envelope adapter: AES-256-GCM ciphertext in D1 (the production default) --------------------

export interface EnvelopeD1KeyStoreConfig {
  readonly clock?: () => Date;
  readonly context: DataAccessContext;
  /** The seam the DO reads ciphertext through — never a raw DO→D1 SELECT (ADR 0040). */
  readonly dataAccess: TenantDataAccess<DataAccessContext>;
  readonly db: D1Database;
  /** The base64 `BYOK_MASTER_KEY`; env names only ever appear in code, never the value in logs. */
  readonly masterKey: string;
}

export const createEnvelopeD1KeyStore = (
  config: EnvelopeD1KeyStoreConfig
): KeyStore => {
  const { context, dataAccess, db, masterKey } = config;
  const clock = config.clock ?? (() => new Date());

  return {
    context,
    deleteKey: async (provider) => {
      try {
        await db
          .prepare(
            "DELETE FROM workspace_provider_key WHERE workspace_id = ?1 AND provider = ?2"
          )
          .bind(context.workspaceId, provider)
          .run();
        return ok();
      } catch {
        return err(writeError("delete", "storage error"));
      }
    },
    resolveProviderAuth: async (input: ProviderAuthRequest) => {
      const provider = parseModelId(input.modelId).providerId as ModelProvider;
      const read = await dataAccess.getProviderKeyCiphertext({ provider });
      if (!read.ok) {
        if (read.error.kind === "tenant_guard_violation") {
          return err<KeyResolveError>(read.error);
        }
        // No other data-access fault can arise for this workspace-scoped read; fail closed.
        return err<KeyResolveError>({
          kind: "byok_key_missing",
          modelId: input.modelId,
          provider,
          workspaceId: context.workspaceId,
        });
      }
      const ciphertext = read.value;
      // No registry row: the key was never registered or was revoked between the edge gate and the
      // turn — fail closed, exactly like the byok gate.
      if (ciphertext === null) {
        return err<KeyResolveError>({
          kind: "byok_key_missing",
          modelId: input.modelId,
          provider,
          workspaceId: context.workspaceId,
        });
      }
      // A row with no ciphertext predates the envelope migration — fall back to the legacy alias so
      // the gateway keeps substituting the still-live Secrets Store secret (ADR 0040 migration path).
      if (ciphertext.sealedKey === null) {
        return ok<ResolvedProviderAuth>({
          alias: byokSecretAlias(context.workspaceId, provider),
          kind: "alias",
        });
      }
      try {
        const rawKey = await openProviderKey(masterKey, ciphertext.sealedKey);
        return ok<ResolvedProviderAuth>({ kind: "header", value: rawKey });
      } catch {
        // A wrong master key, a corrupt ciphertext, or a failed GCM tag check — fail closed with a
        // key-free typed error; never decrypt to garbage and never echo the crypto error.
        return err<KeyResolveError>({
          kind: "byok_key_undecryptable",
          modelId: input.modelId,
          provider,
          workspaceId: context.workspaceId,
        });
      }
    },
    writeKey: async (provider, rawKey) => {
      let sealed: string;
      try {
        sealed = await sealProviderKey(masterKey, rawKey);
      } catch {
        return err(writeError("write", "encryption error"));
      }
      try {
        // Row + ciphertext in one upsert: re-registration replaces the ciphertext in place and
        // preserves `created_at` (the curator's earliest-keyed ordering, ADR 0038 §2).
        await db
          .prepare(
            "INSERT INTO workspace_provider_key (workspace_id, provider, created_at, key_ciphertext) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (workspace_id, provider) DO UPDATE SET key_ciphertext = excluded.key_ciphertext"
          )
          .bind(context.workspaceId, provider, clock().getTime(), sealed)
          .run();
        return ok();
      } catch {
        return err(writeError("write", "storage error"));
      }
    },
  };
};

// --- Selector: production default is envelope; legacy when no master key is bound ---------------

export interface KeyStoreEnv {
  readonly BYOK_CF_ACCOUNT_ID?: string;
  readonly BYOK_CF_API_TOKEN?: string;
  readonly BYOK_CF_GATEWAY_ID?: string;
  readonly BYOK_CF_STORE_ID?: string;
  /** ADR 0040: presence selects the envelope adapter; absence falls back to the legacy adapter. */
  readonly BYOK_MASTER_KEY?: string;
  readonly DB: D1Database;
}

export interface CreateKeyStoreConfig {
  readonly clock?: () => Date;
  readonly context: DataAccessContext;
  readonly env: KeyStoreEnv;
}

/**
 * ADR 0040: select the production KeyStore. `BYOK_MASTER_KEY` bound → `EnvelopeD1KeyStore` (the
 * production default); unbound (e.g. the test env, or a stage that has not provisioned the secret)
 * → the legacy `SecretsStoreKeyStore`. The envelope adapter reads ciphertext through the
 * tenant-data-access seam; the legacy adapter builds its Cloudflare client lazily so a resolve-only
 * holder needs no Secrets Store bindings.
 */
export const createKeyStore = (config: CreateKeyStoreConfig): KeyStore => {
  const { context, env } = config;
  const masterKey = env.BYOK_MASTER_KEY;
  if (masterKey !== undefined && masterKey.length > 0) {
    return createEnvelopeD1KeyStore({
      clock: config.clock,
      context,
      dataAccess: createD1TenantDataAccess({ context, db: env.DB }),
      db: env.DB,
      masterKey,
    });
  }
  return createSecretsStoreKeyStore({
    byokClient: () =>
      createCloudflareByokClient({
        accountId: env.BYOK_CF_ACCOUNT_ID ?? "",
        apiToken: env.BYOK_CF_API_TOKEN ?? "",
        gatewayId: env.BYOK_CF_GATEWAY_ID ?? "",
        storeId: env.BYOK_CF_STORE_ID ?? "",
      }),
    clock: config.clock,
    context,
    db: env.DB,
  });
};
