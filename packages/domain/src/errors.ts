import { z } from "zod";

import {
  channelIdSchema,
  curatorSessionIdSchema,
  mcpServerIdSchema,
  memberIdSchema,
  modelIdSchema,
  runIdSchema,
  shapeIdSchema,
  threadIdSchema,
  workspaceIdSchema,
} from "./ids";
import { modelProviderSchema } from "./model";
import {
  failureReasonSchema,
  mcpHostSchema,
  nonEmptyStringSchema,
} from "./primitives";
import { roleSchema } from "./workspace";

export const authzErrorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unauthenticated") }),
  z.object({
    kind: z.literal("not_workspace_member"),
    workspaceId: workspaceIdSchema,
  }),
  z.object({
    actualRole: roleSchema,
    kind: z.literal("insufficient_role"),
    requiredRole: roleSchema,
    workspaceId: workspaceIdSchema,
  }),
  z.object({
    channelId: channelIdSchema,
    kind: z.literal("channel_not_visible"),
    memberId: memberIdSchema,
  }),
  z.object({
    channelId: channelIdSchema,
    kind: z.literal("channel_read_only"),
  }),
  z.object({ channelId: channelIdSchema, kind: z.literal("channel_deleted") }),
]);
export type AuthzError = z.infer<typeof authzErrorSchema>;

export const byokKeyMissingErrorSchema = z.object({
  kind: z.literal("byok_key_missing"),
  modelId: modelIdSchema,
  provider: modelProviderSchema,
  workspaceId: workspaceIdSchema,
});
export type ByokKeyMissingError = z.infer<typeof byokKeyMissingErrorSchema>;

export const mcpHostNotAllowedErrorSchema = z.object({
  host: mcpHostSchema,
  kind: z.literal("mcp_host_not_allowed"),
  mcpServerId: mcpServerIdSchema,
  workspaceId: workspaceIdSchema,
});
export type McpHostNotAllowedError = z.infer<
  typeof mcpHostNotAllowedErrorSchema
>;

export const observedTenantSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("missing") }),
  z.object({ kind: z.literal("workspace"), workspaceId: workspaceIdSchema }),
]);
export type ObservedTenant = z.infer<typeof observedTenantSchema>;

export const tenantGuardViolationErrorSchema = z.object({
  expectedWorkspaceId: workspaceIdSchema,
  kind: z.literal("tenant_guard_violation"),
  observed: observedTenantSchema,
});
export type TenantGuardViolationError = z.infer<
  typeof tenantGuardViolationErrorSchema
>;

export const runFailureErrorSchema = z.object({
  failureReason: failureReasonSchema,
  kind: z.literal("run_failure"),
  runId: runIdSchema,
});
export type RunFailureError = z.infer<typeof runFailureErrorSchema>;

export const curatorExecutionFailedErrorSchema = z.object({
  failureReason: failureReasonSchema,
  kind: z.literal("curator_execution_failed"),
  workspaceId: workspaceIdSchema,
});
export type CuratorExecutionFailedError = z.infer<
  typeof curatorExecutionFailedErrorSchema
>;

export const curatorSessionNotFoundErrorSchema = z.object({
  kind: z.literal("curator_session_not_found"),
  sessionId: curatorSessionIdSchema,
  workspaceId: workspaceIdSchema,
});
export type CuratorSessionNotFoundError = z.infer<
  typeof curatorSessionNotFoundErrorSchema
>;

/** ADR 0030: a Shape row is only ever written alongside / on behalf of its one channel. */
export const shapeOwnershipViolationErrorSchema = z.object({
  kind: z.literal("shape_ownership_violation"),
  shapeId: shapeIdSchema,
  violation: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("unowned_shape_write") }),
    z.object({
      kind: z.literal("shape_already_owned"),
      owningChannelId: channelIdSchema,
    }),
  ]),
  workspaceId: workspaceIdSchema,
});
export type ShapeOwnershipViolationError = z.infer<
  typeof shapeOwnershipViolationErrorSchema
>;

/**
 * A ThreadAgent address always resolves (DO-namespace semantics), so dispatching at a thread
 * that was never created lands on an agent with no resident state; it must fail closed rather
 * than mint runs at a bogus address (ADR 0016/0028).
 */
export const threadAgentUninitializedErrorSchema = z.object({
  channelId: channelIdSchema,
  kind: z.literal("thread_agent_uninitialized"),
  threadId: threadIdSchema,
  workspaceId: workspaceIdSchema,
});
export type ThreadAgentUninitializedError = z.infer<
  typeof threadAgentUninitializedErrorSchema
>;

export const realtimeHubUnavailableErrorSchema = z.object({
  kind: z.literal("realtime_hub_unavailable"),
  workspaceId: workspaceIdSchema,
});
export type RealtimeHubUnavailableError = z.infer<
  typeof realtimeHubUnavailableErrorSchema
>;

export const notImplementedErrorSchema = z.object({
  kind: z.literal("not_implemented"),
  seam: nonEmptyStringSchema,
});
export type NotImplementedError = z.infer<typeof notImplementedErrorSchema>;

export const createNotImplementedError = (seam: string): NotImplementedError =>
  notImplementedErrorSchema.parse({
    kind: "not_implemented",
    seam,
  });

export const domainErrorSchema = z.discriminatedUnion("kind", [
  ...authzErrorSchema.options,
  byokKeyMissingErrorSchema,
  mcpHostNotAllowedErrorSchema,
  tenantGuardViolationErrorSchema,
  runFailureErrorSchema,
  curatorExecutionFailedErrorSchema,
  curatorSessionNotFoundErrorSchema,
  shapeOwnershipViolationErrorSchema,
  threadAgentUninitializedErrorSchema,
  realtimeHubUnavailableErrorSchema,
  notImplementedErrorSchema,
]);
export type DomainError = z.infer<typeof domainErrorSchema>;
