import { describe, expect, test } from "bun:test";

import { createMemoryModelRouter } from "../src/adapters/memory";
import { defineModelRoutingContract } from "../src/testing";

defineModelRoutingContract({
  api: { describe, expect, test },
  canSeedForeignRoute: true,
  makeModelRouter: (seed) =>
    createMemoryModelRouter({
      catalogUnavailable: seed.catalogUnavailable,
      context: seed.context,
      keyedProviders: seed.keyedProviders,
      models: seed.catalogModels,
      routes: seed.foreignRoutes,
    }),
});
