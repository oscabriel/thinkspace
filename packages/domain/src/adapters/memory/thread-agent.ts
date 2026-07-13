import { createNotImplementedError } from "../../errors";
import {
  collectThreadParticipants,
  summarizeThreadActivity,
} from "../../flows/run-completion";
import type {
  RunCompletionFlow,
  RunCompletionFlowError,
} from "../../flows/run-completion";
import type { GestureId } from "../../ids";
import { commentIdSchema, runIdSchema } from "../../ids";
import type { CommentBody, FailureReason } from "../../primitives";
import { err, ok } from "../../result";
import type { AsyncResult } from "../../result";
import type {
  CompleteRun,
  FailedRun,
  QueuedRun,
  Run,
  RunTrigger,
  Schedule,
  SubAgentActivity,
} from "../../run";
import type {
  BranchSnapshot,
  ThreadAgent,
  ThreadAgentAddress,
  ThreadAgentDirectory,
  ThreadAgentError,
} from "../../seams/thread-agent";
import type { ShapeSnapshot } from "../../shape";
import type { Comment } from "../../thread";
import { ancestorComments, branchComments } from "../comment-tree";
import { encodeThreadAgentAddress } from "../thread-agent-address";
import { hasSameId, idKey } from "./helpers";

/** The scripted outcome of one executed run — the memory stand-in for a real model turn. */
export type MemoryThreadAgentTurnOutcome =
  | { readonly body: CommentBody; readonly kind: "reply" }
  | { readonly failureReason: FailureReason; readonly kind: "failure" };

export type MemoryThreadAgentExecutionError =
  | RunCompletionFlowError
  | ThreadAgentError;

/**
 * The memory agent's execution surface is not part of the ThreadAgent seam: in production
 * the Durable Object drives its own queued runs (alarms/turn loop); executeNextRun is how a
 * test caller stands in for that tick.
 */
export interface MemoryThreadAgent extends ThreadAgent {
  readonly executeNextRun: () => AsyncResult<
    Run | null,
    MemoryThreadAgentExecutionError
  >;
}

export interface MemoryThreadAgentConfig {
  readonly address: ThreadAgentAddress;
  readonly clock?: () => Date;
  readonly comments?: readonly Comment[];
  readonly completionFlow?: RunCompletionFlow;
  readonly nextCommentId?: () => Comment["id"];
  readonly nextRunId?: () => QueuedRun["id"];
  readonly runs?: readonly Run[];
  readonly schedules?: readonly Schedule[];
  readonly shapeSnapshot?: ShapeSnapshot;
  readonly subAgentActivityByRunId?: Readonly<
    Record<string, readonly SubAgentActivity[]>
  >;
  readonly turnScript?: readonly MemoryThreadAgentTurnOutcome[];
}

interface MemoryThreadAgentState {
  readonly comments: Map<string, Comment>;
  readonly runs: Map<string, Run>;
  readonly schedules: Map<string, Schedule>;
  shapeSnapshot: ShapeSnapshot | null;
}

const defaultRunId = (): QueuedRun["id"] =>
  runIdSchema.parse(`memory-run-${Date.now()}-${Math.random()}`);

const defaultCommentId = (): Comment["id"] =>
  commentIdSchema.parse(`memory-comment-${Date.now()}-${Math.random()}`);

const isCommentInAddress = (
  address: ThreadAgentAddress,
  comment: Comment
): boolean =>
  hasSameId(comment.workspaceId, address.workspaceId) &&
  hasSameId(comment.threadId, address.threadId);

const isScheduleInAddress = (
  address: ThreadAgentAddress,
  schedule: Schedule
): boolean =>
  hasSameId(schedule.workspaceId, address.workspaceId) &&
  hasSameId(schedule.threadId, address.threadId) &&
  hasSameId(schedule.channelId, address.channelId);

const tenantOrThreadViolation = (
  address: ThreadAgentAddress,
  observedWorkspaceId: Comment["workspaceId"] | Schedule["workspaceId"]
): ThreadAgentError => ({
  expectedWorkspaceId: address.workspaceId,
  kind: "tenant_guard_violation",
  observed: { kind: "workspace", workspaceId: observedWorkspaceId },
});

/** Only dispatch triggers carry a gestureId; scheduled fires have no client gesture (E5.3). */
const dispatchGestureId = (trigger: RunTrigger): GestureId | null =>
  trigger.kind === "dispatch" ? trigger.dispatch.gestureId : null;

/**
 * The queue-time view of a run, reconstructed from a stored run of any lifecycle: a
 * replayed dispatch returns the original run's receipt, deterministically "queued" (E5.3),
 * because every Run variant preserves the queued base fields.
 */
