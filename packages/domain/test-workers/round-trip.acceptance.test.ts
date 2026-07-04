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
import type { RunTrigger } from "../src/run";
import type { TenantContext } from "../src/seams/tenant-data-access";
import type { ThreadAgentAddress } from "../src/seams/thread-agent";
import {
  channelId,
  makeComment,
  makeShapeSnapshot,
  memberId,
  runId,
  threadId,
  unwrapOk,
  workspaceId,
} from "../src/testing";
import { threadSchema } from "../src/thread";
import { modelReplying } from "./mock-model";

/**
 * The dispatch→completion round-trip acceptance bar: a real ThreadAgent DO (reached
 * through the production directory) executes a stubbed model turn as a Think submission;
 * the completion flow — built from the real D1 TenantDataAccess and the real hub DOs —
 * settles it. Everything below the model call is production code.
 *
 * The test seeds the D1 thread-index row and initializes the agent directly: that is the
 * thread-creation flow's job, deliberately out of scope here (ADR 0033 non-goal).
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

    // Thread-creation stand-in: D1 index row first, agent initialize second.
    const thread = threadSchema.parse({
      channelId: address.channelId,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      createdByMemberId: member,
      id: address.threadId,
      lastActivityAt: new Date("2026-07-01T00:00:00Z"),
      lifecycle: { state: "active" },
      name: "round-trip thread",
      workspaceId: address.workspaceId,
    });
    unwrapOk(
      await tenantDataAccess.batch({
        commands: [{ kind: "put_thread_index", thread }],
        workspaceId: address.workspaceId,
      })
    );

    const directory = createProductionThreadAgentDirectory({
      namespace: env.THREAD_AGENT,
    });
    const agent = directory.get(address);
    const opening = {
      ...makeComment({
        id: "rt-comment-opening",
        threadId: address.threadId,
        workspaceId: address.workspaceId,
      }),
      author: { kind: "member" as const, memberId: member },
    };
    unwrapOk(
      await agent.initialize({
        openingComment: opening,
        shapeSnapshot: makeShapeSnapshot(),
      })
    );

    // Test capability: the model stub and the completion flow are injected in-isolate;
    // production wiring of both inside the DO lands with the HTTP edge slice.
    const agentStub = env.THREAD_AGENT.get(
      env.THREAD_AGENT.idFromName(encodeThreadAgentAddress(address))
    );
    await runInDurableObject(
      agentStub,
      (instance: ThreadAgentDurableObject) => {
        instance.applyTestSeed({
          address,
          nextRunId: () => runId("rt-run-1"),
        });
        instance.modelOverride = modelReplying("Round trip reply.");
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
    const channelHubStub = env.CHANNEL_HUB.get(
      env.CHANNEL_HUB.idFromName(
        encodeChannelHubName(context, { channelId: address.channelId })
      )
    );
    const channelEvents = await runInDurableObject(
      channelHubStub,
      (instance: ChannelHubDurableObject) => instance.listRecentEvents()
    );
    expect(channelEvents).toEqual([
      {
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

    // …and the workspace hub announced the bump.
    const workspaceHubStub = env.WORKSPACE_HUB.get(
      env.WORKSPACE_HUB.idFromName(encodeWorkspaceHubName(context))
    );
    const activity = await runInDurableObject(
      workspaceHubStub,
      (instance: WorkspaceHubDurableObject) => instance.listRecentActivity()
    );
    expect(activity).toEqual([
      {
        bumpedAt: settled.completedAt,
        channelId: address.channelId,
        kind: "thread_bumped",
        threadId: address.threadId,
      },
    ]);
  });
});
