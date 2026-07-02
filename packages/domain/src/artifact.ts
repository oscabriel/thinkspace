import { z } from "zod";

import {
  artifactIdSchema,
  channelIdSchema,
  memberIdSchema,
  runIdSchema,
  threadIdSchema,
  workspaceIdSchema,
} from "./ids";
import {
  artifactNameSchema,
  byteLengthSchema,
  contentTypeSchema,
  r2KeySchema,
} from "./primitives";

export const artifactOriginSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("agent"),
    runId: runIdSchema,
    threadId: threadIdSchema,
  }),
  z.object({
    kind: z.literal("member_upload"),
    threadId: threadIdSchema.nullable(),
    uploadedByMemberId: memberIdSchema,
  }),
]);
export type ArtifactOrigin = z.infer<typeof artifactOriginSchema>;

/** Search is determined by kind: text_extractable → lexical search, binary → metadata search (ADR 0024). */
export const artifactMediaKindSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text_extractable") }),
  z.object({ kind: z.literal("binary") }),
]);
export type ArtifactMediaKind = z.infer<typeof artifactMediaKindSchema>;

export const artifactSchema = z.object({
  byteLength: byteLengthSchema,
  contentType: contentTypeSchema,
  createdAt: z.date(),
  homeChannelId: channelIdSchema,
  id: artifactIdSchema,
  mediaKind: artifactMediaKindSchema,
  name: artifactNameSchema,
  origin: artifactOriginSchema,
  r2Key: r2KeySchema,
  workspaceId: workspaceIdSchema,
});
export type Artifact = z.infer<typeof artifactSchema>;
