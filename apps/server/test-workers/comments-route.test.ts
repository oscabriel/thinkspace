import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  addWorkspaceMember,
  signUpUser,
  signUpWithWorkspace,
} from "./auth-fixtures";
import { seedChannel } from "./channel-fixtures";

const gestureId = "01980d13-93a2-7000-8000-000000000000";
const replyGestureId = "01980d13-93a2-7000-8000-000000000001";

const commentsUrl = (input: {
  readonly channelId: string;
  readonly threadId: string;
  readonly workspaceId: string;
}) =>
  `https://test.local/api/w/${input.workspaceId}/channels/${input.channelId}/threads/${input.threadId}/comments`;

/** Creates a thread via the PUT create gesture (no ask — no model routing involved). */
const createThread = (input: {
  readonly channelId: string;
  readonly cookie: string;
  readonly openingCommentId: string;
  readonly threadId: string;
  readonly workspaceId: string;
}) =>
  SELF.fetch(
    `https://test.local/api/w/${input.workspaceId}/channels/${input.channelId}/threads/${input.threadId}`,
    {
      body: JSON.stringify({
        openingBody: "Kick off the thread",
        openingCommentId: input.openingCommentId,
      }),
      headers: { "content-type": "application/json", cookie: input.cookie },
      method: "PUT",
    }
  );

describe("POST /api/w/:workspaceId/channels/:channelId/threads/:threadId/comments", () => {
  it("appends a member reply and returns the nested comment (E8.4)", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "comment-happy@example.com",
      slug: "comment-happy-space",
    });
    await seedChannel({
      channelId: "ch-ch-1",
      memberId,
      shapeId: "ch-shape-1",
      workspaceId,
    });
    const created = await createThread({
      channelId: "ch-ch-1",
      cookie,
      openingCommentId: "ch-comment-open",
      threadId: "ch-th-1",
      workspaceId,
    });
    expect(created.status).toBe(200);

    const response = await SELF.fetch(
      commentsUrl({ channelId: "ch-ch-1", threadId: "ch-th-1", workspaceId }),
      {
        body: JSON.stringify({
          body: "A follow-up thought",
          commentId: "ch-comment-reply",
          gestureId: replyGestureId,
          parentCommentId: "ch-comment-open",
        }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      author: { kind: "member", memberId },
      body: "A follow-up thought",
      id: "ch-comment-reply",
      parent: { kind: "nested", parentCommentId: "ch-comment-open" },
      threadId: "ch-th-1",
      workspaceId,
    });
  });

  it("rejects an unauthenticated append with 401", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "comment-401@example.com",
      slug: "comment-401-space",
    });
    await seedChannel({
      channelId: "un-ch-1",
      memberId,
      shapeId: "un-shape-1",
      workspaceId,
    });
    await createThread({
      channelId: "un-ch-1",
      cookie,
      openingCommentId: "un-comment-open",
      threadId: "un-th-1",
      workspaceId,
    });

    const response = await SELF.fetch(
      commentsUrl({ channelId: "un-ch-1", threadId: "un-th-1", workspaceId }),
      {
        body: JSON.stringify({
          body: "No cookie here",
          commentId: "un-comment-reply",
          gestureId: replyGestureId,
          parentCommentId: "un-comment-open",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }
    );

    expect(response.status).toBe(401);
  });

  it("answers an append at a channel the workspace does not hold with 404", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "comment-cross-tenant@example.com",
      slug: "comment-cross-tenant-space",
    });

    const response = await SELF.fetch(
      commentsUrl({
        channelId: "ct-ch-never",
        threadId: "ct-th-1",
        workspaceId,
      }),
      {
        body: JSON.stringify({
          body: "Into the void",
          commentId: "ct-comment-reply",
          gestureId: replyGestureId,
          parentCommentId: "ct-comment-open",
        }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );

    expect(response.status).toBe(404);
  });

  it("hides a private channel from a non-owner member: the append is 404 (channel_not_visible)", async () => {
    const owner = await signUpWithWorkspace({
      email: "comment-private-owner@example.com",
      slug: "comment-private-space",
    });
    await seedChannel({
      channelId: "pv-ch-1",
      memberId: owner.memberId,
      shapeId: "pv-shape-1",
      visibility: { kind: "private" },
      workspaceId: owner.workspaceId,
    });
    await createThread({
      channelId: "pv-ch-1",
      cookie: owner.cookie,
      openingCommentId: "pv-comment-open",
      threadId: "pv-th-1",
      workspaceId: owner.workspaceId,
    });

    // A second member of the same workspace who does not own the private channel.
    const outsider = await signUpUser({
      email: "comment-private-outsider@example.com",
    });
    await addWorkspaceMember({
      role: "member",
      userId: outsider.userId,
      workspaceId: owner.workspaceId,
    });

    const response = await SELF.fetch(
      commentsUrl({
        channelId: "pv-ch-1",
        threadId: "pv-th-1",
        workspaceId: owner.workspaceId,
      }),
      {
        body: JSON.stringify({
          body: "Can I see this?",
          commentId: "pv-comment-reply",
          gestureId: replyGestureId,
          parentCommentId: "pv-comment-open",
        }),
        headers: {
          "content-type": "application/json",
          cookie: outsider.cookie,
        },
        method: "POST",
      }
    );

    expect(response.status).toBe(404);
  });

  it("rejects a reply to a parent not in the thread with 404 (comment_parent_not_in_thread)", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "comment-orphan@example.com",
      slug: "comment-orphan-space",
    });
    await seedChannel({
      channelId: "or-ch-1",
      memberId,
      shapeId: "or-shape-1",
      workspaceId,
    });
    await createThread({
      channelId: "or-ch-1",
      cookie,
      openingCommentId: "or-comment-open",
      threadId: "or-th-1",
      workspaceId,
    });

    const response = await SELF.fetch(
      commentsUrl({ channelId: "or-ch-1", threadId: "or-th-1", workspaceId }),
      {
        body: JSON.stringify({
          body: "Reply to a ghost",
          commentId: "or-comment-reply",
          gestureId: replyGestureId,
          parentCommentId: "or-comment-ghost",
        }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { kind: "comment_parent_not_in_thread" },
    });
  });

  it("rejects an append missing its gestureId as 400", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "comment-400@example.com",
      slug: "comment-400-space",
    });
    await seedChannel({
      channelId: "bd-ch-1",
      memberId,
      shapeId: "bd-shape-1",
      workspaceId,
    });
    await createThread({
      channelId: "bd-ch-1",
      cookie,
      openingCommentId: "bd-comment-open",
      threadId: "bd-th-1",
      workspaceId,
    });

    const response = await SELF.fetch(
      commentsUrl({ channelId: "bd-ch-1", threadId: "bd-th-1", workspaceId }),
      {
        body: JSON.stringify({
          body: "No gesture id",
          commentId: "bd-comment-reply",
          parentCommentId: "bd-comment-open",
        }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );

    expect(response.status).toBe(400);
  });
});
