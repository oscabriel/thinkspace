import { env } from "@thinkspace/env/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { createAuth } from "./auth";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: true,
    origin: env.CORS_ORIGIN,
  })
);

app.on(["POST", "GET"], "/api/auth/*", (c) => createAuth().handler(c.req.raw));

app.get("/", (c) => c.text("OK"));

/** Durable Object classes this worker defines (alchemy binds them; className must match). */
export {
  ChannelHubDurableObject,
  ThreadAgentDurableObject,
  WorkspaceHubDurableObject,
} from "@thinkspace/domain/adapters/production";

export default app;
