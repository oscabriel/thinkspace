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
  ShapeId,
  ThreadId,
} from "../ids";
import type { AsyncResult } from "../result";
import type { ShapeSnapshot } from "../shape";
import type { Comment, Thread } from "../thread";
import type {
  ChannelListingRequest,
  TenantContext,
} from "./tenant-data-access";

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

export interface ChannelThreadCreationRequest {
  readonly openingComment: Comment;
  readonly shapeId: ShapeId;
  readonly thread: Thread;
}

export interface ChannelThreadCreation {
  readonly openingComment: Comment;
  readonly shapeSnapshot: ShapeSnapshot;
  readonly thread: Thread;
}

export interface ChannelHubAddress {
  readonly channelId: ChannelId;
}

export interface WorkspaceHub {
  readonly context: TenantContext;
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
  readonly context: TenantContext;
  readonly createThread: (
    input: ChannelThreadCreationRequest
  ) => AsyncResult<ChannelThreadCreation, RealtimeHubError>;
  readonly getPresence: () => AsyncResult<
    readonly MemberPresence[],
    RealtimeHubError
  >;
  readonly publishEvent: (
    event: ChannelHubEvent
  ) => AsyncResult<void, RealtimeHubError>;
}
