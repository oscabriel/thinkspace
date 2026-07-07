import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, test } from "vitest";

import type {
  ChannelHubDurableObject,
  WorkspaceHubDurableObject,
} from "../src/adapters/production/realtime-hubs";
import {
  createProductionChannelHub,
  createProductionWorkspaceHub,
} from "../src/adapters/production/realtime-hubs";
import type { TenantContext } from "../src/seams/tenant-data-access";
import {
  channelId,
  commentId,
  memberId,
  runId,
  threadId,
  unwrapErr,
  unwrapOk,
  workspaceId,
} from "../src/testing";

const context = (ws: string): TenantContext => ({
  memberId: memberId("hub-member-1"),
  role: "member",
  workspaceId: workspaceId(ws),
});

describe("Production realtime hubs — custom DOs, name is the tenant boundary (ADR 0010/0033)", () => {
  test("workspace activity published through the adapter lands in the workspace hub DO's recent log", async () => {
    const ctx = context("hub-ws-activity");
    const hub = createProductionWorkspaceHub({
      context: ctx,
      namespace: env.WORKSPACE_HUB,
    });
    const event = {
      bumpedAt: new Date("2026-07-01T12:00:00Z"),
      channelId: channelId("hub-ch-1"),
      kind: "thread_bumped" as const,
      threadId: threadId("hub-th-1"),
    };

    unwrapOk(await hub.publishActivity(event));

    const stub = env.WORKSPACE_HUB.get(
      env.WORKSPACE_HUB.idFromName(encodeURIComponent(ctx.workspaceId))
    );
    const events = await runInDurableObject(
      stub,
      (instance: WorkspaceHubDurableObject) => instance.listRecentActivity()
    );
    expect(events).toEqual([event]);
  });

  test("channel events published through the adapter land in the channel hub DO's recent log", async () => {
    const ctx = context("hub-ws-events");
    const address = { channelId: channelId("hub-ch-events") };
    const hub = createProductionChannelHub({
      address,
      context: ctx,
      namespace: env.CHANNEL_HUB,
    });
    const event = {
      kind: "run_lifecycle_changed" as const,
      runId: runId("run-hub-1"),
      threadId: threadId("hub-th-events"),
    };

    unwrapOk(await hub.publishEvent(event));

    const stub = env.CHANNEL_HUB.get(
      env.CHANNEL_HUB.idFromName(
        `${encodeURIComponent(ctx.workspaceId)}/${encodeURIComponent(address.channelId)}`
      )
    );
    const events = await runInDurableObject(
      stub,
      (instance: ChannelHubDurableObject) => instance.listRecentEvents()
    );
    expect(events).toEqual([event]);
  });

  test("channel hubs are tenant-isolated: same channel id in another workspace is a different DO", async () => {
    const address = { channelId: channelId("hub-ch-shared-name") };
    const hubA = createProductionChannelHub({
      address,
      context: context("hub-ws-a"),
      namespace: env.CHANNEL_HUB,
    });

    unwrapOk(
      await hubA.publishEvent({
        authorKind: "agent",
        commentId: commentId("comment-hub-a"),
        kind: "comment_added",
        threadId: threadId("hub-th-a"),
      })
    );

    const otherStub = env.CHANNEL_HUB.get(
      env.CHANNEL_HUB.idFromName(
        `${encodeURIComponent("hub-ws-b")}/${encodeURIComponent(address.channelId)}`
      )
    );
    const otherEvents = await runInDurableObject(
      otherStub,
      (instance: ChannelHubDurableObject) => instance.listRecentEvents()
    );
    expect(otherEvents).toEqual([]);
  });

  test("unpinned hub reads fail closed with not_implemented (extend contract-first)", async () => {
    const workspaceHub = createProductionWorkspaceHub({
      context: context("hub-ws-unpinned"),
      namespace: env.WORKSPACE_HUB,
    });
    const channelHub = createProductionChannelHub({
      address: { channelId: channelId("hub-ch-unpinned") },
      context: context("hub-ws-unpinned"),
      namespace: env.CHANNEL_HUB,
    });

    expect(unwrapErr(await workspaceHub.getRoster()).kind).toBe(
      "not_implemented"
    );
    expect(unwrapErr(await channelHub.getPresence()).kind).toBe(
      "not_implemented"
    );
  });
});
