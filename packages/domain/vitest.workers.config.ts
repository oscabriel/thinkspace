import path from "node:path";

import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./test-workers/worker.ts",
      miniflare: {
        bindings: {
          AI_GATEWAY_TOKEN: "test-ai-gateway-token-0123456789",
          AI_GATEWAY_URL:
            "https://gateway.ai.cloudflare.com/v1/test-account/test-gateway",
          // E4.2: the auth origin's JWKS endpoint. The outbound mock serves the matching
          // public key at this host, mirroring how the AI Gateway literals are wired.
          AUTH_JWKS_URL: "https://auth.test.local/api/auth/jwks",
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(import.meta.dirname, "../db/src/migrations")
          ),
        },
        compatibilityDate: "2026-06-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        r2Buckets: ["ARTIFACTS"],
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
        // Canonical egress mock (spike finding 5): dispatches the workers' global fetch — DO
        // outbound included — through the fixture worker; models.dev and the AI Gateway are
        // served deterministically, everything else passes through.
        outboundService: "AI_GATEWAY_MOCK",
        workers: [
          {
            modules: true,
            name: "AI_GATEWAY_MOCK",
            scriptPath: path.join(
              import.meta.dirname,
              "test-workers/outbound-mock.mjs"
            ),
          },
        ],
      },
    })),
  ],
  test: {
    include: ["test-workers/**/*.test.ts"],
    setupFiles: ["./test-workers/apply-migrations.ts"],
  },
});
