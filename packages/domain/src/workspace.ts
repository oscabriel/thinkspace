import { z } from "zod";

import { memberIdSchema, userIdSchema, workspaceIdSchema } from "./ids";
import { workspaceNameSchema } from "./primitives";

export const roleSchema = z.enum(["owner", "admin", "member"]);
export type Role = z.infer<typeof roleSchema>;

export const workspaceSchema = z.object({
  id: workspaceIdSchema,
  name: workspaceNameSchema,
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const memberSchema = z.object({
  id: memberIdSchema,
  role: roleSchema,
  userId: userIdSchema,
  workspaceId: workspaceIdSchema,
});
export type Member = z.infer<typeof memberSchema>;
