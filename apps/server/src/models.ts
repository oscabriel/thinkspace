import {
  createD1ModelRouter,
  modelCatalog,
} from "@thinkspace/domain/adapters/production";
import { env } from "@thinkspace/env/server";
import { Hono } from "hono";

import { domainErrorStatus } from "./error-translation";
import type { TenantVariables } from "./tenant-context";

/**
 * The model picker's data source (E7.5). The shape form authors a channel's model, but a
 * workspace may only pick a model whose provider it has keyed (ADR 0011 key-first, ADR 0036
 * fail-fast BYOK gate): the picker therefore lists the live catalog ∩ the workspace's keyed
 * providers, exactly the set the ModelRouter's `listAvailableModels` computes and the create /
 * edit flows validate against. An empty list is honest — no provider key is registered — and
 * the UI turns it into a "register a provider key" pointer rather than a broken picker.
 *
 * ADR 0035 §7 discipline, in reverse of the write routes: resolve context (middleware), compose
 * the read with production adapters, translate. Reads never mutate, so there is no idempotence
 * story. A cold catalog with no last-good memo surfaces `catalog_unavailable` → 503 (retryable);
 * a cross-tenant registry probe trips the domain tenant guard → 404.
 */
export const modelRoutes = new Hono<{ Variables: TenantVariables }>().get(
  "/models",
  async (c) => {
    const context = c.get("tenantContext");

    const models = await createD1ModelRouter({
      catalog: modelCatalog,
      context,
      db: env.DB,
    }).listAvailableModels();
    if (!models.ok) {
      return c.json({ error: models.error }, domainErrorStatus(models.error));
    }

    return c.json({ models: models.value }, 200);
  }
);
