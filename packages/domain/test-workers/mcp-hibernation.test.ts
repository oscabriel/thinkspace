import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, test } from "vitest";

import type { ThreadAgentDurableObject } from "../src/adapters/production/thread-agent";
import { encodeThreadAgentAddress } from "../src/adapters/thread-agent-address";
import type { ThreadAgentAddress } from "../src/seams/thread-agent";
import { channelId, threadId, workspaceId } from "../src/testing";

/**
 * ADR 0015 §4 behavioral contract: the agents SDK persists MCP server config to DO-SQLite
 * (`cf_agents_mcp_servers`) and restores/reconnects it on wake — WITHOUT re-running any
 * add-time gate. This is the exact substrate ADR 0002 mitigates by gating before persistence;
 * a bump that breaks persist/restore (or starts re-gating on restore) fails here before prod.
 *
 * Exercised against the real ThreadAgentDurableObject under miniflare, connecting to the
 * outbound-mock's minimal Streamable-HTTP MCP server (`mcp.test.local`).
 */
const MCP_URL = "https://mcp.test.local/mcp";

const address = (suffix: string): ThreadAgentAddress => ({
  channelId: channelId(`mcp-ch-${suffix}`),
  threadId: threadId(`mcp-th-${suffix}`),
  workspaceId: workspaceId(`mcp-ws-${suffix}`),
});

const agentAt = (addr: ThreadAgentAddress) =>
  env.THREAD_AGENT.get(
    env.THREAD_AGENT.idFromName(encodeThreadAgentAddress(addr))
  );

type Instance = ThreadAgentDurableObject;

const startAgent = (
  stub: ReturnType<typeof agentAt>,
  addr: ThreadAgentAddress
) =>
  runInDurableObject(stub, (instance: Instance) =>
    instance.setName(encodeThreadAgentAddress(addr))
  );

/** A hibernation wake re-runs onStart; the SDK's restore path reconnects persisted servers. */
const wake = (stub: ReturnType<typeof agentAt>) =>
  runInDurableObject(stub, (instance: Instance) => instance.onStart());

describe("ThreadAgent MCP connections persist and restore across hibernation (ADR 0015 §4)", () => {
  test("a connected MCP server survives a wake: config persisted, tools rediscovered, no re-gate", async () => {
    const addr = address("persist");
    const stub = agentAt(addr);
    await startAgent(stub, addr);

    const connected = await runInDurableObject(stub, (instance: Instance) =>
      instance.addMcpServer("mock", MCP_URL, {
        transport: { type: "streamable-http" },
      })
    );
    expect(connected.state).toBe("ready");

    const beforeWake = await runInDurableObject(stub, (instance: Instance) =>
      instance.getMcpServers()
    );
    expect(Object.values(beforeWake.servers)).toHaveLength(1);
    expect(beforeWake.tools.some((tool) => tool.name.includes("echo"))).toBe(
      true
    );

    // Additive tool assembly (ADR 0015 §4): the DO's own getTools() is empty (v1 catalog is
    // MCP-only), yet the MCP tool set is present for the turn — Think spreads getTools() ∪ MCP,
    // so beforeTurn is additive, not a replacement. A regression that dropped the MCP merge
    // (or let an empty getTools() shadow it) would empty this set.
    const mergeInputs = await runInDurableObject(
      stub,
      (instance: Instance) => ({
        firstPartyTools: Object.keys(instance.getTools()),
        mcpTools: Object.keys(instance.mcp.getAITools()),
      })
    );
    expect(mergeInputs.firstPartyTools).toEqual([]);
    expect(mergeInputs.mcpTools.some((name) => name.includes("echo"))).toBe(
      true
    );

    // Simulate hibernation → fresh start. The persisted row is the ONLY input to restore.
    await wake(stub);

    const afterWake = await runInDurableObject(stub, (instance: Instance) =>
      instance.getMcpServers()
    );
    expect(Object.values(afterWake.servers)).toHaveLength(1);
    expect(Object.values(afterWake.servers)[0]?.server_url).toBe(MCP_URL);
  });

  test("removeMcpServer deletes the persisted row so the wake path does not reconnect it (ADR 0002 revoke)", async () => {
    const addr = address("revoke");
    const stub = agentAt(addr);
    await startAgent(stub, addr);

    const connected = await runInDurableObject(stub, (instance: Instance) =>
      instance.addMcpServer("mock", MCP_URL, {
        transport: { type: "streamable-http" },
      })
    );

    await runInDurableObject(stub, (instance: Instance) =>
      instance.removeMcpServer(connected.id)
    );

    await wake(stub);

    const afterWake = await runInDurableObject(stub, (instance: Instance) =>
      instance.getMcpServers()
    );
    expect(Object.values(afterWake.servers)).toHaveLength(0);
  });
});
