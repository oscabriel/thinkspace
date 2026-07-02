import { z } from "zod";

import {
  channelIdSchema,
  commentIdSchema,
  memberIdSchema,
  runIdSchema,
  scheduleIdSchema,
  threadIdSchema,
  workspaceIdSchema,
} from "./ids";
import {
  facetNameSchema,
  failureReasonSchema,
  recurrenceRuleSchema,
  schedulePromptSchema,
} from "./primitives";

export const dispatchSchema = z.object({
  byMemberId: memberIdSchema,
  targetCommentId: commentIdSchema,
});
export type Dispatch = z.infer<typeof dispatchSchema>;

export const scheduleSchema = z.object({
  active: z.boolean(),
  channelId: channelIdSchema,
  createdAt: z.date(),
  createdByMemberId: memberIdSchema,
  id: scheduleIdSchema,
  prompt: schedulePromptSchema,
  recurrence: recurrenceRuleSchema,
  threadId: threadIdSchema,
  workspaceId: workspaceIdSchema,
});
export type Schedule = z.infer<typeof scheduleSchema>;

export const runTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ dispatch: dispatchSchema, kind: z.literal("dispatch") }),
  z.object({ kind: z.literal("schedule"), scheduleId: scheduleIdSchema }),
]);
export type RunTrigger = z.infer<typeof runTriggerSchema>;

const runBaseSchema = z.object({
  channelId: channelIdSchema,
  id: runIdSchema,
  queuedAt: z.date(),
  threadId: threadIdSchema,
  trigger: runTriggerSchema,
  workspaceId: workspaceIdSchema,
});

export const queuedRunSchema = runBaseSchema.extend({
  lifecycle: z.literal("queued"),
});
export type QueuedRun = z.infer<typeof queuedRunSchema>;

export const runningRunSchema = runBaseSchema.extend({
  lifecycle: z.literal("running"),
  startedAt: z.date(),
});
export type RunningRun = z.infer<typeof runningRunSchema>;

export const completeRunSchema = runBaseSchema.extend({
  completedAt: z.date(),
  lifecycle: z.literal("complete"),
  outputCommentId: commentIdSchema,
  startedAt: z.date(),
});
export type CompleteRun = z.infer<typeof completeRunSchema>;

export const runFailureSchema = z.discriminatedUnion("from", [
  z.object({
    failedAt: z.date(),
    failureReason: failureReasonSchema,
    from: z.literal("queued"),
  }),
  z.object({
    failedAt: z.date(),
    failureReason: failureReasonSchema,
    from: z.literal("running"),
    startedAt: z.date(),
  }),
]);
export type RunFailure = z.infer<typeof runFailureSchema>;

export const failedRunSchema = runBaseSchema.extend({
  failure: runFailureSchema,
  lifecycle: z.literal("failed"),
});
export type FailedRun = z.infer<typeof failedRunSchema>;

export const runSchema = z.discriminatedUnion("lifecycle", [
  queuedRunSchema,
  runningRunSchema,
  completeRunSchema,
  failedRunSchema,
]);
export type Run = z.infer<typeof runSchema>;

export const subAgentActivityStatusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("running"), startedAt: z.date() }),
  z.object({
    completedAt: z.date(),
    kind: z.literal("complete"),
    outputCommentId: commentIdSchema,
    startedAt: z.date(),
  }),
  z.object({
    failedAt: z.date(),
    failureReason: failureReasonSchema,
    kind: z.literal("failed"),
    startedAt: z.date(),
  }),
]);
export type SubAgentActivityStatus = z.infer<
  typeof subAgentActivityStatusSchema
>;

/**
 * Sub-agent work is state OF the parent run, not a run itself (ADR 0028): runId is the
 * PARENT run that spawned the facet. Dispatch and Schedule remain the only two Run triggers.
 */
export const subAgentActivitySchema = z.object({
  name: facetNameSchema,
  runId: runIdSchema,
  status: subAgentActivityStatusSchema,
});
export type SubAgentActivity = z.infer<typeof subAgentActivitySchema>;
