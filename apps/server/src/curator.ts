import {
  createD1ModelRouter,
  createProductionCuratorAgent,
  defaultCuratorModelId,
  modelCatalog,
} from "@thinkspace/domain/adapters/production";
import { curatorSessionIdSchema } from "@thinkspace/domain/ids";
import { curatorPromptSchema } from "@thinkspace/domain/primitives";
import type { TenantContext } from "@thinkspace/domain/seams/tenant-data-access";
import { env } from "@thinkspace/env/server";
import { Hono } from "hono";
import { z } from "zod";

import { domainErrorStatus } from "./error-translation";
import type { TenantVariables } from "./tenant-context";

const sessionPathSchema = z.object({
  sessionId: curatorSessionIdSchema,
});

const sendBodySchema = z.object({
  message: curatorPromptSchema,
});

const buildCuratorAgent = (context: TenantContext) =>
  createProductionCuratorAgent({
    context,
    namespace: env.CURATOR_AGENT,
  });

/**
 * E8.3 fail-fast BYOK gate (ADR 0021/0026, mirroring buildDispatchFlow's router construction in
 * gestures.ts): the curator DO self-constructs its fixed first-party model without a catalog
 * pre-flight, so the edge is the gate. A workspace that has keyed no provider gets 409
 * `byok_key_missing` here — before any DO round-trip — instead of a mid-turn DO failure. Only a
 * missing key blocks: catalog membership of the first-party curator model is not the edge's
 * concern (the DO never consults the catalog), so any other resolve outcome proceeds.
 */
const byokGate = async (context: TenantContext) => {
  const resolved = await createD1ModelRouter({
    catalog: modelCatalog,
    context,
    db: env.DB,
  }).resolve({ modelId: defaultCuratorModelId() });

  return !resolved.ok && resolved.error.kind === "byok_key_missing"
    ? resolved.error
    : null;
};

/**
 * The curator surface (ADR 0021/0026): one Think DO per member+workspace, reached through the
 * per-member production adapter. Any member may curate — per-member DO isolation is the whole
 * boundary, so there is no owner gate. Handlers resolve context (middleware), run the BYOK gate,
 * brand-parse path ids and body, dispatch to the DO, and translate. A malformed session id
 * cannot name anything — 404, same as an invisible resource (mirrors gestures.ts).
 */
export const curatorRoutes = new Hono<{ Variables: TenantVariables }>()
  .post("/curator/sessions", async (c) => {
    const context = c.get("tenantContext");

    const missingKey = await byokGate(context);
    if (missingKey !== null) {
      return c.json({ error: missingKey }, domainErrorStatus(missingKey));
    }

    const started = await buildCuratorAgent(context).startSession();
    if (!started.ok) {
      return c.json({ error: started.error }, domainErrorStatus(started.error));
    }

    return c.json(started.value, 200);
  })
  .post("/curator/sessions/:sessionId/messages", async (c) => {
    const context = c.get("tenantContext");

    const path = sessionPathSchema.safeParse({
      sessionId: c.req.param("sessionId"),
    });
    if (!path.success) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    const body = sendBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!body.success) {
      return c.json({ error: { kind: "malformed_gesture" } }, 400);
    }

    const missingKey = await byokGate(context);
    if (missingKey !== null) {
      return c.json({ error: missingKey }, domainErrorStatus(missingKey));
    }

    const turn = await buildCuratorAgent(context).send({
      message: body.data.message,
      sessionId: path.data.sessionId,
    });
    if (!turn.ok) {
      return c.json({ error: turn.error }, domainErrorStatus(turn.error));
    }

    return c.json(turn.value, 200);
  });
