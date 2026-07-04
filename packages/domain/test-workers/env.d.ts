/// <reference types="@cloudflare/vitest-pool-workers/types" />
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

import type {
  ChannelHubDurableObject,
  WorkspaceHubDurableObject,
} from "../src/adapters/production/realtime-hubs";
import type { ThreadAgentDurableObject } from "../src/adapters/production/thread-agent";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    CHANNEL_HUB: DurableObjectNamespace<ChannelHubDurableObject>;
    DB: D1Database;
    TEST_MIGRATIONS: D1Migration[];
    THREAD_AGENT: DurableObjectNamespace<ThreadAgentDurableObject>;
    WORKSPACE_HUB: DurableObjectNamespace<WorkspaceHubDurableObject>;
  }
}
