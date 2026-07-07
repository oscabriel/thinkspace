import { idKey, isInTenant } from "./adapters/helpers";
import type { TenantScoped } from "./adapters/helpers";
import type { McpHostNotAllowedError } from "./errors";
import type { McpServer } from "./mcp";
import type { McpHost } from "./primitives";
import type { Result } from "./result";
import { err, ok } from "./result";
import type { TenantContext } from "./seams/tenant-data-access";
import type {
  EffectiveToolset,
  ToolResolutionRequest,
} from "./seams/tool-resolution";
import type { Skill } from "./skill";
import type { CatalogTool, WorkspaceToolDisable } from "./tool";

/**
 * The resolved workspace facts a ToolResolver adapter feeds the core: the layer-1 catalog
 * plus the layer-2 governance state (MCP registry + host allowlist + per-tool disables) and
 * the workspace skill pool. Every adapter (memory config, D1 data-access) gathers these its
 * own way; the three-layer intersection itself lives here so both share one implementation.
 */
export interface ToolResolutionWorkspaceData {
  readonly approvedMcpHosts: readonly McpHost[];
  readonly catalogTools: readonly CatalogTool[];
  readonly mcpServers: readonly McpServer[];
  readonly skills: readonly Skill[];
  readonly workspaceToolDisables: readonly WorkspaceToolDisable[];
}

const idSet = (ids: readonly string[]): Set<string> =>
  new Set(ids.map((id) => idKey(id)));

const inTenant = (context: TenantContext, value: TenantScoped): boolean =>
  isInTenant(context, value);

const mcpHostNotAllowed = (
  context: TenantContext,
  server: Pick<McpServer, "host" | "id">
): McpHostNotAllowedError => ({
  host: server.host,
  kind: "mcp_host_not_allowed",
  mcpServerId: server.id,
  workspaceId: context.workspaceId,
});

/**
 * ADR 0004 effective toolset: `catalog ∩ workspace-permitted ∩ shape-selected` (∩ beforeTurn
 * activeTools). Layer 2's MCP host allowlist (ADR 0002) fails the WHOLE resolution closed —
 * a shape-selected server on an unapproved host is a governance breach, not a silent drop.
 * Skills are the workspace pool narrowed by the shape's selection (ADR 0029). Pure and sync;
 * the async data-gathering is the adapter's job.
 */
export const resolveEffectiveToolset = (input: {
  readonly context: TenantContext;
  readonly data: ToolResolutionWorkspaceData;
  readonly request: ToolResolutionRequest;
}): Result<EffectiveToolset, McpHostNotAllowedError> => {
  const { context, data, request } = input;

  const disabledToolIds = idSet(
    data.workspaceToolDisables
      .filter((toolDisable) => inTenant(context, toolDisable))
      .map((toolDisable) => toolDisable.toolId)
  );
  const selectedOrAddedToolIds = idSet([
    ...request.shape.toolSelection,
    ...request.beforeTurnAdditions.addedToolIds,
  ]);
  const activeToolIds = idSet(request.runtimeNarrowing.activeToolIds);
  const catalogTools = data.catalogTools.filter(
    (tool) =>
      selectedOrAddedToolIds.has(idKey(tool.id)) &&
      activeToolIds.has(idKey(tool.id)) &&
      !disabledToolIds.has(idKey(tool.id))
  );

  const selectedSkillIds = idSet(request.shape.skillSelection);
  const skills = data.skills.filter(
    (skill) => inTenant(context, skill) && selectedSkillIds.has(idKey(skill.id))
  );

  const approvedMcpHosts = idSet(data.approvedMcpHosts);
  const selectedMcpServerIds = idSet(request.shape.mcpServerSelection);
  const mcpServers: McpServer[] = [];
  for (const server of data.mcpServers) {
    if (
      !inTenant(context, server) ||
      !selectedMcpServerIds.has(idKey(server.id))
    ) {
      continue;
    }

    if (!approvedMcpHosts.has(idKey(server.host))) {
      return err(mcpHostNotAllowed(context, server));
    }

    mcpServers.push(server);
  }

  return ok({
    artifactAccessScope: request.artifactAccessScope,
    catalogTools,
    mcpServers,
    selectedToolIds: catalogTools.map((tool) => tool.id),
    skills,
    workspaceId: context.workspaceId,
  });
};
