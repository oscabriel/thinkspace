import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, test, vi } from "vitest";

import type {
  ChannelHubDurableObject,
  ThreadAgentDurableObject,
  WorkspaceHubDurableObject,
} from "../src/adapters/production";
import {
  createD1TenantDataAccess,
  createProductionChannelHub,
  createProductionThreadAgentDirectory,
  createProductionWorkspaceHub,
  encodeChannelHubName,
  encodeWorkspaceHubName,
} from "../src/adapters/production";
import { encodeThreadAgentAddress } from "../src/adapters/thread-agent-address";
import { createRunCompletionFlow } from "../src/flows/run-completion";
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
 * The dispatch→completion round-trip acceptance bar: a real ThreadAgent DO (reached
 * through the production directory) executes a stubbed model turn as a Think submission;
 * the completion flow — built from the real D1 TenantDataAccess and the real hub DOs —
 * settles it. Everything below the model call is production code.
 *
 * The thread exists because ThreadCreationFlow created it (ADR 0034) — the same call the
 * HTTP edge will make.
 */
describe("dispatch→completion round trip (acceptance)", () => {
  test("a dispatched run completes: reply in the DO, D1 rows written, hub events observed", async () => {
    const address: ThreadAgentAddress = {
      channelId: channelId("rt-ch-1"),
      threadId: threadId("rt-th-1"),
      workspaceId: workspaceId("rt-ws-1"),
    };
    const member = memberId("rt-member-1");
    const context: TenantContext = {
      memberId: member,
      role: "member",
      workspaceId: address.workspaceId,
    };

    const tenantDataAccess = createD1TenantDataAccess({
      context,
      db: env.DB,
    });
    const completionFlow = createRunCompletionFlow({
      channelHub: createProductionChannelHub({
        address: { channelId: address.channelId },
        context,
        namespace: env.CHANNEL_HUB,
      }),
      tenantDataAccess,
      workspaceHub: createProductionWorkspaceHub({
        context,
        namespace: env.WORKSPACE_HUB,
      }),
    });

    // The channel and its live shape exist; ThreadCreationFlow creates the thread.
    const shape = {
      ...makeShape({ id: "rt-shape-1" }),
      workspaceId: address.workspaceId,
    };
    const channel = makeChannel({
      id: "rt-ch-1",
      ownerMemberId: member,
      shapeId: "rt-shape-1",
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

    const directory = createProductionThreadAgentDirectory({
      namespace: env.THREAD_AGENT,
    });
    const agent = directory.get(address);

    const created = unwrapOk(
      await createThreadCreationFlow({
        clock: () => new Date("2026-07-01T00:00:00Z"),
        tenantDataAccess,
        threadAgents: directory,
        workspaceHub: createProductionWorkspaceHub({
          context,
          namespace: env.WORKSPACE_HUB,
        }),
      }).create({
        channelId: address.channelId,
        openingBody: commentBodySchema.parse("round-trip thread"),
        openingCommentId: commentId("rt-comment-opening"),
        threadId: address.threadId,
      })
    );
    const { openingComment: opening, thread } = created;

    // Test capability: the model stub is injected in-isolate (ModelRouter pending). The
    // injected completion flow pins the override path — the DO's lazy self-construct
    // (ADR 0035 §2) never fires when a binder injects; the self-construct path has its
    // own pin in completion-self-construct.test.ts.
    const agentStub = env.THREAD_AGENT.get(
      env.THREAD_AGENT.idFromName(encodeThreadAgentAddress(address))
    );
    await runInDurableObject(
      agentStub,
      (instance: ThreadAgentDurableObject) => {
        instance.applyTestSeed({
          address,
          nextRunId: () => runId("rt-run-1"),
          testModel: modelReplying("Round trip reply."),
        });
        instance.completionFlow = completionFlow;
      }
    );

    const trigger: RunTrigger = {
      dispatch: { byMemberId: member, targetCommentId: opening.id },
      kind: "dispatch",
    };
    const receipt = unwrapOk(await agent.run(trigger));
    expect(receipt.runId).toBe(runId("rt-run-1"));

    // The DO settles the run.
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

    // 1. The reply lives in the DO's comment tree at the dispatch target.
    const branch = unwrapOk(
      await agent.loadBranch({ rootCommentId: opening.id })
    );
    const reply = branch.subtree.find(
      (comment) => comment.id === settled.outputCommentId
    );
    expect(reply?.body).toBe("Round trip reply.");

    // 2. D1: the thread index bumped to the completion time…
    const threads = unwrapOk(
      await tenantDataAccess.listChannelThreads({
        channelId: address.channelId,
      })
    );
    expect(threads.threads).toEqual([
      { ...thread, lastActivityAt: settled.completedAt },
    ]);

    // …and the dispatching member has an agent_output unread row.
    const unread = unwrapOk(
      await tenantDataAccess.listMemberUnread({ memberId: member })
    );
    expect(unread).toEqual([
      {
        bumpedAt: settled.completedAt,
        memberId: member,
        reasons: [
          {
            commentId: settled.outputCommentId,
            kind: "agent_output",
            runId: settled.id,
          },
        ],
        threadId: address.threadId,
        workspaceId: address.workspaceId,
      },
    ]);

    // 3. Hub events observed: channel hub announced the comment and the lifecycle turn…
    // (Settle-side hub publishes are fire-and-forget, so poll rather than read-once.)
    const channelHubStub = env.CHANNEL_HUB.get(
      env.CHANNEL_HUB.idFromName(
        encodeChannelHubName(context, { channelId: address.channelId })
      )
    );
    await vi.waitFor(
      async () => {
        const channelEvents = await runInDurableObject(
          channelHubStub,
          (instance: ChannelHubDurableObject) => instance.listRecentEvents()
        );
        expect(channelEvents).toEqual([
          {
            authorKind: "agent",
            commentId: settled.outputCommentId,
            kind: "comment_added",
            threadId: address.threadId,
          },
          {
            kind: "run_lifecycle_changed",
            runId: settled.id,
            threadId: address.threadId,
          },
        ]);
      },
      { interval: 50, timeout: 5000 }
    );

    // …and the workspace hub announced the bump.
    const workspaceHubStub = env.WORKSPACE_HUB.get(
      env.WORKSPACE_HUB.idFromName(encodeWorkspaceHubName(context))
    );
    await vi.waitFor(
      async () => {
        const activity = await runInDurableObject(
          workspaceHubStub,
          (instance: WorkspaceHubDurableObject) => instance.listRecentActivity()
        );
        expect(activity).toEqual([
          {
            bumpedAt: thread.lastActivityAt,
            channelId: address.channelId,
            kind: "thread_bumped",
            threadId: address.threadId,
          },
          {
            bumpedAt: settled.completedAt,
            channelId: address.channelId,
            kind: "thread_bumped",
            threadId: address.threadId,
          },
        ]);
      },
      { interval: 50, timeout: 5000 }
    );
  });
});
