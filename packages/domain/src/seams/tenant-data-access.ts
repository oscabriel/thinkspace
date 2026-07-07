import type { Artifact } from "../artifact";
import type { Channel, ChannelFavorite } from "../channel";
import type {
  ChannelDirectory,
  ChannelDirectoryEntry,
  DirectorySearch,
} from "../directory";
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
  UserId,
  WorkspaceId,
} from "../ids";
import type { McpHostApproval, McpServer } from "../mcp";
import type { DisplayName, McpHost } from "../primitives";
import type { AsyncResult } from "../result";
import type { Schedule } from "../run";
import type { Shape } from "../shape";
import type { Skill } from "../skill";
import type { Thread } from "../thread";
import type { WorkspaceToolDisable } from "../tool";
import type { Unread } from "../unread";
import type { Role } from "../workspace";

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

/**
 * ADR 0035 §1: the system-side caller — a workspace with no acting member (run settle,
 * reconciliation). Only the data-access adapters learn the distinction (by the kind tag);
 * every other seam keeps the flat member shape.
 */
export interface SystemContext {
  readonly kind: "system";
  readonly workspaceId: WorkspaceId;
}

export type DataAccessContext = SystemContext | TenantContext;

/**
 * ADR 0035 §6 / ADR 0027: the sidebar payload — the visible, non-deleted channels the
 * acting member can see (directory-entry shape). A member-visibility read, so it fails
 * closed under a system context. Carries only workspaceId (like ThreadIndex/HomeFeed); the
 * workspace name and member roster live in better-auth's org/member tables (ADR 0008) whose
 * mapping stays deferred §6 debt, not read here yet.
 */
export interface WorkspaceGraph {
  readonly channels: readonly ChannelDirectoryEntry[];
  readonly workspaceId: WorkspaceId;
}

export interface ThreadIndex {
  readonly channelId: ChannelId;
  readonly threads: readonly Thread[];
  readonly workspaceId: WorkspaceId;
}

/**
 * E8.6: a workspace member paired with the display name from its better-auth user row (ADR
 * 0008). The roster join the directory/home surfaces need to label owners and authors by name
 * instead of a truncated member id. The adapter owns the member→user join; the seam stays in
 * domain vocabulary and exposes display name only — never email or avatar (§6 scope guard).
 */
export interface WorkspaceMember {
  readonly displayName: DisplayName;
  readonly memberId: MemberId;
  readonly userId: UserId;
  readonly workspaceId: WorkspaceId;
}

/** A roster entry as exposed to callers: identity + label, nothing else from the user row. */
export interface WorkspaceMemberProfile {
  readonly displayName: DisplayName;
  readonly memberId: MemberId;
}

/** The workspace roster payload — member profiles for the acting member's workspace. */
export interface MemberRoster {
  readonly members: readonly WorkspaceMemberProfile[];
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
      /** Insert-if-absent (ADR 0034): a replayed creation never touches an existing row. */
      readonly kind: "create_thread_index";
      readonly thread: Thread;
    }
  | {
      readonly channelId: ChannelId;
      readonly kind: "delete_channel_favorite";
      readonly memberId: MemberId;
    }
  | { readonly host: McpHost; readonly kind: "delete_mcp_host_approval" }
  | { readonly kind: "delete_mcp_server"; readonly mcpServerId: McpServerId }
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

/**
 * Tenant-guarded D1 seam over better-auth org membership plus workspace-partitioned tables.
 * Generic only so a system context can hold the seam (ADR 0035 §1); the default keeps the
 * flat member shape everywhere else. Member-visibility reads (sidebar/directory listings,
 * home feed) fail closed with an AuthzError under a system context.
 */
export interface TenantDataAccess<
  Context extends DataAccessContext = TenantContext,
> {
  readonly batch: (
    input: TenantWriteBatch
  ) => AsyncResult<TenantWriteReceipt, TenantDataAccessError>;
  readonly context: Context;
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
  readonly listMcpHostApprovals: () => AsyncResult<
    readonly McpHostApproval[],
    TenantDataAccessError
  >;
  readonly listMcpServers: () => AsyncResult<
    readonly McpServer[],
    TenantDataAccessError
  >;
  readonly listMemberUnread: (input: {
    readonly memberId: MemberId;
  }) => AsyncResult<readonly Unread[], TenantDataAccessError>;
  readonly listMembers: () => AsyncResult<MemberRoster, TenantDataAccessError>;
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
