import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

import type { SkillId, WorkspaceId } from "../../ids";
import { skillIdSchema } from "../../ids";
import type { SkillMarkdown } from "../../primitives";
import { r2KeySchema, skillMarkdownSchema } from "../../primitives";
import { err, ok } from "../../result";
import type { SkillContent, SkillStore } from "../../seams/skill-store";
import type { TenantContext } from "../../seams/tenant-data-access";
import type { Skill } from "../../skill";
import { hasSameId, tenantGuardViolation } from "../helpers";

export interface R2MarkdownSkillStoreConfig {
  readonly bucket: R2Bucket;
  readonly clock?: () => Date;
  readonly context: TenantContext;
  readonly db: D1Database;
  readonly nextSkillId?: () => SkillId;
}

/** Adapter-owned D1 index row (sdk-signature-verification §5): D1 owns the lookup table, R2 the body. */
interface SkillRow {
  readonly created_at: number;
  readonly id: string;
  readonly name: string;
  readonly r2_key: string;
  readonly updated_at: number;
  readonly workspace_id: string;
}

const rowToSkill = (row: SkillRow): Skill =>
  ({
    createdAt: new Date(row.created_at),
    id: row.id,
    name: row.name,
    storage: { kind: "r2_markdown", r2Key: row.r2_key },
    updatedAt: new Date(row.updated_at),
    workspaceId: row.workspace_id,
  }) as Skill;

/** ADR 0029: R2 layout is adapter-internal `{workspace}/skills/{skill}.md`; never crosses the seam. */
const skillR2Key = (workspaceId: WorkspaceId, skillId: SkillId): string =>
  r2KeySchema.parse(`${workspaceId}/skills/${skillId}.md`);

const defaultSkillId = (): SkillId =>
  skillIdSchema.parse(`skill-${crypto.randomUUID()}`);

const readMarkdown = async (
  bucket: R2Bucket,
  r2Key: string
): Promise<SkillMarkdown | null> => {
  const object = await bucket.get(r2Key);
  if (object === null) {
    return null;
  }
  return skillMarkdownSchema.parse(await object.text());
};

/**
 * ADR 0005/0029: markdown skill bodies live in R2 (content, live), an adapter-owned D1
 * `skill` index owns identity and the R2 key mapping (structure). Editing re-indexes.
 */
export const createR2MarkdownSkillStore = (
  config: R2MarkdownSkillStoreConfig
): SkillStore => {
  const { bucket, context, db } = config;
  const clock = config.clock ?? (() => new Date());
  const nextSkillId = config.nextSkillId ?? defaultSkillId;

  const readRow = async (skillId: SkillId): Promise<SkillRow | null> =>
    db
      .prepare("SELECT * FROM skill WHERE id = ?1")
      .bind(skillId)
      .first<SkillRow>();

  return {
    context,
    create: async (input) => {
      const skillId = nextSkillId();
      const createdAt = clock();
      const r2Key = skillR2Key(context.workspaceId, skillId);

      await bucket.put(r2Key, input.markdown);
      await db
        .prepare(
          `INSERT INTO skill (id, created_at, name, r2_key, updated_at, workspace_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
        )
        .bind(
          skillId,
          createdAt.getTime(),
          input.draft.name,
          r2Key,
          createdAt.getTime(),
          context.workspaceId
        )
        .run();

      const skill: Skill = {
        createdAt,
        id: skillId,
        name: input.draft.name,
        storage: { kind: "r2_markdown", r2Key: r2KeySchema.parse(r2Key) },
        updatedAt: createdAt,
        workspaceId: context.workspaceId,
      };
      return ok({ markdown: input.markdown, skill });
    },
    get: async (input) => {
      const row = await readRow(input.skillId);
      if (row === null) {
        return ok(null);
      }
      // Fail closed: a row visible by key but outside the tenant is a guard violation, not a miss.
      if (!hasSameId(row.workspace_id, context.workspaceId)) {
        return err(
          tenantGuardViolation(context, row.workspace_id as WorkspaceId)
        );
      }

      const markdown = await readMarkdown(bucket, row.r2_key);
      if (markdown === null) {
        return ok(null);
      }
      return ok({ markdown, skill: rowToSkill(row) });
    },
    update: async (input) => {
      const row = await readRow(input.skillId);
      if (row === null) {
        return ok(null);
      }
      if (!hasSameId(row.workspace_id, context.workspaceId)) {
        return err(
          tenantGuardViolation(context, row.workspace_id as WorkspaceId)
        );
      }

      const updatedAt = clock();
      await bucket.put(row.r2_key, input.markdown);
      await db
        .prepare("UPDATE skill SET updated_at = ?1 WHERE id = ?2")
        .bind(updatedAt.getTime(), row.id)
        .run();

      return ok({
        markdown: input.markdown,
        skill: { ...rowToSkill(row), updatedAt },
      });
    },
  };
};

/**
 * Turn assembly (ADR 0007 "structure frozen, content live"): loads the current markdown for a
 * shape's frozen skill selection, workspace-scoped. Filtering on `workspace_id` in the query
 * fails closed — a selection that names a skill outside the tenant simply renders nothing.
 * Rows without a live R2 body are skipped; selection order is preserved.
 */
export const loadSelectedSkillContents = async (input: {
  readonly bucket: R2Bucket;
  readonly db: D1Database;
  readonly skillIds: readonly SkillId[];
  readonly workspaceId: WorkspaceId;
}): Promise<readonly SkillContent[]> => {
  if (input.skillIds.length === 0) {
    return [];
  }

  const placeholders = input.skillIds.map((_id, index) => `?${index + 2}`);
  const { results } = await input.db
    .prepare(
      `SELECT * FROM skill WHERE workspace_id = ?1 AND id IN (${placeholders.join(", ")})`
    )
    .bind(input.workspaceId, ...input.skillIds)
    .all<SkillRow>();

  const rowById = new Map(results.map((row) => [row.id, row]));
  // Preserve selection order; read each live body in parallel and drop rows without one.
  const loaded = await Promise.all(
    input.skillIds.map(async (skillId): Promise<SkillContent | null> => {
      const row = rowById.get(skillId);
      if (row === undefined) {
        return null;
      }
      const markdown = await readMarkdown(input.bucket, row.r2_key);
      return markdown === null ? null : { markdown, skill: rowToSkill(row) };
    })
  );
  return loaded.filter((content): content is SkillContent => content !== null);
};
