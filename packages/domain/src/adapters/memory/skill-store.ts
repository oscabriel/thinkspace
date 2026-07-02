import { skillIdSchema } from "../../ids";
import { r2KeySchema } from "../../primitives";
import { err, ok } from "../../result";
import type { SkillContent, SkillStore } from "../../seams/skill-store";
import type { TenantContext } from "../../seams/tenant-data-access";
import type { Skill } from "../../skill";
import { idKey, isInTenant, tenantGuardViolation } from "./helpers";

export interface MemorySkillStoreConfig {
  readonly clock?: () => Date;
  readonly context: TenantContext;
  readonly nextSkillId?: () => Skill["id"];
  readonly skills?: readonly SkillContent[];
}

const defaultSkillId = (): Skill["id"] =>
  skillIdSchema.parse(`memory-skill-${Date.now()}-${Math.random()}`);

export const createMemorySkillStore = (
  config: MemorySkillStoreConfig
): SkillStore => {
  const clock = config.clock ?? (() => new Date());
  const nextSkillId = config.nextSkillId ?? defaultSkillId;
  const skills = new Map(
    (config.skills ?? []).map((content) => [idKey(content.skill.id), content])
  );

  return {
    context: config.context,
    create: async (input) => {
      const skillId = nextSkillId();
      const createdAt = clock();
      const skill: Skill = {
        createdAt,
        id: skillId,
        name: input.draft.name,
        storage: {
          kind: "r2_markdown",
          r2Key: r2KeySchema.parse(
            `${config.context.workspaceId}/skills/${skillId}.md`
          ),
        },
        updatedAt: createdAt,
        workspaceId: config.context.workspaceId,
      };

      const content: SkillContent = { markdown: input.markdown, skill };
      skills.set(idKey(skillId), content);
      return ok(content);
    },
    get: async (input) => {
      const content = skills.get(idKey(input.skillId));
      if (content === undefined) {
        return ok(null);
      }

      return isInTenant(config.context, content.skill)
        ? ok(content)
        : err(tenantGuardViolation(config.context, content.skill.workspaceId));
    },
    update: async (input) => {
      const existing = skills.get(idKey(input.skillId));
      if (existing === undefined) {
        return ok(null);
      }

      if (!isInTenant(config.context, existing.skill)) {
        return err(
          tenantGuardViolation(config.context, existing.skill.workspaceId)
        );
      }

      const content: SkillContent = {
        markdown: input.markdown,
        skill: { ...existing.skill, updatedAt: clock() },
      };

      skills.set(idKey(input.skillId), content);
      return ok(content);
    },
  };
};
