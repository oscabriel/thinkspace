import {
  createD1TenantDataAccess,
  createProductionChannelHub,
  createProductionThreadAgentDirectory,
  createProductionWorkspaceHub,
} from "@thinkspace/domain/adapters/production";
import { createCommentAppendFlow } from "@thinkspace/domain/flows/comment-append";
import type { ChannelId } from "@thinkspace/domain/ids";
import {
  channelIdSchema,
  commentIdSchema,
  gestureIdSchema,
  threadIdSchema,
} from "@thinkspace/domain/ids";
import { commentBodySchema } from "@thinkspace/domain/primitives";
import type { TenantContext } from "@thinkspace/domain/seams/tenant-data-access";
import { env } from "@thinkspace/env/server";
import { Hono } from "hono";
import { z } from "zod";

import { domainErrorStatus } from "./error-translation";
import type { TenantVariables } from "./tenant-context";

/**
 * ADR 0035 §7: the reply gesture carries an edge-minted comment id (like thread creation),
 * a required UUIDv7 gestureId, the parent it nests under, and the body. commentId is the
 * idempotency key — a replay carrying the same ids converges on the one comment (E8.4).
 */
const wireGestureIdSchema = z.uuidv7().pipe(gestureIdSchema);

const appendGestureSchema = z.object({
  body: commentBodySchema,
  commentId: commentIdSchema,
  gestureId: wireGestureIdSchema,
  parentCommentId: commentIdSchema,
});

const pathIdsSchema = z.object({
  channelId: channelIdSchema,
  threadId: threadIdSchema,
});

const buildAppendFlow = (context: TenantContext, channelId: ChannelId) =>
  createCommentAppendFlow({
    channelHub: createProductionChannelHub({
      address: { channelId },
      context,
      namespace: env.CHANNEL_HUB,
    }),
    clock: () => new Date(),
    tenantDataAccess: createD1TenantDataAccess({ context, db: env.DB }),
    threadAgents: createProductionThreadAgentDirectory({
      namespace: env.THREAD_AGENT,
    }),
    workspaceHub: createProductionWorkspaceHub({
      context,
      namespace: env.WORKSPACE_HUB,
    }),
  });

/**
 * E8.4: the member-reply gesture. Same discipline as gestures.ts — resolve context, brand-parse
 * the path ids and body, compose the append flow with production adapters, translate. Appends a
 * comment mid-thread without triggering a Run (distinct from the dispatch spine).
 */
export const commentRoutes = new Hono<{ Variables: TenantVariables }>().post(
  "/channels/:channelId/threads/:threadId/comments",
  async (c) => {
    const context = c.get("tenantContext");

    const pathIds = pathIdsSchema.safeParse({
      channelId: c.req.param("channelId"),
      threadId: c.req.param("threadId"),
    });
    if (!pathIds.success) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    const gesture = appendGestureSchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!gesture.success) {
      return c.json({ error: { kind: "malformed_gesture" } }, 400);
    }

    const appended = await buildAppendFlow(
      context,
      pathIds.data.channelId
    ).append({
      body: gesture.data.body,
      channelId: pathIds.data.channelId,
      commentId: gesture.data.commentId,
      gestureId: gesture.data.gestureId,
      parentCommentId: gesture.data.parentCommentId,
      threadId: pathIds.data.threadId,
    });
    if (!appended.ok) {
      return c.json(
        { error: appended.error },
        domainErrorStatus(appended.error)
      );
    }

    return c.json(appended.value, 200);
  }
);
