import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, test } from "vitest";

import type { WorkspaceHubDurableObject } from "../src/adapters/production";
import {
  createD1TenantDataAccess,
  createProductionThreadAgentDirectory,
  createProductionWorkspaceHub,
  encodeWorkspaceHubName,
} from "../src/adapters/production";
import { createThreadCreationFlow } from "../src/flows/thread-creation";
import { commentBodySchema } from "../src/primitives";
import type { RunTrigger } from "../src/run";
import type { TenantContext } from "../src/seams/tenant-data-access";
import type { ThreadAgentAddress } from "../src/seams/thread-agent";
import {
  channelId,
  commentId,
  makeChannel,
  makeShape,
  memberId,
  threadId,
  unwrapErr,
  unwrapOk,
  workspaceId,
} from "../src/testing";
import { threadSchema } from "../src/thread";

/**
 * ADR 0034's designed half-crash, pinned over the production binders: the D1 index row
 * exists but the agent is empty. Dispatching fails closed; replaying the same creation
 * gesture heals it without touching the row.
 */
describe("thread creation over production adapters (ADR 0034 binder)", () => {
  test("row present + empty agent: runs fail closed, replaying create() heals, the row survives untouched", async () => {
    const address: ThreadAgentAddress = {
      channelId: channelId("tc-ch-1"),
      threadId: threadId("tc-th-1"),
      workspaceId: workspaceId("tc-ws-1"),
    };
    const member = memberId("tc-member-1");
    const context: TenantContext = {
      memberId: member,
      role: "member",
      workspaceId: address.workspaceId,
    };
    const tenantDataAccess = createD1TenantDataAccess({ context, db: env.DB });

    // Creation reads the channel and its live shape; both exist.
    const shape = {
      ...makeShape({ id: "tc-shape-1" }),
      workspaceId: address.workspaceId,
    };
    const channel = makeChannel({
      id: "tc-ch-1",
      ownerMemberId: member,
      shapeId: "tc-shape-1",
      workspaceId: address.workspaceId,
    });
    unwrapOk(
      await tenantDataAccess.batch({
        commands: [
          { kind: "put_shape", shape },
          { channel, kind: "put_channel" },
        ],
        workspaceId: address.workspaceId,
      })
    );

    // The half-crash: the crashed attempt got the index row written…
    const crashedRow = threadSchema.parse({
      channelId: address.channelId,
      createdAt: new Date("2026-07-04T11:00:00Z"),
      createdByMemberId: member,
      id: address.threadId,
      lastActivityAt: new Date("2026-07-04T11:00:00Z"),
      lifecycle: { state: "active" },
      name: "crashed attempt",
      workspaceId: address.workspaceId,
    });
    unwrapOk(
      await tenantDataAccess.batch({
        commands: [{ kind: "create_thread_index", thread: crashedRow }],
        workspaceId: address.workspaceId,
      })
    );

    // …and the agent stayed empty: it cannot mint runs.
    const directory = createProductionThreadAgentDirectory({
      namespace: env.THREAD_AGENT,
    });
    const agent = directory.get(address);
    const trigger: RunTrigger = {
      dispatch: {
        byMemberId: member,
        targetCommentId: commentId("tc-comment-opening"),
      },
      kind: "dispatch",
    };
    const failedClosed = unwrapErr(await agent.run(trigger));
    expect(failedClosed.kind).toBe("thread_agent_uninitialized");

    // The heal is the same gesture, replayed.
    const flow = createThreadCreationFlow({
      clock: () => new Date("2026-07-04T12:00:00Z"),
      tenantDataAccess,
      threadAgents: directory,
      workspaceHub: createProductionWorkspaceHub({
        context,
        namespace: env.WORKSPACE_HUB,
      }),
    });
    const healed = unwrapOk(
      await flow.create({
        channelId: address.channelId,
        openingBody: commentBodySchema.parse("Summarize our options"),
        openingCommentId: commentId("tc-comment-opening"),
        threadId: address.threadId,
      })
    );

    // Insert-if-absent: the crashed row is exactly what the index still holds.
    const index = unwrapOk(
      await tenantDataAccess.listChannelThreads({
        channelId: address.channelId,
      })
    );
    expect(index.threads).toEqual([crashedRow]);

    // The healed agent mints runs (queued only: the no-model gate holds until ModelRouter).
    const receipt = unwrapOk(await agent.run(trigger));
    expect(receipt.threadId).toBe(address.threadId);
    expect(receipt.queuedRun.lifecycle).toBe("queued");

    // The heal re-announced the bump on the workspace hub.
    const hubStub = env.WORKSPACE_HUB.get(
      env.WORKSPACE_HUB.idFromName(encodeWorkspaceHubName(context))
    );
    const activity = await runInDurableObject(
      hubStub,
      (instance: WorkspaceHubDurableObject) => instance.listRecentActivity()
    );
    expect(activity).toEqual([
      {
        bumpedAt: healed.thread.lastActivityAt,
        channelId: address.channelId,
        kind: "thread_bumped",
        threadId: address.threadId,
      },
    ]);
  });
});
