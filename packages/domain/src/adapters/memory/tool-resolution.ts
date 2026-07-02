import type { McpHostNotAllowedError } from "../../errors";
import type { McpServer } from "../../mcp";
import type { McpHost } from "../../primitives";
import { err, ok } from "../../result";
import type { TenantContext } from "../../seams/tenant-data-access";
import type {
  McpEgressPolicy,
  ToolResolver,
} from "../../seams/tool-resolution";
import type { Skill } from "../../skill";
import type { CatalogTool, WorkspaceToolDisable } from "../../tool";
import { hasSameId, idKey, isInTenant } from "./helpers";

export interface MemoryToolResolverConfig {
  readonly approvedMcpHosts?: readonly McpHost[];
  readonly catalogTools?: readonly CatalogTool[];
  readonly context: TenantContext;
  readonly mcpServers?: readonly McpServer[];
  readonly skills?: readonly Skill[];
  readonly workspaceToolDisables?: readonly WorkspaceToolDisable[];
}

export interface MemoryMcpEgressPolicyConfig {
  readonly approvedHosts?: readonly McpHost[];
  readonly context: TenantContext;
}

const idSet = (ids: readonly string[]): Set<string> =>
  new Set(ids.map((id) => idKey(id)));

const mcpHostNotAllowed = (
  context: TenantContext,
  server: Pick<McpServer, "host" | "id">
): McpHostNotAllowedError => ({
  host: server.host,
  kind: "mcp_host_not_allowed",
  mcpServerId: server.id,
  workspaceId: context.workspaceId,
});

/** ADR 0004 default-permit: every catalog tool is permitted unless a disable row exists. */
const workspacePermissionPredicate = (
  context: TenantContext,
  disables: readonly WorkspaceToolDisable[]
): ((tool: CatalogTool) => boolean) => {
  const disabledToolIds = idSet(
    disables
      .filter((toolDisable) =>
        hasSameId(toolDisable.workspaceId, context.workspaceId)
      )
      .map((toolDisable) => toolDisable.toolId)
  );

  return (tool) => !disabledToolIds.has(idKey(tool.id));
};

export const createMemoryToolResolver = (
  config: MemoryToolResolverConfig
): ToolResolver => {
  const approvedMcpHosts = idSet(config.approvedMcpHosts ?? []);
  const isWorkspacePermitted = workspacePermissionPredicate(
    config.context,
    config.workspaceToolDisables ?? []
  );

  return {
    context: config.context,
    resolve: async (input) => {
      const selectedOrAddedToolIds = idSet([
        ...input.shape.toolSelection,
        ...input.beforeTurnAdditions.addedToolIds,
      ]);
      const activeToolIds = idSet(input.runtimeNarrowing.activeToolIds);
      const catalogTools = (config.catalogTools ?? []).filter(
        (tool) =>
          selectedOrAddedToolIds.has(idKey(tool.id)) &&
          activeToolIds.has(idKey(tool.id)) &&
          isWorkspacePermitted(tool)
      );

      const selectedSkillIds = idSet(input.shape.skillSelection);
      const skills = (config.skills ?? []).filter(
        (skill) =>
          isInTenant(config.context, skill) &&
          selectedSkillIds.has(idKey(skill.id))
      );

      const selectedMcpServerIds = idSet(input.shape.mcpServerSelection);
      const mcpServers: McpServer[] = [];
      for (const server of config.mcpServers ?? []) {
        if (
          !isInTenant(config.context, server) ||
          !selectedMcpServerIds.has(idKey(server.id))
        ) {
          continue;
        }

        if (!approvedMcpHosts.has(idKey(server.host))) {
          return err(mcpHostNotAllowed(config.context, server));
        }

        mcpServers.push(server);
      }

      return ok({
        artifactAccessScope: input.artifactAccessScope,
        catalogTools,
        mcpServers,
        selectedToolIds: catalogTools.map((tool) => tool.id),
        skills,
        workspaceId: config.context.workspaceId,
      });
    },
  };
};

export const createMemoryMcpEgressPolicy = (
  config: MemoryMcpEgressPolicyConfig
): McpEgressPolicy => {
  const approvedHosts = idSet(config.approvedHosts ?? []);

  return {
    authorize: async (input) =>
      approvedHosts.has(idKey(input.host))
        ? ok({
            host: input.host,
            kind: "allowed_mcp_egress",
            mcpServerId: input.mcpServerId,
            workspaceId: config.context.workspaceId,
          })
        : err(
            mcpHostNotAllowed(config.context, {
              host: input.host,
              id: input.mcpServerId,
            })
          ),
    context: config.context,
  };
};
