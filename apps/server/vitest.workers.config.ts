import path from "node:path";

import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./src/index.ts",
      miniflare: {
        bindings: {
          AI_GATEWAY_TOKEN: "test-ai-gateway-token-0123456789",
          AI_GATEWAY_URL:
            "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway",
          BETTER_AUTH_SECRET: "test-secret-for-workers-tests-0123456789",
          BETTER_AUTH_URL: "https://test.local",
          CORS_ORIGIN: "https://test.local",
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(import.meta.dirname, "../../packages/db/src/migrations")
          ),
        },
        compatibilityDate: "2026-06-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        durableObjects: {
          CHANNEL_HUB: {
            className: "ChannelHubDurableObject",
            useSQLite: true,
          },
          THREAD_AGENT: {
            className: "ThreadAgentDurableObject",
            useSQLite: true,
          },
          WORKSPACE_HUB: {
            className: "WorkspaceHubDurableObject",
            useSQLite: true,
          },
        },
      },
    })),
  ],
  test: {
    include: ["test-workers/**/*.test.ts"],
    setupFiles: ["./test-workers/apply-migrations.ts"],
  },
});
