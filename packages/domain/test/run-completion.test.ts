import { describe, expect, test } from "bun:test";

import {
  createMemoryChannelHub,
  createMemoryTenantDataAccess,
  createMemoryThreadAgent,
  createMemoryWorkspaceHub,
} from "../src/adapters/memory";
import type { MemoryThreadAgentTurnOutcome } from "../src/adapters/memory";
import { createRunCompletionFlow } from "../src/flows/run-completion";
import { commentBodySchema, failureReasonSchema } from "../src/primitives";
import type {
  ChannelHubEvent,
  WorkspaceActivityEvent,
} from "../src/seams/realtime-hubs";
import {
  commentId,
  makeChannel,
  makeComment,
  makeDispatchTrigger,
  makeShapeSnapshot,
  makeThread,
  memberId,
  runId,
  testChannelId,
  testMemberId,
  testTenantContext,
  testThreadId,
  testWorkspace,
  testWorkspaceId,
  threadAgentAddress,
  unwrapOk,
} from "../src/testing/fixtures";
import type { Comment } from "../src/thread";

const commentBody = (value: string) => commentBodySchema.parse(value);
const failureReason = (value: string) => failureReasonSchema.parse(value);

const executionTime = new Date("2026-07-03T12:00:00Z");

/**
 * Composes the completion half of the dispatch story (ADR 0017): an initialized thread
 * agent with a scripted turn, wired to the run-completion flow over the memory adapters.
 * The test caller stands in for the production DO's self-driven execution tick.
 */
const makeCompletionHarness = (input?: {
  readonly comments?: readonly Comment[];
  readonly turnScript?: readonly MemoryThreadAgentTurnOutcome[];
}) => {
  const publishedChannelEvents: ChannelHubEvent[] = [];
  const publishedActivity: WorkspaceActivityEvent[] = [];

  const tenantDataAccess = createMemoryTenantDataAccess({
    channels: [makeChannel({ id: "channel-1" })],
    context: testTenantContext,
    threads: [makeThread({ channelId: "channel-1", id: "thread-1" })],
    workspace: testWorkspace,
  });

  const agent = createMemoryThreadAgent({
    address: threadAgentAddress,
    clock: () => executionTime,
    comments: [makeComment({ id: "comment-top" }), ...(input?.comments ?? [])],
    completionFlow: createRunCompletionFlow({
      channelHub: createMemoryChannelHub({
        address: { channelId: testChannelId },
        context: testTenantContext,
        onEvent: (event) => publishedChannelEvents.push(event),
      }),
      tenantDataAccess,
      workspaceHub: createMemoryWorkspaceHub({
        context: testTenantContext,
        onActivity: (event) => publishedActivity.push(event),
      }),
    }),
    nextCommentId: () => commentId("comment-run-output"),
    nextRunId: () => runId("run-1"),
    shapeSnapshot: makeShapeSnapshot(),
    turnScript: input?.turnScript ?? [
      { body: commentBody("agent reply"), kind: "reply" },
    ],
  });

  return { agent, publishedActivity, publishedChannelEvents, tenantDataAccess };
};

describe("Run completion — a dispatched run executes to completion (ADR 0017/0028)", () => {
  test("executing the queued run settles it complete and announces the lifecycle change", async () => {
    const harness = makeCompletionHarness();
    const receipt = unwrapOk(
      await harness.agent.run(
        makeDispatchTrigger({ targetCommentId: "comment-top" })
      )
    );

    const settled = unwrapOk(await harness.agent.executeNextRun());
    if (settled === null) {
      throw new Error("expected a queued run to execute");
    }

    expect(settled).toEqual({
      channelId: testChannelId,
      completedAt: executionTime,
      id: receipt.runId,
      lifecycle: "complete",
      outputCommentId: commentId("comment-run-output"),
      queuedAt: executionTime,
      startedAt: executionTime,
      threadId: testThreadId,
      trigger: receipt.queuedRun.trigger,
      workspaceId: testWorkspaceId,
    });

    const detail = unwrapOk(
      await harness.agent.getRun({ runId: receipt.runId })
    );
    expect(detail?.run).toEqual(settled);

    expect(harness.publishedChannelEvents).toContainEqual({
      kind: "run_lifecycle_changed",
      runId: receipt.runId,
      threadId: testThreadId,
    });
  });

  test("the completed run's output comment is the agent's reply nested at the dispatch target", async () => {
    const harness = makeCompletionHarness({
      turnScript: [
        { body: commentBody("exploration findings"), kind: "reply" },
      ],
    });
    unwrapOk(
      await harness.agent.run(
        makeDispatchTrigger({ targetCommentId: "comment-top" })
      )
    );

    unwrapOk(await harness.agent.executeNextRun());

    const branch = unwrapOk(
      await harness.agent.loadBranch({
        rootCommentId: commentId("comment-top"),
      })
    );
    expect(branch.subtree).toContainEqual({
      author: {
        channelId: testChannelId,
        facet: { kind: "channel_agent" },
        kind: "agent",
      },
      body: commentBody("exploration findings"),
      createdAt: executionTime,
      id: commentId("comment-run-output"),
      parent: { kind: "nested", parentCommentId: commentId("comment-top") },
      threadId: testThreadId,
      workspaceId: testWorkspaceId,
    });
  });
});

