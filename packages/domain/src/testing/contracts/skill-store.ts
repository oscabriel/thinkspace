import { skillMarkdownSchema, skillNameSchema } from "../../primitives";
import type { SkillContent, SkillStore } from "../../seams/skill-store";
import type { TenantContext } from "../../seams/tenant-data-access";
import type { ContractTestApi } from "../contract-api";
import {
  makeSkillContent,
  otherWorkspaceId,
  skillId,
  testTenantContext,
  unwrapErr,
  unwrapOk,
} from "../fixtures";

/** Domain-termed initial state a SkillStore adapter must be constructible from. */
export interface SkillStoreSeed {
  readonly context: TenantContext;
  /** Skills already present in the store (any workspace — cross-tenant guard fodder). */
  readonly skills?: readonly SkillContent[];
}

export type SkillStoreFactory = (
  seed: SkillStoreSeed
) => Promise<SkillStore> | SkillStore;

/** Pins the SkillStore seam semantics (ADR 0005/0029) on whichever adapter the factory builds. */
export const defineSkillStoreContract = (input: {
  readonly api: ContractTestApi;
  readonly makeSkillStore: SkillStoreFactory;
}): void => {
  const { describe, expect, test } = input.api;
  const { makeSkillStore } = input;

  const draftName = skillNameSchema.parse("Deployment runbook");

  describe("SkillStore — R2 markdown bodies + adapter-owned D1 index", () => {
    test("create persists the markdown and a workspace-keyed r2_markdown record", async () => {
      const store = await makeSkillStore({ context: testTenantContext });
      const markdown = skillMarkdownSchema.parse("# Runbook\n\nStep one.");

      const created = unwrapOk(
        await store.create({ draft: { name: draftName }, markdown })
      );

      expect(created.markdown).toBe(markdown);
      expect(created.skill.name).toBe(draftName);
      expect(created.skill.workspaceId).toBe(testTenantContext.workspaceId);
      expect(created.skill.storage.kind).toBe("r2_markdown");

      const fetched = unwrapOk(await store.get({ skillId: created.skill.id }));
      expect(fetched?.markdown).toBe(markdown);
      expect(fetched?.skill.id).toBe(created.skill.id);
    });

    test("get returns null for an unknown skillId", async () => {
      const store = await makeSkillStore({ context: testTenantContext });
      const fetched = unwrapOk(
        await store.get({ skillId: skillId("skill-absent") })
      );
      expect(fetched).toBeNull();
    });

    test("update replaces the live markdown and bumps updatedAt (ADR 0005 re-index)", async () => {
      const store = await makeSkillStore({ context: testTenantContext });
      const created = unwrapOk(
        await store.create({
          draft: { name: draftName },
          markdown: skillMarkdownSchema.parse("# v1"),
        })
      );

      const nextMarkdown = skillMarkdownSchema.parse("# v2\n\nMore detail.");
      const updated = unwrapOk(
        await store.update({
          markdown: nextMarkdown,
          skillId: created.skill.id,
        })
      );

      expect(updated?.markdown).toBe(nextMarkdown);
      expect(updated?.skill.id).toBe(created.skill.id);

      const refetched = unwrapOk(
        await store.get({ skillId: created.skill.id })
      );
      expect(refetched?.markdown).toBe(nextMarkdown);
    });

    test("update returns null for an unknown skillId", async () => {
      const store = await makeSkillStore({ context: testTenantContext });
      const updated = unwrapOk(
        await store.update({
          markdown: skillMarkdownSchema.parse("# nope"),
          skillId: skillId("skill-absent"),
        })
      );
      expect(updated).toBeNull();
    });

    test("get fails closed on a cross-tenant skill (tenant_guard_violation)", async () => {
      const foreign = makeSkillContent({
        id: "skill-foreign",
        workspaceId: otherWorkspaceId,
      });
      const store = await makeSkillStore({
        context: testTenantContext,
        skills: [foreign],
      });

      const error = unwrapErr(await store.get({ skillId: foreign.skill.id }));
      expect(error.kind).toBe("tenant_guard_violation");
    });

    test("update fails closed on a cross-tenant skill (tenant_guard_violation)", async () => {
      const foreign = makeSkillContent({
        id: "skill-foreign-write",
        workspaceId: otherWorkspaceId,
      });
      const store = await makeSkillStore({
        context: testTenantContext,
        skills: [foreign],
      });

      const error = unwrapErr(
        await store.update({
          markdown: skillMarkdownSchema.parse("# intrusion"),
          skillId: foreign.skill.id,
        })
      );
      expect(error.kind).toBe("tenant_guard_violation");
    });
  });
};
