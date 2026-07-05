import type { AuthzError, TenantGuardViolationError } from "../errors";
import type { WorkspaceId } from "../ids";
import { err, ok } from "../result";
import type { Result } from "../result";
import type {
  DataAccessContext,
  TenantContext,
} from "../seams/tenant-data-access";

export interface TenantScoped {
  readonly workspaceId: WorkspaceId;
}

export const idKey = (id: string): string => id;

export const hasSameId = (left: string, right: string): boolean =>
  left === right;

export const tenantGuardViolation = (
  context: DataAccessContext,
  observedWorkspaceId: WorkspaceId | null
): TenantGuardViolationError => ({
  expectedWorkspaceId: context.workspaceId,
  kind: "tenant_guard_violation",
  observed:
    observedWorkspaceId === null
      ? { kind: "missing" }
      : { kind: "workspace", workspaceId: observedWorkspaceId },
});

/** The tenant guard reads workspaceId from either context variant (ADR 0035 §1). */
export const isInTenant = (
  context: DataAccessContext,
  value: TenantScoped
): boolean => hasSameId(value.workspaceId, context.workspaceId);

/**
 * ADR 0035 §1: member-visibility reads fail closed under a system context — "the sidebar
 * as seen by nobody" is a meaningless question; returning all channels would invent an
 * answer for it.
 */
export const requireMemberContext = (
  context: DataAccessContext
): Result<TenantContext, AuthzError> =>
  "kind" in context
    ? err({ kind: "not_workspace_member", workspaceId: context.workspaceId })
    : ok(context);

const isoDatePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

/** Revives Date-valued fields (domain convention: keys ending in "At") from stored JSON. */
export const parseJsonColumn = <Value>(text: string): Value =>
  JSON.parse(text, (key, value: unknown) =>
    typeof value === "string" &&
    key.endsWith("At") &&
    isoDatePattern.test(value)
      ? new Date(value)
      : value
  ) as Value;
