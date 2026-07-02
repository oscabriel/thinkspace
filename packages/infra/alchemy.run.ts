import alchemy from "alchemy";
import { D1Database, TanStackStart, Worker } from "alchemy/cloudflare";
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

const db = await D1Database("database", {
  migrationsDir: "../../packages/db/src/migrations",
});

export const server = await Worker("server", {
  bindings: {
    BETTER_AUTH_SECRET: required(
      alchemy.secret.env.BETTER_AUTH_SECRET,
      "BETTER_AUTH_SECRET"
    ),
    BETTER_AUTH_URL: required(alchemy.env.BETTER_AUTH_URL, "BETTER_AUTH_URL"),
    CORS_ORIGIN: required(alchemy.env.CORS_ORIGIN, "CORS_ORIGIN"),
    DB: db,
    GOOGLE_GENERATIVE_AI_API_KEY: required(
      alchemy.secret.env.GOOGLE_GENERATIVE_AI_API_KEY,
      "GOOGLE_GENERATIVE_AI_API_KEY"
    ),
  },
  compatibility: "node",
  cwd: "../../apps/server",
  dev: {
    port: 3000,
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
    BETTER_AUTH_URL: required(alchemy.env.BETTER_AUTH_URL, "BETTER_AUTH_URL"),
    CORS_ORIGIN: required(alchemy.env.CORS_ORIGIN, "CORS_ORIGIN"),
    DB: db,
    GOOGLE_GENERATIVE_AI_API_KEY: required(
      alchemy.secret.env.GOOGLE_GENERATIVE_AI_API_KEY,
      "GOOGLE_GENERATIVE_AI_API_KEY"
    ),
    VITE_SERVER_URL: required(server.url, "server.url"),
  },
  cwd: "../../apps/web",
});

console.log(`Web    -> ${web.url}`);
console.log(`Server -> ${server.url}`);

await app.finalize();
