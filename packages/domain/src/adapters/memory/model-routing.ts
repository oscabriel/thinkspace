import { byokSecretAlias } from "../../byok";
import { parseModelId } from "../../ids";
import type { ModelId } from "../../ids";
import type { Model, ModelProvider } from "../../model";
import type { SecretAlias } from "../../primitives";
import { err, ok } from "../../result";
import type { ModelRoute, ModelRouter } from "../../seams/model-routing";
import type { TenantContext } from "../../seams/tenant-data-access";
import { hasSameId, idKey, tenantGuardViolation } from "./helpers";

export interface MemoryModelSecretAlias {
  readonly provider: ModelProvider;
  readonly secretAlias: SecretAlias;
}

export interface MemoryModelRouterConfig {
  readonly catalogUnavailable?: boolean;
  readonly context: TenantContext;
  readonly keyedProviders?: readonly ModelProvider[];
  readonly models?: readonly Model[];
  readonly routes?: readonly ModelRoute[];
  /** @deprecated Use keyedProviders; aliases are now derived via byokSecretAlias. */
  readonly secretAliases?: readonly MemoryModelSecretAlias[];
}

const modelRouteKey = (modelId: ModelId): string => idKey(modelId);

export const createMemoryModelRouter = (
  config: MemoryModelRouterConfig
): ModelRouter => {
  const models = new Map(
    (config.models ?? []).map((model) => [modelRouteKey(model.id), model])
  );
  const routes = new Map(
    (config.routes ?? []).map((route) => [modelRouteKey(route.model.id), route])
  );
  const keyedProviders = new Set([
    ...(config.keyedProviders ?? []).map((provider) => idKey(provider)),
    ...(config.secretAliases ?? []).map((alias) => idKey(alias.provider)),
  ]);

  return {
    context: config.context,
    listAvailableModels: async () => {
      if (config.catalogUnavailable === true) {
        return err({ kind: "catalog_unavailable" });
      }

      return ok(
        (config.models ?? []).filter((model) =>
          keyedProviders.has(idKey(model.provider))
        )
      );
    },
    resolve: async (input) => {
      // Design B fail-fast BYOK gate: the provider parsed from the ModelId is checked before any
      // catalog concern, mirroring the production adapter's ordering.
      const provider = parseModelId(input.modelId).providerId as ModelProvider;
      if (!keyedProviders.has(idKey(provider))) {
        return err({
          kind: "byok_key_missing",
          modelId: input.modelId,
          provider,
          workspaceId: config.context.workspaceId,
        });
      }

      if (config.catalogUnavailable === true) {
        return err({ kind: "catalog_unavailable" });
      }

      const seededRoute = routes.get(modelRouteKey(input.modelId));
      if (seededRoute !== undefined) {
        return hasSameId(
          seededRoute.gatewayMetadata.workspaceId,
          config.context.workspaceId
        )
          ? ok(seededRoute)
          : err(
              tenantGuardViolation(
                config.context,
                seededRoute.gatewayMetadata.workspaceId
              )
            );
      }

      const model = models.get(modelRouteKey(input.modelId));
      if (model === undefined) {
        return err({
          kind: "model_not_in_catalog",
          modelId: input.modelId,
          workspaceId: config.context.workspaceId,
        });
      }

      return ok({
        gatewayMetadata: {
          modelId: model.id,
          workspaceId: config.context.workspaceId,
        },
        model,
        secretAlias: byokSecretAlias(
          config.context.workspaceId,
          model.provider
        ),
      });
    },
  };
};
