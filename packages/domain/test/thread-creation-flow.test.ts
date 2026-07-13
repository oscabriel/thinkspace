import { describe, expect, test } from "bun:test";

import {
  createMemoryChannelHub,
  createMemoryMcpEgressPolicy,
  createMemoryModelRouter,
  createMemoryTenantDataAccess,
  createMemoryThreadAgentDirectory,
  createMemoryToolResolver,
  createMemoryWorkspaceHub,
} from "../src/adapters/memory";
import type { Channel } from "../src/channel";
import { createDispatchFlow } from "../src/flows/dispatch";
import { createThreadCreationFlow } from "../src/flows/thread-creation";
import { modelIdSchema } from "../src/ids";
import { modelProviderSchema } from "../src/model";
import {
  commentBodySchema,
  nonEmptyStringSchema,
  secretAliasSchema,
  systemPromptSchema,
  threadNameSchema,
} from "../src/primitives";
import type { WorkspaceActivityEvent } from "../src/seams/realtime-hubs";
import type { Shape } from "../src/shape";
import {
  commentId,
  gestureId,
  makeChannel,
  makeShape,
  makeThread,
  testChannelId,
  testMemberId,
  testTenantContext,
  testWorkspace,
  testWorkspaceId,
  threadId,
  unwrapErr,
  unwrapOk,
} from "../src/testing/fixtures";
import type { Thread } from "../src/thread";

const creationClock = () => new Date("2026-07-04T10:00:00Z");

const makeCreationHarness = (input?: {
  readonly channel?: Channel;
  readonly threads?: readonly Thread[];
}) => {
  const channel = input?.channel ?? makeChannel({ id: "channel-1" });
  const shape: Shape = makeShape({ id: `shape-of-${channel.id}` });

  const tenantDataAccess = createMemoryTenantDataAccess({
    channels: [channel],
    context: testTenantContext,
    shapes: [shape],
    threads: input?.threads,
    workspace: testWorkspace,
  });
  const threadAgents = createMemoryThreadAgentDirectory();
  const publishedActivity: WorkspaceActivityEvent[] = [];

  const flow = createThreadCreationFlow({
    clock: creationClock,
    tenantDataAccess,
    threadAgents,
    workspaceHub: createMemoryWorkspaceHub({
      context: testTenantContext,
      onActivity: (event) => publishedActivity.push(event),
    }),
  });

  return {
    channel,
    flow,
    publishedActivity,
    shape,
    tenantDataAccess,
    threadAgents,
  };
};

/** A dispatch spine over the SAME stores the creation harness wrote through. */
const makeDispatchFlowOver = (
  harness: ReturnType<typeof makeCreationHarness>
) => {
  const testModel = {
    capabilities: {
      attachment: false,
      reasoning: false,
      structuredOutput: true,
      toolCall: true,
    },
    catalogSource: "models_dev" as const,
    cost: { cacheRead: 0, cacheWrite: 0, input: 1, output: 1 },
    displayName: nonEmptyStringSchema.parse("Test Model"),
    id: modelIdSchema.parse("test-provider/model-1"),
    limits: { context: 1000, output: 1000 },
    provider: modelProviderSchema.parse("test-provider"),
    releaseDate: "2026-07-01",
  };

  return createDispatchFlow({
    channelHub: createMemoryChannelHub({
      address: { channelId: testChannelId },
      context: testTenantContext,
    }),
    mcpEgressPolicy: createMemoryMcpEgressPolicy({
      approvedHosts: [],
      context: testTenantContext,
    }),
    modelRouter: createMemoryModelRouter({
      context: testTenantContext,
      models: [testModel],
      secretAliases: [
        {
          provider: testModel.provider,
          secretAlias: secretAliasSchema.parse("alias-test-provider"),
        },
      ],
    }),
    tenantDataAccess: harness.tenantDataAccess,
    threadAgents: harness.threadAgents,
    toolResolver: createMemoryToolResolver({
      approvedMcpHosts: [],
      context: testTenantContext,
    }),
  });
};

describe("Thread creation flow — D1 row first, initialize second, announce last (ADR 0034)", () => {
  test("create writes the index row, initializes the agent with the opening comment, and announces a bump", async () => {
    const harness = makeCreationHarness();

    const created = unwrapOk(
      await harness.flow.create({
        channelId: testChannelId,
        openingBody: commentBodySchema.parse(
          "fix the login bug\n\nstack trace below"
        ),
        openingCommentId: commentId("comment-opening"),
        threadId: threadId("thread-new"),
      })
    );

    expect(created.thread.name).toBe(
      threadNameSchema.parse("fix the login bug")
    );
    expect(created.thread.createdByMemberId).toBe(testMemberId);
    expect(created.thread.lifecycle).toEqual({ state: "active" });
    expect(created.thread.openingExcerpt).toBe(
      "fix the login bug\n\nstack trace below"
    );
    expect(created.thread.commentCount).toBe(1);
    expect(created.thread.working).toBeNull();

    const index = unwrapOk(
      await harness.tenantDataAccess.listChannelThreads({
        channelId: testChannelId,
      })
    );
    expect(index.threads).toEqual([created.thread]);

    const agent = harness.threadAgents.get({
      channelId: testChannelId,
      threadId: threadId("thread-new"),
      workspaceId: testWorkspaceId,
    });
    const branch = unwrapOk(
      await agent.loadBranch({ rootCommentId: commentId("comment-opening") })
    );
    expect(branch.subtree).toEqual([created.openingComment]);

    expect(created.shapeSnapshot.shapeId).toBe(harness.shape.id);
    expect(created.shapeSnapshot.structure).toEqual(harness.shape.structure);

    expect(harness.publishedActivity).toEqual([
      {
        bumpedAt: creationClock(),
        channelId: testChannelId,
        kind: "thread_bumped",
        threadId: threadId("thread-new"),
      },
    ]);
  });

  test("dispatch works immediately after create — the fresh agent queues a run at the opening comment (ADR 0017 §6)", async () => {
    const harness = makeCreationHarness();
    unwrapOk(
      await harness.flow.create({
        channelId: testChannelId,
        openingBody: commentBodySchema.parse("summarize our options"),
        openingCommentId: commentId("comment-opening"),
        threadId: threadId("thread-new"),
      })
    );

    const dispatchFlow = makeDispatchFlowOver(harness);
    const receipt = unwrapOk(
      await dispatchFlow.dispatch({
        channelId: testChannelId,
        gestureId: gestureId("gesture-1"),
        targetCommentId: commentId("comment-opening"),
        threadId: threadId("thread-new"),
      })
    );

    expect(receipt.threadId).toBe(threadId("thread-new"));
    expect(receipt.queuedRun.lifecycle).toBe("queued");
  });
});