describe("Run completion — completion bumps the thread (ADR 0017/0027)", () => {
  test("the thread index row's lastActivityAt becomes the run's completion time", async () => {
    const harness = makeCompletionHarness();
    unwrapOk(
      await harness.agent.run(
        makeDispatchTrigger({ targetCommentId: "comment-top" })
      )
    );

    unwrapOk(await harness.agent.executeNextRun());

    const index = unwrapOk(
      await harness.tenantDataAccess.listChannelThreads({
        channelId: testChannelId,
      })
    );
    const bumped = index.threads.find((thread) => thread.id === testThreadId);
    expect(bumped?.lastActivityAt).toEqual(executionTime);
  });

  test("every thread participant gets an agent_output unread row, including the dispatcher awaiting the reply", async () => {
    const coParticipantComment: Comment = {
      ...makeComment({ id: "comment-reply", parentCommentId: "comment-top" }),
      author: { kind: "member", memberId: memberId("member-2") },
    };
    const harness = makeCompletionHarness({
      comments: [coParticipantComment],
    });
    unwrapOk(
      await harness.agent.run(
        makeDispatchTrigger({ targetCommentId: "comment-top" })
      )
    );

    unwrapOk(await harness.agent.executeNextRun());

    const expectedReasons = [
      {
        commentId: commentId("comment-run-output"),
        kind: "agent_output" as const,
        runId: runId("run-1"),
      },
    ];
    expect(
      unwrapOk(
        await harness.tenantDataAccess.listMemberUnread({
          memberId: testMemberId,
        })
      )
    ).toEqual([
      {
        bumpedAt: executionTime,
        memberId: testMemberId,
        reasons: expectedReasons,
        threadId: testThreadId,
        workspaceId: testWorkspaceId,
      },
    ]);
    expect(
      unwrapOk(
        await harness.tenantDataAccess.listMemberUnread({
          memberId: memberId("member-2"),
        })
      )
    ).toEqual([
      {
        bumpedAt: executionTime,
        memberId: memberId("member-2"),
        reasons: expectedReasons,
        threadId: testThreadId,
        workspaceId: testWorkspaceId,
      },
    ]);
  });
});

describe("Run completion — hub deltas fan out after the bump is durable (ADR 0010/0017)", () => {
  test("the channel hub hears comment_added then run_lifecycle_changed; the workspace hub hears thread_bumped", async () => {
    const harness = makeCompletionHarness();
    const receipt = unwrapOk(
      await harness.agent.run(
        makeDispatchTrigger({ targetCommentId: "comment-top" })
      )
    );

    unwrapOk(await harness.agent.executeNextRun());

    expect(harness.publishedChannelEvents).toEqual([
      {
        commentId: commentId("comment-run-output"),
        kind: "comment_added",
        threadId: testThreadId,
      },
      {
        kind: "run_lifecycle_changed",
        runId: receipt.runId,
        threadId: testThreadId,
      },
    ]);
    expect(harness.publishedActivity).toEqual([
      {
        bumpedAt: executionTime,
        channelId: testChannelId,
        kind: "thread_bumped",
        threadId: testThreadId,
      },
    ]);
  });
});

describe("Run completion — a failing run settles without bumping (ADR 0017/0028)", () => {
  test("a failed run records its failure and announces the lifecycle change, but leaves no comment, bump, or unread", async () => {
    const harness = makeCompletionHarness({
      turnScript: [
        { failureReason: failureReason("model_call_failed"), kind: "failure" },
      ],
    });
    const receipt = unwrapOk(
      await harness.agent.run(
        makeDispatchTrigger({ targetCommentId: "comment-top" })
      )
    );

    const settled = unwrapOk(await harness.agent.executeNextRun());
    if (settled === null) {
      throw new Error("expected a queued run to execute");
    }

    expect(settled).toEqual({
      channelId: testChannelId,
      failure: {
        failedAt: executionTime,
        failureReason: failureReason("model_call_failed"),
        from: "running",
        startedAt: executionTime,
      },
      id: receipt.runId,
      lifecycle: "failed",
      queuedAt: executionTime,
      threadId: testThreadId,
      trigger: receipt.queuedRun.trigger,
      workspaceId: testWorkspaceId,
    });
    const detail = unwrapOk(
      await harness.agent.getRun({ runId: receipt.runId })
    );
    expect(detail?.run).toEqual(settled);

    expect(harness.publishedChannelEvents).toEqual([
      {
        kind: "run_lifecycle_changed",
        runId: receipt.runId,
        threadId: testThreadId,
      },
    ]);
    expect(harness.publishedActivity).toEqual([]);

    const branch = unwrapOk(
      await harness.agent.loadBranch({
        rootCommentId: commentId("comment-top"),
      })
    );
    expect(branch.subtree.map((comment) => comment.id)).toEqual([
      commentId("comment-top"),
    ]);

    const index = unwrapOk(
      await harness.tenantDataAccess.listChannelThreads({
        channelId: testChannelId,
      })
    );
    const thread = index.threads.find(
      (candidate) => candidate.id === testThreadId
    );
    expect(thread?.lastActivityAt).not.toEqual(executionTime);
    expect(
      unwrapOk(
        await harness.tenantDataAccess.listMemberUnread({
          memberId: testMemberId,
        })
      )
    ).toEqual([]);
  });
});
