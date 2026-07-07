import { describe, expect, test } from "bun:test";

import { createMemoryTenantDataAccess } from "../src/adapters/memory";
import { createWorkerMcpEgressPolicy } from "../src/adapters/production/tool-resolution";
import { createMcpRegistrationFlow } from "../src/flows/mcp-registration";
import type { TenantDataAccess } from "../src/seams/tenant-data-access";
import {
  makeMcpHostApproval,
  makeMcpServer,
  testTenantContext,
  testWorkspace,
  unwrapErr,
  unwrapOk,
} from "../src/testing";

/**
 * The E6.3 verified-real bug class (ADR 0002): the egress allowlist must gate BEFORE the
 * server row is persisted, because the SDK's hibernation-restore path reconnects straight from
 * persisted rows without re-running any connect-time check. A disallowed host must therefore
 * never reach the registry — so the restore path (listMcpServers) can never see it.
 *
 * The flow composes the real WorkerMcpEgressPolicy over the SAME data-access that holds the
 * registry, so the gate reads the same allowlist the registry is written against.
 */
const buildFlow = (dataAccess: TenantDataAccess) =>
  createMcpRegistrationFlow({
    mcpEgressPolicy: createWorkerMcpEgressPolicy({
      context: testTenantContext,
      dataAccess,
    }),
    tenantDataAccess: dataAccess,
  });

describe("McpRegistrationFlow — egress gate runs before persistence (ADR 0002, baked decision 7)", () => {
  test("registering a server on a DISALLOWED host is rejected and NOTHING is persisted", async () => {
    const dataAccess = createMemoryTenantDataAccess({
      context: testTenantContext,
      workspace: testWorkspace,
    });
    const flow = buildFlow(dataAccess);
    const server = makeMcpServer({ host: "rogue.example.com", id: "mcp-1" });

    const rejected = unwrapErr(
      await flow.registerServer({ mcpServer: server })
    );
    expect(rejected.kind).toBe("mcp_host_not_allowed");

    // The restore path reads persisted rows — it must never see the rejected server.
    const persisted = unwrapOk(await dataAccess.listMcpServers());
    expect(persisted).toEqual([]);
    expect(
      unwrapOk(await dataAccess.getMcpServer({ mcpServerId: server.id }))
    ).toBeNull();
  });

  test("an owner-approved host clears the gate: registerServer persists and the restore path sees it", async () => {
    const dataAccess = createMemoryTenantDataAccess({
      context: testTenantContext,
      mcpHostApprovals: [makeMcpHostApproval({ host: "mcp.example.com" })],
      workspace: testWorkspace,
    });
    const flow = buildFlow(dataAccess);
    const server = makeMcpServer({ host: "mcp.example.com", id: "mcp-1" });

    const receipt = unwrapOk(await flow.registerServer({ mcpServer: server }));
    expect(receipt.commandCount).toBe(1);

    const persisted = unwrapOk(await dataAccess.listMcpServers());
    expect(persisted).toEqual([server]);
  });

  test("approveHost grows the allowlist so a previously-rejected registration then succeeds", async () => {
    const dataAccess = createMemoryTenantDataAccess({
      context: testTenantContext,
      workspace: testWorkspace,
    });
    const flow = buildFlow(dataAccess);
    const server = makeMcpServer({ host: "mcp.example.com", id: "mcp-1" });

    expect(
      unwrapErr(await flow.registerServer({ mcpServer: server })).kind
    ).toBe("mcp_host_not_allowed");

    unwrapOk(
      await flow.approveHost({
        hostApproval: makeMcpHostApproval({ host: "mcp.example.com" }),
      })
    );

    unwrapOk(await flow.registerServer({ mcpServer: server }));
    expect(unwrapOk(await dataAccess.listMcpServers())).toEqual([server]);
  });
});

describe("McpRegistrationFlow — revoke writes (ADR 0037 decision 4)", () => {
  test("deregisterServer drops the row so the restore path no longer sees it", async () => {
    const dataAccess = createMemoryTenantDataAccess({
      context: testTenantContext,
      mcpHostApprovals: [makeMcpHostApproval({ host: "mcp.example.com" })],
      workspace: testWorkspace,
    });
    const flow = buildFlow(dataAccess);
    const server = makeMcpServer({ host: "mcp.example.com", id: "mcp-1" });
    unwrapOk(await flow.registerServer({ mcpServer: server }));

    unwrapOk(await flow.deregisterServer({ mcpServerId: server.id }));

    expect(unwrapOk(await dataAccess.listMcpServers())).toEqual([]);
  });

  test("revokeHost shrinks the allowlist so a re-register on that host fails closed again", async () => {
    const dataAccess = createMemoryTenantDataAccess({
      context: testTenantContext,
      mcpHostApprovals: [makeMcpHostApproval({ host: "mcp.example.com" })],
      workspace: testWorkspace,
    });
    const flow = buildFlow(dataAccess);
    const server = makeMcpServer({ host: "mcp.example.com", id: "mcp-1" });
    unwrapOk(await flow.registerServer({ mcpServer: server }));

    unwrapOk(await flow.revokeHost({ host: server.host }));

    expect(
      unwrapErr(
        await flow.registerServer({
          mcpServer: makeMcpServer({ host: "mcp.example.com", id: "mcp-2" }),
        })
      ).kind
    ).toBe("mcp_host_not_allowed");
  });
});
