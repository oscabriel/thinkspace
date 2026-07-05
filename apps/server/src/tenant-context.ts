import { createDb } from "@thinkspace/db";
import { member } from "@thinkspace/db/schema/auth";
import { memberIdSchema, workspaceIdSchema } from "@thinkspace/domain/ids";
import { err, ok } from "@thinkspace/domain/result";
import type { AsyncResult } from "@thinkspace/domain/result";
import type { TenantContext } from "@thinkspace/domain/seams/tenant-data-access";
import { roleSchema } from "@thinkspace/domain/workspace";
import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { z } from "zod";

import { createAuth } from "./auth";

/** ADR 0035 §4: the edge's whole error vocabulary — unauthenticated→401, not_a_member→404, malformed_identity→500. */
export type TenantResolutionError =
  | { readonly kind: "malformed_identity" }
  | { readonly kind: "not_a_member" }
  | { readonly kind: "unauthenticated" };

const tenantContextSchema = z.object({
  memberId: memberIdSchema,
  role: roleSchema,
  workspaceId: workspaceIdSchema,
});

/**
 * ADR 0035 §3–§5: session via better-auth, member row for (userId, path workspaceId)
 * by direct drizzle query; workspace identity is path-resident, never session-resident.
 */
export const resolveTenantContext = async (
  request: Request,
  workspaceId: string
): AsyncResult<TenantContext, TenantResolutionError> => {
  const session = await createAuth().api.getSession({
    headers: request.headers,
  });
  if (session === null) {
    return err({ kind: "unauthenticated" });
  }

  const [memberRow] = await createDb()
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(
      and(
        eq(member.userId, session.user.id),
        eq(member.organizationId, workspaceId)
      )
    )
    .limit(1);
  if (memberRow === undefined) {
    return err({ kind: "not_a_member" });
  }

  const context = tenantContextSchema.safeParse({
    memberId: memberRow.id,
    role: memberRow.role,
    workspaceId,
  });
  return context.success
    ? ok(context.data)
    : err({ kind: "malformed_identity" });
};

export interface TenantVariables {
  readonly tenantContext: TenantContext;
}

const resolutionErrorStatus = {
  malformed_identity: 500,
  not_a_member: 404,
  unauthenticated: 401,
} as const;

/** The thin middleware half of the seam: resolves the path workspace onto c.var, or ends the request. */
export const tenantContextMiddleware = createMiddleware<{
  Variables: TenantVariables;
}>(async (c, next) => {
  const resolved = await resolveTenantContext(
    c.req.raw,
    c.req.param("workspaceId") ?? ""
  );
  if (!resolved.ok) {
    return c.json(
      { error: { kind: resolved.error.kind } },
      resolutionErrorStatus[resolved.error.kind]
    );
  }
  c.set("tenantContext", resolved.value);
  return next();
});
