import { z } from "zod";

import {
  channelIdSchema,
  commentIdSchema,
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

/**
 * ADR 0040: an envelope-sealed provider key that will not open — a wrong `BYOK_MASTER_KEY`, a
 * corrupt ciphertext/IV, or a failed GCM tag check. The turn-time KeyStore resolve fails closed
 * with this instead of decrypting to garbage or throwing a raw crypto error (which the run path
 * would surface). Redaction-safe by construction: it carries only routing ids, never key bytes.
 */
export const byokKeyUndecryptableErrorSchema = z.object({
  kind: z.literal("byok_key_undecryptable"),
  modelId: modelIdSchema,
  provider: modelProviderSchema,
  workspaceId: workspaceIdSchema,
});
export type ByokKeyUndecryptableError = z.infer<
  typeof byokKeyUndecryptableErrorSchema
>;

export const modelNotInCatalogErrorSchema = z.object({
  kind: z.literal("model_not_in_catalog"),
  modelId: modelIdSchema,
  workspaceId: workspaceIdSchema,
});
export type ModelNotInCatalogError = z.infer<
  typeof modelNotInCatalogErrorSchema
>;

export const catalogUnavailableErrorSchema = z.object({
  kind: z.literal("catalog_unavailable"),
});
export type CatalogUnavailableError = z.infer<
  typeof catalogUnavailableErrorSchema
>;

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

/**
 * ADR 0033 addressing applied to the curator (ADR 0026 DO-per-member): a curator DO whose
 * name does not decode into a workspace/member address (bad route, forged name, directory
 * bypass) executes nothing and fails closed with this. doName carries no tenant data by
 * construction — it failed to decode into ids.
 */
export const curatorUnaddressableErrorSchema = z.object({
  doName: z.string(),
  kind: z.literal("curator_unaddressable"),
});
export type CuratorUnaddressableError = z.infer<
  typeof curatorUnaddressableErrorSchema
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
 * ADR 0018: hard-delete is a distinct, deliberate action reached only from the archived
 * state ("archived-first"). Deleting a still-active channel is a lifecycle conflict, not an
 * authz failure — the edge maps it to 409.
 */
export const channelNotArchivedErrorSchema = z.object({
  channelId: channelIdSchema,
  kind: z.literal("channel_not_archived"),
});
export type ChannelNotArchivedError = z.infer<
  typeof channelNotArchivedErrorSchema
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

/**
 * ADR 0033: the DO name is the address; a DO whose name does not decode (bad route,
 * forged name, directory-bypassing caller) executes nothing and fails closed with this.
 * doName carries no tenant data by construction — it failed to decode into ids.
 */
export const threadAgentUnaddressableErrorSchema = z.object({
  doName: z.string(),
  kind: z.literal("thread_agent_unaddressable"),
});
export type ThreadAgentUnaddressableError = z.infer<
  typeof threadAgentUnaddressableErrorSchema
>;

/**
 * E8.4: a member reply names a parent comment that is not resident in the thread's tree
 * (a stale/forged parent id, or a cross-thread reference). The append fails closed rather
 * than orphan a comment under a parent the branch read can never anchor.
 */
export const commentParentNotInThreadErrorSchema = z.object({
  kind: z.literal("comment_parent_not_in_thread"),
  parentCommentId: commentIdSchema,
  threadId: threadIdSchema,
  workspaceId: workspaceIdSchema,
});
export type CommentParentNotInThreadError = z.infer<
  typeof commentParentNotInThreadErrorSchema
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
  catalogUnavailableErrorSchema,
  modelNotInCatalogErrorSchema,
  mcpHostNotAllowedErrorSchema,
  tenantGuardViolationErrorSchema,
  runFailureErrorSchema,
  curatorExecutionFailedErrorSchema,
  curatorSessionNotFoundErrorSchema,
  curatorUnaddressableErrorSchema,
  shapeOwnershipViolationErrorSchema,
  channelNotArchivedErrorSchema,
  commentParentNotInThreadErrorSchema,
  threadAgentUnaddressableErrorSchema,
  threadAgentUninitializedErrorSchema,
  realtimeHubUnavailableErrorSchema,
  notImplementedErrorSchema,
]);
export type DomainError = z.infer<typeof domainErrorSchema>;
