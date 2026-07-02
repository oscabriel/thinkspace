import { describe, expect, test } from "bun:test";

import { createMemoryTenantDataAccess } from "../src/adapters/memory";
import {
  channelId,
  makeChannel,
  makeShape,
  makeThread,
  makeUnread,
  makeWorkspaceToolDisable,
  memberId,
  otherWorkspaceId,
  shapeId,
  testMemberId,
  testTenantContext,
  testWorkspace,
  testWorkspaceId,
  threadId,
  toolId,
  unwrapErr,
  unwrapOk,
} from "./fixtures";

describe("TenantDataAccess.listRecentThreads — home feed (ADR 0020/0027)", () => {
  test("lists bumped threads across the member's visible channels, most recent first; other members' private and deleted channels are excluded", async () => {
    const sharedChannel = makeChannel({ id: "channel-shared" });
    const ownPrivateChannel = makeChannel({
      id: "channel-own-private",
      visibility: { kind: "private" },
    });
    const foreignPrivateChannel = makeChannel({
      id: "channel-foreign-private",
      ownerMemberId: memberId("member-2"),
      visibility: { kind: "private" },
    });
    const deletedChannel = makeChannel({
      id: "channel-deleted",
      lifecycle: {
        archivedAt: null,
        deletedAt: new Date("2026-06-30T00:00:00Z"),
        state: "deleted",
      },
    });
    const archivedChannel = makeChannel({
      id: "channel-archived",
      lifecycle: {
        archivedAt: new Date("2026-06-30T00:00:00Z"),
        state: "archived",
      },
    });

    const data = createMemoryTenantDataAccess({
      channels: [
        sharedChannel,
        ownPrivateChannel,
        foreignPrivateChannel,
        deletedChannel,
        archivedChannel,
      ],
      context: testTenantContext,
      threads: [
        makeThread({
          channelId: "channel-shared",
          id: "thread-oldest",
          lastActivityAt: new Date("2026-06-30T10:00:00Z"),
        }),
        makeThread({
          channelId: "channel-own-private",
          id: "thread-newest",
          lastActivityAt: new Date("2026-06-30T12:00:00Z"),
        }),
        makeThread({
          channelId: "channel-archived",
          id: "thread-archived",
          lastActivityAt: new Date("2026-06-30T11:00:00Z"),
        }),
        makeThread({
          channelId: "channel-foreign-private",
          id: "thread-invisible",
          lastActivityAt: new Date("2026-06-30T13:00:00Z"),
        }),
        makeThread({
          channelId: "channel-deleted",
          id: "thread-in-deleted",
          lastActivityAt: new Date("2026-06-30T14:00:00Z"),
        }),
      ],
      workspace: testWorkspace,
    });

    const feed = unwrapOk(
      await data.listRecentThreads({ before: null, limit: 10 })
    );

    expect(feed.threads.map((thread) => thread.id)).toEqual([
      threadId("thread-newest"),
      threadId("thread-archived"),
      threadId("thread-oldest"),
    ]);
  });

  test("paginates with limit and an exclusive before cursor", async () => {
    const data = createMemoryTenantDataAccess({
      channels: [makeChannel({ id: "channel-shared" })],
      context: testTenantContext,
      threads: [
        makeThread({
          channelId: "channel-shared",
          id: "thread-1",
          lastActivityAt: new Date("2026-06-30T10:00:00Z"),
        }),
        makeThread({
          channelId: "channel-shared",
          id: "thread-2",
          lastActivityAt: new Date("2026-06-30T11:00:00Z"),
        }),
        makeThread({
          channelId: "channel-shared",
          id: "thread-3",
          lastActivityAt: new Date("2026-06-30T12:00:00Z"),
        }),
      ],
      workspace: testWorkspace,
    });

    const firstPage = unwrapOk(
      await data.listRecentThreads({ before: null, limit: 2 })
    );
    expect(firstPage.threads.map((thread) => thread.id)).toEqual([
      threadId("thread-3"),
      threadId("thread-2"),
    ]);

    const lastSeen = firstPage.threads.at(-1);
    const secondPage = unwrapOk(
      await data.listRecentThreads({
        before: lastSeen?.lastActivityAt ?? null,
        limit: 2,
      })
    );
    expect(secondPage.threads.map((thread) => thread.id)).toEqual([
      threadId("thread-1"),
    ]);
  });
});

