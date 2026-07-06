import { Hono } from "hono";

import { createAuth } from "./auth";
import type { TenantVariables } from "./tenant-context";

/**
 * E4.1: the client's hub-connect token. The session cookie authenticates and the tenant
 * middleware has already resolved the path workspace to a member row; this route only mints
 * a short-lived JWT carrying that identity. Claims come straight off the resolved
 * TenantContext — the same source of truth every other workspace gesture reads — so the
 * token can never name a workspace/role the caller is not actually a member of, and there
 * is no parallel membership lookup to drift.
 *
 * The claims are exactly what E4.2's hub matches against its decoded address: `workspaceId`
 * (which hub), `role` (channel visibility), and `memberId` (who, also the `sub`). The
 * signature rides the JWKS the /api/auth/jwks endpoint publishes, so the hub can verify
 * offline against cached keys.
 */
export const tokenRoutes = new Hono<{ Variables: TenantVariables }>().get(
  "/token",
  async (c) => {
    const context = c.get("tenantContext");
    const { token } = await createAuth().api.signJWT({
      body: {
        payload: {
          memberId: context.memberId,
          role: context.role,
          sub: context.memberId,
          workspaceId: context.workspaceId,
        },
      },
    });
    return c.json({ token });
  }
);
