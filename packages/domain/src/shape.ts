import { z } from "zod";

import {
  artifactIdSchema,
  channelIdSchema,
  mcpServerIdSchema,
  modelIdSchema,
  shapeIdSchema,
  skillIdSchema,
  toolIdSchema,
  workspaceIdSchema,
} from "./ids";
import { systemPromptSchema } from "./primitives";

export const shapeStructureSchema = z.object({
  /**
   * Cross-channel opt-ins only (ADR 0014); the home channel's artifact set is dynamic and
   * resolved at dispatch. Freezes into the thread snapshot (ADR 0007).
   */
  artifactSelection: z.array(artifactIdSchema),
  mcpServerSelection: z.array(mcpServerIdSchema),
  modelId: modelIdSchema,
  skillSelection: z.array(skillIdSchema),
  systemPrompt: systemPromptSchema,
  toolSelection: z.array(toolIdSchema),
});
export type ShapeStructure = z.infer<typeof shapeStructureSchema>;

export const shapeCloneProvenanceSchema = z.object({
  channelId: channelIdSchema,
  shapeId: shapeIdSchema,
});
export type ShapeCloneProvenance = z.infer<typeof shapeCloneProvenanceSchema>;

/**
 * Strict 1:1, channel-owned (ADR 0030): a Shape row is only ever written alongside / on
 * behalf of its single referencing Channel. Cloning copies the structure into a fresh Shape
 * and records provenance; the source channel/shape may since be archived or deleted.
 */
export const shapeSchema = z.object({
  clonedFrom: shapeCloneProvenanceSchema.nullable(),
  createdAt: z.date(),
  id: shapeIdSchema,
  structure: shapeStructureSchema,
  updatedAt: z.date(),
  workspaceId: workspaceIdSchema,
});
export type Shape = z.infer<typeof shapeSchema>;

export const shapeSnapshotSchema = z.object({
  shapeId: shapeIdSchema,
  snapshottedAt: z.date(),
  structure: shapeStructureSchema,
});
export type ShapeSnapshot = z.infer<typeof shapeSnapshotSchema>;
