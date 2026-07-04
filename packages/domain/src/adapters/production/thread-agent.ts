import { Agent, getAgentByName } from "agents";
import type { AgentContext } from "agents";

import { runIdSchema } from "../../ids";
import { err, ok } from "../../result";
import type { AsyncResult } from "../../result";
import type {
  QueuedRun,
  Run,
  RunTrigger,
  Schedule,
  SubAgentActivity,
} from "../../run";
import type {
  BranchSnapshot,
  RunDetail,
  ThreadAgent,
  ThreadAgentAddress,
  ThreadAgentDirectory,
  ThreadAgentError,
  ThreadAgentInitializeRequest,
  ThreadAgentResnapshotRequest,
  ThreadAgentRunReceipt,
  ThreadAgentSnapshot,
} from "../../seams/thread-agent";
import type { ShapeSnapshot } from "../../shape";
import type { ThreadAgentSeed } from "../../testing/contracts/thread-agent";
import type { Comment } from "../../thread";
import { ancestorComments, branchComments } from "../comment-tree";
import { hasSameId, idKey, parseJsonColumn } from "../helpers";
import {
  decodeThreadAgentAddress,
  encodeThreadAgentAddress,
} from "../thread-agent-address";

const defaultClock = (): Date => new Date();

const defaultRunId = (): QueuedRun["id"] =>
  runIdSchema.parse(`run-${crypto.randomUUID()}`);

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

/**
 * The production ThreadAgent: an agents-SDK Durable Object (ADR 0015 pin set) whose seam
 * state lives in adapter-owned DO-SQLite tables. The domain rows are the source of truth;
 * the SDK supplies the substrate (SQLite, hibernation, alarms) — the model-turn execution
 * layer (Think submissions) composes on top in the dispatch→completion round-trip slice.
 */
export class ThreadAgentDurableObject extends Agent<Cloudflare.Env> {
  private address: ThreadAgentAddress | null = null;
  private clock: () => Date = defaultClock;
  private mintRunId: () => QueuedRun["id"] = defaultRunId;
  private subAgentActivityByRunId: Readonly<
    Record<string, readonly SubAgentActivity[]>
  > = {};

  constructor(ctx: AgentContext, env: Cloudflare.Env) {
    super(ctx, env);
    this.ensureSeamTables();
  }

  /**
   * ADR 0033: the DO name IS the address — routing-derived and tamper-proof. Decoded
   * lazily (never in the constructor: contract binders address DOs by random UUID names
   * and seed afterward; the seed's explicit address takes precedence) and memoized.
   */
  private deriveAddress(): ThreadAgentAddress | null {
    this.address ??= decodeThreadAgentAddress(this.readDoName() ?? "");
    return this.address;
  }

  /** `this.name` throws for DOs addressed by unique id (partyserver getter over ctx.id.name). */
  private readDoName(): string | null {
    try {
      return this.name;
    } catch {
      return null;
    }
  }

  /** Fail closed: an undecodable name is a bad route or a forged caller — execute nothing. */
  private unaddressable(): ThreadAgentError {
    return {
      doName: this.readDoName() ?? "",
      kind: "thread_agent_unaddressable",
    };
  }

