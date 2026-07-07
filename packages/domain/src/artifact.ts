import { z } from "zod";

import {
  artifactIdSchema,
  artifactVersionIdSchema,
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

/**
 * An immutable version's bytes-metadata + provenance (ADR 0032). Every write appends one;
 * `r2Key` addresses this version's bytes at `${workspaceId}/artifacts/${artifactId}/${id}`.
 */
export const artifactVersionSchema = z.object({
  artifactId: artifactIdSchema,
  byteLength: byteLengthSchema,
  contentType: contentTypeSchema,
  createdAt: z.date(),
  id: artifactVersionIdSchema,
  mediaKind: artifactMediaKindSchema,
  origin: artifactOriginSchema,
  r2Key: r2KeySchema,
  workspaceId: workspaceIdSchema,
});
export type ArtifactVersion = z.infer<typeof artifactVersionSchema>;

/**
 * The stable artifact identity projected over its head version (ADR 0032): identity fields
 * (id, name, home channel) plus `headVersionId`/`updatedAt` and the head version's
 * bytes-metadata (contentType, byteLength, mediaKind, origin, r2Key). Search and list see
 * this head projection; superseded versions are reachable only from the version history.
 */
export const artifactSchema = z.object({
  byteLength: byteLengthSchema,
  contentType: contentTypeSchema,
  createdAt: z.date(),
  headVersionId: artifactVersionIdSchema,
  homeChannelId: channelIdSchema,
  id: artifactIdSchema,
  mediaKind: artifactMediaKindSchema,
  name: artifactNameSchema,
  origin: artifactOriginSchema,
  r2Key: r2KeySchema,
  updatedAt: z.date(),
  workspaceId: workspaceIdSchema,
});
export type Artifact = z.infer<typeof artifactSchema>;
