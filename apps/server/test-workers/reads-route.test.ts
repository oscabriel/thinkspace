import { createD1TenantDataAccess } from "@thinkspace/domain/adapters/production";
import {
  makeChannel,
  makeShape,
  makeThread,
  makeUnread,
  memberId as brandMemberId,
  unwrapOk,
  workspaceId as brandWorkspaceId,
} from "@thinkspace/domain/testing";
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { signUpWithWorkspace } from "./auth-fixtures";
import { addWorkspaceMember, signUpUser } from "./auth-fixtures";

const base = (workspaceId: string) => `https://test.local/api/w/${workspaceId}`;

const get = (url: string, cookie?: string) =>
  SELF.fetch(url, { headers: cookie === undefined ? {} : { cookie } });

interface SeedThread {
  readonly id: string;
  readonly lastActivityAt: Date;
}

/** Seeds a channel (plus its live shape, threads and unread) through the real D1 write path. */
const seedChannel = async (input: {
  readonly channelId: string;
  readonly memberId: string;
  readonly ownerMemberId?: string;
  readonly shapeId: string;
  readonly threads?: readonly SeedThread[];
  readonly unreadThreadIds?: readonly string[];
  readonly visibility?: { readonly kind: "private" } | { readonly kind: "shared" };
  readonly workspaceId: string;
}) => {
  const workspaceId = brandWorkspaceId(input.workspaceId);
  const tenantDataAccess = createD1TenantDataAccess({
    context: {
      memberId: brandMemberId(input.memberId),
      role: "owner",
      workspaceId,
    },
    db: env.DB,
  });

  const shape = { ...makeShape({ id: input.shapeId }), workspaceId };
  const channel = {
    ...makeChannel({
      id: input.channelId,
      ownerMemberId: brandMemberId(input.ownerMemberId ?? input.memberId),
      shapeId: input.shapeId,
      visibility: input.visibility ?? { kind: "shared" },
    }),
    workspaceId,
  };

  unwrapOk(
    await tenantDataAccess.batch({
      commands: [
        { kind: "put_shape", shape },
        { channel, kind: "put_channel" },
        ...(input.threads ?? []).map(
          (thread) =>
            ({
              kind: "put_thread_index",
              thread: {
                ...makeThread({
                  channelId: input.channelId,
                  id: thread.id,
                  lastActivityAt: thread.lastActivityAt,
                }),
                workspaceId,
              },
            }) as const
        ),
        ...(input.unreadThreadIds ?? []).map(
          (threadId) =>
            ({
              kind: "put_unread",
              unread: {
                ...makeUnread({ threadId }),
                memberId: brandMemberId(input.memberId),
                workspaceId,
              },
            }) as const
        ),
      ],
      workspaceId,
    })
  );

  return tenantDataAccess;
};

