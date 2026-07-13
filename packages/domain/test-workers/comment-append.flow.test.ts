import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, test } from "vitest";

import type { WorkspaceHubDurableObject } from "../src/adapters/production";
import {
  createD1TenantDataAccess,
  createProductionChannelHub,
  createProductionThreadAgentDirectory,
  createProductionWorkspaceHub,
  encodeWorkspaceHubName,
} from "../src/adapters/production";
import { createCommentAppendFlow } from "../src/flows/comment-append";
import { createThreadCreationFlow } from "../src/flows/thread-creation";
import { commentBodySchema } from "../src/primitives";
import type { TenantContext } from "../src/seams/tenant-data-access";
import type { ThreadAgentAddress } from "../src/seams/thread-agent";
import {
  channelId,
  commentId,
  gestureId,
  makeChannel,
  makeShape,
  memberId,
  threadId,
  unwrapErr,
  unwrapOk,
  workspaceId,
} from "../src/testing";

/**
 * The member-append spine (E8.4) pinned over the production binders: a real thread created
 * through the creation flow, a member reply appended through the append flow. The append
 * lands in the DO's tree, bumps the D1 index row, and re-announces on the workspace hub.
 */
describe("comment append over production adapters (E8.4 binder)", () => {
  test("append lands in the DO tree, bumps the D1 row, and announces thread_bumped", async () => {
    const address: ThreadAgentAddress = {
      channelId: channelId("ca-ch-1"),
      threadId: threadId("ca-th-1"),
      workspaceId: workspaceId("ca-ws-1"),
    };
    const member = memberId("ca-member-1");
    const context: TenantContext = {
      memberId: member,
      role: "member",
      workspaceId: address.workspaceId,
    };
    const tenantDataAccess = createD1TenantDataAccess({ context, db: env.DB });

    const shape = {
      ...makeShape({ id: "ca-shape-1" }),
      workspaceId: address.workspaceId,
    };
    const channel = makeChannel({
      id: "ca-ch-1",
      ownerMemberId: member,
      shapeId: "ca-shape-1",
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

    const created = unwrapOk(
      await createThreadCreationFlow({
        clock: () => new Date("2026-07-06T09:00:00Z"),
        tenantDataAccess,
        threadAgents: directory,
        workspaceHub: createProductionWorkspaceHub({
          context,
          namespace: env.WORKSPACE_HUB,
        }),
      }).create({
        channelId: address.channelId,
        openingBody: commentBodySchema.parse("Kick off the thread"),
        openingCommentId: commentId("ca-comment-opening"),
        threadId: address.threadId,
      })
    );
    // The creation flow persists the opening comment id as the branch root (E8.4).
    expect(created.thread.rootCommentId).toBe(commentId("ca-comment-opening"));

    const appendFlow = createCommentAppendFlow({
      channelHub: createProductionChannelHub({
        address: { channelId: address.channelId },
        context,
        namespace: env.CHANNEL_HUB,
      }),
      clock: () => new Date("2026-07-06T10:00:00Z"),
      tenantDataAccess,
      threadAgents: directory,
      workspaceHub: createProductionWorkspaceHub({
        context,
        namespace: env.WORKSPACE_HUB,
      }),
    });

    const appended = unwrapOk(
      await appendFlow.append({
        body: commentBodySchema.parse("A follow-up thought"),
        channelId: address.channelId,
        commentId: commentId("ca-comment-reply"),
        gestureId: gestureId("ca-gesture-1"),
        parentCommentId: commentId("ca-comment-opening"),
        threadId: address.threadId,
      })
    );
    expect(appended.id).toBe(commentId("ca-comment-reply"));

    // The reply is resident in the DO's comment tree.
    const branch = unwrapOk(
      await directory
        .get(address)
        .loadBranch({ rootCommentId: commentId("ca-comment-opening") })
    );
    expect(branch.subtree.map((comment) => comment.id)).toContain(
      commentId("ca-comment-reply")
    );

    // The D1 index row bumped to the append time.
    const index = unwrapOk(
      await tenantDataAccess.listChannelThreads({
        channelId: address.channelId,
      })
    );
    expect(
      index.threads.find((thread) => thread.id === address.threadId)
        ?.lastActivityAt
    ).toEqual(new Date("2026-07-06T10:00:00Z"));

    // The workspace hub heard the create bump then the append bump.
    const hubStub = env.WORKSPACE_HUB.get(
      env.WORKSPACE_HUB.idFromName(encodeWorkspaceHubName(context))
    );
    const activity = await runInDurableObject(
      hubStub,
      (instance: WorkspaceHubDurableObject) => instance.listRecentActivity()
    );
    expect(activity).toContainEqual({
      bumpedAt: new Date("2026-07-06T10:00:00Z"),
      channelId: address.channelId,
      kind: "thread_bumped",
      threadId: address.threadId,
    });
  });

  test("a reply to a parent not in the thread fails closed with comment_parent_not_in_thread", async () => {
    const address: ThreadAgentAddress = {
      channelId: channelId("ca-ch-2"),
      threadId: threadId("ca-th-2"),
      workspaceId: workspaceId("ca-ws-2"),
    };
    const member = memberId("ca-member-2");
    const context: TenantContext = {
      memberId: member,
      role: "member",
      workspaceId: address.workspaceId,
    };
    const tenantDataAccess = createD1TenantDataAccess({ context, db: env.DB });

    const shape = {
      ...makeShape({ id: "ca-shape-2" }),
      workspaceId: address.workspaceId,
    };
    const channel = makeChannel({
      id: "ca-ch-2",
      ownerMemberId: member,
      shapeId: "ca-shape-2",
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
    unwrapOk(
      await createThreadCreationFlow({
        clock: () => new Date("2026-07-06T09:00:00Z"),
        tenantDataAccess,
        threadAgents: directory,
        workspaceHub: createProductionWorkspaceHub({
          context,
          namespace: env.WORKSPACE_HUB,
        }),
      }).create({
        channelId: address.channelId,
        openingBody: commentBodySchema.parse("Kick off the thread"),
        openingCommentId: commentId("ca-comment-opening-2"),
        threadId: address.threadId,
      })
    );

    const error = unwrapErr(
      await createCommentAppendFlow({
        channelHub: createProductionChannelHub({
          address: { channelId: address.channelId },
          context,
          namespace: env.CHANNEL_HUB,
        }),
        clock: () => new Date("2026-07-06T10:00:00Z"),
        tenantDataAccess,
        threadAgents: directory,
        workspaceHub: createProductionWorkspaceHub({
          context,
          namespace: env.WORKSPACE_HUB,
        }),
      }).append({
        body: commentBodySchema.parse("Reply to a ghost"),
        channelId: address.channelId,
        commentId: commentId("ca-comment-orphan"),
        gestureId: gestureId("ca-gesture-2"),
        parentCommentId: commentId("ca-comment-ghost"),
        threadId: address.threadId,
      })
    );
    expect(error.kind).toBe("comment_parent_not_in_thread");
  });
});
