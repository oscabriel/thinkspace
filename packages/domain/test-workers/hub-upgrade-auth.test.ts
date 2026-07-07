import { env } from "cloudflare:test";
import type { JWTPayload } from "jose";
import { importJWK, SignJWT } from "jose";
import { describe, expect, test } from "vitest";

import {
  createProductionChannelHub,
  createProductionWorkspaceHub,
  encodeChannelHubName,
  encodeWorkspaceHubName,
  HUB_UPGRADE_REJECT_CODE,
} from "../src/adapters/production";
import type { TenantContext } from "../src/seams/tenant-data-access";
import { channelId, memberId, runId, threadId, workspaceId } from "../src/testing";

/**
 * E4.2 (baked decision 5): the hub verifies a better-auth-minted JWT at the WS upgrade
 * against the auth origin's JWKS (served here by the outbound mock at auth.test.local) and
 * matches its claims to the hub's own decoded address. These pins mint tokens with the
 * private half of the fixed Ed25519 keypair whose public half the mock publishes.
 */

// Private half of the outbound mock's published JWKS key (test-workers/outbound-mock.mjs).
const privateJwk = {
  alg: "EdDSA",
  crv: "Ed25519",
  d: "jgjJqUeBzticO6QZsM5d-iGPGbTtY9WbMFJ5FtkueLY",
  kid: "hub-test-key-1",
  kty: "OKP",
  x: "J8wEBy_lq4XDHlbgX7rIgZ8oS_LFYm9Xffjl848l2HY",
};

const context = (ws: string): TenantContext => ({
  memberId: memberId("hub-auth-member-1"),
  role: "member",
  workspaceId: workspaceId(ws),
});

const claimsFor = (ctx: TenantContext): JWTPayload => ({
  memberId: ctx.memberId,
  role: ctx.role,
  sub: ctx.memberId,
  workspaceId: ctx.workspaceId,
});

const mintToken = async (
  claims: JWTPayload,
  expiration: number | string
): Promise<string> => {
  const key = await importJWK(privateJwk, "EdDSA");
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "EdDSA", kid: privateJwk.kid })
    .setIssuedAt()
    .setExpirationTime(expiration)
    .sign(key);
};

/** Open a WS upgrade to a named hub DO. partyserver always returns 101; rejection is a close. */
const openSocket = async (
  namespace: DurableObjectNamespace,
  name: string,
  token: string
): Promise<WebSocket> => {
  const stub = namespace.get(namespace.idFromName(name));
  const url = `https://hub.test.local/?token=${encodeURIComponent(token)}`;
  const response = await stub.fetch(url, {
    headers: { Upgrade: "websocket" },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) {
    throw new Error("expected a WebSocket on the upgrade response");
  }
  socket.accept();
  return socket;
};

// Resolves on the first non-protocol (broadcast event) message; rejects if the socket closes.
const nextEvent = (socket: WebSocket): Promise<unknown> =>
  new Promise((resolve, reject) => {
    socket.addEventListener("message", (message) => {
      const data = JSON.parse(String(message.data)) as { type?: unknown };
      if (typeof data.type === "string" && data.type.startsWith("cf_agent_")) {
        return;
      }
      resolve(data);
    });
    socket.addEventListener("close", (event) =>
      reject(new Error(`socket closed with ${event.code}`))
    );
  });

const nextClose = (socket: WebSocket): Promise<number> =>
  new Promise((resolve) => {
    socket.addEventListener("close", (event) => resolve(event.code));
  });

describe("E4.2 — hub verifies the connect JWT at WS upgrade (baked decision 5)", () => {
  test("a valid token connects and receives events published to its channel hub", async () => {
    const ctx = context("hub-auth-valid-ws");
    const address = { channelId: channelId("hub-auth-valid-ch") };
    const name = encodeChannelHubName(ctx, address);
    const token = await mintToken(claimsFor(ctx), "5m");

    const socket = await openSocket(env.CHANNEL_HUB, name, token);
    const received = nextEvent(socket);

    const hub = createProductionChannelHub({
      address,
      context: ctx,
      namespace: env.CHANNEL_HUB,
    });
    const event = {
      kind: "run_lifecycle_changed" as const,
      runId: runId("hub-auth-run-1"),
      threadId: threadId("hub-auth-th-1"),
    };
    const publish = await hub.publishEvent(event);
    expect(publish.ok).toBe(true);

    expect(await received).toEqual(event);
  });

  test("a token for another workspace is rejected with a 4401 close", async () => {
    const hubCtx = context("hub-auth-ws-a");
    const address = { channelId: channelId("hub-auth-ch-shared") };
    const name = encodeChannelHubName(hubCtx, address);
    // Token names a *different* workspace than the hub the client is dialing.
    const token = await mintToken(claimsFor(context("hub-auth-ws-b")), "5m");

    const socket = await openSocket(env.CHANNEL_HUB, name, token);

    expect(await nextClose(socket)).toBe(HUB_UPGRADE_REJECT_CODE);
  });

  test("an expired token is rejected with a 4401 close", async () => {
    const ctx = context("hub-auth-expired-ws");
    const name = encodeWorkspaceHubName(ctx);
    const token = await mintToken(
      claimsFor(ctx),
      Math.floor(Date.now() / 1000) - 60
    );

    const socket = await openSocket(env.WORKSPACE_HUB, name, token);

    expect(await nextClose(socket)).toBe(HUB_UPGRADE_REJECT_CODE);
  });
});
