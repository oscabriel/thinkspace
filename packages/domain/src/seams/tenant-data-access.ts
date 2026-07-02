import type { Artifact } from "../artifact";
import type { Channel, ChannelFavorite } from "../channel";
import type { ChannelDirectory, DirectorySearch } from "../directory";
import type {
  AuthzError,
  NotImplementedError,
  ShapeOwnershipViolationError,
  TenantGuardViolationError,
} from "../errors";
import type {
  ArtifactId,
  ChannelId,
  MemberId,
  McpServerId,
  ScheduleId,
  ShapeId,
  SkillId,
  ThreadId,
  ToolId,
  WorkspaceId,
} from "../ids";
import type { McpHostApproval, McpServer } from "../mcp";
import type { McpHost } from "../primitives";
import type { AsyncResult } from "../result";
import type { Schedule } from "../run";
import type { Shape } from "../shape";
import type { Skill } from "../skill";
import type { Thread } from "../thread";
import type { WorkspaceToolDisable } from "../tool";
import type { Unread } from "../unread";
import type { Member, Role, Workspace } from "../workspace";

export type TenantDataAccessError =
  | AuthzError
  | NotImplementedError
  | ShapeOwnershipViolationError
  | TenantGuardViolationError;

export interface TenantContext {
  readonly memberId: MemberId;
  readonly role: Role;
  readonly workspaceId: WorkspaceId;
}

export interface WorkspaceGraph {
  readonly members: readonly Member[];
  readonly workspace: Workspace;
}

export interface ThreadIndex {
  readonly channelId: ChannelId;
  readonly threads: readonly Thread[];
  readonly workspaceId: WorkspaceId;
}

export interface ArtifactIndex {
  readonly artifacts: readonly Artifact[];
  readonly workspaceId: WorkspaceId;
}

export type ChannelListingRequest =
  | { readonly kind: "sidebar" }
  | { readonly kind: "directory"; readonly search: DirectorySearch };

/** before = exclusive recency cursor: only threads whose lastActivityAt is strictly older. */
export interface HomeFeedRequest {
  readonly before: Date | null;
  readonly limit: number;
}

/** ADR 0020/0027: bumped threads across the member's visible channels, recency-sorted. */
export interface HomeFeed {
  readonly threads: readonly Thread[];
  readonly workspaceId: WorkspaceId;
}

export type TenantWriteCommand =
  | {
      readonly channelId: ChannelId;
      readonly kind: "delete_channel_favorite";
      readonly memberId: MemberId;
    }
  | { readonly host: McpHost; readonly kind: "delete_mcp_host_approval" }
  | { readonly kind: "delete_schedule"; readonly scheduleId: ScheduleId }
  | { readonly kind: "delete_skill"; readonly skillId: SkillId }
  | {
      readonly kind: "delete_unread";
      readonly memberId: MemberId;
      readonly threadId: ThreadId;
    }
  | { readonly kind: "delete_workspace_tool_disable"; readonly toolId: ToolId }
  | { readonly artifact: Artifact; readonly kind: "put_artifact_index" }
  | { readonly channel: Channel; readonly kind: "put_channel" }
  | {
      readonly favorite: ChannelFavorite;
      readonly kind: "put_channel_favorite";
    }
  | {
      readonly hostApproval: McpHostApproval;
      readonly kind: "put_mcp_host_approval";
    }
  | { readonly kind: "put_mcp_server"; readonly mcpServer: McpServer }
  | { readonly kind: "put_schedule"; readonly schedule: Schedule }
  | { readonly kind: "put_shape"; readonly shape: Shape }
  | { readonly kind: "put_skill"; readonly skill: Skill }
  | { readonly kind: "put_thread_index"; readonly thread: Thread }
  | { readonly kind: "put_unread"; readonly unread: Unread }
  | {
      readonly kind: "put_workspace_tool_disable";
      readonly toolDisable: WorkspaceToolDisable;
    };

export interface TenantWriteBatch {
  readonly commands: readonly [TenantWriteCommand, ...TenantWriteCommand[]];
  readonly workspaceId: WorkspaceId;
}

export interface TenantWriteReceipt {
  readonly commandCount: number;
  readonly workspaceId: WorkspaceId;
}

/** Tenant-guarded D1 seam over better-auth org membership plus workspace-partitioned tables. */
export interface TenantDataAccess {
  readonly batch: (
    input: TenantWriteBatch
  ) => AsyncResult<TenantWriteReceipt, TenantDataAccessError>;
  readonly context: TenantContext;
  readonly getArtifact: (input: {
    readonly artifactId: ArtifactId;
  }) => AsyncResult<Artifact | null, TenantDataAccessError>;
  readonly getChannel: (input: {
    readonly channelId: ChannelId;
  }) => AsyncResult<Channel | null, TenantDataAccessError>;
  readonly getMcpHostApproval: (input: {
    readonly host: McpHost;
  }) => AsyncResult<McpHostApproval | null, TenantDataAccessError>;
  readonly getMcpServer: (input: {
    readonly mcpServerId: McpServerId;
  }) => AsyncResult<McpServer | null, TenantDataAccessError>;
  readonly getSchedule: (input: {
    readonly scheduleId: ScheduleId;
  }) => AsyncResult<Schedule | null, TenantDataAccessError>;
  readonly getShape: (input: {
    readonly shapeId: ShapeId;
  }) => AsyncResult<Shape | null, TenantDataAccessError>;
  readonly getSkill: (input: {
    readonly skillId: SkillId;
  }) => AsyncResult<Skill | null, TenantDataAccessError>;
  readonly getWorkspaceGraph: () => AsyncResult<
    WorkspaceGraph,
    TenantDataAccessError
  >;
  readonly listArtifacts: () => AsyncResult<
    ArtifactIndex,
    TenantDataAccessError
  >;
  readonly listChannelFavorites: (input: {
    readonly memberId: MemberId;
  }) => AsyncResult<readonly ChannelFavorite[], TenantDataAccessError>;
  readonly listChannels: (
    input: ChannelListingRequest
  ) => AsyncResult<ChannelDirectory, TenantDataAccessError>;
  readonly listChannelThreads: (input: {
    readonly channelId: ChannelId;
  }) => AsyncResult<ThreadIndex, TenantDataAccessError>;
  readonly listMemberUnread: (input: {
    readonly memberId: MemberId;
  }) => AsyncResult<readonly Unread[], TenantDataAccessError>;
  readonly listRecentThreads: (
    input: HomeFeedRequest
  ) => AsyncResult<HomeFeed, TenantDataAccessError>;
  readonly listSkills: () => AsyncResult<
    readonly Skill[],
    TenantDataAccessError
  >;
  readonly listWorkspaceToolDisables: () => AsyncResult<
    readonly WorkspaceToolDisable[],
    TenantDataAccessError
  >;
}
