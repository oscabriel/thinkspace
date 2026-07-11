import { modelIdSchema } from "../../ids";
import type { ModelProvider } from "../../model";
import { modelProviderSchema } from "../../model";
import type { KeyStore } from "../../seams/key-store";
import type { DataAccessContext } from "../../seams/tenant-data-access";
import type { ContractTestApi } from "../contract-api";
import { testTenantContext, unwrapErr, unwrapOk } from "../fixtures";

/** A valid 32-byte base64 master key and a distinct foreign one, shared by every binder. */
export const contractMasterKey = btoa(
  String.fromCharCode(...new Uint8Array(32).fill(7))
);
export const contractForeignMasterKey = btoa(
  String.fromCharCode(...new Uint8Array(32).fill(9))
);

/**
 * `store` and `foreignMasterKeyStore` share the SAME backing storage — the second holds a foreign
 * master key so a key sealed by the first cannot be opened by the second (the wrong-key
 * fail-closed pin). An adapter with no envelope layer (the legacy Secrets Store adapter) is not
 * exercised by this contract — it resolves to an alias with no decrypt, so it opts out.
 */
export interface KeyStorePair {
  readonly foreignMasterKeyStore: KeyStore;
  readonly store: KeyStore;
}

export interface KeyStoreSeed {
  readonly context: DataAccessContext;
  readonly foreignMasterKey: string;
  readonly masterKey: string;
}

export type KeyStoreFactory = (
  seed: KeyStoreSeed
) => KeyStorePair | Promise<KeyStorePair>;

const anthropic: ModelProvider = modelProviderSchema.parse("anthropic");
const anthropicModelId = modelIdSchema.parse("anthropic/claude-sonnet-5");
const openaiModelId = modelIdSchema.parse("openai/gpt-5.5");
const RAW_KEY = "sk-live-contract-secret-9f8e7d";

/** Pins the envelope KeyStore semantics on whichever adapter the factory builds (ADR 0040). */
export const defineKeyStoreContract = (input: {
  readonly api: ContractTestApi;
  readonly makeKeyStore: KeyStoreFactory;
}): void => {
  const { describe, expect, test } = input.api;

  const build = () =>
    input.makeKeyStore({
      context: testTenantContext,
      foreignMasterKey: contractForeignMasterKey,
      masterKey: contractMasterKey,
    });

  describe("KeyStore — envelope round-trip and fail-closed resolution (ADR 0040)", () => {
    test("writeKey then resolveProviderAuth yields the raw key as a header value", async () => {
      const { store } = await build();
      unwrapOk(await store.writeKey(anthropic, RAW_KEY));

      const resolved = unwrapOk(
        await store.resolveProviderAuth({ modelId: anthropicModelId })
      );
      expect(resolved).toEqual({ kind: "header", value: RAW_KEY });
    });

    test("an unkeyed provider resolves to a fail-closed byok_key_missing", async () => {
      const { store } = await build();

      expect(
        unwrapErr(await store.resolveProviderAuth({ modelId: openaiModelId }))
      ).toEqual({
        kind: "byok_key_missing",
        modelId: openaiModelId,
        provider: modelProviderSchema.parse("openai"),
        workspaceId: testTenantContext.workspaceId,
      });
    });

    test("deleteKey removes the key so a subsequent resolve fails closed", async () => {
      const { store } = await build();
      unwrapOk(await store.writeKey(anthropic, RAW_KEY));
      unwrapOk(await store.deleteKey(anthropic));

      expect(
        unwrapErr(await store.resolveProviderAuth({ modelId: anthropicModelId }))
          .kind
      ).toBe("byok_key_missing");
    });

    test("the wrong master key fails closed with byok_key_undecryptable (no raw key echoed)", async () => {
      const { foreignMasterKeyStore, store } = await build();
      unwrapOk(await store.writeKey(anthropic, RAW_KEY));

      const error = unwrapErr(
        await foreignMasterKeyStore.resolveProviderAuth({
          modelId: anthropicModelId,
        })
      );
      expect(error.kind).toBe("byok_key_undecryptable");
      // Redaction: the fail-closed error is a plain routing envelope — never the raw key.
      expect(JSON.stringify(error).includes(RAW_KEY)).toBe(false);
    });

    test("resolve never leaks the raw key into an error even after a real write", async () => {
      const { foreignMasterKeyStore, store } = await build();
      unwrapOk(await store.writeKey(anthropic, RAW_KEY));
      const good = await store.resolveProviderAuth({ modelId: anthropicModelId });
      const bad = await foreignMasterKeyStore.resolveProviderAuth({
        modelId: anthropicModelId,
      });
      // The good path carries the key (transiently); the error path must not.
      expect(JSON.stringify(bad).includes(RAW_KEY)).toBe(false);
      expect(good.ok).toBe(true);
    });
  });
};
