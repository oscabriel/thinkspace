import { z } from "zod";

export const nonEmptyStringSchema = z.string().min(1);
export type NonEmptyString = z.infer<typeof nonEmptyStringSchema>;

export const workspaceNameSchema =
  nonEmptyStringSchema.brand<"WorkspaceName">();
export type WorkspaceName = z.infer<typeof workspaceNameSchema>;

export const goalSchema = nonEmptyStringSchema.brand<"Goal">();
export type Goal = z.infer<typeof goalSchema>;

export const systemPromptSchema = nonEmptyStringSchema.brand<"SystemPrompt">();
export type SystemPrompt = z.infer<typeof systemPromptSchema>;

export const threadNameSchema = nonEmptyStringSchema.brand<"ThreadName">();
export type ThreadName = z.infer<typeof threadNameSchema>;

export const commentBodySchema = nonEmptyStringSchema.brand<"CommentBody">();
export type CommentBody = z.infer<typeof commentBodySchema>;

export const facetNameSchema = nonEmptyStringSchema.brand<"FacetName">();
export type FacetName = z.infer<typeof facetNameSchema>;

export const toolNameSchema = nonEmptyStringSchema.brand<"ToolName">();
export type ToolName = z.infer<typeof toolNameSchema>;

export const skillNameSchema = nonEmptyStringSchema.brand<"SkillName">();
export type SkillName = z.infer<typeof skillNameSchema>;

export const skillMarkdownSchema =
  nonEmptyStringSchema.brand<"SkillMarkdown">();
export type SkillMarkdown = z.infer<typeof skillMarkdownSchema>;

export const directorySearchQuerySchema =
  nonEmptyStringSchema.brand<"DirectorySearchQuery">();
export type DirectorySearchQuery = z.infer<typeof directorySearchQuerySchema>;

export const curatorPromptSchema =
  nonEmptyStringSchema.brand<"CuratorPrompt">();
export type CuratorPrompt = z.infer<typeof curatorPromptSchema>;

export const curatorReplySchema = nonEmptyStringSchema.brand<"CuratorReply">();
export type CuratorReply = z.infer<typeof curatorReplySchema>;

export const mcpServerNameSchema =
  nonEmptyStringSchema.brand<"McpServerName">();
export type McpServerName = z.infer<typeof mcpServerNameSchema>;

export const mcpHostSchema = nonEmptyStringSchema.brand<"McpHost">();
export type McpHost = z.infer<typeof mcpHostSchema>;

export const mcpServerUrlSchema = z.url().brand<"McpServerUrl">();
export type McpServerUrl = z.infer<typeof mcpServerUrlSchema>;

export const secretAliasSchema = nonEmptyStringSchema.brand<"SecretAlias">();
export type SecretAlias = z.infer<typeof secretAliasSchema>;

export const artifactSearchQuerySchema =
  nonEmptyStringSchema.brand<"ArtifactSearchQuery">();
export type ArtifactSearchQuery = z.infer<typeof artifactSearchQuerySchema>;

export const recurrenceRuleSchema =
  nonEmptyStringSchema.brand<"RecurrenceRule">();
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;

export const schedulePromptSchema =
  nonEmptyStringSchema.brand<"SchedulePrompt">();
export type SchedulePrompt = z.infer<typeof schedulePromptSchema>;

export const artifactNameSchema = nonEmptyStringSchema.brand<"ArtifactName">();
export type ArtifactName = z.infer<typeof artifactNameSchema>;

export const contentTypeSchema = nonEmptyStringSchema.brand<"ContentType">();
export type ContentType = z.infer<typeof contentTypeSchema>;

export const r2KeySchema = nonEmptyStringSchema.brand<"R2Key">();
export type R2Key = z.infer<typeof r2KeySchema>;

export const failureReasonSchema =
  nonEmptyStringSchema.brand<"FailureReason">();
export type FailureReason = z.infer<typeof failureReasonSchema>;

export const byteLengthSchema = z.number().int().nonnegative();
export type ByteLength = z.infer<typeof byteLengthSchema>;
