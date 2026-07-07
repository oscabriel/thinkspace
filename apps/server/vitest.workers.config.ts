import { readFile } from "node:fs/promises";
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
          // E3.2: BYOK write-half config. The store id / account id / gateway id compose the
          // Secrets Store secret name; the outbound mock (api.cloudflare.com) serves the store
          // deterministically, so these are inert literals — no real CF account is contacted.
          BYOK_CF_ACCOUNT_ID: "test-cf-account",
          BYOK_CF_API_TOKEN: "test-cf-byok-token-0123456789",
          BYOK_CF_GATEWAY_ID: "test-gateway",
          BYOK_CF_STORE_ID: "test-secrets-store",
          CORS_ORIGIN: "https://test.local",
          INVITATION_FROM: "Thinkspace <no-reply@test.local>",
          INVITATION_ORIGIN: "https://test.local",
          RESEND_API_KEY: "test-resend-key-0123456789",
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(import.meta.dirname, "../../packages/db/src/migrations")
          ),
        },
        compatibilityDate: "2026-06-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        r2Buckets: ["ARTIFACTS", "SKILLS"],
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
        // Canonical egress mock, shared with packages/domain (spike finding 5): intercepts the
        // workers' global fetch — DO outbound included — serving models.dev and the AI Gateway
        // deterministically, passing everything else through. Inlined as `script` because
        // workerd refuses module paths outside its starting directory (apps/server), and the
        // one source of truth lives in packages/domain.
        outboundService: "AI_GATEWAY_MOCK",
        workers: [
          {
            modules: true,
            name: "AI_GATEWAY_MOCK",
            script: await readFile(
              path.join(
                import.meta.dirname,
                "../../packages/domain/test-workers/outbound-mock.mjs"
              ),
              "utf-8"
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
