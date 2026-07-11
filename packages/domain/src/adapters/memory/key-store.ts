import { byokSecretAlias } from "../../byok";
import { parseModelId } from "../../ids";
import { openProviderKey, sealProviderKey } from "../../key-envelope";
import type { ModelProvider } from "../../model";
import { err, ok } from "../../result";
import type {
  KeyResolveError,
  KeyStore,
  ResolvedProviderAuth,
} from "../../seams/key-store";
import type { DataAccessContext } from "../../seams/tenant-data-access";
import { idKey } from "./helpers";

/**
 * In-memory `KeyStore` mirroring `EnvelopeD1KeyStore` semantics for the fast (bun) contract suite:
 * real AES-256-GCM via the shared `key-envelope`, ciphertext held in a swappable `storage` map so a
 * second store with a foreign master key can share the same sealed bytes (the wrong-key
 * fail-closed pin). `sealedKey: null` in the map models a legacy (pre-envelope) row → alias fallback.
 */
export interface MemoryKeyStoreConfig {
  readonly context: DataAccessContext;
  readonly masterKey: string;
  /** Shared ciphertext store (`idKey(provider)` → sealed | null); defaults to a fresh map. */
  readonly storage?: Map<string, string | null>;
}

export const createMemoryKeyStore = (
  config: MemoryKeyStoreConfig
): KeyStore => {
  const { context, masterKey } = config;
  const storage = config.storage ?? new Map<string, string | null>();

  return {
    context,
    deleteKey: async (provider) => {
      storage.delete(idKey(provider));
      return ok();
    },
    resolveProviderAuth: async (input) => {
      const provider = parseModelId(input.modelId).providerId as ModelProvider;
      const key = idKey(provider);
      if (!storage.has(key)) {
        return err<KeyResolveError>({
          kind: "byok_key_missing",
          modelId: input.modelId,
          provider,
          workspaceId: context.workspaceId,
        });
      }
      const sealed = storage.get(key) ?? null;
      if (sealed === null) {
        return ok<ResolvedProviderAuth>({
          alias: byokSecretAlias(context.workspaceId, provider),
          kind: "alias",
        });
      }
      try {
        const rawKey = await openProviderKey(masterKey, sealed);
        return ok<ResolvedProviderAuth>({ kind: "header", value: rawKey });
      } catch {
        return err<KeyResolveError>({
          kind: "byok_key_undecryptable",
          modelId: input.modelId,
          provider,
          workspaceId: context.workspaceId,
        });
      }
    },
    writeKey: async (provider, rawKey) => {
      try {
        storage.set(idKey(provider), await sealProviderKey(masterKey, rawKey));
        return ok();
      } catch {
        return err({
          kind: "byok_registration_failed",
          message: "encryption error",
          operation: "write",
          status: 0,
        });
      }
    },
  };
};
