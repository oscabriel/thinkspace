import { describe, expect, test } from "bun:test";

import { createMemorySkillStore } from "../src/adapters/memory";
import { defineSkillStoreContract } from "../src/testing";

defineSkillStoreContract({
  api: { describe, expect, test },
  makeSkillStore: (seed) =>
    createMemorySkillStore({ context: seed.context, skills: seed.skills }),
});