describe("TenantDataAccess unread — clearing via delete_unread (ADR 0017/0027)", () => {
  test("delete_unread clears exactly the (member, thread) pair the member opened", async () => {
    const data = createMemoryTenantDataAccess({
      context: testTenantContext,
      unread: [
        makeUnread({ threadId: "thread-opened" }),
        makeUnread({ threadId: "thread-still-unread" }),
        makeUnread({
          memberId: memberId("member-2"),
          threadId: "thread-opened",
        }),
      ],
      workspace: testWorkspace,
    });

    const receipt = unwrapOk(
      await data.batch({
        commands: [
          {
            kind: "delete_unread",
            memberId: testMemberId,
            threadId: threadId("thread-opened"),
          },
        ],
        workspaceId: testWorkspaceId,
      })
    );
    expect(receipt.commandCount).toBe(1);

    const remaining = unwrapOk(
      await data.listMemberUnread({ memberId: testMemberId })
    );
    expect(remaining.map((unread) => unread.threadId)).toEqual([
      threadId("thread-still-unread"),
    ]);

    const otherMemberUnread = unwrapOk(
      await data.listMemberUnread({ memberId: memberId("member-2") })
    );
    expect(otherMemberUnread.map((unread) => unread.threadId)).toEqual([
      threadId("thread-opened"),
    ]);
  });
});

describe("TenantDataAccess workspace tool disables — default-permit rows (ADR 0004)", () => {
  test("put_workspace_tool_disable and delete_workspace_tool_disable round-trip through the listing", async () => {
    const data = createMemoryTenantDataAccess({
      context: testTenantContext,
      workspace: testWorkspace,
    });

    const disable = makeWorkspaceToolDisable({ toolId: "tool-a" });
    unwrapOk(
      await data.batch({
        commands: [
          { kind: "put_workspace_tool_disable", toolDisable: disable },
        ],
        workspaceId: testWorkspaceId,
      })
    );
    expect(unwrapOk(await data.listWorkspaceToolDisables())).toEqual([disable]);

    unwrapOk(
      await data.batch({
        commands: [
          { kind: "delete_workspace_tool_disable", toolId: toolId("tool-a") },
        ],
        workspaceId: testWorkspaceId,
      })
    );
    expect(unwrapOk(await data.listWorkspaceToolDisables())).toEqual([]);
  });
});

describe("TenantDataAccess.batch — tenant guard and atomicity (ADR 0009)", () => {
  test("rejects a batch addressed to a foreign workspace", async () => {
    const data = createMemoryTenantDataAccess({
      context: testTenantContext,
      workspace: testWorkspace,
    });

    const error = unwrapErr(
      await data.batch({
        commands: [
          {
            kind: "put_thread_index",
            thread: makeThread({ channelId: "channel-1", id: "thread-1" }),
          },
        ],
        workspaceId: otherWorkspaceId,
      })
    );

    expect(error.kind).toBe("tenant_guard_violation");
  });

  test("a batch containing one cross-tenant command applies nothing", async () => {
    const data = createMemoryTenantDataAccess({
      context: testTenantContext,
      workspace: testWorkspace,
    });

    const foreignChannel = makeChannel({
      id: "channel-foreign",
      workspaceId: otherWorkspaceId,
    });
    const error = unwrapErr(
      await data.batch({
        commands: [
          {
            kind: "put_thread_index",
            thread: makeThread({ channelId: "channel-1", id: "thread-good" }),
          },
          { channel: foreignChannel, kind: "put_channel" },
        ],
        workspaceId: testWorkspaceId,
      })
    );
    expect(error.kind).toBe("tenant_guard_violation");

    const index = unwrapOk(
      await data.listChannelThreads({ channelId: channelId("channel-1") })
    );
    expect(index.threads).toEqual([]);
  });
});

