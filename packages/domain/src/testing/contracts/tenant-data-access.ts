import type { Channel } from "../../channel";
import type {
  DataAccessContext,
  TenantDataAccess,
  WorkspaceMember,
} from "../../seams/tenant-data-access";
import type { Shape } from "../../shape";
import type { Thread } from "../../thread";
import type { Unread } from "../../unread";
import type { Workspace } from "../../workspace";
import type { ContractTestApi } from "../contract-api";
import {
  channelId,
  commentId,
  makeChannel,
  makeMcpHostApproval,
  makeMcpServer,
  makeShape,
  makeThread,
  makeUnread,
  makeWorkspaceMember,
  makeWorkspaceToolDisable,
  mcpHost,
  mcpServerId,
  memberId,
  otherWorkspaceId,
  shapeId,
  testMemberId,
  testSystemContext,
  testTenantContext,
  testWorkspace,
  testWorkspaceId,
  threadId,
  toolId,
  unwrapErr,
  unwrapOk,
} from "../fixtures";

/** Domain-termed initial state a TenantDataAccess adapter must be constructible from. */
export interface TenantDataAccessSeed {
  readonly channels?: readonly Channel[];
  readonly context: DataAccessContext;
  readonly members?: readonly WorkspaceMember[];
  readonly shapes?: readonly Shape[];
  readonly threads?: readonly Thread[];
  readonly unread?: readonly Unread[];
  readonly workspace: Workspace;
}

export type TenantDataAccessFactory = (
  seed: TenantDataAccessSeed
) =>
  | Promise<TenantDataAccess<DataAccessContext>>
  | TenantDataAccess<DataAccessContext>;

