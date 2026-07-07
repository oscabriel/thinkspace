import {
  createD1ModelRouter,
  createD1TenantDataAccess,
  createProductionThreadAgentDirectory,
  modelCatalog,
} from "@thinkspace/domain/adapters/production";
import { visibilitySchema } from "@thinkspace/domain/channel";
import { createChannelCrudFlow } from "@thinkspace/domain/flows/channel-crud";
import { channelIdSchema, shapeIdSchema } from "@thinkspace/domain/ids";
import { goalSchema } from "@thinkspace/domain/primitives";
import type { TenantContext } from "@thinkspace/domain/seams/tenant-data-access";
import { shapeStructureSchema } from "@thinkspace/domain/shape";
import { env } from "@thinkspace/env/server";
import { Hono } from "hono";
import { z } from "zod";

import { domainErrorStatus } from "./error-translation";
import type { TenantVariables } from "./tenant-context";

const channelIdPathSchema = z.object({ channelId: channelIdSchema });

/**
 * The channel is born with its shape (ADR 0030 strict 1:1): the creation gesture carries the
 * client-minted shapeId and the manually-authored structure (config-as-data, ADR 0007). Both
 * ids are edge-minted so a replay converges on the same channel-plus-shape pair.
 */
const createChannelBodySchema = z.object({
  goal: goalSchema,
  shape: shapeStructureSchema,
  shapeId: shapeIdSchema,
  visibility: visibilitySchema.optional(),
});

const editShapeBodySchema = z.object({ shape: shapeStructureSchema });

/**
 * ADR 0036 real ModelRouter (D1 registry + live catalog, fail-fast BYOK gate) validates the
 * shape's model; the ThreadAgentDirectory carries an edit's new snapshot to the channel's
 * live thread DOs (ADR 0007 explicit update).
 */
const buildChannelCrudFlow = (context: TenantContext) =>
  createChannelCrudFlow({
    clock: () => new Date(),
    modelRouter: createD1ModelRouter({
      catalog: modelCatalog,
      context,
      db: env.DB,
    }),
    tenantDataAccess: createD1TenantDataAccess({ context, db: env.DB }),
    threadAgents: createProductionThreadAgentDirectory({
      namespace: env.THREAD_AGENT,
    }),
  });

/**
 * Channel + shape CRUD gestures (E5.2; ADR 0035 §7 discipline). Handlers do exactly:
 * resolve context (middleware), brand-parse the path id and body, compose the flow with
 * production adapters, translate. A malformed path id cannot name anything — 404.
 */
export const channelRoutes = new Hono<{ Variables: TenantVariables }>()
  .put("/channels/:channelId", async (c) => {
    const context = c.get("tenantContext");

    const pathIds = channelIdPathSchema.safeParse({
      channelId: c.req.param("channelId"),
    });
    if (!pathIds.success) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    const body = createChannelBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!body.success) {
      return c.json({ error: { kind: "malformed_gesture" } }, 400);
    }

    const created = await buildChannelCrudFlow(context).createChannel({
      channelId: pathIds.data.channelId,
      goal: body.data.goal,
      shapeId: body.data.shapeId,
      structure: body.data.shape,
      visibility: body.data.visibility,
    });
    if (!created.ok) {
      return c.json({ error: created.error }, domainErrorStatus(created.error));
    }

    return c.json(created.value, 200);
  })
  .put("/channels/:channelId/shape", async (c) => {
    const context = c.get("tenantContext");

    const pathIds = channelIdPathSchema.safeParse({
      channelId: c.req.param("channelId"),
    });
    if (!pathIds.success) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    const body = editShapeBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!body.success) {
      return c.json({ error: { kind: "malformed_gesture" } }, 400);
    }

    const edited = await buildChannelCrudFlow(context).editShape({
      channelId: pathIds.data.channelId,
      structure: body.data.shape,
    });
    if (!edited.ok) {
      return c.json({ error: edited.error }, domainErrorStatus(edited.error));
    }

    return c.json(edited.value, 200);
  })
  .post("/channels/:channelId/archive", async (c) => {
    const context = c.get("tenantContext");

    const pathIds = channelIdPathSchema.safeParse({
      channelId: c.req.param("channelId"),
    });
    if (!pathIds.success) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    const archived = await buildChannelCrudFlow(context).archiveChannel({
      channelId: pathIds.data.channelId,
    });
    if (!archived.ok) {
      return c.json(
        { error: archived.error },
        domainErrorStatus(archived.error)
      );
    }

    return c.json(archived.value, 200);
  })
  .post("/channels/:channelId/delete", async (c) => {
    const context = c.get("tenantContext");

    const pathIds = channelIdPathSchema.safeParse({
      channelId: c.req.param("channelId"),
    });
    if (!pathIds.success) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    const deleted = await buildChannelCrudFlow(context).deleteChannel({
      channelId: pathIds.data.channelId,
    });
    if (!deleted.ok) {
      return c.json({ error: deleted.error }, domainErrorStatus(deleted.error));
    }

    return c.json(deleted.value, 200);
  });
