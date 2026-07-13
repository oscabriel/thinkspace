import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, test } from "vitest";

import { createD1TenantDataAccess } from "../src/adapters/production/tenant-data-access";
import type { ThreadAgentDurableObject } from "../src/adapters/production/thread-agent";
import { encodeThreadAgentAddress } from "../src/adapters/thread-agent-address";
import { ok } from "../src/result";
import type { TenantWriteCommand } from "../src/seams/tenant-data-access";
import type { ThreadAgentAddress } from "../src/seams/thread-agent";
import {
  channelId,
  makeComment,
  makeDispatchTrigger,
  makeMcpHostApproval,
  makeMcpServer,
  makeShapeSnapshot,
  makeShapeStructure,
  mcpServerId,
  runId,
  testMemberId,
  threadId,
  unwrapErr,
  unwrapOk,
  workspaceId,
} from "../src/testing";
import { modelReplying } from "./mock-model";

/**
 * ADR 0037 per-turn MCP connection reconciliation, exercised against the real ThreadAgent DO
 * under miniflare. Each run resolves the EffectiveToolset over live D1 registry rows (layer 2)
 * and diffs it against the SDK's connections — connecting newly resolved servers (via the
 * outbound-mock's Streamable-HTTP MCP endpoint), dropping revoked ones, and failing the run
 * closed on an unapproved host. Never egresses: the mock intercepts `mcp.test.local`.
 */
const MCP_URL = "https://mcp.test.local/mcp";
const MCP_HOST = "mcp.test.local";
const SERVER_ID = "mcp-recon-server";

const address = (suffix: string): ThreadAgentAddress => ({
  channelId: channelId(`recon-ch-${suffix}`),
  threadId: threadId(`recon-th-${suffix}`),
  workspaceId: workspaceId(`recon-ws-${suffix}`),
});

const agentAt = (addr: ThreadAgentAddress) =>
  env.THREAD_AGENT.get(
    env.THREAD_AGENT.idFromName(encodeThreadAgentAddress(addr))
  );

type Instance = ThreadAgentDurableObject;

/** A monotonic run-id source so a test's second dispatch is never deduped onto the first. */
const runIdSequence = (suffix: string) => {
  let n = 0;
  return () => runId(`recon-run-${suffix}-${(n += 1)}`);
};

/**
 * Seed the DO the paved way: apply the shape snapshot + opening comment, stub the settlement
 * fan-out and the model, then mirror the setName → onStart start lifecycle before any run().
 */
const primeAgent = async (
  addr: ThreadAgentAddress,
  input: { readonly selection: readonly string[] }
) => {
  const stub = agentAt(addr);
  const target = makeComment({
    id: `recon-target-${addr.threadId}`,
    threadId: addr.threadId,
    workspaceId: addr.workspaceId,
  });

  await runInDurableObject(stub, (instance: Instance) => {
    instance.applyTestSeed({
      address: addr,
      comments: [target],
      nextRunId: runIdSequence(addr.threadId),
      shapeSnapshot: makeShapeSnapshot({
        structure: makeShapeStructure({
          mcpServerSelection: input.selection,
        }),
      }),
      testModel: modelReplying("Reconciled."),
    });
    instance.completionFlow = { settle: async () => ok() };
  });
  await runInDurableObject(stub, (instance: Instance) =>
    instance.setName(encodeThreadAgentAddress(addr))
  );

  return { stub, target };
};

/** Author workspace MCP registry rows (server + host approval) through the D1 adapter's batch. */
const seedRegistry = async (
  ws: ThreadAgentAddress["workspaceId"],
  input: {
    readonly approvedHosts?: readonly string[];
    readonly servers?: readonly string[];
  }
): Promise<void> => {
  const commands: TenantWriteCommand[] = [
    ...(input.servers ?? []).map(
      (host) =>
        ({
          kind: "put_mcp_server",
          mcpServer: makeMcpServer({ host, id: SERVER_ID, workspaceId: ws }),
        }) as const
    ),
    ...(input.approvedHosts ?? []).map(
      (host) =>
        ({
          hostApproval: makeMcpHostApproval({ host, workspaceId: ws }),
          kind: "put_mcp_host_approval",
        }) as const
    ),
  ];
  const [first, ...rest] = commands;
  if (first === undefined) {
    return;
  }
  const data = createD1TenantDataAccess({
    context: { memberId: testMemberId, role: "member", workspaceId: ws },
    db: env.DB,
  });
  const written = await data.batch({
    commands: [first, ...rest],
    workspaceId: ws,
  });
  if (!written.ok) {
    throw new Error(`registry seed failed: ${JSON.stringify(written.error)}`);
  }
};

