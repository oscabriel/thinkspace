import type { QueuedRun, Run, SubAgentActivity } from "../../run";
import type { ThreadAgent, ThreadAgentAddress } from "../../seams/thread-agent";
import type { ShapeSnapshot } from "../../shape";
import type { Comment } from "../../thread";
import type { ContractTestApi } from "../contract-api";
import {
  makeComment,
  makeDispatchTrigger,
  makeQueuedRun,
  makeRunningSubAgentActivity,
  makeShapeSnapshot,
  makeShapeStructure,
  otherWorkspaceId,
  runId,
  threadAgentAddress,
  unwrapErr,
  unwrapOk,
} from "../fixtures";

/**
 * Domain-termed initial state a ThreadAgent adapter must be constructible from. The
 * deterministic knobs (clock, nextRunId) are test capabilities the factory must honor —
 * a production harness injects them into the Durable Object the same way the memory
 * adapter takes them as config.
 */
export interface ThreadAgentSeed {
  readonly address: ThreadAgentAddress;
  readonly clock?: () => Date;
  readonly comments?: readonly Comment[];
  readonly nextRunId?: () => QueuedRun["id"];
  readonly runs?: readonly Run[];
  readonly shapeSnapshot?: ShapeSnapshot;
  readonly subAgentActivityByRunId?: Readonly<
    Record<string, readonly SubAgentActivity[]>
  >;
  readonly testModel?: unknown;
}

export type ThreadAgentFactory = (
  seed: ThreadAgentSeed
) => Promise<ThreadAgent> | ThreadAgent;

