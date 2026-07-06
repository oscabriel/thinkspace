import { ok } from "../../result";
import type { TenantContext } from "../../seams/tenant-data-access";
import type { ToolResolver } from "../../seams/tool-resolution";

export interface CatalogWorkspaceShapeToolResolverConfig {
  readonly context: TenantContext;
}

/**
 * v1 production ToolResolver (E1.6). The catalog of available tools is EMPTY —
 * there are no built-in tools and no MCP registry yet (that arrives in E6.3). The
 * three-layer model (catalog ∩ workspace permission ∩ shape selection) therefore
 * intersects every shape request against the empty catalog and yields an empty
 * effective toolset.
 *
 * Resolution is a SILENT intersect: unknown tools the shape selects are dropped
 * without error. MCP host authorization is vacuously unreachable (no server ever
 * survives the empty catalog), so WorkerMcpEgressPolicy stays a placeholder.
 * `artifactAccessScope` is echoed through unchanged.
 */
export const createCatalogWorkspaceShapeToolResolver = (
  config: CatalogWorkspaceShapeToolResolverConfig
): ToolResolver => ({
  context: config.context,
  resolve: (input) =>
    Promise.resolve(
      ok({
        artifactAccessScope: input.artifactAccessScope,
        catalogTools: [],
        mcpServers: [],
        selectedToolIds: [],
        skills: [],
        workspaceId: config.context.workspaceId,
      })
    ),
});
