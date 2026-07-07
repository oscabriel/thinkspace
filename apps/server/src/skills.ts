import {
  createD1TenantDataAccess,
  createR2MarkdownSkillStore,
} from "@thinkspace/domain/adapters/production";
import { skillIdSchema } from "@thinkspace/domain/ids";
import {
  skillMarkdownSchema,
  skillNameSchema,
} from "@thinkspace/domain/primitives";
import type { TenantContext } from "@thinkspace/domain/seams/tenant-data-access";
import { env } from "@thinkspace/env/server";
import { Hono } from "hono";
import { z } from "zod";

import { domainErrorStatus } from "./error-translation";
import type { TenantVariables } from "./tenant-context";
import { WORKSPACE_MANAGER_ROLES } from "./tenant-context";

/**
 * E8.2: the HTTP surface for the R2-markdown skill registry (ADR 0029), a wave-7 debt item.
 * Reads are member-visible (browsable, key-first — ADR 0011); writes are owner/admin only,
 * reusing the E3.2 BYOK role-gate pattern. There is deliberately no DELETE: the SkillStore seam
 * has no delete (a shape's frozen skillSelection may still reference a skill), so deletion
 * semantics stay future work.
 */

const skillPathSchema = z.object({ skillId: skillIdSchema });

const createBodySchema = z.object({
  markdown: skillMarkdownSchema,
  name: skillNameSchema,
});

const updateBodySchema = z.object({ markdown: skillMarkdownSchema });

const buildSkillStore = (context: TenantContext) =>
  createR2MarkdownSkillStore({ bucket: env.SKILLS, context, db: env.DB });

const buildTenantDataAccess = (context: TenantContext) =>
  createD1TenantDataAccess({ context, db: env.DB });

export const skillRoutes = new Hono<{ Variables: TenantVariables }>()
  /**
   * The skill index — identity + R2-key mapping, no markdown bodies (ADR 0037 §5: the resolver's
   * skills layer reads the same tenant-guarded `listSkills`). Any member may browse.
   */
  .get("/skills", async (c) => {
    const context = c.get("tenantContext");
    const skills = await buildTenantDataAccess(context).listSkills();
    if (!skills.ok) {
      return c.json({ error: skills.error }, domainErrorStatus(skills.error));
    }
    return c.json({ skills: skills.value }, 200);
  })
  /** A single skill's content, including its live markdown body. A missing id is 404. */
  .get("/skills/:skillId", async (c) => {
    const context = c.get("tenantContext");

    const path = skillPathSchema.safeParse({ skillId: c.req.param("skillId") });
    if (!path.success) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    const content = await buildSkillStore(context).get({
      skillId: path.data.skillId,
    });
    if (!content.ok) {
      return c.json({ error: content.error }, domainErrorStatus(content.error));
    }
    if (content.value === null) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    return c.json(content.value, 200);
  })
  /** Author a new skill (owner/admin): the adapter mints the id and R2 key. */
  .post("/skills", async (c) => {
    const context = c.get("tenantContext");
    if (!WORKSPACE_MANAGER_ROLES.has(context.role)) {
      return c.json({ error: { kind: "insufficient_role" } }, 403);
    }

    const body = createBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!body.success) {
      return c.json({ error: { kind: "malformed_request" } }, 400);
    }

    const created = await buildSkillStore(context).create({
      draft: { name: body.data.name },
      markdown: body.data.markdown,
    });
    if (!created.ok) {
      return c.json({ error: created.error }, domainErrorStatus(created.error));
    }

    return c.json(created.value, 200);
  })
  /** Re-author a skill's markdown (owner/admin); editing re-indexes it. A missing id is 404. */
  .put("/skills/:skillId", async (c) => {
    const context = c.get("tenantContext");
    if (!WORKSPACE_MANAGER_ROLES.has(context.role)) {
      return c.json({ error: { kind: "insufficient_role" } }, 403);
    }

    const path = skillPathSchema.safeParse({ skillId: c.req.param("skillId") });
    if (!path.success) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    const body = updateBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!body.success) {
      return c.json({ error: { kind: "malformed_request" } }, 400);
    }

    const updated = await buildSkillStore(context).update({
      markdown: body.data.markdown,
      skillId: path.data.skillId,
    });
    if (!updated.ok) {
      return c.json({ error: updated.error }, domainErrorStatus(updated.error));
    }
    if (updated.value === null) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    return c.json(updated.value, 200);
  });
