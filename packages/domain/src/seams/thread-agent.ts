import type {
  AuthzError,
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
  /**
   * ADR 0037 decision 4: sever a since-revoked MCP server's live SDK connection at revoke
   * time (the edge registry delete / host-revoke route fans this out over the workspace's
   * threads). Idle DOs self-heal by per-turn pull; this closes the window for live ones.
   * NOTE (wave-8 merge dedupe): E8.1 (#31) adds this identical declaration + DO reconciliation
   * in a parallel worktree — keep one copy on merge.
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
