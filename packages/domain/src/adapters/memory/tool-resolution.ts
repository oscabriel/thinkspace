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
import { resolveEffectiveToolset } from "../../tool-resolution-core";
import { idKey } from "../helpers";

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

const mcpHostNotAllowed = (
  context: TenantContext,
  server: Pick<McpServer, "host" | "id">
): McpHostNotAllowedError => ({
  host: server.host,
  kind: "mcp_host_not_allowed",
  mcpServerId: server.id,
  workspaceId: context.workspaceId,
});

/** ADR 0004 three-layer resolution over an in-memory catalog (see {@link resolveEffectiveToolset}). */
export const createMemoryToolResolver = (
  config: MemoryToolResolverConfig
): ToolResolver => ({
  context: config.context,
  resolve: async (input) =>
    resolveEffectiveToolset({
      context: config.context,
      data: {
        approvedMcpHosts: config.approvedMcpHosts ?? [],
        catalogTools: config.catalogTools ?? [],
        mcpServers: config.mcpServers ?? [],
        skills: config.skills ?? [],
        workspaceToolDisables: config.workspaceToolDisables ?? [],
      },
      request: input,
    }),
});

export const createMemoryMcpEgressPolicy = (
  config: MemoryMcpEgressPolicyConfig
): McpEgressPolicy => {
  const approvedHosts = new Set(
    (config.approvedHosts ?? []).map((host) => idKey(host))
  );

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
