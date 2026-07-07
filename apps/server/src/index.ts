import { env } from "@thinkspace/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { artifactRoutes } from "./artifacts";
import { createAuth } from "./auth";
import { channelRoutes } from "./channels";
import { commentRoutes } from "./comments";
import { gestureRoutes } from "./gestures";
import { hubWsRoutes } from "./hub-ws";
import { modelRoutes } from "./models";
import { providerKeyRoutes } from "./providers";
import { readRoutes } from "./reads";
import { tenantContextMiddleware } from "./tenant-context";
import { tokenRoutes } from "./token";
import { unreadRoutes } from "./unread";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    origin: env.CORS_ORIGIN,
  })
);

app.on(["POST", "GET"], "/api/auth/*", (c) => createAuth().handler(c.req.raw));

app.use("/api/w/:workspaceId/*", tenantContextMiddleware);
app.route("/api/w/:workspaceId", artifactRoutes);
app.route("/api/w/:workspaceId", channelRoutes);
app.route("/api/w/:workspaceId", commentRoutes);
app.route("/api/w/:workspaceId", gestureRoutes);
app.route("/api/w/:workspaceId", hubWsRoutes);
app.route("/api/w/:workspaceId", modelRoutes);
app.route("/api/w/:workspaceId", providerKeyRoutes);
app.route("/api/w/:workspaceId", readRoutes);
app.route("/api/w/:workspaceId", tokenRoutes);
app.route("/api/w/:workspaceId", unreadRoutes);

app.get("/", (c) => c.text("OK"));

/** Durable Object classes this worker defines (alchemy binds them; className must match). */
export {
  ChannelHubDurableObject,
  CuratorAgentDurableObject,
  ThreadAgentDurableObject,
  WorkspaceHubDurableObject,
} from "@thinkspace/domain/adapters/production";

export default app;
