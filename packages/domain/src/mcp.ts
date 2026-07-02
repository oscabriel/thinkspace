import { z } from "zod";

import { mcpServerIdSchema, memberIdSchema, workspaceIdSchema } from "./ids";
import {
  mcpHostSchema,
  mcpServerNameSchema,
  mcpServerUrlSchema,
} from "./primitives";

export const mcpHostApprovalSchema = z.object({
  approvedAt: z.date(),
  approvedByOwnerMemberId: memberIdSchema,
  host: mcpHostSchema,
  workspaceId: workspaceIdSchema,
});
export type McpHostApproval = z.infer<typeof mcpHostApprovalSchema>;

export const mcpServerSchema = z.object({
  host: mcpHostSchema,
  id: mcpServerIdSchema,
  name: mcpServerNameSchema,
  url: mcpServerUrlSchema,
  workspaceId: workspaceIdSchema,
});
export type McpServer = z.infer<typeof mcpServerSchema>;
