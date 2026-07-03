import { describe, expect, test } from "bun:test";

import {
  createMemoryChannelHub,
  createMemoryMcpEgressPolicy,
  createMemoryModelRouter,
  createMemoryTenantDataAccess,
  createMemoryThreadAgent,
  createMemoryThreadAgentDirectory,
  createMemoryToolResolver,
} from "../src/adapters/memory";
import type { Channel } from "../src/channel";
import { createDispatchFlow } from "../src/flows/dispatch";
import { modelIdSchema } from "../src/ids";
import type { McpServer } from "../src/mcp";
import { modelProviderSchema } from "../src/model";
import { nonEmptyStringSchema, secretAliasSchema } from "../src/primitives";
import type { ChannelHubEvent } from "../src/seams/realtime-hubs";
import type { Shape, ShapeStructure } from "../src/shape";
import {
  channelId,
  commentId,
  makeChannel,
  makeMcpServer,
  makeShape,
  makeShapeSnapshot,
  makeShapeStructure,
  mcpHost,
  mcpServerId,
  memberId,
  runId,
  testChannelId,
  testMemberId,
  testTenantContext,
  testThreadId,
  testWorkspace,
  testWorkspaceId,
  threadAgentAddress,
  threadId,
  unwrapErr,
  unwrapOk,
} from "../src/testing/fixtures";

const testModel = {
  displayName: nonEmptyStringSchema.parse("Test Model"),
  id: modelIdSchema.parse("model-1"),
  provider: modelProviderSchema.parse("test-provider"),
  tier: "default" as const,
};

const makeDispatchHarness = (input?: {
  readonly approvedEgressHosts?: readonly string[];
  readonly channel?: Channel;
  readonly mcpServers?: readonly McpServer[];
  readonly modelKeyed?: boolean;
  readonly resolverApprovedHosts?: readonly string[];
  readonly shapeStructure?: ShapeStructure;
}) => {
  const channel = input?.channel ?? makeChannel({ id: "channel-1" });
  const shape: Shape = {
    ...makeShape({ id: `shape-of-${channel.id}` }),
    structure: input?.shapeStructure ?? makeShapeStructure(),
  };

  const threadAgent = createMemoryThreadAgent({
    address: threadAgentAddress,
    clock: () => new Date("2026-07-03T10:00:00Z"),
    nextRunId: () => runId("run-1"),
    shapeSnapshot: makeShapeSnapshot({
      shapeId: `shape-of-${channel.id}`,
      structure: shape.structure,
    }),
  });

  const publishedChannelEvents: ChannelHubEvent[] = [];

  const flow = createDispatchFlow({
    channelHub: createMemoryChannelHub({
      address: { channelId: testChannelId },
      context: testTenantContext,
      onEvent: (event) => publishedChannelEvents.push(event),
    }),
    mcpEgressPolicy: createMemoryMcpEgressPolicy({
      approvedHosts: (input?.approvedEgressHosts ?? []).map(mcpHost),
      context: testTenantContext,
    }),
    modelRouter: createMemoryModelRouter({
      context: testTenantContext,
      models: [testModel],
      secretAliases:
        input?.modelKeyed === false
          ? []
          : [
              {
                provider: testModel.provider,
                secretAlias: secretAliasSchema.parse("alias-test-provider"),
              },
            ],
    }),
    tenantDataAccess: createMemoryTenantDataAccess({
      channels: [channel],
      context: testTenantContext,
      shapes: [shape],
      workspace: testWorkspace,
    }),
    threadAgents: createMemoryThreadAgentDirectory({
      agents: [threadAgent],
    }),
    toolResolver: createMemoryToolResolver({
      approvedMcpHosts: (input?.resolverApprovedHosts ?? []).map(mcpHost),
      context: testTenantContext,
      mcpServers: input?.mcpServers,
    }),
  });

  return { flow, publishedChannelEvents, threadAgent };
};

describe("Dispatch flow — the dispatch spine (ADR 0017)", () => {
  test("a member dispatch at a comment in an active shared channel queues a run on the thread's agent", async () => {
    const harness = makeDispatchHarness();

    const receipt = unwrapOk(
      await harness.flow.dispatch({
        channelId: testChannelId,
        targetCommentId: commentId("comment-top"),
        threadId: testThreadId,
      })
    );

    expect(receipt.runId).toBe(runId("run-1"));
    expect(receipt.queuedRun.lifecycle).toBe("queued");
    expect(receipt.queuedRun.trigger).toEqual({
      dispatch: {
        byMemberId: testMemberId,
        targetCommentId: commentId("comment-top"),
      },
      kind: "dispatch",
    });

    const residentRuns = unwrapOk(await harness.threadAgent.listRuns());
    expect(residentRuns).toEqual([receipt.queuedRun]);
  });

  test("queuing a run publishes run_lifecycle_changed to the channel hub", async () => {
    const harness = makeDispatchHarness();

    const receipt = unwrapOk(
      await harness.flow.dispatch({
        channelId: testChannelId,
        targetCommentId: commentId("comment-top"),
        threadId: testThreadId,
      })
    );

    expect(harness.publishedChannelEvents).toEqual([
      {
        kind: "run_lifecycle_changed",
        runId: receipt.runId,
        threadId: testThreadId,
      },
    ]);
  });
});

