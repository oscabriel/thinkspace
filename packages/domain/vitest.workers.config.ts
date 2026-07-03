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
          TEST_MIGRATIONS: await readD1Migrations(
            path.join(import.meta.dirname, "../db/src/migrations")
          ),
        },
        compatibilityDate: "2026-06-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        durableObjects: {
          THREAD_AGENT: {
            className: "ThreadAgentDurableObject",
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