describe("GET /api/w/:workspaceId read surface (E5.1)", () => {
  it("serves the workspace graph — the sidebar payload of visible channels", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "graph-reader@example.com",
      slug: "graph-reader-space",
    });
    await seedChannel({
      channelId: "gr-shared",
      memberId,
      shapeId: "gr-shape-1",
      workspaceId,
    });
    await seedChannel({
      channelId: "gr-own-private",
      memberId,
      shapeId: "gr-shape-2",
      visibility: { kind: "private" },
      workspaceId,
    });

    const response = await get(`${base(workspaceId)}/graph`, cookie);
    expect(response.status).toBe(200);
    const graph = await response.json<{
      channels: { channelId: string }[];
      workspaceId: string;
    }>();
    expect(graph.workspaceId).toBe(workspaceId);
    expect(graph.channels.map((entry) => entry.channelId).toSorted()).toEqual([
      "gr-own-private",
      "gr-shared",
    ]);
  });

  it("serves a channel's detail", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "channel-reader@example.com",
      slug: "channel-reader-space",
    });
    await seedChannel({
      channelId: "cr-ch-1",
      memberId,
      shapeId: "cr-shape-1",
      workspaceId,
    });

    const response = await get(
      `${base(workspaceId)}/channels/cr-ch-1`,
      cookie
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "cr-ch-1",
      ownerMemberId: memberId,
      visibility: { kind: "shared" },
      workspaceId,
    });
  });

  it("serves a channel's threads most-recent-activity first (the bump order)", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "threads-reader@example.com",
      slug: "threads-reader-space",
    });
    await seedChannel({
      channelId: "tr-ch-1",
      memberId,
      shapeId: "tr-shape-1",
      threads: [
        { id: "tr-oldest", lastActivityAt: new Date("2026-06-30T10:00:00Z") },
        { id: "tr-newest", lastActivityAt: new Date("2026-06-30T12:00:00Z") },
        { id: "tr-middle", lastActivityAt: new Date("2026-06-30T11:00:00Z") },
      ],
      workspaceId,
    });

    const response = await get(
      `${base(workspaceId)}/channels/tr-ch-1/threads`,
      cookie
    );
    expect(response.status).toBe(200);
    const index = await response.json<{ threads: { id: string }[] }>();
    expect(index.threads.map((thread) => thread.id)).toEqual([
      "tr-newest",
      "tr-middle",
      "tr-oldest",
    ]);
  });

  it("serves the home feed of bumped threads across visible channels", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "home-reader@example.com",
      slug: "home-reader-space",
    });
    await seedChannel({
      channelId: "hr-ch-1",
      memberId,
      shapeId: "hr-shape-1",
      threads: [
        { id: "hr-older", lastActivityAt: new Date("2026-06-30T10:00:00Z") },
        { id: "hr-newer", lastActivityAt: new Date("2026-06-30T12:00:00Z") },
      ],
      workspaceId,
    });

    const response = await get(
      `${base(workspaceId)}/home?limit=10`,
      cookie
    );
    expect(response.status).toBe(200);
    const feed = await response.json<{ threads: { id: string }[] }>();
    expect(feed.threads.map((thread) => thread.id)).toEqual([
      "hr-newer",
      "hr-older",
    ]);
  });

  it("serves the member's unread rows", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "unread-reader@example.com",
      slug: "unread-reader-space",
    });
    await seedChannel({
      channelId: "ur-ch-1",
      memberId,
      shapeId: "ur-shape-1",
      threads: [
        { id: "ur-th-1", lastActivityAt: new Date("2026-06-30T12:00:00Z") },
      ],
      unreadThreadIds: ["ur-th-1"],
      workspaceId,
    });

    const response = await get(`${base(workspaceId)}/unread`, cookie);
    expect(response.status).toBe(200);
    const body = await response.json<{ unread: { threadId: string }[] }>();
    expect(body.unread.map((row) => row.threadId)).toEqual(["ur-th-1"]);
  });

  it("serves the workspace member roster — memberId + display name (E8.6)", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "roster-owner@example.com",
      slug: "roster-owner-space",
    });
    const teammate = await signUpUser({ email: "roster-teammate@example.com" });
    const { memberId: teammateMemberId } = await addWorkspaceMember({
      role: "member",
      userId: teammate.userId,
      workspaceId,
    });

    const response = await get(`${base(workspaceId)}/members`, cookie);
    expect(response.status).toBe(200);
    const roster = await response.json<{
      members: { displayName: string; memberId: string }[];
      workspaceId: string;
    }>();
    expect(roster.workspaceId).toBe(workspaceId);
    expect(roster.members.map((profile) => profile.memberId).toSorted()).toEqual(
      [memberId, teammateMemberId].toSorted()
    );
    for (const profile of roster.members) {
      expect(profile.displayName).toBe("Test Member");
    }
  });

  it("rejects the roster read without a session as 401", async () => {
    const { workspaceId } = await signUpWithWorkspace({
      email: "roster-no-session@example.com",
      slug: "roster-no-session-space",
    });

    const response = await get(`${base(workspaceId)}/members`);
    expect(response.status).toBe(401);
  });

  it("answers the roster of a workspace the caller is not a member of with 404", async () => {
    const { workspaceId: foreignWorkspaceId } = await signUpWithWorkspace({
      email: "roster-foreign@example.com",
      slug: "roster-foreign-space",
    });
    const { cookie } = await signUpWithWorkspace({
      email: "roster-outsider@example.com",
      slug: "roster-outsider-space",
    });

    const response = await get(
      `${base(foreignWorkspaceId)}/members`,
      cookie
    );
    expect(response.status).toBe(404);
  });

  it("serves a branch snapshot from the thread DO after a creation gesture", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "branch-reader@example.com",
      slug: "branch-reader-space",
    });
    await seedChannel({
      channelId: "br-ch-1",
      memberId,
      shapeId: "br-shape-1",
      workspaceId,
    });

    const created = await SELF.fetch(
      `${base(workspaceId)}/channels/br-ch-1/threads/br-th-1`,
      {
        body: JSON.stringify({
          openingBody: "Open the branch",
          openingCommentId: "br-comment-1",
        }),
        headers: { "content-type": "application/json", cookie },
        method: "PUT",
      }
    );
    expect(created.status).toBe(200);

    const response = await get(
      `${base(workspaceId)}/channels/br-ch-1/threads/br-th-1/branches/br-comment-1`,
      cookie
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      branch: { rootCommentId: "br-comment-1", threadId: "br-th-1" },
      subtree: [{ id: "br-comment-1" }],
    });
  });

  it("joins the author's display name onto member comments in the branch read (E10.6)", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "author-name@example.com",
      slug: "author-name-space",
    });
    await seedChannel({
      channelId: "an-ch-1",
      memberId,
      shapeId: "an-shape-1",
      workspaceId,
    });

    const created = await SELF.fetch(
      `${base(workspaceId)}/channels/an-ch-1/threads/an-th-1`,
      {
        body: JSON.stringify({
          openingBody: "Name my author",
          openingCommentId: "an-comment-1",
        }),
        headers: { "content-type": "application/json", cookie },
        method: "PUT",
      }
    );
    expect(created.status).toBe(200);

    const response = await get(
      `${base(workspaceId)}/channels/an-ch-1/threads/an-th-1/branches/an-comment-1`,
      cookie
    );
    expect(response.status).toBe(200);
    const branch = await response.json<{
      subtree: {
        author: { displayName?: string; kind: string; memberId: string };
        id: string;
      }[];
    }>();
    const opening = branch.subtree.find((c) => c.id === "an-comment-1");
    expect(opening?.author).toMatchObject({
      displayName: "Test Member",
      kind: "member",
    });
  });

  it("degrades a member comment whose author left the workspace to no joined name (E10.6)", async () => {
    // The reader (owner) stays a member so the read passes, but the opening comment's author is
    // a member who has since left — their roster row is gone, so the join finds no name and the
    // author name is absent, letting the client fall back to "Member" rather than erroring.
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "ghost-reader@example.com",
      slug: "ghost-reader-space",
    });
    const author = await signUpUser({ email: "ghost-author@example.com" });
    const { memberId: authorMemberId } = await addWorkspaceMember({
      role: "member",
      userId: author.userId,
      workspaceId,
    });
    await seedChannel({
      channelId: "ga-ch-1",
      memberId,
      shapeId: "ga-shape-1",
      workspaceId,
    });

    // The author (a plain member) opens the branch in the shared channel — the opening comment
    // carries their memberId.
    const created = await SELF.fetch(
      `${base(workspaceId)}/channels/ga-ch-1/threads/ga-th-1`,
      {
        body: JSON.stringify({
          openingBody: "Who am I",
          openingCommentId: "ga-comment-1",
        }),
        headers: { "content-type": "application/json", cookie: author.cookie },
        method: "PUT",
      }
    );
    expect(created.status).toBe(200);

    // The author leaves the workspace: their roster row is dropped, so the join can no longer
    // name them. The comment persists in the DO with their memberId.
    await env.DB.prepare("DELETE FROM member WHERE id = ?1")
      .bind(authorMemberId)
      .run();

    const response = await get(
      `${base(workspaceId)}/channels/ga-ch-1/threads/ga-th-1/branches/ga-comment-1`,
      cookie
    );
    expect(response.status).toBe(200);
    const branch = await response.json<{
      subtree: {
        author: { displayName?: string; kind: string; memberId: string };
        id: string;
      }[];
    }>();
    const opening = branch.subtree.find((c) => c.id === "ga-comment-1");
    expect(opening?.author.memberId).toBe(authorMemberId);
    expect(opening?.author.kind).toBe("member");
    expect(opening?.author.displayName).toBeUndefined();
  });

  it("rejects a read without a session as 401", async () => {
    const { memberId, workspaceId } = await signUpWithWorkspace({
      email: "no-session-read@example.com",
      slug: "no-session-read-space",
    });
    await seedChannel({
      channelId: "ns-ch-1",
      memberId,
      shapeId: "ns-shape-1",
      workspaceId,
    });

    const response = await get(`${base(workspaceId)}/graph`);
    expect(response.status).toBe(401);
  });

  /**
   * ADR 0035 §4 fail-closed pin: a private channel a member does not own is invisible —
   * the read collapses to 404 (channel_not_visible), never 403, so a probe cannot tell an
   * unshared channel from one that does not exist. The edge must not weaken this domain pin.
   */
  it("answers a private channel a member cannot see with 404, not 403", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "private-probe@example.com",
      slug: "private-probe-space",
    });
    await seedChannel({
      channelId: "pv-ch-1",
      memberId,
      ownerMemberId: "pv-other-member",
      shapeId: "pv-shape-1",
      threads: [
        { id: "pv-th-1", lastActivityAt: new Date("2026-06-30T12:00:00Z") },
      ],
      visibility: { kind: "private" },
      workspaceId,
    });

    const detail = await get(`${base(workspaceId)}/channels/pv-ch-1`, cookie);
    expect(detail.status).toBe(404);

    const threads = await get(
      `${base(workspaceId)}/channels/pv-ch-1/threads`,
      cookie
    );
    expect(threads.status).toBe(404);

    const graph = await get(`${base(workspaceId)}/graph`, cookie);
    const body = await graph.json<{ channels: { channelId: string }[] }>();
    expect(body.channels.map((entry) => entry.channelId)).not.toContain(
      "pv-ch-1"
    );
  });
});
