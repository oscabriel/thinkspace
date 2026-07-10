import { env } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { createModelCatalog } from "../src/adapters/production/model-catalog";
import { createD1ModelRouter } from "../src/adapters/production/model-routing";
import { byokSecretAlias } from "../src/byok";
import { modelIdSchema } from "../src/ids";
import { modelProviderSchema } from "../src/model";
import {
  testTenantContext,
  testWorkspaceId,
  unwrapErr,
  unwrapOk,
} from "../src/testing";

/**
 * E1.5 production composition: the REAL E1.4 catalog (global fetch, intercepted by the canonical
 * outboundService mock's models.dev branch) composed with the real D1-backed router. The contract
 * suite pins seam semantics against a seeded catalog; this file pins that the production wiring —
 * models.dev fetch → allowlist filter → skip-don't-fail → D1 key gate — actually holds inside a
 * worker.
 */

const anthropic = modelProviderSchema.parse("anthropic");
const openai = modelProviderSchema.parse("openai");

const keyWorkspaceFor = (provider: string) =>
  env.DB.prepare(
    "INSERT INTO workspace_provider_key (workspace_id, provider, created_at) VALUES (?1, ?2, ?3)"
  )
    .bind(testWorkspaceId, provider, Date.now())
    .run();

const keyWorkspaceForAnthropic = () => keyWorkspaceFor(anthropic);

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM workspace_provider_key").run();
});

describe("D1 ModelRouter × live catalog through the outbound mock (E1.5)", () => {
  test("resolves a mock-served catalog model to a route with the derived alias", async () => {
    await keyWorkspaceForAnthropic();
    const router = createD1ModelRouter({
      catalog: createModelCatalog(),
      context: testTenantContext,
      db: env.DB,
    });
    const modelId = modelIdSchema.parse("anthropic/claude-test-sonnet");

    const route = unwrapOk(await router.resolve({ modelId }));

    expect(route.model.displayName).toBe("Claude Test Sonnet");
    expect(route.gatewayMetadata).toEqual({
      modelId,
      workspaceId: testWorkspaceId,
    });
    expect(route.secretAlias).toBe(byokSecretAlias(testWorkspaceId, anthropic));
  });

  test("listAvailableModels is the assembled allowlisted catalog ∩ keyed providers", async () => {
    await keyWorkspaceForAnthropic();
    const router = createD1ModelRouter({
      catalog: createModelCatalog(),
      context: testTenantContext,
      db: env.DB,
    });

    const models = unwrapOk(await router.listAvailableModels());

    // The mock fixture carries 2 valid anthropic models, 1 boundary-schema reject (skipped, not
    // fatal), and 1 openai model. openai is now allowlisted (ADR 0038 §1), so it survives the
    // allowlist filter — but this workspace is keyed for anthropic only, so the BYOK key gate
    // drops the openai model here.
    expect(models.map((model) => model.id).toSorted()).toEqual([
      "anthropic/claude-test-haiku",
      "anthropic/claude-test-sonnet",
    ]);
  });

  test("an openai-keyed workspace sees the allowlisted openai model (ADR 0038 §1)", async () => {
    await keyWorkspaceFor(openai);
    const router = createD1ModelRouter({
      catalog: createModelCatalog(),
      context: testTenantContext,
      db: env.DB,
    });

    // Same live fixture, keyed for openai instead: the openai model now passes both the allowlist
    // and the key gate, while the anthropic models are dropped by the (now-unkeyed) anthropic gate.
    expect(
      unwrapOk(await router.listAvailableModels()).map((model) => model.id)
    ).toEqual(["openai/gpt-test"]);
  });

  test("listAvailableModels is empty for an unkeyed workspace even with a live catalog", async () => {
    const router = createD1ModelRouter({
      catalog: createModelCatalog(),
      context: testTenantContext,
      db: env.DB,
    });

    expect(unwrapOk(await router.listAvailableModels())).toEqual([]);
  });

  test("a cold-miss catalog failure surfaces catalog_unavailable through resolve", async () => {
    await keyWorkspaceForAnthropic();
    const router = createD1ModelRouter({
      // Real catalog module, failing fetch: byok gate passes first (keyed), then the cold miss
      // with no last-good memo must surface catalog_unavailable.
      catalog: createModelCatalog({
        fetch: () => Promise.reject(new Error("models.dev unreachable")),
      }),
      context: testTenantContext,
      db: env.DB,
    });

    expect(
      unwrapErr(
        await router.resolve({
          modelId: modelIdSchema.parse("anthropic/claude-test-sonnet"),
        })
      )
    ).toEqual({ kind: "catalog_unavailable" });
  });
});