/** Pins the ThreadAgent seam semantics on whichever adapter the factory builds. */
export const defineThreadAgentContract = (input: {
  readonly api: ContractTestApi;
  readonly makeThreadAgent: ThreadAgentFactory;
}): void => {
  const { describe, expect, test } = input.api;
  const { makeThreadAgent } = input;

  describe("ThreadAgent.loadBranch — dispatch context window (ADR 0025)", () => {
    test("returns the ancestor path (oldest first) plus the subtree rooted at the dispatch comment, excluding ancestor-siblings and other top-level branches", async () => {
      const topLevel = makeComment({ id: "comment-top" });
      const discussion = makeComment({
        id: "comment-discussion",
        parentCommentId: "comment-top",
      });
      const dispatchRoot = makeComment({
        id: "comment-dispatch-root",
        parentCommentId: "comment-discussion",
      });
      const reply = makeComment({
        id: "comment-reply",
        parentCommentId: "comment-dispatch-root",
      });
      const deepReply = makeComment({
        id: "comment-deep-reply",
        parentCommentId: "comment-reply",
      });
      const ancestorSibling = makeComment({
        id: "comment-ancestor-sibling",
        parentCommentId: "comment-discussion",
      });
      const otherTopLevel = makeComment({ id: "comment-other-top" });

      const agent = await makeThreadAgent({
        address: threadAgentAddress,
        comments: [
          topLevel,
          discussion,
          dispatchRoot,
          reply,
          deepReply,
          ancestorSibling,
          otherTopLevel,
        ],
      });

      const snapshot = unwrapOk(
        await agent.loadBranch({ rootCommentId: dispatchRoot.id })
      );

      expect(snapshot.ancestors.map((comment) => comment.id)).toEqual([
        topLevel.id,
        discussion.id,
      ]);
      expect(snapshot.subtree[0]?.id).toBe(dispatchRoot.id);
      expect(new Set(snapshot.subtree.map((comment) => comment.id))).toEqual(
        new Set([dispatchRoot.id, reply.id, deepReply.id])
      );
      expect(snapshot.branch).toEqual({
        rootCommentId: dispatchRoot.id,
        threadId: threadAgentAddress.threadId,
      });
    });

    test("a dispatch at a top-level comment has an empty ancestor path", async () => {
      const topLevel = makeComment({ id: "comment-top" });
      const reply = makeComment({
        id: "comment-reply",
        parentCommentId: "comment-top",
      });

      const agent = await makeThreadAgent({
        address: threadAgentAddress,
        comments: [topLevel, reply],
      });

      const snapshot = unwrapOk(
        await agent.loadBranch({ rootCommentId: topLevel.id })
      );

      expect(snapshot.ancestors).toEqual([]);
      expect(new Set(snapshot.subtree.map((comment) => comment.id))).toEqual(
        new Set([topLevel.id, reply.id])
      );
    });
  });

  describe("ThreadAgent run reads — DO-resident run state (ADR 0028)", () => {
    test("a dispatch mints a queued run readable back via getRun and listRuns", async () => {
      const agent = await makeThreadAgent({
        address: threadAgentAddress,
        clock: () => new Date("2026-07-01T10:00:00Z"),
        nextRunId: () => runId("run-1"),
        shapeSnapshot: makeShapeSnapshot(),
      });

      const trigger = makeDispatchTrigger({ targetCommentId: "comment-top" });
      const receipt = unwrapOk(await agent.run(trigger));

      expect(receipt.runId).toBe(runId("run-1"));
      expect(receipt.queuedRun.lifecycle).toBe("queued");
      expect(receipt.queuedRun.trigger).toEqual(trigger);

      // Lifecycle progression past "queued" is adapter-specific (a self-constructing
      // production adapter may already be executing the turn by the time this reads
      // back); the seam-generic pin is that the same run is retrievable by id/trigger.
      const detail = unwrapOk(await agent.getRun({ runId: receipt.runId }));
      expect(detail?.run.id).toEqual(receipt.queuedRun.id);
      expect(detail?.run.trigger).toEqual(receipt.queuedRun.trigger);

      const runs = unwrapOk(await agent.listRuns());
      expect(runs.map((run) => run.id)).toEqual([receipt.queuedRun.id]);
    });

    test("a replayed dispatch (same gestureId) converges on the existing run's receipt and mints no second run (E5.3)", async () => {
      const agent = await makeThreadAgent({
        address: threadAgentAddress,
        clock: () => new Date("2026-07-01T10:00:00Z"),
        nextRunId: () => runId("run-dedupe"),
        shapeSnapshot: makeShapeSnapshot(),
      });

      const trigger = makeDispatchTrigger({
        gestureId: "gesture-dedupe",
        targetCommentId: "comment-top",
      });
      const first = unwrapOk(await agent.run(trigger));
      const replay = unwrapOk(await agent.run(trigger));

      // The replay carries the same run, deterministically reported as queued.
      expect(replay.runId).toEqual(first.runId);
      expect(replay.queuedRun).toEqual(first.queuedRun);

      // Exactly one run exists — the replay converged instead of starting a second.
      const runs = unwrapOk(await agent.listRuns());
      expect(runs.map((run) => run.id)).toEqual([first.runId]);
    });

    test("distinct gestureIds mint distinct runs — dedupe keys on the gesture, not the address (E5.3)", async () => {
      let minted = 0;
      const agent = await makeThreadAgent({
        address: threadAgentAddress,
        nextRunId: () => runId(`run-distinct-${minted++}`),
        shapeSnapshot: makeShapeSnapshot(),
      });

      const first = unwrapOk(
        await agent.run(
          makeDispatchTrigger({
            gestureId: "gesture-a",
            targetCommentId: "comment-top",
          })
        )
      );
      const second = unwrapOk(
        await agent.run(
          makeDispatchTrigger({
            gestureId: "gesture-b",
            targetCommentId: "comment-top",
          })
        )
      );

      expect(first.runId === second.runId).toBe(false);
      const runs = unwrapOk(await agent.listRuns());
      expect(runs.map((run) => run.id)).toEqual([first.runId, second.runId]);
    });

    test("run on a never-initialized agent fails closed with thread_agent_uninitialized", async () => {
      const agent = await makeThreadAgent({ address: threadAgentAddress });

      const error = unwrapErr(
        await agent.run(makeDispatchTrigger({ targetCommentId: "comment-top" }))
      );

      expect(error).toEqual({
        channelId: threadAgentAddress.channelId,
        kind: "thread_agent_uninitialized",
        threadId: threadAgentAddress.threadId,
        workspaceId: threadAgentAddress.workspaceId,
      });
      expect(unwrapOk(await agent.listRuns())).toEqual([]);
    });

    test("getRun returns null for an unknown run id instead of failing", async () => {
      const agent = await makeThreadAgent({ address: threadAgentAddress });

      const detail = unwrapOk(await agent.getRun({ runId: runId("run-404") }));

      expect(detail).toBeNull();
    });

    test("getRun nests the parent run's sub-agent activity in the RunDetail", async () => {
      const parentRun = makeQueuedRun({ id: "run-parent" });
      const activity = makeRunningSubAgentActivity({
        name: "researcher",
        runId: "run-parent",
      });

      const agent = await makeThreadAgent({
        address: threadAgentAddress,
        runs: [parentRun],
        subAgentActivityByRunId: { "run-parent": [activity] },
      });

      const detail = unwrapOk(await agent.getRun({ runId: parentRun.id }));

      expect(detail?.run).toEqual(parentRun);
      expect(detail?.subAgentActivity).toEqual([activity]);
    });
  });

  describe("ThreadAgent shape snapshot — config as data (ADR 0007/0015)", () => {
    test("initialize stores the shape snapshot and opening comment, returning the snapshot as data", async () => {
      const snapshot = makeShapeSnapshot({ shapeId: "shape-1" });
      const openingComment = makeComment({ id: "comment-opening" });
      const agent = await makeThreadAgent({ address: threadAgentAddress });

      const result = unwrapOk(
        await agent.initialize({ openingComment, shapeSnapshot: snapshot })
      );

      expect(result.shapeSnapshot).toEqual(snapshot);
      expect(result.threadId).toBe(threadAgentAddress.threadId);

      const branch = unwrapOk(
        await agent.loadBranch({ rootCommentId: openingComment.id })
      );
      expect(branch.subtree.map((comment) => comment.id)).toEqual([
        openingComment.id,
      ]);
    });

    test("initialize is first-write-wins: a replay leaves the resident snapshot and comment tree untouched (ADR 0034)", async () => {
      const original = makeShapeSnapshot({ shapeId: "shape-1" });
      const openingComment = makeComment({ id: "comment-opening" });
      const agent = await makeThreadAgent({ address: threadAgentAddress });
      unwrapOk(
        await agent.initialize({ openingComment, shapeSnapshot: original })
      );

      const replayed = unwrapOk(
        await agent.initialize({
          openingComment: makeComment({ id: "comment-replayed" }),
          shapeSnapshot: makeShapeSnapshot({
            shapeId: "shape-1",
            structure: makeShapeStructure({
              systemPrompt: "Edited since creation.",
            }),
          }),
        })
      );

      expect(replayed.shapeSnapshot).toEqual(original);

      const branch = unwrapOk(
        await agent.loadBranch({ rootCommentId: openingComment.id })
      );
      expect(branch.subtree).toEqual([openingComment]);
    });

    test("resnapshot swaps the resident snapshot on explicit shape update", async () => {
      const initial = makeShapeSnapshot({ shapeId: "shape-1" });
      const updated = makeShapeSnapshot({
        shapeId: "shape-1",
        structure: makeShapeStructure({ systemPrompt: "Updated prompt." }),
      });
      const agent = await makeThreadAgent({
        address: threadAgentAddress,
        shapeSnapshot: initial,
      });

      const result = unwrapOk(
        await agent.resnapshot({ shapeSnapshot: updated })
      );

      expect(result.shapeSnapshot).toEqual(updated);
      expect(result.shapeSnapshot.structure.systemPrompt).toBe(
        updated.structure.systemPrompt
      );
    });
  });

  describe("ThreadAgent tenant guard", () => {
    test("appendComment rejects a comment from another workspace with tenant_guard_violation", async () => {
      const foreignComment = makeComment({
        id: "comment-foreign",
        workspaceId: otherWorkspaceId,
      });
      const agent = await makeThreadAgent({ address: threadAgentAddress });

      const error = unwrapErr(
        await agent.appendComment({ comment: foreignComment })
      );

      expect(error).toEqual({
        expectedWorkspaceId: threadAgentAddress.workspaceId,
        kind: "tenant_guard_violation",
        observed: { kind: "workspace", workspaceId: otherWorkspaceId },
      });
    });
  });
};
