import { Think } from "@cloudflare/think";
import type { ThinkSubmissionInspection } from "@cloudflare/think";
import { getAgentByName, normalizeServerId } from "agents";
import type { AgentContext } from "agents";
import type { LanguageModel, ToolSet, UIMessage } from "ai";

import type { RunFailureError } from "../../errors";
import {
  collectThreadParticipants,
  createRunCompletionFlow,
  summarizeThreadActivity,
} from "../../flows/run-completion";
import type {
  RunCompletionFlow,
  RunSettlement,
} from "../../flows/run-completion";
import type { GestureId, McpServerId, MemberId } from "../../ids";
import { commentIdSchema, runIdSchema } from "../../ids";
import type { McpServer } from "../../mcp";
import { commentBodySchema, failureReasonSchema } from "../../primitives";
import type { FailureReason } from "../../primitives";
import { err, ok } from "../../result";
import type { AsyncResult } from "../../result";
import type {
  CompleteRun,
  FailedRun,
  QueuedRun,
  Run,
  RunFailure,
  RunningRun,
  RunTrigger,
  Schedule,
  SubAgentActivity,
} from "../../run";
import type { ResolvedProviderAuth } from "../../seams/key-store";
import type { SkillContent } from "../../seams/skill-store";
import type { SystemContext } from "../../seams/tenant-data-access";
import type {
  BranchSnapshot,
  CommentAppend,
  RunDetail,
  ThreadAgent,
  ThreadAgentAddress,
  ThreadAgentDirectory,
  ThreadAgentError,
  ThreadAgentInitializeRequest,
  ThreadAgentResnapshotRequest,
  ThreadAgentRunReceipt,
  ThreadAgentSnapshot,
  ThreadActivitySummary,
} from "../../seams/thread-agent";
import type {
  ToolResolutionError,
  ToolResolutionRequest,
} from "../../seams/tool-resolution";
import type { ShapeSnapshot, ShapeStructure } from "../../shape";
import type { ThreadAgentSeed } from "../../testing/contracts/thread-agent";
import type { Comment } from "../../thread";
import { ancestorComments, branchComments } from "../comment-tree";
import { hasSameId, idKey, parseJsonColumn } from "../helpers";
import {
  decodeThreadAgentAddress,
  encodeThreadAgentAddress,
} from "../thread-agent-address";
import { createKeyStore } from "./key-store";
import type { KeyStoreEnv } from "./key-store";
import { createGatewayModel } from "./model-gateway";
import {
  createProductionChannelHub,
  createProductionWorkspaceHub,
} from "./realtime-hubs";
import type {
  ChannelHubDurableObject,
  WorkspaceHubDurableObject,
} from "./realtime-hubs";
import { loadSelectedSkillContents } from "./skill-store";
import { createD1TenantDataAccess } from "./tenant-data-access";
import {
  createCatalogWorkspaceShapeToolResolver,
  createWorkerMcpEgressPolicy,
} from "./tool-resolution";

const defaultClock = (): Date => new Date();

const defaultRunId = (): QueuedRun["id"] =>
  runIdSchema.parse(`run-${crypto.randomUUID()}`);

const defaultCommentId = (): Comment["id"] =>
  commentIdSchema.parse(`comment-${crypto.randomUUID()}`);

const TERMINAL_SUBMISSION_STATUSES = new Set([
  "aborted",
  "completed",
  "error",
  "skipped",
]);

/** ADR 0025 context window rendered as the turn input: ancestors then subtree, in tree order. */
const commentToUiMessage = (comment: Comment): UIMessage => ({
  id: idKey(comment.id),
  parts: [{ text: comment.body, type: "text" }],
  role: comment.author.kind === "member" ? "user" : "assistant",
});