/** Pins the TenantDataAccess seam semantics on whichever adapter the factory builds. */
export const defineTenantDataAccessContract = (input: {
  readonly api: ContractTestApi;
  readonly makeTenantDataAccess: TenantDataAccessFactory;
}): void => {
  const { describe, expect, test } = input.api;
  const { makeTenantDataAccess } = input;

  describe("TenantDataAccess under a system context (ADR 0035 §1)", () => {
    test("a system context passes the tenant guard for settle-shaped work: listChannelThreads + batch", async () => {
      const thread = makeThread({
        channelId: "channel-1",
        id: "thread-1",
        lastActivityAt: new Date("2026-07-01T10:00:00Z"),
      });
      const data = await makeTenantDataAccess({
        channels: [makeChannel({ id: "channel-1" })],
        context: testSystemContext,
        threads: [thread],
        workspace: testWorkspace,
      });

      const bumped = {
        ...thread,
        lastActivityAt: new Date("2026-07-01T11:00:00Z"),
      };
      const receipt = unwrapOk(
        await data.batch({
          commands: [
            { kind: "put_thread_index", thread: bumped },
            {
              kind: "put_unread",
              unread: makeUnread({ threadId: "thread-1" }),
            },
          ],
          workspaceId: testWorkspaceId,
        })
      );
      expect(receipt.commandCount).toBe(2);

      const index = unwrapOk(
        await data.listChannelThreads({ channelId: channelId("channel-1") })
      );
      expect(index.threads).toEqual([bumped]);
    });

    test("sidebar and directory channel listings fail closed with an AuthzError", async () => {
      const data = await makeTenantDataAccess({
        channels: [makeChannel({ id: "channel-1" })],
        context: testSystemContext,
        workspace: testWorkspace,
      });

      const failClosed = {
        kind: "not_workspace_member",
        workspaceId: testWorkspaceId,
      };
      expect(unwrapErr(await data.listChannels({ kind: "sidebar" }))).toEqual(
        failClosed
      );
      expect(
        unwrapErr(
          await data.listChannels({
            kind: "directory",
            search: { ownerMemberId: null, query: null, status: null },
          })
        )
      ).toEqual(failClosed);
    });

    test("the home feed fails closed with an AuthzError", async () => {
      const data = await makeTenantDataAccess({
        channels: [makeChannel({ id: "channel-1" })],
        context: testSystemContext,
        workspace: testWorkspace,
      });

      expect(
        unwrapErr(await data.listRecentThreads({ before: null, limit: 10 }))
      ).toEqual({
        kind: "not_workspace_member",
        workspaceId: testWorkspaceId,
      });
    });

    test("the workspace graph (sidebar) fails closed with an AuthzError", async () => {
      const data = await makeTenantDataAccess({
        channels: [makeChannel({ id: "channel-1" })],
        context: testSystemContext,
        workspace: testWorkspace,
      });

      expect(unwrapErr(await data.getWorkspaceGraph())).toEqual({
        kind: "not_workspace_member",
        workspaceId: testWorkspaceId,
      });
    });
  });

  describe("TenantDataAccess.getWorkspaceGraph — sidebar payload (ADR 0035 §6 / ADR 0027)", () => {
    test("returns the workspace plus the visible, non-deleted channels the member can see", async () => {
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

      const data = await makeTenantDataAccess({
        channels: [
          sharedChannel,
          ownPrivateChannel,
          foreignPrivateChannel,
          deletedChannel,
        ],
        context: testTenantContext,
        workspace: testWorkspace,
      });

      const graph = unwrapOk(await data.getWorkspaceGraph());

      expect(graph.workspaceId).toEqual(testWorkspaceId);
      expect(
        graph.channels.map((entry) => entry.channelId).toSorted()
      ).toEqual([channelId("channel-own-private"), channelId("channel-shared")]);
      const shared = graph.channels.find(
        (entry) => entry.channelId === channelId("channel-shared")
      );
      expect(shared).toEqual({
        channelId: sharedChannel.id,
        goal: sharedChannel.goal,
        lifecycle: sharedChannel.lifecycle,
        ownerMemberId: sharedChannel.ownerMemberId,
        visibility: sharedChannel.visibility,
      });
    });
  });

  describe("TenantDataAccess.listChannelThreads — recency-ordered (ADR 0020)", () => {
    test("lists a channel's threads most-recent-activity first — the bump order", async () => {
      const data = await makeTenantDataAccess({
        channels: [makeChannel({ id: "channel-1" })],
        context: testTenantContext,
        threads: [
          makeThread({
            channelId: "channel-1",
            id: "thread-oldest",
            lastActivityAt: new Date("2026-06-30T10:00:00Z"),
          }),
          makeThread({
            channelId: "channel-1",
            id: "thread-newest",
            lastActivityAt: new Date("2026-06-30T12:00:00Z"),
          }),
          makeThread({
            channelId: "channel-1",
            id: "thread-middle",
            lastActivityAt: new Date("2026-06-30T11:00:00Z"),
          }),
        ],
        workspace: testWorkspace,
      });

      const index = unwrapOk(
        await data.listChannelThreads({ channelId: channelId("channel-1") })
      );
      expect(index.threads.map((thread) => thread.id)).toEqual([
        threadId("thread-newest"),
        threadId("thread-middle"),
        threadId("thread-oldest"),
      ]);
    });
  });

  describe("TenantDataAccess.getThread — single index row by id (E10.3)", () => {
    test("returns the thread when it is present in the tenant", async () => {
      const thread = makeThread({ channelId: "channel-1", id: "thread-1" });
      const data = await makeTenantDataAccess({
        channels: [makeChannel({ id: "channel-1" })],
        context: testTenantContext,
        threads: [thread],
        workspace: testWorkspace,
      });

      expect(unwrapOk(await data.getThread({ threadId: thread.id }))).toEqual(
        thread
      );
    });

    test("returns null when no such thread exists", async () => {
      const data = await makeTenantDataAccess({
        channels: [makeChannel({ id: "channel-1" })],
        context: testTenantContext,
        workspace: testWorkspace,
      });

      expect(
        unwrapOk(await data.getThread({ threadId: threadId("thread-absent") }))
      ).toBeNull();
    });

    test("fails closed against a thread owned by another workspace", async () => {
      const foreignThread = {
        ...makeThread({ channelId: "channel-foreign", id: "thread-foreign" }),
        workspaceId: otherWorkspaceId,
      };
      const data = await makeTenantDataAccess({
        channels: [makeChannel({ id: "channel-1" })],
        context: testTenantContext,
        threads: [foreignThread],
        workspace: testWorkspace,
      });

      expect(
        unwrapErr(await data.getThread({ threadId: foreignThread.id }))
      ).toEqual({
        expectedWorkspaceId: testWorkspaceId,
        kind: "tenant_guard_violation",
        observed: { kind: "workspace", workspaceId: otherWorkspaceId },
      });
    });
  });

  describe("TenantDataAccess.listWorkspaceThreadAddresses — revoke fan-out enumeration (ADR 0037 decision 4, E10.4)", () => {
    test("returns every thread's DO address in the workspace, across channels and regardless of visibility", async () => {
      const data = await makeTenantDataAccess({
        channels: [
          makeChannel({ id: "channel-1" }),
          makeChannel({ id: "channel-2", visibility: { kind: "private" } }),
        ],
        context: testTenantContext,
        threads: [
          makeThread({ channelId: "channel-1", id: "thread-a" }),
          makeThread({ channelId: "channel-1", id: "thread-b" }),
          makeThread({ channelId: "channel-2", id: "thread-c" }),
        ],
        workspace: testWorkspace,
      });

      const enumerated = unwrapOk(await data.listWorkspaceThreadAddresses());

      expect(enumerated.workspaceId).toEqual(testWorkspaceId);
      expect(
        enumerated.addresses
          .map((address) => ({
            channelId: address.channelId,
            threadId: address.threadId,
          }))
          .toSorted((left, right) =>
            left.threadId.localeCompare(right.threadId)
          )
      ).toEqual([
        { channelId: channelId("channel-1"), threadId: threadId("thread-a") },
        { channelId: channelId("channel-1"), threadId: threadId("thread-b") },
        { channelId: channelId("channel-2"), threadId: threadId("thread-c") },
      ]);
    });

    test("an empty workspace enumerates to no addresses", async () => {
      const data = await makeTenantDataAccess({
        context: testTenantContext,
        workspace: testWorkspace,
      });

      const enumerated = unwrapOk(await data.listWorkspaceThreadAddresses());

      expect(enumerated.workspaceId).toEqual(testWorkspaceId);
      expect(enumerated.addresses).toEqual([]);
    });

    test("fails closed on tenancy: another workspace's threads never enter the fan-out", async () => {
      const home = await makeTenantDataAccess({
        channels: [makeChannel({ id: "channel-home" })],
        context: testTenantContext,
        threads: [makeThread({ channelId: "channel-home", id: "thread-home" })],
        workspace: testWorkspace,
      });
      // A second tenant seeded into the same store (shared D1 under the workers binder); the
      // foreign thread carries otherWorkspaceId so its own batch clears the tenant guard.
      await makeTenantDataAccess({
        channels: [
          makeChannel({ id: "channel-foreign", workspaceId: otherWorkspaceId }),
        ],
        context: {
          memberId: testMemberId,
          role: "member",
          workspaceId: otherWorkspaceId,
        },
        threads: [
          makeThread({
            channelId: "channel-foreign",
            id: "thread-foreign",
            workspaceId: otherWorkspaceId,
          }),
        ],
        workspace: { ...testWorkspace, id: otherWorkspaceId },
      });

      const enumerated = unwrapOk(await home.listWorkspaceThreadAddresses());

      expect(enumerated.addresses.map((address) => address.threadId)).toEqual([
        threadId("thread-home"),
      ]);
    });
  });

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

      const data = await makeTenantDataAccess({
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
      const data = await makeTenantDataAccess({
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

  describe("TenantDataAccess.listMembers — workspace roster (E8.6, ADR 0008)", () => {
    test("returns memberId + display name for each member of the acting workspace", async () => {
      const data = await makeTenantDataAccess({
        context: testTenantContext,
        members: [
          makeWorkspaceMember({
            displayName: "Ada Lovelace",
            memberId: "member-1",
          }),
          makeWorkspaceMember({
            displayName: "Alan Turing",
            memberId: "member-2",
          }),
        ],
        workspace: testWorkspace,
      });

      const roster = unwrapOk(await data.listMembers());

      expect(roster.workspaceId).toEqual(testWorkspaceId);
      expect(
        roster.members
          .map((profile) => ({
            displayName: profile.displayName,
            memberId: profile.memberId,
          }))
          .toSorted((left, right) => left.memberId.localeCompare(right.memberId))
      ).toEqual([
        { displayName: "Ada Lovelace", memberId: memberId("member-1") },
        { displayName: "Alan Turing", memberId: memberId("member-2") },
      ]);
    });

    test("fails closed on tenancy: a member of another workspace is invisible", async () => {
      const data = await makeTenantDataAccess({
        context: testTenantContext,
        members: [
          makeWorkspaceMember({
            displayName: "Home Member",
            memberId: "member-1",
          }),
          makeWorkspaceMember({
            displayName: "Foreign Member",
            memberId: "member-foreign",
            userId: "user-foreign",
            workspaceId: otherWorkspaceId,
          }),
        ],
        workspace: testWorkspace,
      });

      const roster = unwrapOk(await data.listMembers());

      expect(roster.members.map((profile) => profile.memberId)).toEqual([
        memberId("member-1"),
      ]);
    });
  });

  describe("TenantDataAccess unread — clearing via delete_unread (ADR 0017/0027)", () => {
    test("delete_unread clears exactly the (member, thread) pair the member opened", async () => {
      const data = await makeTenantDataAccess({
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
      const data = await makeTenantDataAccess({
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
      expect(unwrapOk(await data.listWorkspaceToolDisables())).toEqual([
        disable,
      ]);

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

  describe("TenantDataAccess MCP registry — workspace servers + host allowlist (ADR 0002, E6.3)", () => {
    test("put_mcp_server round-trips through getMcpServer and listMcpServers", async () => {
      const data = await makeTenantDataAccess({
        context: testTenantContext,
        workspace: testWorkspace,
      });

      const server = makeMcpServer({ host: "mcp.example.com", id: "mcp-1" });
      unwrapOk(
        await data.batch({
          commands: [{ kind: "put_mcp_server", mcpServer: server }],
          workspaceId: testWorkspaceId,
        })
      );

      expect(
        unwrapOk(await data.getMcpServer({ mcpServerId: server.id }))
      ).toEqual(server);
      expect(unwrapOk(await data.listMcpServers())).toEqual([server]);
    });

    test("put_mcp_host_approval and delete_mcp_host_approval round-trip through the allowlist", async () => {
      const data = await makeTenantDataAccess({
        context: testTenantContext,
        workspace: testWorkspace,
      });

      const approval = makeMcpHostApproval({ host: "mcp.example.com" });
      unwrapOk(
        await data.batch({
          commands: [{ hostApproval: approval, kind: "put_mcp_host_approval" }],
          workspaceId: testWorkspaceId,
        })
      );
      expect(
        unwrapOk(
          await data.getMcpHostApproval({ host: mcpHost("mcp.example.com") })
        )
      ).toEqual(approval);
      expect(unwrapOk(await data.listMcpHostApprovals())).toEqual([approval]);

      unwrapOk(
        await data.batch({
          commands: [
            {
              host: mcpHost("mcp.example.com"),
              kind: "delete_mcp_host_approval",
            },
          ],
          workspaceId: testWorkspaceId,
        })
      );
      expect(unwrapOk(await data.listMcpHostApprovals())).toEqual([]);
      expect(
        unwrapOk(
          await data.getMcpHostApproval({ host: mcpHost("mcp.example.com") })
        )
      ).toBeNull();
    });

    test("delete_mcp_server drops the row from getMcpServer and listMcpServers", async () => {
      const data = await makeTenantDataAccess({
        context: testTenantContext,
        workspace: testWorkspace,
      });

      const server = makeMcpServer({ host: "mcp.example.com", id: "mcp-1" });
      unwrapOk(
        await data.batch({
          commands: [{ kind: "put_mcp_server", mcpServer: server }],
          workspaceId: testWorkspaceId,
        })
      );
      expect(unwrapOk(await data.listMcpServers())).toEqual([server]);

      unwrapOk(
        await data.batch({
          commands: [{ kind: "delete_mcp_server", mcpServerId: server.id }],
          workspaceId: testWorkspaceId,
        })
      );
      expect(unwrapOk(await data.listMcpServers())).toEqual([]);
      expect(
        unwrapOk(await data.getMcpServer({ mcpServerId: server.id }))
      ).toBeNull();
    });

    test("an unknown server id reads back as null, not a foreign-tenant leak", async () => {
      const data = await makeTenantDataAccess({
        context: testTenantContext,
        workspace: testWorkspace,
      });

      expect(
        unwrapOk(
          await data.getMcpServer({ mcpServerId: mcpServerId("absent") })
        )
      ).toBeNull();
    });
  });

  describe("TenantDataAccess.batch — create_thread_index is insert-if-absent (ADR 0034)", () => {
    test("creates the index row when no row exists for the thread id", async () => {
      const data = await makeTenantDataAccess({
        channels: [makeChannel({ id: "channel-1" })],
        context: testTenantContext,
        workspace: testWorkspace,
      });

      const thread = makeThread({ channelId: "channel-1", id: "thread-new" });
      const receipt = unwrapOk(
        await data.batch({
          commands: [{ kind: "create_thread_index", thread }],
          workspaceId: testWorkspaceId,
        })
      );
      expect(receipt.commandCount).toBe(1);

      const index = unwrapOk(
        await data.listChannelThreads({ channelId: channelId("channel-1") })
      );
      expect(index.threads).toEqual([thread]);
    });

    test("the thread's rootCommentId round-trips through create_thread_index → listChannelThreads (E8.4)", async () => {
      const data = await makeTenantDataAccess({
        channels: [makeChannel({ id: "channel-1" })],
        context: testTenantContext,
        workspace: testWorkspace,
      });

      const thread = makeThread({
        channelId: "channel-1",
        id: "thread-rooted",
        rootCommentId: "comment-opening",
      });
      unwrapOk(
        await data.batch({
          commands: [{ kind: "create_thread_index", thread }],
          workspaceId: testWorkspaceId,
        })
      );

      const index = unwrapOk(
        await data.listChannelThreads({ channelId: channelId("channel-1") })
      );
      expect(index.threads).toEqual([thread]);
      expect(index.threads[0]?.rootCommentId).toBe(commentId("comment-opening"));
    });

    test("a replayed creation leaves the existing row untouched — lastActivityAt cannot regress", async () => {
      const original = makeThread({
        channelId: "channel-1",
        id: "thread-1",
        lastActivityAt: new Date("2026-06-30T12:00:00Z"),
      });
      const data = await makeTenantDataAccess({
        channels: [makeChannel({ id: "channel-1" })],
        context: testTenantContext,
        threads: [original],
        workspace: testWorkspace,
      });

      const replay = makeThread({
        channelId: "channel-1",
        id: "thread-1",
        lastActivityAt: new Date("2026-06-30T09:00:00Z"),
      });
      unwrapOk(
        await data.batch({
          commands: [{ kind: "create_thread_index", thread: replay }],
          workspaceId: testWorkspaceId,
        })
      );

      const index = unwrapOk(
        await data.listChannelThreads({ channelId: channelId("channel-1") })
      );
      expect(index.threads).toEqual([original]);
    });
  });

  describe("TenantDataAccess.batch — tenant guard and atomicity (ADR 0009)", () => {
    test("rejects a batch addressed to a foreign workspace", async () => {
      const data = await makeTenantDataAccess({
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
      const data = await makeTenantDataAccess({
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
      const data = await makeTenantDataAccess({
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

      expect(unwrapOk(await data.getShape({ shapeId: shape.id }))).toEqual(
        shape
      );
      expect(
        unwrapOk(await data.getChannel({ channelId: channel.id }))
      ).toEqual(channel);
    });

    test("rejects a channel claiming a shape already owned by another channel", async () => {
      const data = await makeTenantDataAccess({
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
      const data = await makeTenantDataAccess({
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
      const data = await makeTenantDataAccess({
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
      const data = await makeTenantDataAccess({
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

      const readBack = unwrapOk(
        await data.getShape({ shapeId: clonedShape.id })
      );
      expect(readBack?.clonedFrom).toEqual({
        channelId: sourceChannel.id,
        shapeId: shapeId("shape-source"),
      });
    });
  });
};
