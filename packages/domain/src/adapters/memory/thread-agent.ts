import { createNotImplementedError } from "../../errors";
import { collectThreadParticipants } from "../../flows/run-completion";
import type {
  RunCompletionFlow,
  RunCompletionFlowError,
} from "../../flows/run-completion";
import { commentIdSchema, runIdSchema } from "../../ids";
import type { CommentBody, FailureReason } from "../../primitives";
import { err, ok } from "../../result";
import type { AsyncResult } from "../../result";
import type {
  CompleteRun,
  FailedRun,
  QueuedRun,
  Run,
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

const ancestorComments = (
  state: MemoryThreadAgentState,
  rootCommentId: Comment["id"]
): readonly Comment[] => {
  const root = state.comments.get(idKey(rootCommentId));
  if (root === undefined) {
    return [];
  }

  const ancestors: Comment[] = [];
  let current = root;
  while (current.parent.kind === "nested") {
    const parent = state.comments.get(idKey(current.parent.parentCommentId));
    if (parent === undefined) {
      break;
    }

    ancestors.unshift(parent);
    current = parent;
  }

  return ancestors;
};

const branchComments = (
  state: MemoryThreadAgentState,
  rootCommentId: Comment["id"]
): readonly Comment[] => {
  const root = state.comments.get(idKey(rootCommentId));
  if (root === undefined) {
    return [];
  }

  const collected: Comment[] = [];
  const visit = (comment: Comment): void => {
    collected.push(comment);

    for (const candidate of state.comments.values()) {
      if (
        candidate.parent.kind === "nested" &&
        hasSameId(candidate.parent.parentCommentId, comment.id)
      ) {
        visit(candidate);
      }
    }
  };

  visit(root);
  return collected;
};

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

      state.comments.set(idKey(input.comment.id), input.comment);
      return ok(input.comment);
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
        ancestors: ancestorComments(state, input.rootCommentId),
        branch: {
          rootCommentId: input.rootCommentId,
          threadId: config.address.threadId,
        },
        subtree: branchComments(state, input.rootCommentId),
      };

      return ok(snapshot);
    },
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

const addressKey = (address: ThreadAgentAddress): string =>
  [
    idKey(address.workspaceId),
    idKey(address.channelId),
    idKey(address.threadId),
  ].join("/");

/** Mirrors DO namespace semantics: an agent exists at every address, created on first get. */
export const createMemoryThreadAgentDirectory = (
  config?: MemoryThreadAgentDirectoryConfig
): ThreadAgentDirectory => {
  const agents = new Map(
    (config?.agents ?? []).map((agent) => [addressKey(agent.address), agent])
  );

  return {
    get: (address) => {
      const key = addressKey(address);
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
