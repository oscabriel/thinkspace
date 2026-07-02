import { z } from "zod";

import { skillIdSchema, workspaceIdSchema } from "./ids";
import { r2KeySchema, skillNameSchema } from "./primitives";

export const skillStorageSchema = z.object({
  kind: z.literal("r2_markdown"),
  r2Key: r2KeySchema,
});
export type SkillStorage = z.infer<typeof skillStorageSchema>;

export const skillSchema = z.object({
  createdAt: z.date(),
  id: skillIdSchema,
  name: skillNameSchema,
  storage: skillStorageSchema,
  updatedAt: z.date(),
  workspaceId: workspaceIdSchema,
});
export type Skill = z.infer<typeof skillSchema>;
