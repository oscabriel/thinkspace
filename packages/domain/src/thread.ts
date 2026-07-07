import { z } from "zod";

import {
  channelIdSchema,
  commentIdSchema,
  memberIdSchema,
  runIdSchema,
  threadIdSchema,
  workspaceIdSchema,
} from "./ids";
import {
  commentBodySchema,
  facetNameSchema,
  threadNameSchema,
} from "./primitives";
import type { CommentBody, ThreadName } from "./primitives";

export const threadLifecycleSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("active") }),
  z.object({ archivedAt: z.date(), state: z.literal("archived") }),
]);
export type ThreadLifecycle = z.infer<typeof threadLifecycleSchema>;

export const threadSchema = z.object({
  channelId: channelIdSchema,
  createdAt: z.date(),
  createdByMemberId: memberIdSchema,
  id: threadIdSchema,
  lastActivityAt: z.date(),
  lifecycle: threadLifecycleSchema,
  /** Auto-generated at creation from the opening prompt; member-editable (ADR 0020). */
  name: threadNameSchema,
  /**
   * E8.4: the thread's opening (top-level) comment id — the branch anchor a `threadId`-only
   * surface needs to render the whole thread (ADR 0025). Populated at creation from the
   * edge-minted opening comment; nullable for dev rows that predate the column (no backfill).
   */
  rootCommentId: commentIdSchema.nullable().default(null),
  workspaceId: workspaceIdSchema,
});
export type Thread = z.infer<typeof threadSchema>;

/**
 * ADR 0034 §5's pinned derivation: first non-empty line, whitespace runs collapsed,
 * hard-truncated to 80 characters; whitespace-only bodies fall back to "New thread".
 */
export const deriveThreadName = (openingBody: CommentBody): ThreadName => {
  const firstLine = openingBody
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const collapsed = (firstLine ?? "").replaceAll(/\s+/gu, " ").slice(0, 80);
  return threadNameSchema.parse(
    collapsed.length > 0 ? collapsed : "New thread"
  );
};

export const commentParentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("top_level") }),
  z.object({ kind: z.literal("nested"), parentCommentId: commentIdSchema }),
]);
export type CommentParent = z.infer<typeof commentParentSchema>;

export const channelAgentFacetSchema = z.object({
  kind: z.literal("channel_agent"),
});
export type ChannelAgentFacet = z.infer<typeof channelAgentFacetSchema>;

/** runId is the PARENT run that spawned this facet (ADR 0022/0028), not a run of its own. */
export const subAgentFacetSchema = z.object({
  kind: z.literal("sub_agent"),
  name: facetNameSchema,
  runId: runIdSchema,
});
export type SubAgentFacet = z.infer<typeof subAgentFacetSchema>;

export const agentFacetSchema = z.discriminatedUnion("kind", [
  channelAgentFacetSchema,
  subAgentFacetSchema,
]);
export type AgentFacet = z.infer<typeof agentFacetSchema>;

export const commentAuthorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("member"), memberId: memberIdSchema }),
  z.object({
    channelId: channelIdSchema,
    facet: agentFacetSchema,
    kind: z.literal("agent"),
  }),
]);
export type CommentAuthor = z.infer<typeof commentAuthorSchema>;

export const commentSchema = z.object({
  author: commentAuthorSchema,
  body: commentBodySchema,
  createdAt: z.date(),
  id: commentIdSchema,
  parent: commentParentSchema,
  threadId: threadIdSchema,
  workspaceId: workspaceIdSchema,
});
export type Comment = z.infer<typeof commentSchema>;

/**
 * Branch is a derived view anchored at rootCommentId. The agent context window is the
 * ancestor path (thread's top-level comment down to the root comment) plus the subtree
 * beneath it (ADR 0016, amended by 0025); ancestor-siblings are excluded.
 */
export const branchSchema = z.object({
  rootCommentId: commentIdSchema,
  threadId: threadIdSchema,
});
export type Branch = z.infer<typeof branchSchema>;
