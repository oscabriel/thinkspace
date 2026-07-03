import { describe, expect, test } from "bun:test";

import { createMemoryThreadAgent } from "../src/adapters/memory";
import { defineThreadAgentContract } from "../src/testing";

defineThreadAgentContract({
  api: { describe, expect, test },
  makeThreadAgent: (seed) => createMemoryThreadAgent(seed),
});
