import {
  createD1TenantDataAccess,
  HUB_UPGRADE_REJECT_CODE,
} from "@thinkspace/domain/adapters/production";
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

/**
 * E7.4: the edge proxies a browser WS upgrade to the ChannelHubDurableObject. partyserver
 * always answers an upgrade with 101 and rejects by *closing* the socket (baked decision 5),
 * so "the upgrade reached the DO" is provable two ways: the 101 status, and — with no connect
 * token — the DO's own auth gate closing it with 4401. A malformed/foreign address never
 * reaches a hub: a bad channel id 404s at the route, a foreign workspace 404s at the tenant
 * middleware.
 */

const base = (workspaceId: string) => `https://test.local/api/w/${workspaceId}`;

const seedChannel = async (input: {
  readonly channelId: string;
  readonly memberId: string;
  readonly shapeId: string;
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
      ],
      workspaceId,
    })
  );
};

const openUpgrade = (url: string, cookie?: string) =>
  SELF.fetch(url, {
    headers: {
      Upgrade: "websocket",
      ...(cookie === undefined ? {} : { cookie }),
    },
  });

const nextClose = (socket: WebSocket): Promise<number> =>
  new Promise((resolve) => {
    socket.addEventListener("close", (event) => resolve(event.code));
  });

describe("GET /api/w/:workspaceId/channels/:channelId/ws (E7.4)", () => {
  it("forwards the upgrade to the channel hub DO (101), which closes an unauthenticated socket with 4401", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "hub-ws-happy@example.com",
      slug: "hub-ws-happy-space",
    });
    await seedChannel({
      channelId: "hw-ch-1",
      memberId,
      shapeId: "hw-shape-1",
      workspaceId,
    });

    const response = await openUpgrade(
      `${base(workspaceId)}/channels/hw-ch-1/ws`,
      cookie
    );

    // partyserver returns 101 for any upgrade — the DO handled it (the edge cannot mint a 101).
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    if (!socket) {
      throw new Error("expected a WebSocket on the upgrade response");
    }
    socket.accept();
    // No `?token=` was supplied, so the hub's own auth gate closes the socket with 4401 —
    // proof the request reached the ChannelHubDurableObject, not just the edge.
    expect(await nextClose(socket)).toBe(HUB_UPGRADE_REJECT_CODE);
  });

  it("rejects a non-upgrade request with 426", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "hub-ws-noupgrade@example.com",
      slug: "hub-ws-noupgrade-space",
    });
    await seedChannel({
      channelId: "hw-ch-2",
      memberId,
      shapeId: "hw-shape-2",
      workspaceId,
    });

    const response = await SELF.fetch(
      `${base(workspaceId)}/channels/hw-ch-2/ws`,
      { headers: { cookie } }
    );
    expect(response.status).toBe(426);
  });

  it("404s the upgrade for a workspace the caller is not a member of (tenant guard)", async () => {
    const { cookie } = await signUpWithWorkspace({
      email: "hub-ws-outsider@example.com",
      slug: "hub-ws-outsider-space",
    });
    const other = await signUpWithWorkspace({
      email: "hub-ws-owner@example.com",
      slug: "hub-ws-owner-space",
    });
    await seedChannel({
      channelId: "hw-ch-3",
      memberId: other.memberId,
      shapeId: "hw-shape-3",
      workspaceId: other.workspaceId,
    });

    const response = await openUpgrade(
      `${base(other.workspaceId)}/channels/hw-ch-3/ws`,
      cookie
    );
    expect(response.status).toBe(404);
  });

  it("rejects an upgrade without a session as 401", async () => {
    const { memberId, workspaceId } = await signUpWithWorkspace({
      email: "hub-ws-nosession@example.com",
      slug: "hub-ws-nosession-space",
    });
    await seedChannel({
      channelId: "hw-ch-4",
      memberId,
      shapeId: "hw-shape-4",
      workspaceId,
    });

    const response = await openUpgrade(`${base(workspaceId)}/channels/hw-ch-4/ws`);
    expect(response.status).toBe(401);
  });
});
