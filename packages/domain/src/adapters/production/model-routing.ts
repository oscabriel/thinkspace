import type { D1Database } from "@cloudflare/workers-types";

import { byokSecretAlias } from "../../byok";
import { parseModelId } from "../../ids";
import type { WorkspaceId } from "../../ids";
import type { ModelProvider } from "../../model";
import { err, ok } from "../../result";
import type { ModelRouter } from "../../seams/model-routing";
import type { TenantContext } from "../../seams/tenant-data-access";
import { hasSameId, idKey, tenantGuardViolation } from "../helpers";
import type { ModelCatalog } from "./model-catalog";

export interface D1ModelRouterConfig {
  readonly catalog: ModelCatalog;
  readonly context: TenantContext;
  readonly db: D1Database;
}

interface WorkspaceProviderKeyRow {
  readonly provider: string;
  readonly workspace_id: string;
}

const listKeyedProviders = async (config: D1ModelRouterConfig) => {
  const rows = await config.db
    .prepare(
      "SELECT workspace_id, provider FROM workspace_provider_key WHERE workspace_id = ?1"
    )
    .bind(config.context.workspaceId)
    .all<WorkspaceProviderKeyRow>();

  const providers = new Set<string>();
  for (const row of rows.results) {
    if (!hasSameId(row.workspace_id, config.context.workspaceId)) {
      return err(
        tenantGuardViolation(config.context, row.workspace_id as WorkspaceId)
      );
    }
    providers.add(idKey(row.provider as ModelProvider));
  }

  return ok(providers);
};

/**
 * D1-backed BYOK model router (E1.5 / BACKLOG E1).
 *
 * The catalog is injected rather than imported as a singleton so tests can pin the adapter against
 * a deterministic catalog and the production Worker can share the normal isolate-level catalog.
 * Resolution is the Design B fail-fast BYOK gate: the provider parsed from the composite ModelId is
 * checked against the workspace's provider-key registry BEFORE any catalog access, so an unkeyed
 * provider is `byok_key_missing` even when the model is absent from the catalog or the catalog is
 * unavailable; only a keyed provider proceeds to catalog membership (`model_not_in_catalog` /
 * `catalog_unavailable`) and resolves to the derived BYOK secret alias.
 *
 * Every registry query is scoped to the resident tenant (`workspace_id = context.workspaceId`). The
 * row-level workspace check mirrors the D1 tenant-data adapter's guard discipline for
 * defense-in-depth even though a mismatched row should be structurally impossible here.
 */
export const createD1ModelRouter = (
  config: D1ModelRouterConfig
): ModelRouter => {
  const { catalog, context } = config;

  return {
    context,
    listAvailableModels: async () => {
      const catalogModels = await catalog.getModels();
      if (!catalogModels.ok) {
        return catalogModels;
      }

      const keyedProviders = await listKeyedProviders(config);
      if (!keyedProviders.ok) {
        return keyedProviders;
      }

      return ok(
        catalogModels.value.filter((model) =>
          keyedProviders.value.has(idKey(model.provider))
        )
      );
    },
    resolve: async (input) => {
      const provider = parseModelId(input.modelId).providerId as ModelProvider;

      const keyedProviders = await listKeyedProviders(config);
      if (!keyedProviders.ok) {
        return keyedProviders;
      }
      if (!keyedProviders.value.has(idKey(provider))) {
        return err({
          kind: "byok_key_missing",
          modelId: input.modelId,
          provider,
          workspaceId: context.workspaceId,
        });
      }

      const catalogModels = await catalog.getModels();
      if (!catalogModels.ok) {
        return catalogModels;
      }

      const model = catalogModels.value.find((entry) =>
        hasSameId(entry.id, input.modelId)
      );
      if (model === undefined) {
        return err({
          kind: "model_not_in_catalog",
          modelId: input.modelId,
          workspaceId: context.workspaceId,
        });
      }

      return ok({
        gatewayMetadata: {
          modelId: input.modelId,
          workspaceId: context.workspaceId,
        },
        model,
        secretAlias: byokSecretAlias(context.workspaceId, model.provider),
      });
    },
  };
};
