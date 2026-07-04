import alchemy from "alchemy";
import {
  D1Database,
  DurableObjectNamespace,
  TanStackStart,
  Worker,
} from "alchemy/cloudflare";
import { config } from "dotenv";

config({ path: "./.env" });
config({ path: "../../apps/web/.env" });
config({ path: "../../apps/server/.env" });

const required = <Value>(value: Value | undefined, name: string): Value => {
  if (value === undefined) {
    throw new Error(`Missing required environment value: ${name}`);
  }
  return value;
};

const app = await alchemy("thinkspace");

const webDevPort = 3002;
const serverDevPort = 3003;
const caddyDevHost = alchemy.env.CADDY_DEV_HOST || undefined;
const caddyDevOrigin = caddyDevHost ? `https://${caddyDevHost}` : undefined;
const authUrl = required(
  caddyDevOrigin ?? alchemy.env.BETTER_AUTH_URL,
  "BETTER_AUTH_URL"
);
const corsOrigin = required(
  caddyDevOrigin ?? alchemy.env.CORS_ORIGIN,
  "CORS_ORIGIN"
);

const db = await D1Database("database", {
  migrationsDir: "../../packages/db/src/migrations",
});

/**
 * agents-SDK DOs REQUIRE sqlite: true (their state lives in DO-SQLite; alchemy applies no
 * default, and the backend choice is permanent). The first argument is the immutable stable
 * id driving alchemy's automatic DO migrations — never change it; className may be renamed.
 * See docs/alchemy-iac-verification.md.
 */
const threadAgent = DurableObjectNamespace("thread-agent", {
  className: "ThreadAgentDurableObject",
  sqlite: true,
});

const channelHub = DurableObjectNamespace("channel-hub", {
  className: "ChannelHubDurableObject",
  sqlite: true,
});

const workspaceHub = DurableObjectNamespace("workspace-hub", {
  className: "WorkspaceHubDurableObject",
  sqlite: true,
});

export const server = await Worker("server", {
  bindings: {
    BETTER_AUTH_SECRET: required(
      alchemy.secret.env.BETTER_AUTH_SECRET,
      "BETTER_AUTH_SECRET"
    ),
    BETTER_AUTH_URL: authUrl,
    CHANNEL_HUB: channelHub,
    CORS_ORIGIN: corsOrigin,
    DB: db,
    GOOGLE_GENERATIVE_AI_API_KEY: required(
      alchemy.secret.env.GOOGLE_GENERATIVE_AI_API_KEY,
      "GOOGLE_GENERATIVE_AI_API_KEY"
    ),
    THREAD_AGENT: threadAgent,
    WORKSPACE_HUB: workspaceHub,
  },
  compatibility: "node",
  cwd: "../../apps/server",
  dev: {
    port: serverDevPort,
  },
  entrypoint: "src/index.ts",
  url: true,
});

export const web = await TanStackStart("web", {
  bindings: {
    BETTER_AUTH_SECRET: required(
      alchemy.secret.env.BETTER_AUTH_SECRET,
      "BETTER_AUTH_SECRET"
    ),
    BETTER_AUTH_URL: authUrl,
    CORS_ORIGIN: corsOrigin,
    DB: db,
    GOOGLE_GENERATIVE_AI_API_KEY: required(
      alchemy.secret.env.GOOGLE_GENERATIVE_AI_API_KEY,
      "GOOGLE_GENERATIVE_AI_API_KEY"
    ),
    VITE_SERVER_URL: required(caddyDevOrigin ?? server.url, "server.url"),
  },
  cwd: "../../apps/web",
  dev: caddyDevHost
    ? {
        command: `bun vite dev --host 127.0.0.1 --port ${webDevPort}`,
        domain: caddyDevHost,
        env: {
          CADDY_DEV_HOST: caddyDevHost,
          VITE_SERVER_URL: `https://${caddyDevHost}`,
        },
      }
    : {
        command: `bun vite dev --host 127.0.0.1 --port ${webDevPort}`,
      },
});

console.log(`Web    -> ${web.url}`);
console.log(`Server -> ${server.url}`);

await app.finalize();
