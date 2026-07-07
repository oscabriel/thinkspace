import { createD1TenantDataAccess } from "@thinkspace/domain/adapters/production";
import { threadIdSchema } from "@thinkspace/domain/ids";
import { env } from "@thinkspace/env/server";
import { Hono } from "hono";

import { domainErrorStatus } from "./error-translation";
import type { TenantVariables } from "./tenant-context";

/**
 * E7.4 / ADR 0027: unread clearing. The read/gesture surface could *write* unread rows
 * (`put_unread` on run completion) but never clear them — ADR 0027 specifies a `delete_unread`
 * batch command "issued by the edge when the member opens the thread", yet no HTTP route
 * exposed it. This is that route (smallest gesture, gestures.ts discipline).
 *
 * The acting member comes from the resolved TenantContext, never the wire: a member can only
 * clear *their own* unread, so the body is empty and the command's `memberId` is `context`'s.
 * The mid-read race (a run completing while the member reads) is benign per ADR 0027 — worst
 * case the badge clears a beat early and reappears on the next bump. A malformed thread id
 * cannot name anything — 404, same as every other path-id route (ADR 0035 §7).
 */
export const unreadRoutes = new Hono<{ Variables: TenantVariables }>().post(
  "/threads/:threadId/read",
  async (c) => {
    const context = c.get("tenantContext");

    const threadId = threadIdSchema.safeParse(c.req.param("threadId"));
    if (!threadId.success) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    const cleared = await createD1TenantDataAccess({
      context,
      db: env.DB,
    }).batch({
      commands: [
        {
          kind: "delete_unread",
          memberId: context.memberId,
          threadId: threadId.data,
        },
      ],
      workspaceId: context.workspaceId,
    });
    if (!cleared.ok) {
      return c.json({ error: cleared.error }, domainErrorStatus(cleared.error));
    }

    return c.json({ ok: true }, 200);
  }
);
