import { z } from "zod";

import { memberIdSchema, toolIdSchema, workspaceIdSchema } from "./ids";
import { toolNameSchema } from "./primitives";

export const catalogToolSourceSchema = z.object({
  kind: z.literal("first_party"),
});
export type CatalogToolSource = z.infer<typeof catalogToolSourceSchema>;

export const catalogToolSchema = z.object({
  id: toolIdSchema,
  name: toolNameSchema,
  source: catalogToolSourceSchema,
});
export type CatalogTool = z.infer<typeof catalogToolSchema>;

/**
 * ADR 0004: every catalog tool is permitted by default; only per-tool disable rows are
 * stored. The absence of a disable row for a tool means that tool is permitted.
 */
export const workspaceToolDisableSchema = z.object({
  disabledAt: z.date(),
  disabledByMemberId: memberIdSchema,
  toolId: toolIdSchema,
  workspaceId: workspaceIdSchema,
});
export type WorkspaceToolDisable = z.infer<typeof workspaceToolDisableSchema>;
