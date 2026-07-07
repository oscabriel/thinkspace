import type { McpServerId } from "../ids";
import type { McpHostApproval, McpServer } from "../mcp";
import type { McpHost } from "../primitives";
import { ok } from "../result";
import type { AsyncResult } from "../result";
import type {
  TenantDataAccess,
  TenantDataAccessError,
  TenantWriteReceipt,
} from "../seams/tenant-data-access";
import type {
  McpEgressPolicy,
  ToolResolutionError,
} from "../seams/tool-resolution";

export type McpRegistrationFlowError =
  | TenantDataAccessError
  | ToolResolutionError;

export interface McpServerRegistrationRequest {
  readonly mcpServer: McpServer;
}

export interface McpHostApprovalRequest {
  readonly hostApproval: McpHostApproval;
}

export interface McpHostRevocationRequest {
  readonly host: McpHost;
}

export interface McpServerDeregistrationRequest {
  readonly mcpServerId: McpServerId;
}

export interface McpRegistrationFlowDependencies {
  readonly mcpEgressPolicy: McpEgressPolicy;
  readonly tenantDataAccess: TenantDataAccess;
}

/**
 * Workspace MCP registry writes (ADR 0002, baked decision 7). Two owner-driven operations:
 *
 *  - `approveHost` grows the egress allowlist — the deliberate, auditable owner action that
 *    ADR 0002 makes a prerequisite for reaching a host. (Role gating is the edge's job, as with
 *    the E3.2 owner-only BYOK routes; this flow is the domain write.)
 *  - `registerServer` records a server (name, host, transport URL) — but ONLY after the egress
 *    policy authorizes its host. This gate runs BEFORE the row is persisted, which is the whole
 *    point: the SDK's hibernation-restore path reconnects straight from persisted rows without
 *    re-running any connect-time check (ADR 0002 consequences, verified against the SDK clone),
 *    so a host that fails the allowlist must never reach the registry in the first place.
 */
export interface McpRegistrationFlow {
  readonly approveHost: (
    input: McpHostApprovalRequest
  ) => AsyncResult<TenantWriteReceipt, McpRegistrationFlowError>;
  /**
   * Drop a server from the registry (ADR 0037 decision 4). No egress gate: removing a row can
   * only shrink reachable egress, never grow it. The edge pairs this with the revoke fan-out.
   */
  readonly deregisterServer: (
    input: McpServerDeregistrationRequest
  ) => AsyncResult<TenantWriteReceipt, McpRegistrationFlowError>;
  readonly registerServer: (
    input: McpServerRegistrationRequest
  ) => AsyncResult<TenantWriteReceipt, McpRegistrationFlowError>;
  /**
   * Shrink the egress allowlist — the inverse of `approveHost`. Servers on the revoked host stay
   * in the registry but stop clearing the egress gate on their next resolution; the edge fans a
   * connection-drop out to live DOs for the host's servers.
   */
  readonly revokeHost: (
    input: McpHostRevocationRequest
  ) => AsyncResult<TenantWriteReceipt, McpRegistrationFlowError>;
}

export const createMcpRegistrationFlow = (
  deps: McpRegistrationFlowDependencies
): McpRegistrationFlow => {
  const { context } = deps.tenantDataAccess;

  return {
    approveHost: (input) =>
      deps.tenantDataAccess.batch({
        commands: [
          { hostApproval: input.hostApproval, kind: "put_mcp_host_approval" },
        ],
        workspaceId: context.workspaceId,
      }),
    deregisterServer: (input) =>
      deps.tenantDataAccess.batch({
        commands: [
          { kind: "delete_mcp_server", mcpServerId: input.mcpServerId },
        ],
        workspaceId: context.workspaceId,
      }),
    registerServer: async (input) => {
      // Gate BEFORE persistence: nothing about a disallowed host may reach D1, or the DO's
      // restore path would reconnect it on the next wake, bypassing the connect-time gate.
      const authorized = await deps.mcpEgressPolicy.authorize({
        host: input.mcpServer.host,
        mcpServerId: input.mcpServer.id,
      });
      if (!authorized.ok) {
        return authorized;
      }

      const receipt = await deps.tenantDataAccess.batch({
        commands: [{ kind: "put_mcp_server", mcpServer: input.mcpServer }],
        workspaceId: context.workspaceId,
      });
      if (!receipt.ok) {
        return receipt;
      }

      return ok(receipt.value);
    },
    revokeHost: (input) =>
      deps.tenantDataAccess.batch({
        commands: [
          { host: input.host, kind: "delete_mcp_host_approval" },
        ],
        workspaceId: context.workspaceId,
      }),
  };
};
