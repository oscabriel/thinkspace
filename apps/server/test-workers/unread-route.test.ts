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

/**
 * E7.4 / ADR 0027: the edge clears the acting member's unread when they open a thread. The
 * member comes from the resolved TenantContext, never the wire.
 */

const base = (workspaceId: string) => `https://test.local/api/w/${workspaceId}`;

const seedThreadWithUnread = async (input: {
  readonly channelId: string;
  readonly memberId: string;
  readonly shapeId: string;
  readonly threadId: string;
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
      ownerMemberId: brandMemberId(input.memberId),
      shapeId: input.shapeId,
    }),
    workspaceId,
  };
  unwrapOk(
    await tenantDataAccess.batch({
      commands: [
        { kind: "put_shape", shape },
        { channel, kind: "put_channel" },
        {
          kind: "put_thread_index",
          thread: {
            ...makeThread({
              channelId: input.channelId,
              id: input.threadId,
              lastActivityAt: new Date("2026-06-30T12:00:00Z"),
            }),
            workspaceId,
          },
        },
        {
          kind: "put_unread",
          unread: {
            ...makeUnread({ threadId: input.threadId }),
            memberId: brandMemberId(input.memberId),
            workspaceId,
          },
        },
      ],
      workspaceId,
    })
  );
};

describe("POST /api/w/:workspaceId/threads/:threadId/read (E7.4)", () => {
  it("clears the acting member's unread for the thread", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "unread-clear@example.com",
      slug: "unread-clear-space",
    });
    await seedThreadWithUnread({
      channelId: "uc-ch-1",
      memberId,
      shapeId: "uc-shape-1",
      threadId: "uc-th-1",
      workspaceId,
    });

    const before = await SELF.fetch(`${base(workspaceId)}/unread`, {
      headers: { cookie },
    });
    expect(
      (await before.json<{ unread: { threadId: string }[] }>()).unread.map(
        (row) => row.threadId
      )
    ).toEqual(["uc-th-1"]);

    const cleared = await SELF.fetch(
      `${base(workspaceId)}/threads/uc-th-1/read`,
      { headers: { cookie }, method: "POST" }
    );
    expect(cleared.status).toBe(200);

    const after = await SELF.fetch(`${base(workspaceId)}/unread`, {
      headers: { cookie },
    });
    expect(
      (await after.json<{ unread: { threadId: string }[] }>()).unread
    ).toEqual([]);
  });

  it("rejects a clear without a session as 401", async () => {
    const { memberId, workspaceId } = await signUpWithWorkspace({
      email: "unread-clear-nosession@example.com",
      slug: "unread-clear-nosession-space",
    });
    await seedThreadWithUnread({
      channelId: "uc-ch-2",
      memberId,
      shapeId: "uc-shape-2",
      threadId: "uc-th-2",
      workspaceId,
    });

    const response = await SELF.fetch(
      `${base(workspaceId)}/threads/uc-th-2/read`,
      { method: "POST" }
    );
    expect(response.status).toBe(401);
  });
});
