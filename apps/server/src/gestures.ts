import {
  createCatalogWorkspaceShapeToolResolver,
  createD1ModelRouter,
  createD1TenantDataAccess,
  createProductionChannelHub,
  createProductionThreadAgentDirectory,
  createProductionWorkspaceHub,
  createWorkerMcpEgressPolicyPlaceholder,
  modelCatalog,
} from "@thinkspace/domain/adapters/production";
import { createDispatchFlow } from "@thinkspace/domain/flows/dispatch";
import { createThreadCreationFlow } from "@thinkspace/domain/flows/thread-creation";
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
 * ADR 0035 §7: gestureId is required on the wire (UUIDv7) from day one; E5.3 now enforces
 * uniqueness in the ThreadAgent DO, so the wire value is branded and carried into the run
 * trigger where a replay converges on the existing run's receipt.
 */
const wireGestureIdSchema = z.uuidv7().pipe(gestureIdSchema);

const creationGestureSchema = z.object({
  ask: z.object({ gestureId: wireGestureIdSchema }).optional(),
  openingBody: commentBodySchema,
  openingCommentId: commentIdSchema,
});

const dispatchGestureSchema = z.object({
  gestureId: wireGestureIdSchema,
  targetCommentId: commentIdSchema,
});

const pathIdsSchema = z.object({
  channelId: channelIdSchema,
  threadId: threadIdSchema,
});

const buildCreationFlow = (context: TenantContext) =>
  createThreadCreationFlow({
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
 * ADR 0036: real ModelRouter (D1 registry + live catalog, fail-fast byok gate) and real
 * ToolResolver (empty-catalog intersection). McpEgressPolicy stays a placeholder — vacuously
 * unreachable behind the empty tool catalog until E6.3.
 */
const buildDispatchFlow = (context: TenantContext, channelId: ChannelId) =>
  createDispatchFlow({
    channelHub: createProductionChannelHub({
      address: { channelId },
      context,
      namespace: env.CHANNEL_HUB,
    }),
    mcpEgressPolicy: createWorkerMcpEgressPolicyPlaceholder(context),
    modelRouter: createD1ModelRouter({
      catalog: modelCatalog,
      context,
      db: env.DB,
    }),
    tenantDataAccess: createD1TenantDataAccess({ context, db: env.DB }),
    threadAgents: createProductionThreadAgentDirectory({
      namespace: env.THREAD_AGENT,
    }),
    toolResolver: createCatalogWorkspaceShapeToolResolver({ context }),
  });

/**
 * ADR 0035 §7: the gesture surface. Handlers do exactly: resolve context (middleware),
 * brand-parse path ids and body, compose the flow with production adapters, translate.
 * A malformed path id cannot name anything — 404, same as an invisible resource.
 */
export const gestureRoutes = new Hono<{ Variables: TenantVariables }>()
  .put("/channels/:channelId/threads/:threadId", async (c) => {
    const context = c.get("tenantContext");

    const pathIds = pathIdsSchema.safeParse({
      channelId: c.req.param("channelId"),
      threadId: c.req.param("threadId"),
    });
    if (!pathIds.success) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    const gesture = creationGestureSchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!gesture.success) {
      return c.json({ error: { kind: "malformed_gesture" } }, 400);
    }

    const created = await buildCreationFlow(context).create({
      channelId: pathIds.data.channelId,
      openingBody: gesture.data.openingBody,
      openingCommentId: gesture.data.openingCommentId,
      threadId: pathIds.data.threadId,
    });
    if (!created.ok) {
      return c.json({ error: created.error }, domainErrorStatus(created.error));
    }

    if (gesture.data.ask === undefined) {
      /**
       * Always 200, never 201: batch writes have no read-back (ADR 0034), so a replay is
       * indistinguishable from a first create and gets the identical receipt.
       */
      return c.json(created.value, 200);
    }

    /**
     * "Create and ask" (ADR 0034 §6): chain dispatch at the opening comment. On dispatch
     * failure the creation stands; the error answer is honest — replaying the whole PUT
     * converges on creation and retries the ask.
     */
    const dispatched = await buildDispatchFlow(
      context,
      pathIds.data.channelId
    ).dispatch({
      channelId: pathIds.data.channelId,
      gestureId: gesture.data.ask.gestureId,
      targetCommentId: gesture.data.openingCommentId,
      threadId: pathIds.data.threadId,
    });
    if (!dispatched.ok) {
      return c.json(
        { error: dispatched.error },
        domainErrorStatus(dispatched.error)
      );
    }

    return c.json({ ...created.value, run: dispatched.value }, 200);
  })
  .post("/channels/:channelId/threads/:threadId/dispatch", async (c) => {
    const context = c.get("tenantContext");

    const pathIds = pathIdsSchema.safeParse({
      channelId: c.req.param("channelId"),
      threadId: c.req.param("threadId"),
    });
    if (!pathIds.success) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    const gesture = dispatchGestureSchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!gesture.success) {
      return c.json({ error: { kind: "malformed_gesture" } }, 400);
    }

    const receipt = await buildDispatchFlow(
      context,
      pathIds.data.channelId
    ).dispatch({
      channelId: pathIds.data.channelId,
      gestureId: gesture.data.gestureId,
      targetCommentId: gesture.data.targetCommentId,
      threadId: pathIds.data.threadId,
    });
    if (!receipt.ok) {
      return c.json({ error: receipt.error }, domainErrorStatus(receipt.error));
    }

    return c.json(receipt.value, 200);
  });
