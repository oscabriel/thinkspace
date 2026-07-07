import { env } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { createD1TenantDataAccess } from "../src/adapters/production/tenant-data-access";
import {
  createCatalogWorkspaceShapeToolResolver,
  createWorkerMcpEgressPolicy,
} from "../src/adapters/production/tool-resolution";
import type {
  TenantDataAccess,
  TenantWriteCommand,
} from "../src/seams/tenant-data-access";
import {
  defineToolResolutionContract,
  makeMcpHostApproval,
  testWorkspace,
} from "../src/testing";
import type { McpEgressPolicySeed, ToolResolverSeed } from "../src/testing";

/**
 * The v2 production ToolResolver + WorkerMcpEgressPolicy bound to real D1 under miniflare
 * (vitest-pool-workers) — the workers half of the tool-resolution contract. Same adapter the
 * bun binder runs; here the three layers resolve over live `mcp_server` / `mcp_host_approval`
 * rows written through the adapter's own batch, so the D1 read path (and the migration) is
 * exercised end to end.
 */
beforeEach(async () => {
  await env.DB.batch(
    [
      "mcp_host_approval",
      "mcp_server",
      "workspace",
      "workspace_tool_disable",
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`))
  );
  await env.DB.prepare(
    "INSERT INTO workspace (id, name) VALUES (?1, ?2) ON CONFLICT (id) DO NOTHING"
  )
    .bind(testWorkspace.id, testWorkspace.name)
    .run();
});

const seedRows = async (
  data: TenantDataAccess,
  commands: readonly TenantWriteCommand[]
): Promise<void> => {
  const [first, ...rest] = commands;
  if (first === undefined) {
    return;
  }
  const written = await data.batch({
    commands: [first, ...rest],
    workspaceId: data.context.workspaceId,
  });
  if (!written.ok) {
    throw new Error(`seed batch failed: ${JSON.stringify(written.error)}`);
  }
};

const resolverCommands = (s: ToolResolverSeed): TenantWriteCommand[] => [
  ...(s.mcpServers ?? []).map(
    (mcpServer) => ({ kind: "put_mcp_server", mcpServer }) as const
  ),
  ...(s.approvedMcpHosts ?? []).map(
    (host) =>
      ({
        hostApproval: makeMcpHostApproval({
          host,
          workspaceId: s.context.workspaceId,
        }),
        kind: "put_mcp_host_approval",
      }) as const
  ),
  ...(s.workspaceToolDisables ?? []).map(
    (toolDisable) =>
      ({ kind: "put_workspace_tool_disable", toolDisable }) as const
  ),
];

const egressCommands = (s: McpEgressPolicySeed): TenantWriteCommand[] =>
  (s.approvedHosts ?? []).map(
    (host) =>
      ({
        hostApproval: makeMcpHostApproval({
          host,
          workspaceId: s.context.workspaceId,
        }),
        kind: "put_mcp_host_approval",
      }) as const
  );

defineToolResolutionContract({
  api: { describe, expect, test },
  catalog: "mcp_only",
  makeMcpEgressPolicy: async (policySeed) => {
    const data = createD1TenantDataAccess({
      context: policySeed.context,
      db: env.DB,
    });
    await seedRows(data, egressCommands(policySeed));
    return createWorkerMcpEgressPolicy({
      context: policySeed.context,
      dataAccess: data,
    });
  },
  makeToolResolver: async (resolverSeed) => {
    const data = createD1TenantDataAccess({
      context: resolverSeed.context,
      db: env.DB,
    });
    await seedRows(data, resolverCommands(resolverSeed));
    return createCatalogWorkspaceShapeToolResolver({
      context: resolverSeed.context,
      dataAccess: data,
    });
  },
});
