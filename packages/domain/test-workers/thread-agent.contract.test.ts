import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, test } from "vitest";

import type { ThreadAgentDurableObject } from "../src/adapters/production/thread-agent";
import type { ThreadAgent } from "../src/seams/thread-agent";
import { defineThreadAgentContract } from "../src/testing";

/**
 * Each factory call gets its own DO instance (unique name), so no cross-test state.
 * Tests run in the same isolate as the DO, so seed closures (clock, nextRunId) inject
 * directly through runInDurableObject.
 */
defineThreadAgentContract({
  api: { describe, expect, test },
  makeThreadAgent: async (seed) => {
    const stub = env.THREAD_AGENT.get(
      env.THREAD_AGENT.idFromName(crypto.randomUUID())
    );
    const inAgent = <Value>(
      body: (instance: ThreadAgentDurableObject) => Promise<Value> | Value
    ): Promise<Value> =>
      runInDurableObject(stub, (instance) =>
        body(instance as ThreadAgentDurableObject)
      );

    await inAgent((instance) => {
      instance.applyTestSeed(seed);
    });

    const agent: ThreadAgent = {
      address: seed.address,
      appendComment: (input) => inAgent((i) => i.appendComment(input)),
      getRun: (input) => inAgent((i) => i.getRun(input)),
      initialize: (input) => inAgent((i) => i.initialize(input)),
      listRuns: () => inAgent((i) => i.listRuns()),
      loadBranch: (input) => inAgent((i) => i.loadBranch(input)),
      resnapshot: (input) => inAgent((i) => i.resnapshot(input)),
      run: (input) => inAgent((i) => i.run(input)),
      schedule: (input) => inAgent((i) => i.scheduleRun(input)),
    };
    return agent;
  },
});
