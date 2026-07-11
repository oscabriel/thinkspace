import { env } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { createEnvelopeD1KeyStore } from "../src/adapters/production/key-store";
import { createD1TenantDataAccess } from "../src/adapters/production/tenant-data-access";
import { modelIdSchema } from "../src/ids";
import { modelProviderSchema } from "../src/model";
import {
  contractForeignMasterKey,
  contractMasterKey,
  defineKeyStoreContract,
} from "../src/testing";
import { testTenantContext } from "../src/testing/fixtures";

/** vitest-pool-workers shares storage across tests; start each from an empty registry. */
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM workspace_provider_key").run();
});

const makeEnvelopeStore = (masterKey: string) =>
  createEnvelopeD1KeyStore({
    context: testTenantContext,
    dataAccess: createD1TenantDataAccess({
      context: testTenantContext,
      db: env.DB,
    }),
    db: env.DB,
    masterKey,
  });

// The production envelope adapter over a real D1: seals to `key_ciphertext`, reads it back through
// the tenant-data-access seam, and decrypts — the same crypto path the DO runs on the hot path.
defineKeyStoreContract({
  api: { describe, expect, test },
  makeKeyStore: () => ({
    foreignMasterKeyStore: makeEnvelopeStore(contractForeignMasterKey),
    store: makeEnvelopeStore(contractMasterKey),
  }),
});

describe("EnvelopeD1KeyStore — D1 ciphertext-at-rest (ADR 0040)", () => {
  const anthropic = modelProviderSchema.parse("anthropic");
  const RAW_KEY = "sk-live-d1-at-rest-7c6b5a";

  test("the persisted key_ciphertext column is sealed — never the plaintext", async () => {
    const store = makeEnvelopeStore(contractMasterKey);
    const written = await store.writeKey(anthropic, RAW_KEY);
    expect(written.ok).toBe(true);

    const row = await env.DB.prepare(
      "SELECT key_ciphertext FROM workspace_provider_key WHERE workspace_id = ?1 AND provider = ?2"
    )
      .bind(testTenantContext.workspaceId, anthropic)
      .first<{ key_ciphertext: string | null }>();

    expect(row?.key_ciphertext).toBeTruthy();
    expect(row?.key_ciphertext).not.toBe(RAW_KEY);
    expect(row?.key_ciphertext ?? "").not.toContain(RAW_KEY);
    expect((row?.key_ciphertext ?? "").startsWith("v1:")).toBe(true);
  });

  test("a registry row with no ciphertext (legacy) resolves to a fallback alias", async () => {
    // A row registered under the legacy adapter carries created_at but no ciphertext.
    await env.DB.prepare(
      "INSERT INTO workspace_provider_key (workspace_id, provider, created_at) VALUES (?1, ?2, ?3)"
    )
      .bind(testTenantContext.workspaceId, anthropic, Date.now())
      .run();

    const store = makeEnvelopeStore(contractMasterKey);
    const resolved = await store.resolveProviderAuth({
      modelId: modelIdSchema.parse("anthropic/claude-sonnet-5"),
    });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.kind).toBe("alias");
    }
  });
});