const queuedReceiptRun = (run: Run): QueuedRun => ({
  channelId: run.channelId,
  id: run.id,
  lifecycle: "queued",
  queuedAt: run.queuedAt,
  threadId: run.threadId,
  trigger: run.trigger,
  workspaceId: run.workspaceId,
});

export const createMemoryThreadAgent = (
  config: MemoryThreadAgentConfig
): MemoryThreadAgent => {
  const clock = config.clock ?? (() => new Date());
  const nextRunId = config.nextRunId ?? defaultRunId;
  const nextCommentId = config.nextCommentId ?? defaultCommentId;
  const turnScript = [...(config.turnScript ?? [])];
  const state: MemoryThreadAgentState = {
    comments: new Map(
      (config.comments ?? []).map((comment) => [idKey(comment.id), comment])
    ),
    runs: new Map((config.runs ?? []).map((run) => [idKey(run.id), run])),
    schedules: new Map(
      (config.schedules ?? []).map((schedule) => [idKey(schedule.id), schedule])
    ),
    shapeSnapshot: config.shapeSnapshot ?? null,
  };

  /** Executes the oldest queued run per the next scripted turn (queued → running → settled). */
  const executeNextRun = async (): AsyncResult<
    Run | null,
    MemoryThreadAgentExecutionError
  > => {
    const queued = [...state.runs.values()].find(
      (run): run is QueuedRun => run.lifecycle === "queued"
    );
    if (queued === undefined) {
      return ok(null);
    }

    if (config.completionFlow === undefined) {
      return err(createNotImplementedError("MemoryThreadAgent.completionFlow"));
    }

    const outcome = turnScript.shift();
    if (outcome === undefined) {
      return err(createNotImplementedError("MemoryThreadAgent.turnScript"));
    }

    const startedAt = clock();

    if (outcome.kind === "failure") {
      const failedRun: FailedRun = {
        ...queued,
        failure: {
          failedAt: clock(),
          failureReason: outcome.failureReason,
          from: "running",
          startedAt,
        },
        lifecycle: "failed",
      };
      state.runs.set(idKey(failedRun.id), failedRun);

      const settled = await config.completionFlow.settle({
        kind: "failed",
        run: failedRun,
        summary: summarizeThreadActivity({
          comments: [...state.comments.values()],
          runs: [...state.runs.values()],
        }),
      });
      if (!settled.ok) {
        return settled;
      }

      return ok(failedRun);
    }

    /** A scheduled fire appends a new top-level comment; a dispatch replies at its target (ADR 0017). */
    const outputComment: Comment = {
      author: {
        channelId: config.address.channelId,
        facet: { kind: "channel_agent" },
        kind: "agent",
      },
      body: outcome.body,
      createdAt: clock(),
      id: nextCommentId(),
      parent:
        queued.trigger.kind === "dispatch"
          ? {
              kind: "nested",
              parentCommentId: queued.trigger.dispatch.targetCommentId,
            }
          : { kind: "top_level" },
      threadId: config.address.threadId,
      workspaceId: config.address.workspaceId,
    };
    state.comments.set(idKey(outputComment.id), outputComment);

    const completeRun: CompleteRun = {
      ...queued,
      completedAt: clock(),
      lifecycle: "complete",
      outputCommentId: outputComment.id,
      startedAt,
    };
    state.runs.set(idKey(completeRun.id), completeRun);

    const settled = await config.completionFlow.settle({
      kind: "complete",
      outputComment,
      participants: collectThreadParticipants({
        comments: [...state.comments.values()],
        runs: [...state.runs.values()],
      }),
      run: completeRun,
      summary: summarizeThreadActivity({
        comments: [...state.comments.values()],
        runs: [...state.runs.values()],
      }),
    });
    if (!settled.ok) {
      return settled;
    }

    return ok(completeRun);
  };

  return {
    address: config.address,
    appendComment: async (input) => {
      if (!isCommentInAddress(config.address, input.comment)) {
        return err(
          tenantOrThreadViolation(config.address, input.comment.workspaceId)
        );
      }

      const { parent } = input.comment;
      if (
        parent.kind === "nested" &&
        !state.comments.has(idKey(parent.parentCommentId))
      ) {
        return err({
          kind: "comment_parent_not_in_thread",
          parentCommentId: parent.parentCommentId,
          threadId: config.address.threadId,
          workspaceId: config.address.workspaceId,
        });
      }

      // First-write-wins on the edge-minted commentId (mirrors initialize): a replay
      // returns the ORIGINAL comment so downstream fan-out converges on its timestamps.
      const existing = state.comments.get(idKey(input.comment.id)) ?? null;
      if (existing === null) {
        state.comments.set(idKey(input.comment.id), input.comment);
      }
      return ok({
        comment: existing ?? input.comment,
        participants: collectThreadParticipants({
          comments: [...state.comments.values()],
          runs: [...state.runs.values()],
        }),
        summary: summarizeThreadActivity({
          comments: [...state.comments.values()],
          runs: [...state.runs.values()],
        }),
      });
    },
    executeNextRun,
    getRun: async (input) => {
      const run = state.runs.get(idKey(input.runId));
      if (run === undefined) {
        return ok(null);
      }

      return ok({
        run,
        subAgentActivity:
          config.subAgentActivityByRunId?.[idKey(input.runId)] ?? [],
      });
    },
    initialize: async (input) => {
      if (!isCommentInAddress(config.address, input.openingComment)) {
        return err(
          tenantOrThreadViolation(
            config.address,
            input.openingComment.workspaceId
          )
        );
      }

      // First-write-wins (ADR 0034): the DO is the authority on its own initialization.
      if (state.shapeSnapshot !== null) {
        return ok({
          shapeSnapshot: state.shapeSnapshot,
          threadId: config.address.threadId,
        });
      }

      state.shapeSnapshot = input.shapeSnapshot;
      state.comments.set(idKey(input.openingComment.id), input.openingComment);

      return ok({
        shapeSnapshot: input.shapeSnapshot,
        threadId: config.address.threadId,
      });
    },
    listRuns: async () => ok([...state.runs.values()]),
    loadBranch: async (input) => {
      const snapshot: BranchSnapshot = {
        ancestors: ancestorComments(state.comments, input.rootCommentId),
        branch: {
          rootCommentId: input.rootCommentId,
          threadId: config.address.threadId,
        },
        subtree: branchComments(state.comments, input.rootCommentId),
      };

      return ok(snapshot);
    },
    // The memory adapter holds no live SDK connections (that is DO substrate), so the revoke
    // fan-out (ADR 0037 decision 4) is a no-op success — the seam contract's idle-case pin.
    removeMcpServer: async () => ok(),
    resnapshot: async (input) => {
      state.shapeSnapshot = input.shapeSnapshot;
      return ok({
        shapeSnapshot: input.shapeSnapshot,
        threadId: config.address.threadId,
      });
    },
    run: async (input) => {
      if (state.shapeSnapshot === null) {
        return err({
          channelId: config.address.channelId,
          kind: "thread_agent_uninitialized",
          threadId: config.address.threadId,
          workspaceId: config.address.workspaceId,
        });
      }

      // Dispatch dedupe (E5.3): a replay carrying a gestureId already on a run converges
      // on that run's receipt and mints no second run — like the PUT creation gesture.
      const gestureId = dispatchGestureId(input);
      if (gestureId !== null) {
        const existing = [...state.runs.values()].find(
          (run) => dispatchGestureId(run.trigger) === gestureId
        );
        if (existing !== undefined) {
          return ok({
            queuedRun: queuedReceiptRun(existing),
            runId: existing.id,
            summary: summarizeThreadActivity({
              comments: [...state.comments.values()],
              runs: [...state.runs.values()],
            }),
            threadId: config.address.threadId,
          });
        }
      }

      const runId = nextRunId();
      const queuedRun: QueuedRun = {
        channelId: config.address.channelId,
        id: runId,
        lifecycle: "queued",
        queuedAt: clock(),
        threadId: config.address.threadId,
        trigger: input,
        workspaceId: config.address.workspaceId,
      };

      state.runs.set(idKey(runId), queuedRun);

      return ok({
        queuedRun,
        runId,
        summary: summarizeThreadActivity({
          comments: [...state.comments.values()],
          runs: [...state.runs.values()],
        }),
        threadId: config.address.threadId,
      });
    },
    schedule: async (input) => {
      if (!isScheduleInAddress(config.address, input.schedule)) {
        return err(
          tenantOrThreadViolation(config.address, input.schedule.workspaceId)
        );
      }

      state.schedules.set(idKey(input.schedule.id), input.schedule);
      return ok(input.schedule);
    },
  };
};

export interface MemoryThreadAgentDirectoryConfig {
  readonly agents?: readonly ThreadAgent[];
}

/** Mirrors DO namespace semantics: an agent exists at every address, created on first get. */
export const createMemoryThreadAgentDirectory = (
  config?: MemoryThreadAgentDirectoryConfig
): ThreadAgentDirectory => {
  const agents = new Map(
    (config?.agents ?? []).map((agent) => [
      encodeThreadAgentAddress(agent.address),
      agent,
    ])
  );

  return {
    get: (address) => {
      const key = encodeThreadAgentAddress(address);
      const existing = agents.get(key);
      if (existing !== undefined) {
        return existing;
      }

      const created = createMemoryThreadAgent({ address });
      agents.set(key, created);
      return created;
    },
  };
};
