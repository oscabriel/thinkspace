import { describe, expect, test } from "bun:test";

import {
  createMemoryChannelHub,
  createMemoryTenantDataAccess,
  createMemoryThreadAgent,
  createMemoryThreadAgentDirectory,
  createMemoryWorkspaceHub,
} from "../src/adapters/memory";
import type { Channel } from "../src/channel";
import { createCommentAppendFlow } from "../src/flows/comment-append";
import { commentBodySchema } from "../src/primitives";
import type {
  ChannelHubEvent,
  WorkspaceActivityEvent,
} from "../src/seams/realtime-hubs";
import {
  commentId,
  gestureId,
  makeChannel,
  makeComment,
  makeShapeSnapshot,
  makeThread,
  memberId,
  testChannelId,
  testMemberId,
  testTenantContext,
  testThreadId,
  testWorkspace,
  testWorkspaceId,
  threadAgentAddress,
  unwrapErr,
  unwrapOk,
} from "../src/testing/fixtures";
import type { Comment } from "../src/thread";

const appendClock = () => new Date("2026-07-06T10:00:00Z");

/**
 * Composes the member-append spine (E8.4) over the memory adapters: an initialized thread
 * agent seeded with an opening comment, wired to a tenant-data-access + hubs the flow bumps.
 */
const makeAppendHarness = (input?: {
  readonly channel?: Channel;
  readonly comments?: readonly Comment[];
}) => {
  const channel = input?.channel ?? makeChannel({ id: "channel-1" });
  const publishedChannelEvents: ChannelHubEvent[] = [];
  const publishedActivity: WorkspaceActivityEvent[] = [];

  const tenantDataAccess = createMemoryTenantDataAccess({
    channels: [channel],
    context: testTenantContext,
    threads: [
      makeThread({
        channelId: "channel-1",
        id: "thread-1",
        rootCommentId: "comment-top",
      }),
    ],
    workspace: testWorkspace,
  });

  const agent = createMemoryThreadAgent({
    address: threadAgentAddress,
    comments: input?.comments ?? [
      makeComment({ id: "comment-top", memberId: "member-1" }),
    ],
    shapeSnapshot: makeShapeSnapshot(),
  });
  const threadAgents = createMemoryThreadAgentDirectory({ agents: [agent] });

  const flow = createCommentAppendFlow({
    channelHub: createMemoryChannelHub({
      address: { channelId: testChannelId },
      context: testTenantContext,
      onEvent: (event) => publishedChannelEvents.push(event),
    }),
    clock: appendClock,
    tenantDataAccess,
    threadAgents,
    workspaceHub: createMemoryWorkspaceHub({
      context: testTenantContext,
      onActivity: (event) => publishedActivity.push(event),
    }),
  });

  return {
    agent,
    flow,
    publishedActivity,
    publishedChannelEvents,
    tenantDataAccess,
  };
};

