import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, test, vi } from "vitest";

import type {
  ThreadAgentDurableObject,
  WorkspaceHubDurableObject,
} from "../src/adapters/production";
import {
  createD1TenantDataAccess,
  createProductionThreadAgentDirectory,
  createProductionWorkspaceHub,
  encodeWorkspaceHubName,
} from "../src/adapters/production";
import { encodeThreadAgentAddress } from "../src/adapters/thread-agent-address";
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
  runId,
  threadId,
  unwrapOk,
  workspaceId,
} from "../src/testing";
import { modelReplying } from "./mock-model";

/**
 * ADR 0035 §2: when no completion flow was injected (a fresh wake after hibernation),
 * the DO self-constructs it from env + its name-derived address and settles through the
 * real D1 adapter (under a SystemContext) and the real hub DOs. Test binders that DO
 * inject keep winning — the ??= never fires for them (round-trip acceptance pins that).
 */
describe("completion flow self-construction (ADR 0035 §2)", () => {
  test("a run settles with no injected flow: thread bumped, unread written, hub announced", async () => {
    const address: ThreadAgentAddress = {
      channelId: channelId("sc-ch-1"),
      threadId: threadId("sc-th-1"),
      workspaceId: workspaceId("sc-ws-1"),
    };
    const member = memberId("sc-member-1");
    const context: TenantContext = {
      memberId: member,
      role: "member",
      workspaceId: address.workspaceId,
    };
    const tenantDataAccess = createD1TenantDataAccess({ context, db: env.DB });

    unwrapOk(
      await tenantDataAccess.batch({
        commands: [
          {
            kind: "put_shape",
            shape: {
              ...makeShape({ id: "sc-shape-1" }),
              workspaceId: address.workspaceId,
            },
          },
          {
            channel: makeChannel({
              id: "sc-ch-1",
              ownerMemberId: member,
              shapeId: "sc-shape-1",
              workspaceId: address.workspaceId,
            }),
            kind: "put_channel",
          },
        ],
        workspaceId: address.workspaceId,
      })
    );

    const directory = createProductionThreadAgentDirectory({
      namespace: env.THREAD_AGENT,
    });
    const created = unwrapOk(
      await createThreadCreationFlow({
        clock: () => new Date("2026-07-05T00:00:00Z"),
        tenantDataAccess,
        threadAgents: directory,
        workspaceHub: createProductionWorkspaceHub({
          context,
          namespace: env.WORKSPACE_HUB,
        }),
      }).create({
        channelId: address.channelId,
        openingBody: commentBodySchema.parse("self-construct thread"),
        openingCommentId: commentId("sc-comment-opening"),
        threadId: address.threadId,
      })
    );

    // Only the model stub and run-id minter are injected — NOT the completion flow.
    const agentStub = env.THREAD_AGENT.get(
      env.THREAD_AGENT.idFromName(encodeThreadAgentAddress(address))
    );
    await runInDurableObject(
      agentStub,
      (instance: ThreadAgentDurableObject) => {
        instance.applyTestSeed({
          address,
          nextRunId: () => runId("sc-run-1"),
          testModel: modelReplying("Self-constructed settle."),
        });
      }
    );

    const agent = directory.get(address);
    const trigger: RunTrigger = {
      dispatch: {
        byMemberId: member,
        targetCommentId: created.openingComment.id,
      },
      kind: "dispatch",
    };
    const receipt = unwrapOk(await agent.run(trigger));

    const settled = await vi.waitFor(
      async () => {
        const detail = unwrapOk(await agent.getRun({ runId: receipt.runId }));
        if (detail?.run.lifecycle !== "complete") {
          throw new Error("run has not completed yet");
        }
        return detail.run;
      },
      { interval: 50, timeout: 5000 }
    );

    // The self-constructed flow wrote through the real D1 adapter…
    const index = unwrapOk(
      await tenantDataAccess.listChannelThreads({
        channelId: address.channelId,
      })
    );
    expect(index.threads).toEqual([
      { ...created.thread, lastActivityAt: settled.completedAt },
    ]);

    const unread = unwrapOk(
      await tenantDataAccess.listMemberUnread({ memberId: member })
    );
    expect(unread.map((row) => row.threadId)).toEqual([address.threadId]);

    // …and announced the bump on the real workspace hub. (Settle-side hub publishes are
    // fire-and-forget, so poll rather than read-once.)
    const hubStub = env.WORKSPACE_HUB.get(
      env.WORKSPACE_HUB.idFromName(encodeWorkspaceHubName(context))
    );
    await vi.waitFor(
      async () => {
        const activity = await runInDurableObject(
          hubStub,
          (instance: WorkspaceHubDurableObject) => instance.listRecentActivity()
        );
        expect(activity).toContainEqual({
          bumpedAt: settled.completedAt,
          channelId: address.channelId,
          kind: "thread_bumped",
          threadId: address.threadId,
        });
      },
      { interval: 50, timeout: 5000 }
    );
  });
});
