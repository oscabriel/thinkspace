import { getChannelHubStub } from "@thinkspace/domain/adapters/production";
import { channelIdSchema } from "@thinkspace/domain/ids";
import { env } from "@thinkspace/env/server";
import { Hono } from "hono";

import type { TenantVariables } from "./tenant-context";

/**
 * E7.4 / E4.2 (baked decision 5): the browser's WebSocket entry to a channel hub. No edge
 * route previously proxied a browser WS upgrade to the ChannelHubDurableObject — the hub was
 * only reachable via DO stubs in tests. This route forwards the upgrade to the DO addressed by
 * `encodeChannelHubName(context, { channelId })` (via `getChannelHubStub`) and returns its 101
 * response untouched.
 *
 * Authz split (recorded reasoning): the route sits under the existing `/api/w/:workspaceId/*`
 * tenant middleware, so a valid session cookie + membership is a cheap edge pre-check (the
 * browser sends the session cookie on the same-site WS handshake). But that is defense in depth
 * only — the *authoritative* authz is the hub DO's own JWT verification (baked decision 5: no
 * session cookie is trusted over WS; the short-lived hub JWT in `?token=` is). The edge route
 * therefore performs no authz of its own beyond brand-parsing the address and requiring the
 * upgrade header; it just routes. A malformed channel id cannot name a hub — 404, like every
 * other path-id route (ADR 0035 §7). A non-upgrade request is a client error — 426.
 */
export const hubWsRoutes = new Hono<{ Variables: TenantVariables }>().get(
  "/channels/:channelId/ws",
  async (c) => {
    const context = c.get("tenantContext");

    const channelId = channelIdSchema.safeParse(c.req.param("channelId"));
    if (!channelId.success) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return c.json({ error: { kind: "upgrade_required" } }, 426);
    }

    const stub = await getChannelHubStub({
      address: { channelId: channelId.data },
      context: { workspaceId: context.workspaceId },
      namespace: env.CHANNEL_HUB,
    });
    return stub.fetch(c.req.raw);
  }
);