describe("Comment append flow — member reply appends + bumps (E8.4)", () => {
  test("appends the reply, bumps the thread, and fans comment_added + thread_bumped out", async () => {
    const harness = makeAppendHarness();

    const appended = unwrapOk(
      await harness.flow.append({
        body: commentBodySchema.parse("one more thing"),
        channelId: testChannelId,
        commentId: commentId("comment-reply"),
        gestureId: gestureId("gesture-append-1"),
        parentCommentId: commentId("comment-top"),
        threadId: testThreadId,
      })
    );

    expect(appended.id).toBe(commentId("comment-reply"));
    expect(appended.author).toEqual({ kind: "member", memberId: testMemberId });
    expect(appended.parent).toEqual({
      kind: "nested",
      parentCommentId: commentId("comment-top"),
    });

    const branch = unwrapOk(
      await harness.agent.loadBranch({
        rootCommentId: commentId("comment-top"),
      })
    );
    expect(branch.subtree.map((comment) => comment.id)).toContain(
      commentId("comment-reply")
    );

    const index = unwrapOk(
      await harness.tenantDataAccess.listChannelThreads({
        channelId: testChannelId,
      })
    );
    expect(
      index.threads.find((thread) => thread.id === testThreadId)?.lastActivityAt
    ).toEqual(appendClock());

    expect(harness.publishedChannelEvents).toEqual([
      {
        authorKind: "member",
        commentId: commentId("comment-reply"),
        kind: "comment_added",
        threadId: testThreadId,
      },
    ]);
    expect(harness.publishedActivity).toEqual([
      {
        bumpedAt: appendClock(),
        channelId: testChannelId,
        kind: "thread_bumped",
        threadId: testThreadId,
      },
    ]);
  });

  test("fans a co_participant_activity unread out to other participants, never to the author", async () => {
    const harness = makeAppendHarness({
      comments: [
        makeComment({ id: "comment-top", memberId: "member-1" }),
        makeComment({
          id: "comment-earlier",
          memberId: "member-2",
          parentCommentId: "comment-top",
        }),
      ],
    });

    // member-1 posts the reply, so member-1 must not badge themselves.
    unwrapOk(
      await harness.flow.append({
        body: commentBodySchema.parse("replying now"),
        channelId: testChannelId,
        commentId: commentId("comment-reply"),
        gestureId: gestureId("gesture-append-2"),
        parentCommentId: commentId("comment-top"),
        threadId: testThreadId,
      })
    );

    expect(
      unwrapOk(
        await harness.tenantDataAccess.listMemberUnread({
          memberId: memberId("member-2"),
        })
      )
    ).toEqual([
      {
        bumpedAt: appendClock(),
        memberId: memberId("member-2"),
        reasons: [
          {
            commentId: commentId("comment-reply"),
            kind: "co_participant_activity",
          },
        ],
        threadId: testThreadId,
        workspaceId: testWorkspaceId,
      },
    ]);
    expect(
      unwrapOk(
        await harness.tenantDataAccess.listMemberUnread({
          memberId: memberId("member-1"),
        })
      )
    ).toEqual([]);
  });

  test("a replay (same commentId) converges: one comment, the bump idempotent", async () => {
    const harness = makeAppendHarness();
    const gesture = {
      body: commentBodySchema.parse("one more thing"),
      channelId: testChannelId,
      commentId: commentId("comment-reply"),
      gestureId: gestureId("gesture-append-3"),
      parentCommentId: commentId("comment-top"),
      threadId: testThreadId,
    };

    unwrapOk(await harness.flow.append(gesture));
    unwrapOk(await harness.flow.append(gesture));

    const branch = unwrapOk(
      await harness.agent.loadBranch({
        rootCommentId: commentId("comment-top"),
      })
    );
    expect(
      branch.subtree.filter(
        (comment) => comment.id === commentId("comment-reply")
      )
    ).toHaveLength(1);
    const indexed = unwrapOk(
      await harness.tenantDataAccess.getThread({ threadId: testThreadId })
    );
    expect(indexed?.commentCount).toBe(2);
  });

  test("rejects a reply to a parent not in the thread with comment_parent_not_in_thread", async () => {
    const harness = makeAppendHarness();

    const error = unwrapErr(
      await harness.flow.append({
        body: commentBodySchema.parse("reply to nothing"),
        channelId: testChannelId,
        commentId: commentId("comment-reply"),
        gestureId: gestureId("gesture-append-4"),
        parentCommentId: commentId("comment-ghost"),
        threadId: testThreadId,
      })
    );

    expect(error.kind).toBe("comment_parent_not_in_thread");
    // Nothing bumped and no delta fanned out on the rejected append.
    expect(harness.publishedChannelEvents).toEqual([]);
    expect(harness.publishedActivity).toEqual([]);
  });

  test("appending into an archived channel fails channel_read_only and writes nothing", async () => {
    const harness = makeAppendHarness({
      channel: makeChannel({
        id: "channel-1",
        lifecycle: {
          archivedAt: new Date("2026-07-05T00:00:00Z"),
          state: "archived",
        },
      }),
    });

    const error = unwrapErr(
      await harness.flow.append({
        body: commentBodySchema.parse("too late"),
        channelId: testChannelId,
        commentId: commentId("comment-reply"),
        gestureId: gestureId("gesture-append-5"),
        parentCommentId: commentId("comment-top"),
        threadId: testThreadId,
      })
    );

    expect(error).toEqual({
      channelId: testChannelId,
      kind: "channel_read_only",
    });
    expect(harness.publishedChannelEvents).toEqual([]);
    expect(harness.publishedActivity).toEqual([]);
  });
});