describe("TenantDataAccess — Shape↔Channel is strictly 1:1, channel-owned (ADR 0030)", () => {
  test("a creation batch writes the shape alongside its owning channel", async () => {
    const data = createMemoryTenantDataAccess({
      context: testTenantContext,
      workspace: testWorkspace,
    });

    const shape = makeShape({ id: "shape-new" });
    const channel = makeChannel({ id: "channel-new", shapeId: "shape-new" });

    const receipt = unwrapOk(
      await data.batch({
        commands: [
          { kind: "put_shape", shape },
          { channel, kind: "put_channel" },
        ],
        workspaceId: testWorkspaceId,
      })
    );
    expect(receipt.commandCount).toBe(2);

    expect(unwrapOk(await data.getShape({ shapeId: shape.id }))).toEqual(shape);
    expect(unwrapOk(await data.getChannel({ channelId: channel.id }))).toEqual(
      channel
    );
  });

  test("rejects a channel claiming a shape already owned by another channel", async () => {
    const data = createMemoryTenantDataAccess({
      channels: [makeChannel({ id: "channel-a", shapeId: "shape-a" })],
      context: testTenantContext,
      shapes: [makeShape({ id: "shape-a" })],
      workspace: testWorkspace,
    });

    const error = unwrapErr(
      await data.batch({
        commands: [
          {
            channel: makeChannel({ id: "channel-b", shapeId: "shape-a" }),
            kind: "put_channel",
          },
        ],
        workspaceId: testWorkspaceId,
      })
    );

    expect(error).toEqual({
      kind: "shape_ownership_violation",
      shapeId: shapeId("shape-a"),
      violation: {
        kind: "shape_already_owned",
        owningChannelId: channelId("channel-a"),
      },
      workspaceId: testWorkspaceId,
    });
  });

  test("rejects a shape write with no owning channel, existing or in-batch", async () => {
    const data = createMemoryTenantDataAccess({
      context: testTenantContext,
      workspace: testWorkspace,
    });

    const error = unwrapErr(
      await data.batch({
        commands: [
          { kind: "put_shape", shape: makeShape({ id: "shape-orphan" }) },
        ],
        workspaceId: testWorkspaceId,
      })
    );

    expect(error).toEqual({
      kind: "shape_ownership_violation",
      shapeId: shapeId("shape-orphan"),
      violation: { kind: "unowned_shape_write" },
      workspaceId: testWorkspaceId,
    });
  });

  test("allows editing the shape its one channel already owns, and re-putting that channel", async () => {
    const channel = makeChannel({ id: "channel-a", shapeId: "shape-a" });
    const data = createMemoryTenantDataAccess({
      channels: [channel],
      context: testTenantContext,
      shapes: [makeShape({ id: "shape-a" })],
      workspace: testWorkspace,
    });

    const editedShape = makeShape({ id: "shape-a" });
    const archivedChannel = {
      ...channel,
      lifecycle: {
        archivedAt: new Date("2026-07-01T00:00:00Z"),
        state: "archived",
      },
    } as const;

    const receipt = unwrapOk(
      await data.batch({
        commands: [
          { kind: "put_shape", shape: editedShape },
          { channel: archivedChannel, kind: "put_channel" },
        ],
        workspaceId: testWorkspaceId,
      })
    );

    expect(receipt.commandCount).toBe(2);
  });

  test("a clone copies the structure into a fresh shape and records provenance", async () => {
    const sourceChannel = makeChannel({
      id: "channel-source",
      shapeId: "shape-source",
    });
    const data = createMemoryTenantDataAccess({
      channels: [sourceChannel],
      context: testTenantContext,
      shapes: [makeShape({ id: "shape-source" })],
      workspace: testWorkspace,
    });

    const clonedShape = makeShape({
      clonedFrom: {
        channelId: sourceChannel.id,
        shapeId: shapeId("shape-source"),
      },
      id: "shape-clone",
    });
    const cloneChannel = makeChannel({
      id: "channel-clone",
      shapeId: "shape-clone",
    });

    unwrapOk(
      await data.batch({
        commands: [
          { kind: "put_shape", shape: clonedShape },
          { channel: cloneChannel, kind: "put_channel" },
        ],
        workspaceId: testWorkspaceId,
      })
    );

    const readBack = unwrapOk(await data.getShape({ shapeId: clonedShape.id }));
    expect(readBack?.clonedFrom).toEqual({
      channelId: sourceChannel.id,
      shapeId: shapeId("shape-source"),
    });
  });
});