  private ensureSeamTables(): readonly (readonly unknown[])[] {
    return [
      this
        .sql`CREATE TABLE IF NOT EXISTS ts_comment (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
      this
        .sql`CREATE TABLE IF NOT EXISTS ts_run (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, data TEXT NOT NULL)`,
      this
        .sql`CREATE TABLE IF NOT EXISTS ts_schedule (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
      this
        .sql`CREATE TABLE IF NOT EXISTS ts_snapshot (slot INTEGER PRIMARY KEY CHECK (slot = 1), data TEXT NOT NULL)`,
    ];
  }

  /** Test capability (contract-suite seed); production state arrives via initialize/run. */
  applyTestSeed(seed: ThreadAgentSeed): void {
    this.address = seed.address;
    if (seed.clock !== undefined) {
      this.clock = seed.clock;
    }
    if (seed.nextRunId !== undefined) {
      this.mintRunId = seed.nextRunId;
    }
    this.subAgentActivityByRunId = seed.subAgentActivityByRunId ?? {};

    for (const comment of seed.comments ?? []) {
      this.putComment(comment);
    }
    for (const run of seed.runs ?? []) {
      this.putRun(run);
    }
    if (seed.shapeSnapshot !== undefined) {
      this.putSnapshot(seed.shapeSnapshot);
    }
  }

  async appendComment(input: {
    readonly comment: Comment;
  }): AsyncResult<Comment, ThreadAgentError> {
    const address = this.deriveAddress();
    if (address === null) {
      return err(this.unaddressable());
    }

    if (!isCommentInAddress(address, input.comment)) {
      return err(tenantOrThreadViolation(address, input.comment.workspaceId));
    }

    this.putComment(input.comment);
    return ok(input.comment);
  }

  async getRun(input: {
    readonly runId: Run["id"];
  }): AsyncResult<RunDetail | null, ThreadAgentError> {
    if (this.deriveAddress() === null) {
      return err(this.unaddressable());
    }

    const rows = this.sql<{ data: string }>`
      SELECT data FROM ts_run WHERE id = ${idKey(input.runId)}
    `;
    const [row] = rows;
    if (row === undefined) {
      return ok(null);
    }

    return ok({
      run: parseJsonColumn<Run>(row.data),
      subAgentActivity: this.subAgentActivityByRunId[idKey(input.runId)] ?? [],
    });
  }

  async initialize(
    input: ThreadAgentInitializeRequest
  ): AsyncResult<ThreadAgentSnapshot, ThreadAgentError> {
    const address = this.deriveAddress();
    if (address === null) {
      return err(this.unaddressable());
    }

    if (!isCommentInAddress(address, input.openingComment)) {
      return err(
        tenantOrThreadViolation(address, input.openingComment.workspaceId)
      );
    }

    this.putSnapshot(input.shapeSnapshot);
    this.putComment(input.openingComment);

    return ok({
      shapeSnapshot: input.shapeSnapshot,
      threadId: address.threadId,
    });
  }

  async listRuns(): AsyncResult<readonly Run[], ThreadAgentError> {
    if (this.deriveAddress() === null) {
      return err(this.unaddressable());
    }

    const rows = this.sql<{ data: string }>`
      SELECT data FROM ts_run ORDER BY seq ASC
    `;
    return ok(rows.map((row) => parseJsonColumn<Run>(row.data)));
  }

  async loadBranch(input: {
    readonly rootCommentId: Comment["id"];
  }): AsyncResult<BranchSnapshot, ThreadAgentError> {
    const address = this.deriveAddress();
    if (address === null) {
      return err(this.unaddressable());
    }

    const comments = this.loadComments();
    return ok({
      ancestors: ancestorComments(comments, input.rootCommentId),
      branch: {
        rootCommentId: input.rootCommentId,
        threadId: address.threadId,
      },
      subtree: branchComments(comments, input.rootCommentId),
    });
  }

  async resnapshot(
    input: ThreadAgentResnapshotRequest
  ): AsyncResult<ThreadAgentSnapshot, ThreadAgentError> {
    const address = this.deriveAddress();
    if (address === null) {
      return err(this.unaddressable());
    }

    this.putSnapshot(input.shapeSnapshot);
    return ok({
      shapeSnapshot: input.shapeSnapshot,
      threadId: address.threadId,
    });
  }

  async run(
    input: RunTrigger
  ): AsyncResult<ThreadAgentRunReceipt, ThreadAgentError> {
    const address = this.deriveAddress();
    if (address === null) {
      return err(this.unaddressable());
    }

    if (this.readSnapshot() === null) {
      return err({
        channelId: address.channelId,
        kind: "thread_agent_uninitialized",
        threadId: address.threadId,
        workspaceId: address.workspaceId,
      });
    }

    const runId = this.mintRunId();
    const queuedRun: QueuedRun = {
      channelId: address.channelId,
      id: runId,
      lifecycle: "queued",
      queuedAt: this.clock(),
      threadId: address.threadId,
      trigger: input,
      workspaceId: address.workspaceId,
    };
    this.putRun(queuedRun);

    return ok({ queuedRun, runId, threadId: address.threadId });
  }

  /** Seam ThreadAgent.schedule — renamed: the agents SDK reserves `schedule` for its alarm API. */
  async scheduleRun(input: {
    readonly schedule: Schedule;
  }): AsyncResult<Schedule, ThreadAgentError> {
    const address = this.deriveAddress();
    if (address === null) {
      return err(this.unaddressable());
    }

    if (!isScheduleInAddress(address, input.schedule)) {
      return err(tenantOrThreadViolation(address, input.schedule.workspaceId));
    }

    this.putSchedule(input.schedule);
    return ok(input.schedule);
  }

  private loadComments(): ReadonlyMap<string, Comment> {
    const rows = this.sql<{ data: string; id: string }>`
      SELECT id, data FROM ts_comment
    `;
    return new Map(
      rows.map((row) => [row.id, parseJsonColumn<Comment>(row.data)])
    );
  }

  private putComment(comment: Comment): readonly unknown[] {
    return this.sql`
      INSERT INTO ts_comment (id, data)
      VALUES (${idKey(comment.id)}, ${JSON.stringify(comment)})
      ON CONFLICT (id) DO UPDATE SET data = excluded.data
    `;
  }

  private putRun(run: Run): readonly unknown[] {
    return this.sql`
      INSERT INTO ts_run (id, seq, data)
      VALUES (
        ${idKey(run.id)},
        COALESCE((SELECT MAX(seq) FROM ts_run), 0) + 1,
        ${JSON.stringify(run)}
      )
      ON CONFLICT (id) DO UPDATE SET data = excluded.data
    `;
  }

  private putSchedule(schedule: Schedule): readonly unknown[] {
    return this.sql`
      INSERT INTO ts_schedule (id, data)
      VALUES (${idKey(schedule.id)}, ${JSON.stringify(schedule)})
      ON CONFLICT (id) DO UPDATE SET data = excluded.data
    `;
  }

  private putSnapshot(snapshot: ShapeSnapshot): readonly unknown[] {
    return this.sql`
      INSERT INTO ts_snapshot (slot, data)
      VALUES (1, ${JSON.stringify(snapshot)})
      ON CONFLICT (slot) DO UPDATE SET data = excluded.data
    `;
  }

  private readSnapshot(): ShapeSnapshot | null {
    const rows = this.sql<{ data: string }>`
      SELECT data FROM ts_snapshot WHERE slot = 1
    `;
    const [row] = rows;
    return row === undefined ? null : parseJsonColumn<ShapeSnapshot>(row.data);
  }
}

/**
 * Compile-time proof the DO satisfies the seam. `address` is carried by the caller-side
 * wrapper; seam `schedule` maps to `scheduleRun` because the agents SDK base class
 * reserves the `schedule` name for its alarm API.
 */
type SeamMethods = Omit<ThreadAgent, "address" | "schedule"> & {
  readonly scheduleRun: ThreadAgent["schedule"];
};
type AssertSeam<T extends SeamMethods> = T;
export type ThreadAgentDurableObjectSatisfiesSeam =
  AssertSeam<ThreadAgentDurableObject>;

export interface ProductionThreadAgentDirectoryConfig {
  readonly namespace: DurableObjectNamespace<ThreadAgentDurableObject>;
}

/**
 * ADR 0033: a pure thin adapter over the DO namespace — no storage, no failure modes,
 * no creation step; the first get materializes the agent. Each wrapper caches its stub
 * promise so getAgentByName's setName round-trip is paid once per wrapper, and maps
 * seam `schedule` to DO `scheduleRun` (the SDK reserves `schedule` for its alarm API).
 */
export const createProductionThreadAgentDirectory = (
  config: ProductionThreadAgentDirectoryConfig
): ThreadAgentDirectory => ({
  get: (address) => {
    let stubPromise: ReturnType<
      typeof getAgentByName<Cloudflare.Env, ThreadAgentDurableObject>
    > | null = null;
    const stub = () =>
      (stubPromise ??= getAgentByName(
        config.namespace,
        encodeThreadAgentAddress(address)
      ));

    return {
      address,
      appendComment: async (input) => (await stub()).appendComment(input),
      getRun: async (input) => (await stub()).getRun(input),
      initialize: async (input) => (await stub()).initialize(input),
      listRuns: async () => (await stub()).listRuns(),
      loadBranch: async (input) => (await stub()).loadBranch(input),
      resnapshot: async (input) => (await stub()).resnapshot(input),
      run: async (input) => (await stub()).run(input),
      schedule: async (input) => (await stub()).scheduleRun(input),
    };
  },
});
