import type { ChannelDirectory } from "../directory";
import type {
  AuthzError,
  NotImplementedError,
  RealtimeHubUnavailableError,
  TenantGuardViolationError,
} from "../errors";
import type {
  ChannelId,
  CommentId,
  MemberId,
  RunId,
  ThreadId,
  WorkspaceId,
} from "../ids";
import type { AsyncResult } from "../result";
import type { ChannelListingRequest } from "./tenant-data-access";

/**
 * Hubs are addressed by tenant containment alone (ADR 0010/0033) — no member identity.
 * Both a member's TenantContext and the system context satisfy this shape, so the
 * completion flow can hold hubs without the seam learning the distinction (ADR 0035 §1/§2).
 */
export interface WorkspaceScope {
  readonly workspaceId: WorkspaceId;
}

export type RealtimeHubError =
  | AuthzError
  | NotImplementedError
  | RealtimeHubUnavailableError
  | TenantGuardViolationError;

export type PresenceState = "away" | "online";

export interface MemberPresence {
  readonly lastSeenAt: Date;
  readonly memberId: MemberId;
  readonly state: PresenceState;
}

export interface WorkspaceRoster {
  readonly members: readonly MemberId[];
}

export type WorkspaceActivityEvent =
  | {
      readonly bumpedAt: Date;
      readonly channelId: ChannelId;
      readonly kind: "thread_bumped";
      readonly threadId: ThreadId;
    }
  | {
      readonly channelId: ChannelId;
      readonly kind: "channel_lifecycle_changed";
    }
  | {
      readonly kind: "member_added";
      readonly memberId: MemberId;
    };

export type ChannelHubEvent =
  | {
      readonly commentId: CommentId;
      readonly kind: "comment_added";
      readonly threadId: ThreadId;
    }
  | {
      readonly kind: "run_lifecycle_changed";
      readonly runId: RunId;
      readonly threadId: ThreadId;
    };

export interface ChannelHubAddress {
  readonly channelId: ChannelId;
}

export interface WorkspaceHub {
  readonly context: WorkspaceScope;
  readonly getRoster: () => AsyncResult<WorkspaceRoster, RealtimeHubError>;
  readonly listChannels: (
    input: ChannelListingRequest
  ) => AsyncResult<ChannelDirectory, RealtimeHubError>;
  readonly publishActivity: (
    event: WorkspaceActivityEvent
  ) => AsyncResult<void, RealtimeHubError>;
}

export interface ChannelHub {
  readonly address: ChannelHubAddress;
  readonly context: WorkspaceScope;
  readonly getPresence: () => AsyncResult<
    readonly MemberPresence[],
    RealtimeHubError
  >;
  readonly publishEvent: (
    event: ChannelHubEvent
  ) => AsyncResult<void, RealtimeHubError>;
}
