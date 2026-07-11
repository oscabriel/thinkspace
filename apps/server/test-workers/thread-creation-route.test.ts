import {
  channelId as brandChannelId,
  unwrapOk,
} from "@thinkspace/domain/testing";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { signUpWithWorkspace } from "./auth-fixtures";
import { seedChannel } from "./channel-fixtures";

const putThread = (input: {
  readonly body: unknown;
  readonly channelId: string;
  readonly cookie?: string;
  readonly threadId: string;
  readonly workspaceId: string;
}) =>
  SELF.fetch(
    `https://test.local/api/w/${input.workspaceId}/channels/${input.channelId}/threads/${input.threadId}`,
    {
      body: JSON.stringify(input.body),
      headers: {
        "content-type": "application/json",
        ...(input.cookie === undefined ? {} : { cookie: input.cookie }),
      },
      method: "PUT",
    }
  );

describe("PUT /api/w/:workspaceId/channels/:channelId/threads/:threadId", () => {
  it("creates a thread from a member's gesture and returns the ThreadCreation receipt", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "creator@example.com",
      slug: "creator-space",
    });
    const tenantDataAccess = await seedChannel({
      channelId: "route-ch-1",
      memberId,
      shapeId: "route-shape-1",
      workspaceId,
    });

    const response = await putThread({
      body: {
        openingBody: "Summarize our launch options",
        openingCommentId: "route-comment-1",
      },
      channelId: "route-ch-1",
      cookie,
      threadId: "route-th-1",
      workspaceId,
    });

    expect(response.status).toBe(200);
    const receipt = await response.json<{
      openingComment: Record<string, unknown>;
      shapeSnapshot: Record<string, unknown>;
      thread: Record<string, unknown>;
    }>();
    expect(receipt.thread).toMatchObject({
      channelId: "route-ch-1",
      createdByMemberId: memberId,
      id: "route-th-1",
      lifecycle: { state: "active" },
      name: "Summarize our launch options",
      workspaceId,
    });
    expect(receipt.openingComment).toMatchObject({
      author: { kind: "member", memberId },
      body: "Summarize our launch options",
      id: "route-comment-1",
      parent: { kind: "top_level" },
      threadId: "route-th-1",
    });
    expect(receipt.shapeSnapshot).toMatchObject({ shapeId: "route-shape-1" });

    // The gesture landed in the D1 thread index.
    const index = unwrapOk(
      await tenantDataAccess.listChannelThreads({
        channelId: brandChannelId("route-ch-1"),
      })
    );
    expect(index.threads.map((thread) => thread.id)).toEqual(["route-th-1"]);
  });

  it("replays of the same gesture converge: 200 again, no duplicate row (ADR 0034 §2)", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "replayer@example.com",
      slug: "replay-space",
    });
    const tenantDataAccess = await seedChannel({
      channelId: "replay-ch-1",
      memberId,
      shapeId: "replay-shape-1",
      workspaceId,
    });
    const gesture = {
      body: {
        openingBody: "Replay me",
        openingCommentId: "replay-comment-1",
      },
      channelId: "replay-ch-1",
      cookie,
      threadId: "replay-th-1",
      workspaceId,
    };

    const first = await putThread(gesture);
    const replay = await putThread(gesture);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    const replayReceipt = await replay.json<{
      thread: Record<string, unknown>;
    }>();
    expect(replayReceipt.thread["id"]).toBe("replay-th-1");

    const index = unwrapOk(
      await tenantDataAccess.listChannelThreads({
        channelId: brandChannelId("replay-ch-1"),
      })
    );
    expect(index.threads.map((thread) => thread.id)).toEqual(["replay-th-1"]);
  });

  it("rejects a gesture without a session as 401", async () => {
    const { memberId, workspaceId } = await signUpWithWorkspace({
      email: "no-session@example.com",
      slug: "no-session-space",
    });
    await seedChannel({
      channelId: "ns-ch-1",
      memberId,
      shapeId: "ns-shape-1",
      workspaceId,
    });

    const response = await putThread({
      body: { openingBody: "Hello", openingCommentId: "ns-comment-1" },
      channelId: "ns-ch-1",
      threadId: "ns-th-1",
      workspaceId,
    });

    expect(response.status).toBe(401);
  });

  it("answers a non-member's gesture with 404, not 403 (invisibility-as-nonexistence)", async () => {
    const outsider = await signUpWithWorkspace({
      email: "route-outsider@example.com",
      slug: "route-outsider-space",
    });
    const resident = await signUpWithWorkspace({
      email: "route-resident@example.com",
      slug: "route-resident-space",
    });
    await seedChannel({
      channelId: "nm-ch-1",
      memberId: resident.memberId,
      shapeId: "nm-shape-1",
      workspaceId: resident.workspaceId,
    });

    const response = await putThread({
      body: { openingBody: "Hello", openingCommentId: "nm-comment-1" },
      channelId: "nm-ch-1",
      cookie: outsider.cookie,
      threadId: "nm-th-1",
      workspaceId: resident.workspaceId,
    });

    expect(response.status).toBe(404);
  });

  it("rejects a gesture whose body fails the brand parse as 400", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "bad-body@example.com",
      slug: "bad-body-space",
    });
    await seedChannel({
      channelId: "bb-ch-1",
      memberId,
      shapeId: "bb-shape-1",
      workspaceId,
    });

    const response = await putThread({
      body: { openingBody: "No opening comment id" },
      channelId: "bb-ch-1",
      cookie,
      threadId: "bb-th-1",
      workspaceId,
    });

    expect(response.status).toBe(400);
  });

  it("answers a gesture at a channel the workspace does not hold with 404", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "no-channel@example.com",
      slug: "no-channel-space",
    });

    const response = await putThread({
      body: { openingBody: "Hello", openingCommentId: "nc-comment-1" },
      channelId: "nc-ch-never-created",
      cookie,
      threadId: "nc-th-1",
      workspaceId,
    });

    expect(response.status).toBe(404);
  });
});
