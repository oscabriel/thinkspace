import { describe, expect, test } from "bun:test";

import { createMemoryTenantDataAccess } from "../src/adapters/memory";
import { defineTenantDataAccessContract } from "../src/testing";

defineTenantDataAccessContract({
  api: { describe, expect, test },
  makeTenantDataAccess: (seed) => createMemoryTenantDataAccess(seed),
});
