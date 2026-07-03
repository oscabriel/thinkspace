import { runIdSchema } from "../../ids";
import { err, ok } from "../../result";
import type { QueuedRun, Run, Schedule, SubAgentActivity } from "../../run";
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

export interface MemoryThreadAgentConfig {
  readonly address: ThreadAgentAddress;
  readonly clock?: () => Date;
  readonly comments?: readonly Comment[];
  readonly nextRunId?: () => QueuedRun["id"];
  readonly runs?: readonly Run[];
  readonly schedules?: readonly Schedule[];
  readonly shapeSnapshot?: ShapeSnapshot;
  readonly subAgentActivityByRunId?: Readonly<
    Record<string, readonly SubAgentActivity[]>
  >;
}

interface MemoryThreadAgentState {
  readonly comments: Map<string, Comment>;
  readonly runs: Map<string, Run>;
  readonly schedules: Map<string, Schedule>;
  shapeSnapshot: ShapeSnapshot | null;
}

const defaultRunId = (): QueuedRun["id"] =>
  runIdSchema.parse(`memory-run-${Date.now()}-${Math.random()}`);

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
): ThreadAgent => {
  const clock = config.clock ?? (() => new Date());
  const nextRunId = config.nextRunId ?? defaultRunId;
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
