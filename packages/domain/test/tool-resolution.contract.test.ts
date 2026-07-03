import { describe, expect, test } from "bun:test";

import {
  createMemoryMcpEgressPolicy,
  createMemoryToolResolver,
} from "../src/adapters/memory";
import { defineToolResolutionContract } from "../src/testing";

defineToolResolutionContract({
  api: { describe, expect, test },
  makeMcpEgressPolicy: (seed) => createMemoryMcpEgressPolicy(seed),
  makeToolResolver: (seed) => createMemoryToolResolver(seed),
});
