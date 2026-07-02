import { z } from "zod";

import { channelLifecycleSchema, visibilitySchema } from "./channel";
import { channelIdSchema, memberIdSchema, workspaceIdSchema } from "./ids";
import { directorySearchQuerySchema, goalSchema } from "./primitives";

/** ADR 0023 directory filters; all-null lists every visible channel. */
export const directorySearchSchema = z.object({
  ownerMemberId: memberIdSchema.nullable(),
  query: directorySearchQuerySchema.nullable(),
  status: z.enum(["active", "archived"]).nullable(),
});
export type DirectorySearch = z.infer<typeof directorySearchSchema>;

export const channelDirectoryEntrySchema = z.object({
  channelId: channelIdSchema,
  goal: goalSchema,
  lifecycle: channelLifecycleSchema,
  ownerMemberId: memberIdSchema,
  visibility: visibilitySchema,
});
export type ChannelDirectoryEntry = z.infer<typeof channelDirectoryEntrySchema>;

export const channelDirectorySchema = z.object({
  entries: z.array(channelDirectoryEntrySchema),
  workspaceId: workspaceIdSchema,
});
export type ChannelDirectory = z.infer<typeof channelDirectorySchema>;
