import { createD1TenantDataAccess } from "@thinkspace/domain/adapters/production";
import {
  makeChannel,
  makeShape,
  memberId as brandMemberId,
  unwrapOk,
  workspaceId as brandWorkspaceId,
} from "@thinkspace/domain/testing";
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { signUpWithWorkspace } from "./auth-fixtures";

const gestureId = "01980d13-93a2-7000-8000-000000000000";

const dispatchUrl = (input: {
  readonly channelId: string;
  readonly threadId: string;
  readonly workspaceId: string;
}) =>
  `https://test.local/api/w/${input.workspaceId}/channels/${input.channelId}/threads/${input.threadId}/dispatch`;

const seedChannel = async (input: {
  readonly channelId: string;
  readonly memberId: string;
  readonly shapeId: string;
  readonly workspaceId: string;
}) => {
  const tenantDataAccess = createD1TenantDataAccess({
    context: {
      memberId: brandMemberId(input.memberId),
      role: "owner",
      workspaceId: brandWorkspaceId(input.workspaceId),
    },
    db: env.DB,
  });
  const shape = {
    ...makeShape({ id: input.shapeId }),
    workspaceId: brandWorkspaceId(input.workspaceId),
  };
  const channel = makeChannel({
    id: input.channelId,
    ownerMemberId: brandMemberId(input.memberId),
    shapeId: input.shapeId,
    workspaceId: brandWorkspaceId(input.workspaceId),
  });
  unwrapOk(
    await tenantDataAccess.batch({
      commands: [
        { kind: "put_shape", shape },
        { channel, kind: "put_channel" },
      ],
      workspaceId: brandWorkspaceId(input.workspaceId),
    })
  );
};

describe("POST /api/w/:workspaceId/channels/:channelId/threads/:threadId/dispatch", () => {
  it("rejects a dispatch without a gestureId as 400 — required on the wire from day one (ADR 0035 §7)", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "no-gesture-id@example.com",
      slug: "no-gesture-id-space",
    });

    const response = await SELF.fetch(
      dispatchUrl({ channelId: "dg-ch-1", threadId: "dg-th-1", workspaceId }),
      {
        body: JSON.stringify({ targetCommentId: "dg-comment-1" }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );

    expect(response.status).toBe(400);
  });

  it("answers a dispatch at a channel the workspace does not hold with 404", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "dispatch-no-channel@example.com",
      slug: "dispatch-no-channel-space",
    });

    const response = await SELF.fetch(
      dispatchUrl({
        channelId: "dnc-ch-never-created",
        threadId: "dnc-th-1",
        workspaceId,
      }),
      {
        body: JSON.stringify({ gestureId, targetCommentId: "dnc-comment-1" }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );

    expect(response.status).toBe(404);
  });

  /**
   * Pins where the production dispatch surface stops today: the flow composes and runs
   * up to the placeholder ToolResolver seam. This test MUST go red when the ModelRouter
   * slice lands — rewrite it into the dispatch happy path then (handoff step 4).
   */
  it("carries a well-formed dispatch to the placeholder tool-resolution seam (500 not_implemented)", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "dispatch-seam@example.com",
      slug: "dispatch-seam-space",
    });
    await seedChannel({
      channelId: "ds-ch-1",
      memberId,
      shapeId: "ds-shape-1",
      workspaceId,
    });

    const response = await SELF.fetch(
      dispatchUrl({ channelId: "ds-ch-1", threadId: "ds-th-1", workspaceId }),
      {
        body: JSON.stringify({ gestureId, targetCommentId: "ds-comment-1" }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        kind: "not_implemented",
        seam: "CatalogWorkspaceShapeToolResolver.resolve",
      },
    });
  });

  /** Same pin for "create and ask": the PUT's ask block chains into the same placeholder seam. */
  it("chains a create-and-ask PUT into the dispatch seam (500 not_implemented today)", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "create-and-ask@example.com",
      slug: "create-and-ask-space",
    });
    await seedChannel({
      channelId: "ca-ch-1",
      memberId,
      shapeId: "ca-shape-1",
      workspaceId,
    });

    const response = await SELF.fetch(
      `https://test.local/api/w/${workspaceId}/channels/ca-ch-1/threads/ca-th-1`,
      {
        body: JSON.stringify({
          ask: { gestureId },
          openingBody: "Create and ask",
          openingCommentId: "ca-comment-1",
        }),
        headers: { "content-type": "application/json", cookie },
        method: "PUT",
      }
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        kind: "not_implemented",
        seam: "CatalogWorkspaceShapeToolResolver.resolve",
      },
    });
  });
});
