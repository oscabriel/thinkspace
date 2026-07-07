import { createR2VirtualFsArtifactStore } from "@thinkspace/domain/adapters/production";
import {
  artifactIdSchema,
  artifactVersionIdSchema,
} from "@thinkspace/domain/ids";
import type { TenantContext } from "@thinkspace/domain/seams/tenant-data-access";
import { env } from "@thinkspace/env/server";
import { Hono } from "hono";
import { z } from "zod";

import { domainErrorStatus } from "./error-translation";
import type { TenantVariables } from "./tenant-context";

/**
 * E6.2: the read surface the E7.6 Library renders over. Writes come from agent runs, never the
 * browser, so this file is GET-only. The store is built per resolved TenantContext (ADR 0035),
 * so every query is workspace-scoped and a cross-tenant id trips the domain tenant guard, which
 * translates to 404 (invisibility-as-nonexistence) — never a 403 that would confirm existence.
 */
const buildArtifactStore = (context: TenantContext) =>
  createR2VirtualFsArtifactStore({
    bucket: env.ARTIFACTS,
    context,
    db: env.DB,
  });

const artifactPathSchema = z.object({ artifactId: artifactIdSchema });
const versionPathSchema = z.object({
  artifactId: artifactIdSchema,
  versionId: artifactVersionIdSchema,
});

export const artifactRoutes = new Hono<{ Variables: TenantVariables }>()
  .get("/artifacts", async (c) => {
    const store = buildArtifactStore(c.get("tenantContext"));
    const listed = await store.list();
    if (!listed.ok) {
      return c.json(
        { error: { kind: listed.error.kind } },
        domainErrorStatus(listed.error)
      );
    }
    return c.json({ artifacts: listed.value.artifacts });
  })
  .get("/artifacts/:artifactId", async (c) => {
    const path = artifactPathSchema.safeParse(c.req.param());
    if (!path.success) {
      return c.json({ error: { kind: "not_found" } }, 404);
    }

    const store = buildArtifactStore(c.get("tenantContext"));
    const head = await store.head({ artifactId: path.data.artifactId });
    if (!head.ok) {
      return c.json(
        { error: { kind: head.error.kind } },
        domainErrorStatus(head.error)
      );
    }
    if (head.value === null) {
      return c.json({ error: { kind: "not_found" } }, 404);
    }

    const versions = await store.listVersions({
      artifactId: path.data.artifactId,
    });
    if (!versions.ok) {
      return c.json(
        { error: { kind: versions.error.kind } },
        domainErrorStatus(versions.error)
      );
    }
    return c.json({ artifact: head.value, versions: versions.value ?? [] });
  })
  .get("/artifacts/:artifactId/versions/:versionId/content", async (c) => {
    const path = versionPathSchema.safeParse(c.req.param());
    if (!path.success) {
      return c.json({ error: { kind: "not_found" } }, 404);
    }

    const store = buildArtifactStore(c.get("tenantContext"));
    const blob = await store.get({
      artifactId: path.data.artifactId,
      versionId: path.data.versionId,
    });
    if (!blob.ok) {
      return c.json(
        { error: { kind: blob.error.kind } },
        domainErrorStatus(blob.error)
      );
    }
    if (blob.value === null) {
      return c.json({ error: { kind: "not_found" } }, 404);
    }

    // ADR 0031: rendered artifact content belongs on the sandbox origin, not here. Until the
    // viewer Worker exists, `sandbox` (script-less, opaque-origin) keeps agent-authored HTML
    // inert when this URL is navigated directly — fetch()-based rendering is unaffected.
    return new Response(blob.value.bytes.data, {
      headers: {
        "Content-Security-Policy": "sandbox",
        "Content-Type": blob.value.version.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
