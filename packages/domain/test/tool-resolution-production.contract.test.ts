import { describe, expect, test } from "bun:test";

import { createCatalogWorkspaceShapeToolResolver } from "../src/adapters/production/tool-resolution";
import { defineToolResolutionContract } from "../src/testing";

/**
 * The v1 production ToolResolver (E1.6) resolves against an EMPTY catalog, so the
 * seed's catalog/skill/MCP fixtures have nowhere to go — the adapter is built from
 * context alone and silently intersects every request to an empty toolset.
 *
 * Its WorkerMcpEgressPolicy is still a placeholder (empty catalog makes egress
 * vacuously unreachable), so no `makeMcpEgressPolicy` is provided and those pins
 * are skipped.
 */
defineToolResolutionContract({
  api: { describe, expect, test },
  catalog: "empty",
  makeToolResolver: (seed) =>
    createCatalogWorkspaceShapeToolResolver({ context: seed.context }),
});