describe("Thread creation flow — replay is the recovery mechanism (ADR 0034 §2/§3)", () => {
  test("replaying the gesture heals the designed half-crash: row present, agent empty", async () => {
    const crashedRow = makeThread({ channelId: "channel-1", id: "thread-new" });
    const harness = makeCreationHarness({ threads: [crashedRow] });
    const dispatchFlow = makeDispatchFlowOver(harness);

    const beforeHeal = unwrapErr(
      await dispatchFlow.dispatch({
        channelId: testChannelId,
        gestureId: gestureId("gesture-1"),
        targetCommentId: commentId("comment-opening"),
        threadId: threadId("thread-new"),
      })
    );
    expect(beforeHeal.kind).toBe("thread_agent_uninitialized");

    unwrapOk(
      await harness.flow.create({
        channelId: testChannelId,
        openingBody: commentBodySchema.parse("summarize our options"),
        openingCommentId: commentId("comment-opening"),
        threadId: threadId("thread-new"),
      })
    );

    const index = unwrapOk(
      await harness.tenantDataAccess.listChannelThreads({
        channelId: testChannelId,
      })
    );
    expect(index.threads).toEqual([crashedRow]);

    const receipt = unwrapOk(
      await dispatchFlow.dispatch({
        channelId: testChannelId,
        gestureId: gestureId("gesture-1"),
        targetCommentId: commentId("comment-opening"),
        threadId: threadId("thread-new"),
      })
    );
    expect(receipt.queuedRun.lifecycle).toBe("queued");
  });

  test("a replay after full success is a no-op: rename, later bumps, and the resident snapshot all survive", async () => {
    const harness = makeCreationHarness();
    const gesture = {
      channelId: testChannelId,
      openingBody: commentBodySchema.parse("summarize our options"),
      openingCommentId: commentId("comment-opening"),
      threadId: threadId("thread-new"),
    };
    const first = unwrapOk(await harness.flow.create(gesture));

    // Life happens between the success and the replayed gesture: a member renames the
    // thread, agent activity bumps it, and the owner edits the channel's live shape.
    const renamedAndBumped: Thread = {
      ...first.thread,
      lastActivityAt: new Date("2026-07-05T09:00:00Z"),
      name: threadNameSchema.parse("renamed by a member"),
    };
    unwrapOk(
      await harness.tenantDataAccess.batch({
        commands: [
          { kind: "put_thread_index", thread: renamedAndBumped },
          {
            kind: "put_shape",
            shape: {
              ...harness.shape,
              structure: {
                ...harness.shape.structure,
                systemPrompt: systemPromptSchema.parse(
                  "Edited since creation."
                ),
              },
            },
          },
        ],
        workspaceId: testWorkspaceId,
      })
    );

    const replay = unwrapOk(await harness.flow.create(gesture));

    const index = unwrapOk(
      await harness.tenantDataAccess.listChannelThreads({
        channelId: testChannelId,
      })
    );
    expect(index.threads).toEqual([renamedAndBumped]);
    expect(replay.shapeSnapshot).toEqual(first.shapeSnapshot);

    const agent = harness.threadAgents.get({
      channelId: testChannelId,
      threadId: threadId("thread-new"),
      workspaceId: testWorkspaceId,
    });
    const branch = unwrapOk(
      await agent.loadBranch({ rootCommentId: commentId("comment-opening") })
    );
    expect(branch.subtree).toEqual([first.openingComment]);
  });
});

describe("Thread creation flow — channel authz gates creation (ADR 0034 §4)", () => {
  test("create into an archived channel fails with channel_read_only and writes nothing anywhere", async () => {
    const harness = makeCreationHarness({
      channel: makeChannel({
        id: "channel-1",
        lifecycle: {
          archivedAt: new Date("2026-07-02T00:00:00Z"),
          state: "archived",
        },
      }),
    });

    const error = unwrapErr(
      await harness.flow.create({
        channelId: testChannelId,
        openingBody: commentBodySchema.parse("summarize our options"),
        openingCommentId: commentId("comment-opening"),
        threadId: threadId("thread-new"),
      })
    );

    expect(error).toEqual({
      channelId: testChannelId,
      kind: "channel_read_only",
    });

    const index = unwrapOk(
      await harness.tenantDataAccess.listChannelThreads({
        channelId: testChannelId,
      })
    );
    expect(index.threads).toEqual([]);
    expect(harness.publishedActivity).toEqual([]);
  });
});
