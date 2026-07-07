import { env } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { createR2MarkdownSkillStore } from "../src/adapters/production/skill-store";
import { defineSkillStoreContract } from "../src/testing";
import type { SkillStoreSeed } from "../src/testing";

/** vitest-pool-workers no longer isolates storage per test; each test starts from empty state. */
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM skill").run();
  const listed = await env.SKILLS.list();
  await Promise.all(
    listed.objects.map((object) => env.SKILLS.delete(object.key))
  );
});

/** Seeds the adapter-owned index row + the live R2 body directly, mirroring the write path. */
const seedSkills = async (seed: SkillStoreSeed): Promise<void> => {
  await Promise.all(
    (seed.skills ?? []).map(async ({ markdown, skill }) => {
      await env.SKILLS.put(skill.storage.r2Key, markdown);
      await env.DB.prepare(
        `INSERT INTO skill (id, created_at, name, r2_key, updated_at, workspace_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
      )
        .bind(
          skill.id,
          skill.createdAt.getTime(),
          skill.name,
          skill.storage.r2Key,
          skill.updatedAt.getTime(),
          skill.workspaceId
        )
        .run();
    })
  );
};

defineSkillStoreContract({
  api: { describe, expect, test },
  makeSkillStore: async (seed) => {
    await seedSkills(seed);
    return createR2MarkdownSkillStore({
      bucket: env.SKILLS,
      context: seed.context,
      db: env.DB,
    });
  },
});
