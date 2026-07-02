import { z } from "zod";

import {
  commentIdSchema,
  memberIdSchema,
  runIdSchema,
  threadIdSchema,
  workspaceIdSchema,
} from "./ids";

export const unreadReasonSchema = z.discriminatedUnion("kind", [
  z.object({
    commentId: commentIdSchema,
    kind: z.literal("agent_output"),
    runId: runIdSchema,
  }),
  z.object({
    commentId: commentIdSchema,
    kind: z.literal("co_participant_activity"),
  }),
]);
export type UnreadReason = z.infer<typeof unreadReasonSchema>;

export const unreadSchema = z.object({
  bumpedAt: z.date(),
  memberId: memberIdSchema,
  reasons: z.array(unreadReasonSchema).min(1),
  threadId: threadIdSchema,
  workspaceId: workspaceIdSchema,
});
export type Unread = z.infer<typeof unreadSchema>;
