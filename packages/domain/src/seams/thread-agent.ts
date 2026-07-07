import type {
  AuthzError,
  CommentParentNotInThreadError,
  NotImplementedError,
  RunFailureError,
  TenantGuardViolationError,
  ThreadAgentUnaddressableError,
  ThreadAgentUninitializedError,
} from "../errors";
import type {
  ChannelId,
  CommentId,
  McpServerId,
  MemberId,
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
  | CommentParentNotInThreadError
  | NotImplementedError
  | RunFailureError
  | TenantGuardViolationError
  | ThreadAgentUnaddressableError
  | ThreadAgentUninitializedError;

/**
 * The dispatch context window (ADR 0025): ancestors = the thread's top-level comment down
 * to the branch root's parent (oldest first); subtree = the branch root and its descendants.
 */
export interface BranchSnapshot {
  readonly ancestors: readonly Comment[];
  readonly branch: Branch;
  readonly subtree: readonly Comment[];
}

/**
 * E8.4: the DO-resident outcome of a member comment append. The DO owns the comment tree,
 * so it is the authority on both parent-in-thread validation and the participant set the
 * bump fans unread out to (collectThreadParticipants over its resident comments + runs).
 */
export interface CommentAppend {
  readonly comment: Comment;
  readonly participants: readonly MemberId[];
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

/** Address-based lookup of per-thread agents; production = DO namespace getByName. */
export interface ThreadAgentDirectory {
  readonly get: (address: ThreadAgentAddress) => ThreadAgent;
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
  }) => AsyncResult<CommentAppend, ThreadAgentError>;
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
  /**
   * Revoke fan-out (ADR 0037 decision 4): drops the named server's live SDK connection if
   * present, so a revoked/removed MCP server is severed immediately rather than only self-
   * healing at the thread's next turn. A no-op success when no such connection is live.
   */
  readonly removeMcpServer: (input: {
    readonly mcpServerId: McpServerId;
  }) => AsyncResult<void, ThreadAgentError>;
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
