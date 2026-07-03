import { describe, expect, test } from "bun:test";

import { createMemoryCuratorAgent } from "../src/adapters/memory";
import { defineCuratorAgentContract } from "../src/testing";

defineCuratorAgentContract({
  api: { describe, expect, test },
  makeCuratorAgent: (seed) => createMemoryCuratorAgent(seed),
});
