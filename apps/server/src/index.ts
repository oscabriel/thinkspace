import { env } from "@thinkspace/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { artifactRoutes } from "./artifacts";
import { createAuth } from "./auth";
import { channelRoutes } from "./channels";
import { gestureRoutes } from "./gestures";
import { providerKeyRoutes } from "./providers";
import { readRoutes } from "./reads";
import { tenantContextMiddleware } from "./tenant-context";
import { tokenRoutes } from "./token";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
    credentials: true,
    origin: env.CORS_ORIGIN,
  })
);

app.on(["POST", "GET"], "/api/auth/*", (c) => createAuth().handler(c.req.raw));

app.use("/api/w/:workspaceId/*", tenantContextMiddleware);
app.route("/api/w/:workspaceId", artifactRoutes);
app.route("/api/w/:workspaceId", channelRoutes);
app.route("/api/w/:workspaceId", gestureRoutes);
app.route("/api/w/:workspaceId", providerKeyRoutes);
app.route("/api/w/:workspaceId", readRoutes);
app.route("/api/w/:workspaceId", tokenRoutes);

app.get("/", (c) => c.text("OK"));

/** Durable Object classes this worker defines (alchemy binds them; className must match). */
export {
  ChannelHubDurableObject,
  CuratorAgentDurableObject,
  ThreadAgentDurableObject,
  WorkspaceHubDurableObject,
} from "@thinkspace/domain/adapters/production";

export default app;
