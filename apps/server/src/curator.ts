import {
  createD1ModelRouter,
  createProductionCuratorAgent,
  modelCatalog,
  resolveCuratorModelId,
} from "@thinkspace/domain/adapters/production";
import type { ByokKeyMissingError } from "@thinkspace/domain/errors";
import type { ModelId } from "@thinkspace/domain/ids";
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

/** Either the curator's resolved model id, or the fail-fast 409 the routes surface. */
type CuratorModelResolution =
  | { readonly error: ByokKeyMissingError }
  | { readonly modelId: ModelId };

/**
 * E8.3 / ADR 0038 §2 curator-model resolver (mirroring buildDispatchFlow's router construction in
 * gestures.ts): the curator DO self-constructs its model without a catalog pre-flight, so the edge
 * picks it and gates on the key. The model is the workspace's earliest-keyed provider's default
 * (`resolveCuratorModelId`, provider-generic); that id runs through the existing model router with
 * unchanged fail-fast semantics — a workspace that has keyed no provider gets 409 `byok_key_missing`
 * here (against the allowlist-head default the resolver falls back to), before any DO round-trip,
 * instead of a mid-turn DO failure. Only a missing key blocks: catalog membership of the curator
 * model is not the edge's concern (the DO never consults the catalog), so any other resolve outcome
 * proceeds with the resolved id.
 */
const resolveCuratorModel = async (
  context: TenantContext
): Promise<CuratorModelResolution> => {
  const modelId = await resolveCuratorModelId({ context, db: env.DB });
  const resolved = await createD1ModelRouter({
    catalog: modelCatalog,
    context,
    db: env.DB,
  }).resolve({ modelId });

  return !resolved.ok && resolved.error.kind === "byok_key_missing"
    ? { error: resolved.error }
    : { modelId };
};

/**
 * The curator surface (ADR 0021/0026): one Think DO per member+workspace, reached through the
 * per-member production adapter. Any member may curate — per-member DO isolation is the whole
 * boundary, so there is no owner gate. Handlers resolve context (middleware), resolve the curator
 * model (fail-fast BYOK gate), brand-parse path ids and body, dispatch to the DO, and translate.
 * A malformed session id
 * cannot name anything — 404, same as an invisible resource (mirrors gestures.ts).
 */
export const curatorRoutes = new Hono<{ Variables: TenantVariables }>()
  .post("/curator/sessions", async (c) => {
    const context = c.get("tenantContext");

    // ADR 0038 §2: resolve the earliest-keyed provider's model at the edge and carry it into the
    // DO so getModel self-constructs it after a wake.
    const resolution = await resolveCuratorModel(context);
    if ("error" in resolution) {
      return c.json(
        { error: resolution.error },
        domainErrorStatus(resolution.error)
      );
    }

    const started = await buildCuratorAgent(context).startSession({
      modelId: resolution.modelId,
    });
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

    const body = sendBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: { kind: "malformed_gesture" } }, 400);
    }

    // ADR 0038 §2: a send resumes a persisted session (its model id is already stored in the DO),
    // so the resolver runs here purely as the fail-fast BYOK pre-flight — a workspace whose key was
    // revoked mid-session is 409 before the DO round-trip. The resolved id is not re-carried.
    const resolution = await resolveCuratorModel(context);
    if ("error" in resolution) {
      return c.json(
        { error: resolution.error },
        domainErrorStatus(resolution.error)
      );
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