describe("Dispatch flow — channel authz gates the spine (ADR 0016/0017)", () => {
  test("dispatch into an archived channel fails with channel_read_only and queues no run", async () => {
    const harness = makeDispatchHarness({
      channel: makeChannel({
        id: "channel-1",
        lifecycle: {
          archivedAt: new Date("2026-07-02T00:00:00Z"),
          state: "archived",
        },
      }),
    });

    const error = unwrapErr(
      await harness.flow.dispatch({
        channelId: testChannelId,
        targetCommentId: commentId("comment-top"),
        threadId: testThreadId,
      })
    );

    expect(error).toEqual({
      channelId: testChannelId,
      kind: "channel_read_only",
    });
    expect(unwrapOk(await harness.threadAgent.listRuns())).toEqual([]);
    expect(harness.publishedChannelEvents).toEqual([]);
  });

  test("dispatch into a deleted channel fails with channel_deleted and queues no run", async () => {
    const harness = makeDispatchHarness({
      channel: makeChannel({
        id: "channel-1",
        lifecycle: {
          archivedAt: null,
          deletedAt: new Date("2026-07-02T00:00:00Z"),
          state: "deleted",
        },
      }),
    });

    const error = unwrapErr(
      await harness.flow.dispatch({
        channelId: testChannelId,
        targetCommentId: commentId("comment-top"),
        threadId: testThreadId,
      })
    );

    expect(error).toEqual({
      channelId: testChannelId,
      kind: "channel_deleted",
    });
    expect(unwrapOk(await harness.threadAgent.listRuns())).toEqual([]);
  });

  test("dispatch into a channel that does not exist fails with channel_not_visible, indistinguishable from a private channel", async () => {
    const harness = makeDispatchHarness();

    const error = unwrapErr(
      await harness.flow.dispatch({
        channelId: channelId("channel-unknown"),
        targetCommentId: commentId("comment-top"),
        threadId: testThreadId,
      })
    );

    expect(error).toEqual({
      channelId: channelId("channel-unknown"),
      kind: "channel_not_visible",
      memberId: testMemberId,
    });
    expect(unwrapOk(await harness.threadAgent.listRuns())).toEqual([]);
  });

  test("dispatch into a private channel by a non-owner fails with channel_not_visible and queues no run", async () => {
    const harness = makeDispatchHarness({
      channel: makeChannel({
        id: "channel-1",
        ownerMemberId: memberId("member-2"),
        visibility: { kind: "private" },
      }),
    });

    const error = unwrapErr(
      await harness.flow.dispatch({
        channelId: testChannelId,
        targetCommentId: commentId("comment-top"),
        threadId: testThreadId,
      })
    );

    expect(error).toEqual({
      channelId: testChannelId,
      kind: "channel_not_visible",
      memberId: testMemberId,
    });
    expect(unwrapOk(await harness.threadAgent.listRuns())).toEqual([]);
  });
});

describe("Dispatch flow — thread agents fail closed before initialization (ADR 0016/0028)", () => {
  test("dispatch addressing a thread never created in the channel fails with thread_agent_uninitialized and queues no run", async () => {
    const harness = makeDispatchHarness();

    const error = unwrapErr(
      await harness.flow.dispatch({
        channelId: testChannelId,
        targetCommentId: commentId("comment-top"),
        threadId: threadId("thread-elsewhere"),
      })
    );

    expect(error).toEqual({
      channelId: testChannelId,
      kind: "thread_agent_uninitialized",
      threadId: threadId("thread-elsewhere"),
      workspaceId: testWorkspaceId,
    });
    expect(unwrapOk(await harness.threadAgent.listRuns())).toEqual([]);
    expect(harness.publishedChannelEvents).toEqual([]);
  });
});

describe("Dispatch flow — MCP egress gate (ADR 0002/0015)", () => {
  test("a shape selecting an MCP server whose host the worker egress policy rejects fails with mcp_host_not_allowed and queues no run", async () => {
    const server = makeMcpServer({ host: "tools.example.com", id: "mcp-1" });
    const harness = makeDispatchHarness({
      approvedEgressHosts: [],
      mcpServers: [server],
      resolverApprovedHosts: ["tools.example.com"],
      shapeStructure: makeShapeStructure({ mcpServerSelection: ["mcp-1"] }),
    });

    const error = unwrapErr(
      await harness.flow.dispatch({
        channelId: testChannelId,
        targetCommentId: commentId("comment-top"),
        threadId: testThreadId,
      })
    );

    expect(error).toEqual({
      host: mcpHost("tools.example.com"),
      kind: "mcp_host_not_allowed",
      mcpServerId: mcpServerId("mcp-1"),
      workspaceId: testWorkspaceId,
    });
    expect(unwrapOk(await harness.threadAgent.listRuns())).toEqual([]);
  });
});

describe("Dispatch flow — BYOK model gate (ADR 0011)", () => {
  test("dispatch fails with byok_key_missing when the workspace has not keyed the shape's model provider, and queues no run", async () => {
    const harness = makeDispatchHarness({ modelKeyed: false });

    const error = unwrapErr(
      await harness.flow.dispatch({
        channelId: testChannelId,
        targetCommentId: commentId("comment-top"),
        threadId: testThreadId,
      })
    );

    expect(error).toEqual({
      kind: "byok_key_missing",
      modelId: testModel.id,
      provider: testModel.provider,
      workspaceId: testWorkspaceId,
    });
    expect(unwrapOk(await harness.threadAgent.listRuns())).toEqual([]);
  });
});
