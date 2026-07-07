import { describe, expect, test } from "bun:test";

import { createMemoryTenantDataAccess } from "../src/adapters/memory";
import {
  createCatalogWorkspaceShapeToolResolver,
  createWorkerMcpEgressPolicy,
} from "../src/adapters/production/tool-resolution";
import {
  defineToolResolutionContract,
  makeMcpHostApproval,
  testWorkspace,
} from "../src/testing";
import type { McpEgressPolicySeed, ToolResolverSeed } from "../src/testing";

/**
 * The v2 production ToolResolver (E6.3) resolves ADR 0004's three layers over the D1 MCP
 * registry via TenantDataAccess. Under bun we back it with the memory data-access seeded from
 * the contract's fixtures (the workers binder exercises the same adapter over real D1); the
 * `approvedMcpHosts` fixture maps to `mcp_host_approval` rows so the allowlist layer is real.
 *
 * catalog: "mcp_only" — v1 has no first-party catalog and no workspace skill pool (E6.1), so
 * first-party tool / skill selections silently intersect to empty.
 */
const dataAccessForResolver = (seed: ToolResolverSeed) =>
  createMemoryTenantDataAccess({
    context: seed.context,
    mcpHostApprovals: (seed.approvedMcpHosts ?? []).map((host) =>
      makeMcpHostApproval({ host, workspaceId: seed.context.workspaceId })
    ),
    mcpServers: seed.mcpServers ?? [],
    // ADR 0037 decision 5: the resolver's skills layer is the tenant-guarded listSkills() read.
    skills: seed.skills ?? [],
    workspace: testWorkspace,
    workspaceToolDisables: seed.workspaceToolDisables ?? [],
  });

const dataAccessForEgress = (seed: McpEgressPolicySeed) =>
  createMemoryTenantDataAccess({
    context: seed.context,
    mcpHostApprovals: (seed.approvedHosts ?? []).map((host) =>
      makeMcpHostApproval({ host, workspaceId: seed.context.workspaceId })
    ),
    workspace: testWorkspace,
  });

defineToolResolutionContract({
  api: { describe, expect, test },
  catalog: "mcp_only",
  makeMcpEgressPolicy: (seed) =>
    createWorkerMcpEgressPolicy({
      context: seed.context,
      dataAccess: dataAccessForEgress(seed),
    }),
  makeToolResolver: (seed) =>
    createCatalogWorkspaceShapeToolResolver({
      context: seed.context,
      dataAccess: dataAccessForResolver(seed),
    }),
});