const runBase = (
  run: QueuedRun | RunningRun
): Omit<QueuedRun, "lifecycle"> => ({
  channelId: run.channelId,
  id: run.id,
  queuedAt: run.queuedAt,
  threadId: run.threadId,
  trigger: run.trigger,
  workspaceId: run.workspaceId,
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

/** The exact bindings settlement wiring needs; the server worker env carries all three. */
export interface CompletionFlowEnv {
  readonly AI_GATEWAY_TOKEN: string;
  readonly AI_GATEWAY_URL: string;
  readonly CHANNEL_HUB: DurableObjectNamespace<ChannelHubDurableObject>;
  readonly DB: D1Database;
  readonly WORKSPACE_HUB: DurableObjectNamespace<WorkspaceHubDurableObject>;
}

/** Skill turn-assembly bindings (ADR 0005/0029): the D1 index + the R2 markdown bucket. */
interface SkillTurnEnv {
  readonly DB: D1Database;
  readonly SKILLS: R2Bucket;
}

/**
 * Renders the shape's selected skills (ADR 0005/0029) into the effective system prompt. The
 * selection is frozen into the snapshot (structure); the markdown stays live (content), so it
 * is reloaded each turn. Empty selection leaves the base prompt untouched.
 */
const renderSystemPromptWithSkills = (
  base: string,
  skills: readonly SkillContent[]
): string => {
  if (skills.length === 0) {
    return base;
  }
  const blocks = skills
    .map((content) => `## ${content.skill.name}\n\n${content.markdown}`)
    .join("\n\n");
  const skillSection = `# Skills\n\n${blocks}`;
  return base.length === 0 ? skillSection : `${base}\n\n${skillSection}`;
};

/**
 * The per-turn tool-resolution request (ADR 0037 decision 1), built from the resident shape
 * snapshot's frozen selections: the turn runs with every selected tool active (no runtime
 * narrowing) plus the shape's cross-channel artifact opt-ins. The home channel's artifact set
 * resolves dynamically and is not needed to reconcile MCP connections.
 */
const toolResolutionRequestFor = (
  structure: ShapeStructure
): ToolResolutionRequest => ({
  artifactAccessScope: {
    artifactIds: structure.artifactSelection,
    homeChannelArtifactIds: [],
    kind: "shape_artifact_selection",
  },
  beforeTurnAdditions: { addedToolIds: [], kind: "additive_tools_only" },
  runtimeNarrowing: {
    activeToolIds: structure.toolSelection,
    kind: "active_tools_allowlist",
  },
  shape: structure,
});

/** ADR 0037 decision 3: a resolution/egress error becomes a RunFailure, never a silent empty set. */
const resolutionFailureReason = (error: ToolResolutionError): FailureReason =>
  failureReasonSchema.parse(
    error.kind === "mcp_host_not_allowed"
      ? `MCP host not approved: ${error.host}`
      : `tool resolution failed: ${error.kind}`
  );

/** The DO-SQLite connection id the SDK derives for a domain MCP server (ADR 0037 decision 2). */
const mcpConnectionId = (mcpServerId: McpServerId): string =>
  normalizeServerId(idKey(mcpServerId));

/**
 * ADR 0035 §2: production wiring of the settlement fan-out. Everything needed survives a
 * hibernation wake — env and the name-derived address. No member acts at settle time, so
 * the D1 adapter runs under a SystemContext built from the address's workspaceId; the
 * hubs are addressed from the same triple.
 */
export const buildCompletionFlow = (
  env: CompletionFlowEnv,
  address: ThreadAgentAddress
): RunCompletionFlow => {
  const context: SystemContext = {
    kind: "system",
    workspaceId: address.workspaceId,
  };
  return createRunCompletionFlow({
    channelHub: createProductionChannelHub({
      address: { channelId: address.channelId },
      context,
      namespace: env.CHANNEL_HUB,
    }),
    tenantDataAccess: createD1TenantDataAccess({ context, db: env.DB }),
    workspaceHub: createProductionWorkspaceHub({
      context,
      namespace: env.WORKSPACE_HUB,
    }),
  });
};

/**
 * The production ThreadAgent: a Think Durable Object (ADR 0015 pin set) whose seam state
 * lives in adapter-owned DO-SQLite tables. The domain rows are the source of truth; the
 * SDK supplies the substrate (SQLite, hibernation, alarms) and the durable turn queue —
 * a domain Run is executed as a Think submission with `submissionId = RunId` (ADR 0033),
 * and `onSubmissionStatus` maps terminal submissions back onto the run lifecycle.
 */
export class ThreadAgentDurableObject extends Think<Cloudflare.Env> {
  /**
   * Run-settlement fan-out (ADR 0017). Injected by the worker host (production) or the
   * test binder; a terminal run still transitions its ts_run row without it — settlement
   * is the only thing lost, and the wake-path reconciliation sweep can replay it.
   */
  completionFlow: RunCompletionFlow | null = null;
  private address: ThreadAgentAddress | null = null;
  /** Effective skills for the turn in flight (ADR 0005/0029), reloaded per turn in `run`. */
  private effectiveSkills: readonly SkillContent[] = [];
  private clock: () => Date = defaultClock;
  private mintCommentId: () => Comment["id"] = defaultCommentId;
  private mintRunId: () => QueuedRun["id"] = defaultRunId;
  private subAgentActivityByRunId: Readonly<
    Record<string, readonly SubAgentActivity[]>
  > = {};
  private testModel: LanguageModel | null = null;
  /**
   * ADR 0040: the KeyStore-resolved provider auth for the turn in flight, resolved async in `run`
   * (decrypt + narrow seam read) and read synchronously by `getModel`. A plain instance field —
   * it never touches ctx.storage, so no plaintext survives hibernation (the redaction invariant).
   */
  private pendingProviderAuth: ResolvedProviderAuth | null = null;

  constructor(ctx: AgentContext, env: Cloudflare.Env) {
    super(ctx, env);
    this.ensureSeamTables();
    // ADR 0037: MCP tools reach the turn by connection reconciliation, not getTools(). Waiting
    // for reconciled connections (SDK default 10s) keeps a first turn from racing setup so the
    // model sees the resolved MCP tools rather than an empty set on a cold connect.
    this.waitForMcpConnections = true;
  }

  /**
   * E2.1 wake-path reconciliation (ADR 0017/0035 §2). partyserver runs `onStart` on every
   * Durable Object start — including a fresh isolate after hibernation — so it is where the
   * settlement sweep hooks in. After the base start work we replay any settlement lost on a
   * prior wake: a terminal run's fan-out is fail-soft inside `onSubmissionStatus`, so the
   * only durable trace of a dropped settlement is the missing `ts_run_settled` mark.
   */
  override async onStart(props?: Record<string, unknown>): Promise<void> {
    await super.onStart(props);
    await this.reconcileUnsettledRuns();
  }

  /**
   * Scan `ts_run` for terminal-but-unsettled runs and replay each through `settle`. A
   * completed run is settled only after its fan-out succeeds (its id in `ts_run_settled`),
   * so an already-settled run carries a mark and never appears here — the fan-out is
   * idempotent. Best-effort: a wake must not be terminalized by a replay hiccup.
   */
  private async reconcileUnsettledRuns(): Promise<void> {
    if (this.deriveAddress() === null) {
      return;
    }
    try {
      const settlements = this.readTerminalUnsettledRuns()
        .map((run) => this.settlementFor(run))
        .filter(
          (settlement): settlement is RunSettlement => settlement !== null
        );
      // Independent, idempotent fan-outs; replay them together rather than serially.
      await Promise.all(
        settlements.map((settlement) => this.settle(settlement))
      );
    } catch (error) {
      console.error("[ThreadAgent] wake reconciliation sweep failed", error);
    }
  }

  /** The activity projection copied onto the D1 index row with every receipt (ADR 0041). */
  private currentSummary(): ThreadActivitySummary {
    return summarizeThreadActivity({
      comments: [...this.loadComments().values()],
      runs: this.readRuns(),
    });
  }

  /** Unread recipients on bump — creator plus everyone who commented or dispatched (ADR 0027). */
  private currentParticipants(): readonly MemberId[] {
    return collectThreadParticipants({
      comments: [...this.loadComments().values()],
      runs: this.readRuns(),
    });
  }

  /** Reconstruct a settlement from resident state (ADR 0035 §2: no member acts at wake). */
  private settlementFor(run: Run): RunSettlement | null {
    if (run.lifecycle === "failed") {
      return {
        kind: "failed",
        run,
        summary: this.currentSummary(),
      };
    }
    if (run.lifecycle !== "complete") {
      return null;
    }
    const outputComment = this.readComment(run.outputCommentId);
    if (outputComment === null) {
      return null;
    }
    return {
      kind: "complete",
      outputComment,
      participants: this.currentParticipants(),
      run,
      summary: this.currentSummary(),
    };
  }

  override getModel(): LanguageModel {
    if (this.testModel !== null) {
      return this.testModel;
    }

    const address = this.deriveAddress();
    const snapshot = this.readSnapshot();
    if (address === null || snapshot === null) {
      throw new Error(
        "ThreadAgentDurableObject.getModel: thread agent is not initialized"
      );
    }

    return createGatewayModel(snapshot.structure.modelId, {
      env: this.env as CompletionFlowEnv,
      // ADR 0040: the turn's resolved provider auth (envelope → decrypted header; legacy →
      // alias). Null on a path that skipped `run`'s pre-resolution — the factory then derives the
      // legacy alias, preserving today's behavior.
      providerAuth: this.pendingProviderAuth ?? undefined,
      workspaceId: address.workspaceId,
    });
  }

  /**
   * Config-as-data (ADR 0007): behavior reads the resident shape snapshot every turn. The
   * shape's selected skills (ADR 0005/0029) are appended as live markdown — preloaded by
   * `run` into `effectiveSkills` because prompt assembly stays synchronous (SDK signature pin).
   */
  override getSystemPrompt(): string {
    const base = this.readSnapshot()?.structure.systemPrompt ?? "";
    return renderSystemPromptWithSkills(base, this.effectiveSkills);
  }

  /**
   * ADR 0037 decision 2: v1's first-party catalog is empty by design (baked decision 7) — all
   * tools are MCP-provided, delivered by connection reconciliation in `run` (the SDK merges an
   * connected server's tools into the turn's set) rather than returned here. So `{}` is the
   * deliberate first-party-catalog mapping, not a stub; a first-party tool later returns from here.
   */
  // eslint-disable-next-line class-methods-use-this -- deliberate empty first-party catalog (ADR 0037)
  override getTools(): ToolSet {
    return {};
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
    const tables = [
      this
        .sql`CREATE TABLE IF NOT EXISTS ts_comment (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
      this
        .sql`CREATE TABLE IF NOT EXISTS ts_run (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, data TEXT NOT NULL)`,
      // Durable settlement state (ADR 0017/0035): a run's id lands here only after its
      // completion-flow fan-out succeeds, so a terminal ts_run row with no sibling here is
      // exactly the "terminal-but-unsettled" set the wake-path sweep replays. A separate
      // table keeps live DOs' existing ts_run rows untouched (CREATE TABLE IF NOT EXISTS).
      this.sql`CREATE TABLE IF NOT EXISTS ts_run_settled (id TEXT PRIMARY KEY)`,
      this
        .sql`CREATE TABLE IF NOT EXISTS ts_schedule (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
      this
        .sql`CREATE TABLE IF NOT EXISTS ts_snapshot (slot INTEGER PRIMARY KEY CHECK (slot = 1), data TEXT NOT NULL)`,
    ];
    this.ensureRunGestureColumn();
    return tables;
  }

  /**
   * Dispatch dedupe (E5.3 / baked decision 8): `ts_run` gains a `gesture_id` column and a
   * UNIQUE index so a replayed dispatch converges on the existing run instead of minting a
   * second. Long-lived DOs predate the column, so the evolution is additive — SQLite forbids
   * ADD COLUMN ... UNIQUE, so the constraint rides a separate unique index (multiple NULLs
   * allowed, which is exactly right: scheduled runs carry no gesture). No D1-side dedupe table.
   */
  private ensureRunGestureColumn(): void {
    const columns = this.sql<{ name: string }>`PRAGMA table_info(ts_run)`;
    if (!columns.some((column) => column.name === "gesture_id")) {
      this.sql`ALTER TABLE ts_run ADD COLUMN gesture_id TEXT`;
    }
    this
      .sql`CREATE UNIQUE INDEX IF NOT EXISTS ts_run_gesture_id ON ts_run (gesture_id)`;
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
    if (seed.testModel !== undefined) {
      this.testModel = seed.testModel as LanguageModel;
    }

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
  }): AsyncResult<CommentAppend, ThreadAgentError> {
    const address = this.deriveAddress();
    if (address === null) {
      return err(this.unaddressable());
    }

    if (!isCommentInAddress(address, input.comment)) {
      return err(tenantOrThreadViolation(address, input.comment.workspaceId));
    }

    const { parent } = input.comment;
    if (
      parent.kind === "nested" &&
      this.readComment(parent.parentCommentId) === null
    ) {
      return err({
        kind: "comment_parent_not_in_thread",
        parentCommentId: parent.parentCommentId,
        threadId: address.threadId,
        workspaceId: address.workspaceId,
      });
    }

    // First-write-wins on the edge-minted commentId (mirrors initialize): a replayed append
    // returns the ORIGINAL comment, so the flow's bump/unread/hub fan-out re-runs with the
    // original timestamps instead of re-bumping the thread to the retry instant.
    const existing = this.readComment(input.comment.id);
    if (existing === null) {
      this.putComment(input.comment);
    }
    return ok({
      comment: existing ?? input.comment,
      participants: this.currentParticipants(),
      summary: this.currentSummary(),
    });
  }

  async getRun(input: {
    readonly runId: Run["id"];
  }): AsyncResult<RunDetail | null, ThreadAgentError> {
    if (this.deriveAddress() === null) {
      return err(this.unaddressable());
    }

    const run = this.readRun(input.runId);
    if (run === null) {
      return ok(null);
    }

    return ok({
      run,
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

    // First-write-wins (ADR 0034): the DO is the authority on its own initialization.
    const resident = this.readSnapshot();
    if (resident !== null) {
      return ok({
        shapeSnapshot: resident,
        threadId: address.threadId,
      });
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

    return ok(this.readRuns());
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

    // Dispatch dedupe (E5.3): a replay carrying a gestureId already on a run converges on
    // that run's receipt and neither mints a second run nor re-submits the turn — like the
    // PUT creation gesture. The DO is single-threaded, so this check-then-insert is atomic.
    const gestureId = dispatchGestureId(input);
    if (gestureId !== null) {
      const existing = this.readRunByGestureId(gestureId);
      if (existing !== null) {
        return ok({
          queuedRun: queuedReceiptRun(existing),
          runId: existing.id,
          summary: this.currentSummary(),
          threadId: address.threadId,
        });
      }
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

    // Reload the shape's selected skills before the turn assembles its prompt (ADR 0005/0029):
    // the selection is frozen structure, the markdown is live content.
    await this.loadEffectiveSkills(address);

    // Resolve the effective toolset per turn (ADR 0037): reconcile MCP connections against the
    // fresh layer-2 registry/allowlist before submitting, so dispatched AND scheduled runs pick
    // up added/revoked servers. A resolution or egress failure fails the run closed.
    const reconciled = await this.reconcileEffectiveToolset(queuedRun, address);
    if (!reconciled.ok) {
      return reconciled;
    }

    // ADR 0040: resolve the provider auth (envelope decrypt or legacy alias) BEFORE the turn's
    // synchronous getModel fires, and fail the run closed on a decrypt/registry fault — the same
    // fail-fast posture as the edge byok gate, now provider-key-material-aware at the DO.
    const resolvedAuth = await this.resolvePendingProviderAuth(queuedRun);
    if (!resolvedAuth.ok) {
      return resolvedAuth;
    }

    const submitted = await this.submitRunTurn(queuedRun);
    if (!submitted.ok) {
      return submitted;
    }

    return ok({
      queuedRun,
      runId,
      summary: this.currentSummary(),
      threadId: address.threadId,
    });
  }

  /**
   * Loads live markdown for the resident snapshot's frozen skill selection (ADR 0007). Runs
   * under the address's workspace scope — the loader filters on `workspace_id`, so a selection
   * naming a foreign skill renders nothing. Fail-soft: a load hiccup leaves the base prompt.
   */
  private async loadEffectiveSkills(
    address: ThreadAgentAddress
  ): Promise<void> {
    const snapshot = this.readSnapshot();
    const skillIds = snapshot?.structure.skillSelection ?? [];
    const env = this.env as unknown as Partial<SkillTurnEnv>;
    if (
      skillIds.length === 0 ||
      env.DB === undefined ||
      env.SKILLS === undefined
    ) {
      this.effectiveSkills = [];
      return;
    }
    try {
      this.effectiveSkills = await loadSelectedSkillContents({
        bucket: env.SKILLS,
        db: env.DB,
        skillIds,
        workspaceId: address.workspaceId,
      });
    } catch (error) {
      console.error("[ThreadAgent] skill load failed", error);
      this.effectiveSkills = [];
    }
  }

  /**
   * ADR 0037 decisions 1-3: resolve the effective toolset for the turn under the address-derived
   * SystemContext (the completion-flow trust boundary — enforcement never rides a trigger
   * payload), then reconcile MCP connections against the SDK's live set: connect newly resolved
   * servers (each re-authorized through McpEgressPolicy immediately before connect, so an
   * unapproved host fails closed at the worker edge), disconnect servers no longer resolved. A
   * resolution or egress error terminalizes the queued run as failed rather than running toolless.
   */
  private async reconcileEffectiveToolset(
    run: QueuedRun,
    address: ThreadAgentAddress
  ): AsyncResult<undefined, ThreadAgentError> {
    const snapshot = this.readSnapshot();
    if (snapshot === null) {
      return ok();
    }

    const context: SystemContext = {
      kind: "system",
      workspaceId: address.workspaceId,
    };
    const dataAccess = createD1TenantDataAccess({
      context,
      db: (this.env as CompletionFlowEnv).DB,
    });
    const resolver = createCatalogWorkspaceShapeToolResolver({
      context,
      dataAccess,
    });

    const resolved = await resolver.resolve(
      toolResolutionRequestFor(snapshot.structure)
    );
    if (!resolved.ok) {
      return err(this.failClosed(run, resolutionFailureReason(resolved.error)));
    }

    const desiredByConnectionId = new Map<string, McpServer>(
      resolved.value.mcpServers.map((server) => [
        mcpConnectionId(server.id),
        server,
      ])
    );

    const live = this.getMcpServers().servers;
    // Drop connections no longer resolved (a revoked server, or a selection the shape dropped).
    for (const connectionId of Object.keys(live)) {
      if (!desiredByConnectionId.has(connectionId)) {
        await this.removeMcpServer(connectionId);
      }
    }
    // Connect newly resolved servers under their stable id — the id is the cf_agents_mcp_servers
    // primary key, so the diff stays deterministic across hibernation restores. Egress is
    // re-authorized immediately before each NEW connect (ADR 0037 decision 2); already-live
    // connections were authorized at their own connect time and resolution above just
    // re-proved their hosts against the same allowlist read, so re-checking them per turn
    // would only duplicate that I/O.
    const egressPolicy = createWorkerMcpEgressPolicy({ context, dataAccess });
    for (const [connectionId, server] of desiredByConnectionId) {
      if (!Object.hasOwn(live, connectionId)) {
        const authorized = await egressPolicy.authorize({
          host: server.host,
          mcpServerId: server.id,
        });
        if (!authorized.ok) {
          return err(
            this.failClosed(run, resolutionFailureReason(authorized.error))
          );
        }
        await this.addMcpServer(server.name, server.url, { id: connectionId });
      }
    }

    return ok();
  }

  /**
   * ADR 0040: resolve the turn's provider auth through the KeyStore and stash it transiently for
   * `getModel`. `env.BYOK_MASTER_KEY` bound → the envelope adapter reads ciphertext via the
   * tenant-data-access seam (never a raw SELECT) and decrypts; unbound → the legacy adapter yields
   * the `cf-aig-byok-alias` with no I/O. A resolve fault (revoked key, undecryptable ciphertext)
   * terminalizes the queued run as failed rather than running it toward a gateway rejection.
   */
  private async resolvePendingProviderAuth(
    run: QueuedRun
  ): AsyncResult<undefined, ThreadAgentError> {
    const snapshot = this.readSnapshot();
    if (snapshot === null) {
      this.pendingProviderAuth = null;
      return ok();
    }
    const context: SystemContext = {
      kind: "system",
      workspaceId: run.workspaceId,
    };
    const keyStore = createKeyStore({
      context,
      env: this.env as unknown as KeyStoreEnv,
    });
    const resolved = await keyStore.resolveProviderAuth({
      modelId: snapshot.structure.modelId,
    });
    if (!resolved.ok) {
      this.pendingProviderAuth = null;
      return err(
        this.failClosed(
          run,
          failureReasonSchema.parse(`provider key ${resolved.error.kind}`)
        )
      );
    }
    this.pendingProviderAuth = resolved.value;
    return ok();
  }

  /** Terminalize a queued run as failed (ADR 0037 decision 3) and yield the run_failure error. */
  private failClosed(
    run: QueuedRun,
    failureReason: FailureReason
  ): RunFailureError {
    this.putRun({
      ...run,
      failure: { failedAt: this.clock(), failureReason, from: "queued" },
      lifecycle: "failed",
    });
    return { failureReason, kind: "run_failure", runId: run.id };
  }

  /**
   * Seam ThreadAgent.removeMcpServer — renamed because the agents SDK reserves
   * `removeMcpServer(id)` for its own connection API (which this drives, like `scheduleRun` vs
   * `schedule`). Revoke fan-out (ADR 0037 decision 4): severs the named server's live connection
   * if present so a revoked host is dropped at revoke time; a no-op success otherwise.
   */
  async dropMcpServer(input: {
    readonly mcpServerId: McpServerId;
  }): AsyncResult<void, ThreadAgentError> {
    if (this.deriveAddress() === null) {
      return err(this.unaddressable());
    }
    const connectionId = mcpConnectionId(input.mcpServerId);
    if (Object.hasOwn(this.getMcpServers().servers, connectionId)) {
      await this.removeMcpServer(connectionId);
    }
    return ok();
  }

  /**
   * ADR 0033 §3: the domain run row is the source of truth; the Think submission is the
   * mechanism, referenced by the shared id. `idempotencyKey = runId` covers internal
   * retries only — duplicate-dispatch suppression is the HTTP edge's concern.
   */
  private async submitRunTurn(
    run: QueuedRun
  ): AsyncResult<undefined, ThreadAgentError> {
    try {
      await this.submitMessages(this.turnMessagesFor(run), {
        idempotencyKey: idKey(run.id),
        submissionId: idKey(run.id),
      });
      return ok();
    } catch (error) {
      const failureReason = failureReasonSchema.parse(
        error instanceof Error && error.message.length > 0
          ? error.message
          : "submission was rejected"
      );
      this.putRun({
        ...run,
        failure: { failedAt: this.clock(), failureReason, from: "queued" },
        lifecycle: "failed",
      });
      return err({ failureReason, kind: "run_failure", runId: run.id });
    }
  }

  /** Dispatch turns get the ADR 0025 context window; scheduled turns get the schedule's prompt. */
  private turnMessagesFor(run: QueuedRun): UIMessage[] {
    if (run.trigger.kind === "dispatch") {
      const comments = this.loadComments();
      const target = run.trigger.dispatch.targetCommentId;
      return [
        ...ancestorComments(comments, target),
        ...branchComments(comments, target),
      ].map(commentToUiMessage);
    }

    const rows = this.sql<{ data: string }>`
      SELECT data FROM ts_schedule WHERE id = ${idKey(run.trigger.scheduleId)}
    `;
    const [row] = rows;
    const prompt =
      row === undefined
        ? "Execute the scheduled run."
        : parseJsonColumn<Schedule>(row.data).prompt;
    return [
      {
        id: idKey(run.id),
        parts: [{ text: prompt, type: "text" }],
        role: "user",
      },
    ];
  }

  /**
   * ADR 0033 §3: terminal submission status maps onto the run lifecycle. Idempotent by
   * construction — an emit for an already-terminal run is a no-op, so Think's wake-path
   * recovery re-emits (stranded `running` submissions swept to error/pending on start)
   * cannot double-settle.
   */
  protected override async onSubmissionStatus(
    inspection: ThinkSubmissionInspection
  ): Promise<void> {
    const parsed = runIdSchema.safeParse(inspection.submissionId);
    if (!parsed.success) {
      return;
    }
    const run = this.readRun(parsed.data);
    if (
      run === null ||
      run.lifecycle === "complete" ||
      run.lifecycle === "failed"
    ) {
      return;
    }

    if (inspection.status === "running") {
      if (run.lifecycle === "queued") {
        const runningRun: RunningRun = {
          ...runBase(run),
          lifecycle: "running",
          startedAt: this.at(inspection.startedAt),
        };
        this.putRun(runningRun);
      }
      return;
    }

    if (!TERMINAL_SUBMISSION_STATUSES.has(inspection.status)) {
      return;
    }

    const startedAt =
      run.lifecycle === "running"
        ? run.startedAt
        : this.at(inspection.startedAt);

    if (inspection.status !== "completed") {
      await this.settleFailed(run, {
        failedAt: this.at(inspection.completedAt),
        failureReason: failureReasonSchema.parse(
          inspection.error ?? `submission ${inspection.status}`
        ),
        from: "running",
        startedAt,
      });
      return;
    }

    const text = this.lastAssistantText();
    if (text === null) {
      await this.settleFailed(run, {
        failedAt: this.at(inspection.completedAt),
        failureReason: failureReasonSchema.parse(
          "model turn produced no output text"
        ),
        from: "running",
        startedAt,
      });
      return;
    }

    /** A scheduled fire appends a new top-level comment; a dispatch replies at its target (ADR 0017). */
    const outputComment: Comment = {
      author: {
        channelId: run.channelId,
        facet: { kind: "channel_agent" },
        kind: "agent",
      },
      body: commentBodySchema.parse(text),
      createdAt: this.at(inspection.completedAt),
      id: this.mintCommentId(),
      parent:
        run.trigger.kind === "dispatch"
          ? {
              kind: "nested",
              parentCommentId: run.trigger.dispatch.targetCommentId,
            }
          : { kind: "top_level" },
      threadId: run.threadId,
      workspaceId: run.workspaceId,
    };
    this.putComment(outputComment);

    const completeRun: CompleteRun = {
      ...runBase(run),
      completedAt: this.at(inspection.completedAt),
      lifecycle: "complete",
      outputCommentId: outputComment.id,
      startedAt,
    };
    this.putRun(completeRun);

    await this.settle({
      kind: "complete",
      outputComment,
      participants: this.currentParticipants(),
      run: completeRun,
      summary: this.currentSummary(),
    });
  }

  private async settleFailed(
    run: QueuedRun | RunningRun,
    failure: RunFailure
  ): Promise<void> {
    const failedRun: FailedRun = {
      ...runBase(run),
      failure,
      lifecycle: "failed",
    };
    this.putRun(failedRun);
    await this.settle({
      kind: "failed",
      run: failedRun,
      summary: this.currentSummary(),
    });
  }

  /** Settlement fan-out is best-effort from inside the hook; the ts_run row already turned. */
  private async settle(settlement: RunSettlement): Promise<void> {
    const address = this.deriveAddress();
    if (address !== null) {
      /**
       * ADR 0035 §2: a field does not survive hibernation — a fresh wake self-constructs
       * the flow from env + address. An injected override (test binders) wins; the ??=
       * never fires for them. The alchemy worker env carries these bindings by
       * construction; Cloudflare.Env is untyped inside this package.
       */
      this.completionFlow ??= buildCompletionFlow(
        this.env as CompletionFlowEnv,
        address
      );
    }

    if (this.completionFlow === null) {
      console.error(
        "[ThreadAgent] run settled without a completion flow injected",
        { runId: idKey(settlement.run.id) }
      );
      return;
    }
    const settled = await this.completionFlow.settle(settlement);
    if (!settled.ok) {
      console.error("[ThreadAgent] run completion flow failed", settled.error);
      return;
    }
    // Fan-out succeeded: mark the run settled so the wake-path sweep leaves it alone.
    this.markRunSettled(settlement.run.id);
  }

  private at(epochMs: number | undefined): Date {
    return epochMs === undefined ? this.clock() : new Date(epochMs);
  }

  private lastAssistantText(): string | null {
    for (const message of this.messages.toReversed()) {
      if (message.role !== "assistant") {
        continue;
      }
      const text = message.parts
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("");
      if (text.length > 0) {
        return text;
      }
    }
    return null;
  }

  private readRun(id: Run["id"]): Run | null {
    const rows = this.sql<{ data: string }>`
      SELECT data FROM ts_run WHERE id = ${idKey(id)}
    `;
    const [row] = rows;
    return row === undefined ? null : parseJsonColumn<Run>(row.data);
  }

  private readRuns(): readonly Run[] {
    const rows = this.sql<{ data: string }>`
      SELECT data FROM ts_run ORDER BY seq ASC
    `;
    return rows.map((row) => parseJsonColumn<Run>(row.data));
  }

  /** Terminal runs with no `ts_run_settled` mark — the wake-path sweep's replay set. */
  private readTerminalUnsettledRuns(): readonly Run[] {
    const rows = this.sql<{ data: string }>`
      SELECT r.data AS data FROM ts_run r
      WHERE NOT EXISTS (SELECT 1 FROM ts_run_settled s WHERE s.id = r.id)
      ORDER BY r.seq ASC
    `;
    return rows
      .map((row) => parseJsonColumn<Run>(row.data))
      .filter(
        (run) => run.lifecycle === "complete" || run.lifecycle === "failed"
      );
  }

  private markRunSettled(id: Run["id"]): readonly unknown[] {
    return this.sql`
      INSERT INTO ts_run_settled (id) VALUES (${idKey(id)})
      ON CONFLICT (id) DO NOTHING
    `;
  }

  private readComment(id: Comment["id"]): Comment | null {
    const rows = this.sql<{ data: string }>`
      SELECT data FROM ts_comment WHERE id = ${idKey(id)}
    `;
    const [row] = rows;
    return row === undefined ? null : parseJsonColumn<Comment>(row.data);
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
    // gesture_id is derived from the trigger (dispatch only) and never changes across a
    // run's lifecycle, so the ON CONFLICT lifecycle bump leaves it untouched (E5.3).
    const gestureId = dispatchGestureId(run.trigger);
    return this.sql`
      INSERT INTO ts_run (id, seq, data, gesture_id)
      VALUES (
        ${idKey(run.id)},
        COALESCE((SELECT MAX(seq) FROM ts_run), 0) + 1,
        ${JSON.stringify(run)},
        ${gestureId === null ? null : idKey(gestureId)}
      )
      ON CONFLICT (id) DO UPDATE SET data = excluded.data
    `;
  }

  /** The dedupe read (E5.3): the run a replayed dispatch's gestureId already names, if any. */
  private readRunByGestureId(gestureId: GestureId): Run | null {
    const rows = this.sql<{ data: string }>`
      SELECT data FROM ts_run WHERE gesture_id = ${idKey(gestureId)}
    `;
    const [row] = rows;
    return row === undefined ? null : parseJsonColumn<Run>(row.data);
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
 * wrapper; seam `schedule`/`removeMcpServer` map to `scheduleRun`/`dropMcpServer` because the
 * agents SDK base class reserves those names for its alarm and MCP-connection APIs.
 */
type SeamMethods = Omit<
  ThreadAgent,
  "address" | "removeMcpServer" | "schedule"
> & {
  readonly dropMcpServer: ThreadAgent["removeMcpServer"];
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
      appendComment: async (input) => {
        const agent = await stub();
        return agent.appendComment(input);
      },
      getRun: async (input) => {
        const agent = await stub();
        return agent.getRun(input);
      },
      initialize: async (input) => {
        const agent = await stub();
        return agent.initialize(input);
      },
      listRuns: async () => {
        const agent = await stub();
        return agent.listRuns();
      },
      loadBranch: async (input) => {
        const agent = await stub();
        return agent.loadBranch(input);
      },
      removeMcpServer: async (input) => {
        const agent = await stub();
        return agent.dropMcpServer(input);
      },
      resnapshot: async (input) => {
        const agent = await stub();
        return agent.resnapshot(input);
      },
      run: async (input) => {
        const agent = await stub();
        return agent.run(input);
      },
      schedule: async (input) => {
        const agent = await stub();
        return agent.scheduleRun(input);
      },
    };
  },
});
