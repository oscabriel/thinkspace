import { z } from "zod";

import {
  channelIdSchema,
  memberIdSchema,
  shapeIdSchema,
  workspaceIdSchema,
} from "./ids";
import { goalSchema } from "./primitives";

export const visibilitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("shared") }),
  z.object({ kind: z.literal("private") }),
]);
export type Visibility = z.infer<typeof visibilitySchema>;

export const channelLifecycleSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("active") }),
  z.object({ archivedAt: z.date(), state: z.literal("archived") }),
  z.object({
    archivedAt: z.date().nullable(),
    deletedAt: z.date(),
    state: z.literal("deleted"),
  }),
]);
export type ChannelLifecycle = z.infer<typeof channelLifecycleSchema>;

/**
 * Channel is the product/domain agent identity. The per-thread Durable Object runtime is a
 * ThreadAgent adapter concern, not a separate user-facing agent in the domain model.
 */
export const channelSchema = z.object({
  createdAt: z.date(),
  goal: goalSchema,
  id: channelIdSchema,
  lifecycle: channelLifecycleSchema,
  ownerMemberId: memberIdSchema,
  shapeId: shapeIdSchema,
  visibility: visibilitySchema,
  workspaceId: workspaceIdSchema,
});
export type Channel = z.infer<typeof channelSchema>;

/** ADR 0020: per-member channel favorites drive the sidebar's favorites section. */
export const channelFavoriteSchema = z.object({
  channelId: channelIdSchema,
  favoritedAt: z.date(),
  memberId: memberIdSchema,
  workspaceId: workspaceIdSchema,
});
export type ChannelFavorite = z.infer<typeof channelFavoriteSchema>;
