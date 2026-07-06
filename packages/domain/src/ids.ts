import { z } from "zod";

const nonEmptyIdSchema = z.string().min(1);

export const userIdSchema = nonEmptyIdSchema.brand<"UserId">();
export type UserId = z.infer<typeof userIdSchema>;

export const workspaceIdSchema = nonEmptyIdSchema.brand<"WorkspaceId">();
export type WorkspaceId = z.infer<typeof workspaceIdSchema>;

export const memberIdSchema = nonEmptyIdSchema.brand<"MemberId">();
export type MemberId = z.infer<typeof memberIdSchema>;

export const channelIdSchema = nonEmptyIdSchema.brand<"ChannelId">();
export type ChannelId = z.infer<typeof channelIdSchema>;

export const shapeIdSchema = nonEmptyIdSchema.brand<"ShapeId">();
export type ShapeId = z.infer<typeof shapeIdSchema>;

export const threadIdSchema = nonEmptyIdSchema.brand<"ThreadId">();
export type ThreadId = z.infer<typeof threadIdSchema>;

export const commentIdSchema = nonEmptyIdSchema.brand<"CommentId">();
export type CommentId = z.infer<typeof commentIdSchema>;

export const runIdSchema = nonEmptyIdSchema.brand<"RunId">();
export type RunId = z.infer<typeof runIdSchema>;

export const scheduleIdSchema = nonEmptyIdSchema.brand<"ScheduleId">();
export type ScheduleId = z.infer<typeof scheduleIdSchema>;

export const artifactIdSchema = nonEmptyIdSchema.brand<"ArtifactId">();
export type ArtifactId = z.infer<typeof artifactIdSchema>;

export const toolIdSchema = nonEmptyIdSchema.brand<"ToolId">();
export type ToolId = z.infer<typeof toolIdSchema>;

export const skillIdSchema = nonEmptyIdSchema.brand<"SkillId">();
export type SkillId = z.infer<typeof skillIdSchema>;

export const mcpServerIdSchema = nonEmptyIdSchema.brand<"McpServerId">();
export type McpServerId = z.infer<typeof mcpServerIdSchema>;

/**
 * A ModelId is the composite `<providerId>/<modelSlug>`. models.dev model ids are unique only
 * within a provider, so the provider segment is what makes the id globally addressable (E1.2).
 */
const modelIdPattern = /^[^/]+\/[^/]+$/u;
export const modelIdSchema = nonEmptyIdSchema
  .regex(modelIdPattern, "ModelId must be '<providerId>/<modelSlug>'")
  .brand<"ModelId">();
export type ModelId = z.infer<typeof modelIdSchema>;

export const formatModelId = (providerId: string, modelSlug: string): ModelId =>
  modelIdSchema.parse(`${providerId}/${modelSlug}`);

export const parseModelId = (
  modelId: ModelId
): { readonly modelSlug: string; readonly providerId: string } => {
  const slashIndex = modelId.indexOf("/");
  return {
    modelSlug: modelId.slice(slashIndex + 1),
    providerId: modelId.slice(0, slashIndex),
  };
};

export const curatorSessionIdSchema =
  nonEmptyIdSchema.brand<"CuratorSessionId">();
export type CuratorSessionId = z.infer<typeof curatorSessionIdSchema>;
