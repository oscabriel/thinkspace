import type { TenantGuardViolationError } from "../errors";
import type { WorkspaceId } from "../ids";
import type { TenantContext } from "../seams/tenant-data-access";

export interface TenantScoped {
  readonly workspaceId: WorkspaceId;
}

export const idKey = (id: string): string => id;

export const hasSameId = (left: string, right: string): boolean =>
  left === right;

export const tenantGuardViolation = (
  context: TenantContext,
  observedWorkspaceId: WorkspaceId | null
): TenantGuardViolationError => ({
  expectedWorkspaceId: context.workspaceId,
  kind: "tenant_guard_violation",
  observed:
    observedWorkspaceId === null
      ? { kind: "missing" }
      : { kind: "workspace", workspaceId: observedWorkspaceId },
});

export const isInTenant = (
  context: TenantContext,
  value: TenantScoped
): boolean => hasSameId(value.workspaceId, context.workspaceId);

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
