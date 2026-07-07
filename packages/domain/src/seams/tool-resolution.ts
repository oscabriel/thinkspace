import type {
  McpHostNotAllowedError,
  NotImplementedError,
  TenantGuardViolationError,
} from "../errors";
import type { ArtifactId, McpServerId, ToolId, WorkspaceId } from "../ids";
import type { McpServer } from "../mcp";
import type { McpHost } from "../primitives";
import type { AsyncResult } from "../result";
import type { ShapeStructure } from "../shape";
import type { Skill } from "../skill";
import type { CatalogTool } from "../tool";
import type { DataAccessContext } from "./tenant-data-access";

export type ToolResolutionError =
  | McpHostNotAllowedError
  | NotImplementedError
  | TenantGuardViolationError;

export interface RuntimeToolNarrowing {
  readonly activeToolIds: readonly ToolId[];
  readonly kind: "active_tools_allowlist";
}

export interface BeforeTurnToolAdditions {
  readonly addedToolIds: readonly ToolId[];
  readonly kind: "additive_tools_only";
}

export interface ArtifactAccessScope {
  /** The frozen cross-channel opt-ins from the shape snapshot (ADR 0014). */
  readonly artifactIds: readonly ArtifactId[];
  /** The home channel's artifact set, resolved dynamically at dispatch time. */
  readonly homeChannelArtifactIds: readonly ArtifactId[];
  readonly kind: "shape_artifact_selection";
}

export interface ToolResolutionRequest {
  readonly artifactAccessScope: ArtifactAccessScope;
  readonly beforeTurnAdditions: BeforeTurnToolAdditions;
  readonly runtimeNarrowing: RuntimeToolNarrowing;
  readonly shape: ShapeStructure;
}

export interface EffectiveToolset {
  readonly artifactAccessScope: ArtifactAccessScope;
  readonly catalogTools: readonly CatalogTool[];
  readonly mcpServers: readonly McpServer[];
  readonly selectedToolIds: readonly ToolId[];
  readonly skills: readonly Skill[];
  readonly workspaceId: WorkspaceId;
}

export interface McpEgressRequest {
  readonly host: McpHost;
  readonly mcpServerId: McpServerId;
}

export type AllowedMcpEgress = McpEgressRequest & {
  readonly kind: "allowed_mcp_egress";
  readonly workspaceId: WorkspaceId;
};

/**
 * Three-layer tool model seam: catalog ∩ workspace permission ∩ shape selection, plus runtime
 * narrowing. Context is a `DataAccessContext` (ADR 0037): the edge resolves under a member's
 * `TenantContext`, the ThreadAgent DO resolves per turn under the address-derived
 * `SystemContext` — resolution reads only workspace-scoped facts, never member visibility.
 */
export interface ToolResolver {
  readonly context: DataAccessContext;
  readonly resolve: (
    input: ToolResolutionRequest
  ) => AsyncResult<EffectiveToolset, ToolResolutionError>;
}

/** Worker/agent egress seam; UI checks are not trusted for MCP host authorization. */
export interface McpEgressPolicy {
  readonly authorize: (
    input: McpEgressRequest
  ) => AsyncResult<AllowedMcpEgress, ToolResolutionError>;
  readonly context: DataAccessContext;
}
