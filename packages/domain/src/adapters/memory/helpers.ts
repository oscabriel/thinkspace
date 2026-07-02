import type { TenantGuardViolationError } from "../../errors";
import type { WorkspaceId } from "../../ids";
import type { TenantContext } from "../../seams/tenant-data-access";

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
