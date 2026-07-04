/// <reference types="@cloudflare/vitest-pool-workers/types" />
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

import type { ThreadAgentDurableObject } from "../src/adapters/production/thread-agent";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    TEST_MIGRATIONS: D1Migration[];
    THREAD_AGENT: DurableObjectNamespace<ThreadAgentDurableObject>;
  }
}
