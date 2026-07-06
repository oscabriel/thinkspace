import { byokSecretAlias } from "../../byok";
import { modelIdSchema } from "../../ids";
import type { Model, ModelProvider } from "../../model";
import { modelProviderSchema } from "../../model";
import type { ModelRoute, ModelRouter } from "../../seams/model-routing";
import type { TenantContext } from "../../seams/tenant-data-access";
import type { ContractTestApi } from "../contract-api";
import {
  otherWorkspaceId,
  testTenantContext,
  testWorkspaceId,
  unwrapErr,
  unwrapOk,
} from "../fixtures";

export interface ModelRouterSeed {
  readonly catalogModels?: readonly Model[];
  readonly catalogUnavailable?: boolean;
  readonly context: TenantContext;
  readonly foreignRoutes?: readonly ModelRoute[];
  readonly keyedProviders?: readonly ModelProvider[];
}

export type ModelRouterFactory = (
  seed: ModelRouterSeed
) => Promise<ModelRouter> | ModelRouter;

const anthropic = modelProviderSchema.parse("anthropic");
const openai = modelProviderSchema.parse("openai");

const makeModel = (input?: {
  readonly id?: string;
  readonly provider?: ModelProvider;
}): Model => ({
  capabilities: {
    attachment: true,
    reasoning: true,
    structuredOutput: true,
    toolCall: true,
  },
  cost: { cacheRead: 0.1, cacheWrite: 0.2, input: 1, output: 5 },
  displayName: "Claude Sonnet Test",
  id: modelIdSchema.parse(input?.id ?? "anthropic/claude-sonnet-test"),
  limits: { context: 200_000, output: 8192 },
  provider: input?.provider ?? anthropic,
  releaseDate: "2026-01-01",
});

/** Pins the BYOK model-routing seam semantics on whichever adapter the factory builds. */
export const defineModelRoutingContract = (input: {
  readonly api: ContractTestApi;
  /** Production D1 is structurally workspace-scoped, so only adapters with direct route seeding opt in. */
  readonly canSeedForeignRoute?: boolean;
  readonly makeModelRouter: ModelRouterFactory;
}): void => {
  const { describe, expect, test } = input.api;
  const { makeModelRouter } = input;

  describe("ModelRouter — BYOK provider-key gating (E1.5)", () => {
    test("listAvailableModels excludes unkeyed providers and includes keyed providers", async () => {
      const keyedModel = makeModel();
      const unkeyedModel = makeModel({
        id: "openai/gpt-test",
        provider: openai,
      });
      const router = await makeModelRouter({
        catalogModels: [keyedModel, unkeyedModel],
        context: testTenantContext,
        keyedProviders: [anthropic],
      });

      expect(unwrapOk(await router.listAvailableModels())).toEqual([
        keyedModel,
      ]);
    });

    test("resolve returns model, gateway metadata, and the derived BYOK secret alias", async () => {
      const model = makeModel();
      const router = await makeModelRouter({
        catalogModels: [model],
        context: testTenantContext,
        keyedProviders: [model.provider],
      });

      const route = unwrapOk(await router.resolve({ modelId: model.id }));

      expect(route).toEqual({
        gatewayMetadata: {
          modelId: model.id,
          workspaceId: testWorkspaceId,
        },
        model,
        secretAlias: byokSecretAlias(testWorkspaceId, model.provider),
      });
    });

    test("resolve fails with byok_key_missing for a catalog model whose provider is unkeyed", async () => {
      const model = makeModel();
      const router = await makeModelRouter({
        catalogModels: [model],
        context: testTenantContext,
        keyedProviders: [],
      });

      expect(unwrapErr(await router.resolve({ modelId: model.id }))).toEqual({
        kind: "byok_key_missing",
        modelId: model.id,
        provider: model.provider,
        workspaceId: testWorkspaceId,
      });
    });

    test("resolve fails with model_not_in_catalog for an absent model id", async () => {
      const router = await makeModelRouter({
        catalogModels: [],
        context: testTenantContext,
        keyedProviders: [anthropic],
      });
      const missingModelId = modelIdSchema.parse("anthropic/missing");

      expect(
        unwrapErr(await router.resolve({ modelId: missingModelId }))
      ).toEqual({
        kind: "model_not_in_catalog",
        modelId: missingModelId,
        workspaceId: testWorkspaceId,
      });
    });

    test("catalog_unavailable propagates from resolve and listAvailableModels", async () => {
      const model = makeModel();
      const router = await makeModelRouter({
        catalogModels: [model],
        catalogUnavailable: true,
        context: testTenantContext,
        keyedProviders: [model.provider],
      });

      expect(unwrapErr(await router.resolve({ modelId: model.id }))).toEqual({
        kind: "catalog_unavailable",
      });
      expect(unwrapErr(await router.listAvailableModels())).toEqual({
        kind: "catalog_unavailable",
      });
    });

    if (input.canSeedForeignRoute === true) {
      test("seeded foreign routes fail closed with tenant_guard_violation", async () => {
        const model = makeModel();
        const router = await makeModelRouter({
          catalogModels: [model],
          context: testTenantContext,
          foreignRoutes: [
            {
              gatewayMetadata: {
                modelId: model.id,
                workspaceId: otherWorkspaceId,
              },
              model,
              secretAlias: byokSecretAlias(otherWorkspaceId, model.provider),
            },
          ],
          keyedProviders: [model.provider],
        });

        expect(unwrapErr(await router.resolve({ modelId: model.id }))).toEqual({
          expectedWorkspaceId: testWorkspaceId,
          kind: "tenant_guard_violation",
          observed: { kind: "workspace", workspaceId: otherWorkspaceId },
        });
      });
    }
  });
};
