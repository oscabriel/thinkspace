import { createNotImplementedError } from "../errors";
import type { NotImplementedError } from "../errors";
import type { MemberId } from "../ids";
import { err } from "../result";
import type { AsyncResult } from "../result";
import type { CompleteRun, FailedRun, Run } from "../run";
import type {
  ChannelHub,
  RealtimeHubError,
  WorkspaceHub,
} from "../seams/realtime-hubs";
import type {
  DataAccessContext,
  TenantDataAccess,
  TenantDataAccessError,
  TenantWriteCommand,
} from "../seams/tenant-data-access";
import type { ThreadActivitySummary } from "../seams/thread-agent";
import type { Comment } from "../thread";

export type RunCompletionFlowError =
  | NotImplementedError
  | RealtimeHubError
  | TenantDataAccessError;

/**
 * Only completion carries an output comment and bumps (ADR 0017); a failure is announced as
 * a lifecycle change and read back from the agent's resident run state (ADR 0028) — the
 * UnreadReason vocabulary has no failure variant, so failed runs cannot badge anyone.
 */
export type RunSettlement =
  | {
      readonly kind: "complete";
      readonly outputComment: Comment;
      readonly participants: readonly MemberId[];
      readonly run: CompleteRun;
      readonly summary: ThreadActivitySummary;
    }
  | {
      readonly kind: "failed";
      readonly run: FailedRun;
      readonly summary: ThreadActivitySummary;
    };

/**
 * Unread recipients on bump = thread participants: the creator plus anyone who has commented
 * or dispatched in the thread (ADR 0027). Derived from the agent's resident state — the
 * creator is the opening comment's author, so the comment tree plus the run history is the
 * whole participant set.
 */
export const summarizeThreadActivity = (input: {
  readonly comments: readonly Comment[];
  readonly runs: readonly Run[];
}): ThreadActivitySummary => {
  let latest: Run | null = null;
  for (const run of input.runs) {
    if (
      (run.lifecycle === "queued" || run.lifecycle === "running") &&
      (latest === null || run.queuedAt >= latest.queuedAt)
    ) {
      latest = run;
    }
  }

  return {
    commentCount: input.comments.length,
    working:
      latest === null ? null : { runId: latest.id, since: latest.queuedAt },
  };
};

export const collectThreadParticipants = (input: {
  readonly comments: readonly Comment[];
  readonly runs: readonly Run[];
}): readonly MemberId[] => {
  const participants = new Set<MemberId>();

  for (const comment of input.comments) {
    if (comment.author.kind === "member") {
      participants.add(comment.author.memberId);
    }
  }

  for (const run of input.runs) {
    if (run.trigger.kind === "dispatch") {
      participants.add(run.trigger.dispatch.byMemberId);
    }
  }

  return [...participants];
};

export interface RunCompletionFlowDependencies {
  readonly channelHub: ChannelHub;
  /** Settle needs no member: production composes this under a SystemContext (ADR 0035 §1/§2). */
  readonly tenantDataAccess: TenantDataAccess<DataAccessContext>;
  readonly workspaceHub: WorkspaceHub;
}

/**
 * The completion half of the run lifecycle (ADR 0017): invoked by the ThreadAgent adapter
 * when a run reaches a terminal state, after the agent has recorded the run and its output
 * comment in its resident state. Everything the outside world learns about a settled run —
 * bump, unread fan-out, hub deltas — flows through here.
 */
export interface RunCompletionFlow {
  readonly settle: (
    input: RunSettlement
  ) => AsyncResult<void, RunCompletionFlowError>;
}

export const createRunCompletionFlow = (
  deps: RunCompletionFlowDependencies
): RunCompletionFlow => ({
  settle: async (input) => {
    if (input.kind === "failed") {
      const written = await deps.tenantDataAccess.batch({
        commands: [
          {
            kind: "update_thread_summary",
            summary: input.summary,
            threadId: input.run.threadId,
          },
        ],
        workspaceId: input.run.workspaceId,
      });
      if (!written.ok) {
        return written;
      }

      return deps.channelHub.publishEvent({
        kind: "run_lifecycle_changed",
        runId: input.run.id,
        threadId: input.run.threadId,
      });
    }

    const { run } = input;

    const indexLoaded = await deps.tenantDataAccess.getThread({
      threadId: run.threadId,
    });
    if (!indexLoaded.ok) {
      return indexLoaded;
    }

    const thread = indexLoaded.value;
    if (thread === null) {
      return err(
        createNotImplementedError("RunCompletionFlow.missingThreadIndexRow")
      );
    }

    const unreadWrites = input.participants.map(
      (participant): TenantWriteCommand => ({
        kind: "put_unread",
        unread: {
          bumpedAt: run.completedAt,
          memberId: participant,
          reasons: [
            {
              commentId: input.outputComment.id,
              kind: "agent_output",
              runId: run.id,
            },
          ],
          threadId: run.threadId,
          workspaceId: run.workspaceId,
        },
      })
    );

    const written = await deps.tenantDataAccess.batch({
      commands: [
        {
          kind: "put_thread_index",
          thread: { ...thread, lastActivityAt: run.completedAt },
        },
        {
          kind: "update_thread_summary",
          summary: input.summary,
          threadId: run.threadId,
        },
        ...unreadWrites,
      ],
      workspaceId: run.workspaceId,
    });
    if (!written.ok) {
      return written;
    }

    const commentAnnounced = await deps.channelHub.publishEvent({
      authorKind: "agent",
      commentId: input.outputComment.id,
      kind: "comment_added",
      threadId: run.threadId,
    });
    if (!commentAnnounced.ok) {
      return commentAnnounced;
    }

    const lifecycleAnnounced = await deps.channelHub.publishEvent({
      kind: "run_lifecycle_changed",
      runId: run.id,
      threadId: run.threadId,
    });
    if (!lifecycleAnnounced.ok) {
      return lifecycleAnnounced;
    }

    return deps.workspaceHub.publishActivity({
      bumpedAt: run.completedAt,
      channelId: run.channelId,
      kind: "thread_bumped",
      threadId: run.threadId,
    });
  },
});
