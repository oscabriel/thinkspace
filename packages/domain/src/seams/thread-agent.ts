import type {
  AuthzError,
  NotImplementedError,
  RunFailureError,
  TenantGuardViolationError,
} from "../errors";
import type {
  ChannelId,
  CommentId,
  RunId,
  ThreadId,
  WorkspaceId,
} from "../ids";
import type { AsyncResult } from "../result";
import type {
  QueuedRun,
  Run,
  RunTrigger,
  Schedule,
  SubAgentActivity,
} from "../run";
import type { ShapeSnapshot } from "../shape";
import type { Branch, Comment } from "../thread";

export type ThreadAgentError =
  | AuthzError
  | NotImplementedError
  | RunFailureError
  | TenantGuardViolationError;

/**
 * The dispatch context window (ADR 0025): ancestors = the thread's top-level comment down
 * to the branch root's parent (oldest first); subtree = the branch root and its descendants.
 */
export interface BranchSnapshot {
  readonly ancestors: readonly Comment[];
  readonly branch: Branch;
  readonly subtree: readonly Comment[];
}

/** Sub-agent activity is state OF the run (ADR 0028), rendered anchored at the dispatch target. */
export interface RunDetail {
  readonly run: Run;
  readonly subAgentActivity: readonly SubAgentActivity[];
}

export interface ThreadAgentAddress {
  readonly channelId: ChannelId;
  readonly threadId: ThreadId;
  readonly workspaceId: WorkspaceId;
}

export interface ThreadAgentSnapshot {
  readonly shapeSnapshot: ShapeSnapshot;
  readonly threadId: ThreadId;
}

export interface ThreadAgentInitializeRequest {
  readonly openingComment: Comment;
  readonly shapeSnapshot: ShapeSnapshot;
}

export interface ThreadAgentResnapshotRequest {
  readonly shapeSnapshot: ShapeSnapshot;
}

export interface ThreadAgentRunReceipt {
  readonly queuedRun: QueuedRun;
  readonly runId: RunId;
  readonly threadId: ThreadId;
}

/**
 * Per-thread Durable Object seam: owns the comment tree and executes runs against its
 * resident shape snapshot. Run state is DO-resident and read here (ADR 0028) — no D1 run
 * index in v1; channel/home surfaces stay bump-driven.
 */
export interface ThreadAgent {
  readonly address: ThreadAgentAddress;
  readonly appendComment: (input: {
    readonly comment: Comment;
  }) => AsyncResult<Comment, ThreadAgentError>;
  readonly getRun: (input: {
    readonly runId: RunId;
  }) => AsyncResult<RunDetail | null, ThreadAgentError>;
  readonly initialize: (
    input: ThreadAgentInitializeRequest
  ) => AsyncResult<ThreadAgentSnapshot, ThreadAgentError>;
  readonly listRuns: () => AsyncResult<readonly Run[], ThreadAgentError>;
  readonly loadBranch: (input: {
    readonly rootCommentId: CommentId;
  }) => AsyncResult<BranchSnapshot, ThreadAgentError>;
  readonly resnapshot: (
    input: ThreadAgentResnapshotRequest
  ) => AsyncResult<ThreadAgentSnapshot, ThreadAgentError>;
  readonly run: (
    input: RunTrigger
  ) => AsyncResult<ThreadAgentRunReceipt, ThreadAgentError>;
  readonly schedule: (input: {
    readonly schedule: Schedule;
  }) => AsyncResult<Schedule, ThreadAgentError>;
}
