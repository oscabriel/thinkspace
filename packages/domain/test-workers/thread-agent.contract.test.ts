import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, test } from "vitest";

import type { ThreadAgentDurableObject } from "../src/adapters/production/thread-agent";
import type { ThreadAgent } from "../src/seams/thread-agent";
import { defineThreadAgentContract, makeComment } from "../src/testing";
import { modelReplying } from "./mock-model";

/**
 * Direct runInDurableObject calls bypass partyserver's start gating (production traffic
 * arrives via getAgentByName → setName → onStart, which builds Think's Session). Every
 * seed carries a real name here, so mirror that lifecycle before any run() call —
 * self-construction now always submits a Think turn (no more no-model queue-only path).
 */

/**
 * Each factory call gets its own DO instance (unique name), so no cross-test state.
 * Tests run in the same isolate as the DO, so seed closures (clock, nextRunId) inject
 * directly through runInDurableObject.
 */
defineThreadAgentContract({
  api: { describe, expect, test },
  makeThreadAgent: async (seed) => {
    const name = crypto.randomUUID();
    const stub = env.THREAD_AGENT.get(env.THREAD_AGENT.idFromName(name));
    const inAgent = <Value>(
      body: (instance: ThreadAgentDurableObject) => Promise<Value> | Value
    ): Promise<Value> =>
      runInDurableObject(stub, (instance) =>
        body(instance as ThreadAgentDurableObject)
      );

    await inAgent((instance) => {
      instance.applyTestSeed({
        ...seed,
        comments:
          seed.shapeSnapshot === undefined || seed.comments !== undefined
            ? seed.comments
            : [makeComment({ id: "comment-top" })],
        testModel:
          seed.shapeSnapshot === undefined
            ? seed.testModel
            : (seed.testModel ?? modelReplying("Contract reply.")),
      });
    });
    // Mirror the paved-path start lifecycle (see file header) before any run() call.
    await inAgent((instance) => instance.setName(name));

    const agent: ThreadAgent = {
      address: seed.address,
      appendComment: (input) => inAgent((i) => i.appendComment(input)),
      getRun: (input) => inAgent((i) => i.getRun(input)),
      initialize: (input) => inAgent((i) => i.initialize(input)),
      listRuns: () => inAgent((i) => i.listRuns()),
      loadBranch: (input) => inAgent((i) => i.loadBranch(input)),
      removeMcpServer: (input) => inAgent((i) => i.dropMcpServer(input)),
      resnapshot: (input) => inAgent((i) => i.resnapshot(input)),
      run: (input) => inAgent((i) => i.run(input)),
      schedule: (input) => inAgent((i) => i.scheduleRun(input)),
    };
    return agent;
  },
});