const liveServers = (stub: ReturnType<typeof agentAt>) =>
  runInDurableObject(stub, (instance: Instance) => instance.getMcpServers());

/** Dispatch at the seeded target comment; a distinct gesture per call avoids E5.3 dedupe. */
const dispatch = (
  stub: ReturnType<typeof agentAt>,
  targetCommentId: string,
  gesture: string
) =>
  runInDurableObject(stub, (instance: Instance) =>
    instance.run(makeDispatchTrigger({ gestureId: gesture, targetCommentId }))
  );

describe("ThreadAgent MCP connection reconciliation (ADR 0037)", () => {
  test("a turn resolves fresh layer-2 facts: a registry row added after start connects on the next run", async () => {
    const addr = address("fresh");
    const { stub, target } = await primeAgent(addr, { selection: [SERVER_ID] });

    // First turn: the selection is frozen but the registry has no matching server yet.
    unwrapOk(await dispatch(stub, target.id, `${target.id}-a`));
    expect(Object.values((await liveServers(stub)).servers)).toHaveLength(0);

    // Layer-2 fact appears between turns; the next turn re-resolves and connects.
    await seedRegistry(addr.workspaceId, {
      approvedHosts: [MCP_HOST],
      servers: [MCP_HOST],
    });

    unwrapOk(await dispatch(stub, target.id, `${target.id}-b`));
    const after = await liveServers(stub);
    expect(Object.values(after.servers)).toHaveLength(1);
    expect(Object.values(after.servers)[0]?.server_url).toBe(MCP_URL);
  });

  test("a server removed from the registry is disconnected on the next run", async () => {
    const addr = address("revoke");
    await seedRegistry(addr.workspaceId, {
      approvedHosts: [MCP_HOST],
      servers: [MCP_HOST],
    });
    const { stub, target } = await primeAgent(addr, { selection: [SERVER_ID] });

    unwrapOk(await dispatch(stub, target.id, `${target.id}-a`));
    expect(Object.values((await liveServers(stub)).servers)).toHaveLength(1);

    // Registry row deleted (there is no delete_mcp_server write command — raw is the test path).
    await env.DB.prepare("DELETE FROM mcp_server WHERE id = ?1")
      .bind(SERVER_ID)
      .run();

    unwrapOk(await dispatch(stub, target.id, `${target.id}-b`));
    expect(Object.values((await liveServers(stub)).servers)).toHaveLength(0);
  });

  test("a shape-selected server on an unapproved host fails the run closed (no connection)", async () => {
    const addr = address("closed");
    // Server is registered but its host is NOT approved — resolution fails closed (ADR 0002).
    await seedRegistry(addr.workspaceId, { servers: [MCP_HOST] });
    const { stub, target } = await primeAgent(addr, { selection: [SERVER_ID] });

    const failure = unwrapErr(
      await dispatch(stub, target.id, `${target.id}-a`)
    );
    expect(failure.kind).toBe("run_failure");
    expect(Object.values((await liveServers(stub)).servers)).toHaveLength(0);
  });

  test("removeMcpServer severs a live connection immediately (revoke fan-out)", async () => {
    const addr = address("sever");
    await seedRegistry(addr.workspaceId, {
      approvedHosts: [MCP_HOST],
      servers: [MCP_HOST],
    });
    const { stub, target } = await primeAgent(addr, { selection: [SERVER_ID] });

    unwrapOk(await dispatch(stub, target.id, `${target.id}-a`));
    expect(Object.values((await liveServers(stub)).servers)).toHaveLength(1);

    unwrapOk(
      await runInDurableObject(stub, (instance: Instance) =>
        instance.dropMcpServer({ mcpServerId: mcpServerId(SERVER_ID) })
      )
    );

    expect(Object.values((await liveServers(stub)).servers)).toHaveLength(0);
  });
});
