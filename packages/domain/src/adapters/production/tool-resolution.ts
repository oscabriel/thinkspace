import { createNotImplementedError } from "../../errors";
import { err, ok } from "../../result";
import type {
  TenantContext,
  TenantDataAccess,
  TenantDataAccessError,
} from "../../seams/tenant-data-access";
import type {
  McpEgressPolicy,
  ToolResolutionError,
  ToolResolver,
} from "../../seams/tool-resolution";
import type { CatalogTool } from "../../tool";
import { resolveEffectiveToolset } from "../../tool-resolution-core";

/**
 * v1 catalog of first-party tools (ADR 0004 layer 1). Baked decision 7 froze this EMPTY —
 * catalog tools v1 = MCP-provided tools only, wired at the DO from the resolved MCP servers
 * (the SDK merges them into the turn's toolset). Adding a first-party tool later means adding
 * a `CatalogTool` here; the three-layer intersection already handles it.
 */
export const FIRST_PARTY_CATALOG: readonly CatalogTool[] = [];

/**
 * These reads only ever fail with a tenant guard (fail-closed cross-tenant row) or a
 * not-implemented seam — both already in {@link ToolResolutionError}. The authz / shape-
 * ownership variants are unreachable for key/workspace reads; if one somehow surfaces, fail
 * closed as not-implemented rather than widen the seam's error surface.
 */
const asToolResolutionError = (
  error: TenantDataAccessError
): ToolResolutionError =>
  error.kind === "tenant_guard_violation" || error.kind === "not_implemented"
    ? error
    : createNotImplementedError(
        `CatalogWorkspaceShapeToolResolver.unexpectedDataAccessError:${error.kind}`
      );

export interface CatalogWorkspaceShapeToolResolverConfig {
  readonly context: TenantContext;
  readonly dataAccess: TenantDataAccess;
}

/**
 * v2 production ToolResolver (E6.3). ADR 0004 three-layer resolution sourced from D1:
 * layer 1 = {@link FIRST_PARTY_CATALOG} (empty in v1), layer 2 = the workspace MCP registry
 * + host allowlist (ADR 0002) + per-tool disables, layer 3 = the shape's selections. The MCP
 * host allowlist fails the whole resolution closed on an unapproved host. Skills stay empty
 * pending E6.1 (the workspace skill pool); wire `dataAccess.listSkills()` in here when it lands.
 */
export const createCatalogWorkspaceShapeToolResolver = (
  config: CatalogWorkspaceShapeToolResolverConfig
): ToolResolver => ({
  context: config.context,
  resolve: async (input) => {
    const [servers, approvals, disables] = await Promise.all([
      config.dataAccess.listMcpServers(),
      config.dataAccess.listMcpHostApprovals(),
      config.dataAccess.listWorkspaceToolDisables(),
    ]);
    if (!servers.ok) {
      return err(asToolResolutionError(servers.error));
    }
    if (!approvals.ok) {
      return err(asToolResolutionError(approvals.error));
    }
    if (!disables.ok) {
      return err(asToolResolutionError(disables.error));
    }

    return resolveEffectiveToolset({
      context: config.context,
      data: {
        approvedMcpHosts: approvals.value.map((approval) => approval.host),
        catalogTools: FIRST_PARTY_CATALOG,
        mcpServers: servers.value,
        skills: [],
        workspaceToolDisables: disables.value,
      },
      request: input,
    });
  },
});

export interface WorkerMcpEgressPolicyConfig {
  readonly context: TenantContext;
  readonly dataAccess: TenantDataAccess;
}

/**
 * v1 production McpEgressPolicy (E6.3, ADR 0002). Worker/agent-boundary egress gate: a host is
 * authorized iff the workspace holds an owner-approved allowlist row for it (`mcp_host_approval`).
 * UI checks are not trusted — this is the enforcement point a member or injected prompt cannot
 * bypass, and the gate the registration flow runs BEFORE any host reaches the registry so the
 * hibernation-restore path never reconnects a host that was never approved.
 */
export const createWorkerMcpEgressPolicy = (
  config: WorkerMcpEgressPolicyConfig
): McpEgressPolicy => ({
  authorize: async (input) => {
    const approval = await config.dataAccess.getMcpHostApproval({
      host: input.host,
    });
    if (!approval.ok) {
      return err(asToolResolutionError(approval.error));
    }

    return approval.value === null
      ? err({
          host: input.host,
          kind: "mcp_host_not_allowed",
          mcpServerId: input.mcpServerId,
          workspaceId: config.context.workspaceId,
        })
      : ok({
          host: input.host,
          kind: "allowed_mcp_egress",
          mcpServerId: input.mcpServerId,
          workspaceId: config.context.workspaceId,
        });
  },
  context: config.context,
});
