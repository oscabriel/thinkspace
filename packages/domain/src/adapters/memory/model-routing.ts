import { createNotImplementedError } from "../../errors";
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
  readonly context: TenantContext;
  readonly models?: readonly Model[];
  readonly routes?: readonly ModelRoute[];
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
  const secretAliases = new Map(
    (config.secretAliases ?? []).map((alias) => [
      idKey(alias.provider),
      alias.secretAlias,
    ])
  );

  return {
    context: config.context,
    listAvailableModels: async () =>
      ok(
        (config.models ?? []).filter((model) =>
          secretAliases.has(idKey(model.provider))
        )
      ),
    resolve: async (input) => {
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
        return err(createNotImplementedError("MemoryModelRouter.resolve"));
      }

      const secretAlias = secretAliases.get(idKey(model.provider));
      if (secretAlias === undefined) {
        return err({
          kind: "byok_key_missing",
          modelId: model.id,
          provider: model.provider,
          workspaceId: config.context.workspaceId,
        });
      }

      return ok({
        gatewayMetadata: {
          modelId: model.id,
          workspaceId: config.context.workspaceId,
        },
        model,
        secretAlias,
      });
    },
  };
};
