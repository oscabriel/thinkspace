import { describe, expect, test } from "bun:test";

import {
  createMemoryMcpEgressPolicy,
  createMemoryToolResolver,
} from "../src/adapters/memory";
import type { ToolResolutionRequest } from "../src/seams/tool-resolution";
import type { ShapeStructure } from "../src/shape";
import {
  makeCatalogTool,
  makeMcpServer,
  makeShapeStructure,
  makeSkill,
  makeWorkspaceToolDisable,
  mcpHost,
  mcpServerId,
  testTenantContext,
  testWorkspaceId,
  toolId,
  unwrapErr,
  unwrapOk,
} from "./fixtures";

const makeResolutionRequest = (input?: {
  readonly activeToolIds?: readonly string[];
  readonly addedToolIds?: readonly string[];
  readonly shape?: ShapeStructure;
}): ToolResolutionRequest => ({
  artifactAccessScope: {
    artifactIds: [],
    homeChannelArtifactIds: [],
    kind: "shape_artifact_selection",
  },
  beforeTurnAdditions: {
    addedToolIds: (input?.addedToolIds ?? []).map(toolId),
    kind: "additive_tools_only",
  },
  runtimeNarrowing: {
    activeToolIds: (input?.activeToolIds ?? []).map(toolId),
    kind: "active_tools_allowlist",
  },
  shape: input?.shape ?? makeShapeStructure(),
});

describe("ToolResolver — default-permit workspace tool disables (ADR 0004)", () => {
  test("a shape-selected catalog tool resolves without any workspace permission row", async () => {
    const resolver = createMemoryToolResolver({
      catalogTools: [makeCatalogTool({ id: "tool-a" })],
      context: testTenantContext,
    });

    const toolset = unwrapOk(
      await resolver.resolve(
        makeResolutionRequest({
          activeToolIds: ["tool-a"],
          shape: makeShapeStructure({ toolSelection: ["tool-a"] }),
        })
      )
    );

    expect(toolset.selectedToolIds).toEqual([toolId("tool-a")]);
  });

  test("a disable row excludes exactly that tool; absence of a row keeps permitting the rest", async () => {
    const resolver = createMemoryToolResolver({
      catalogTools: [
        makeCatalogTool({ id: "tool-a" }),
        makeCatalogTool({ id: "tool-b" }),
      ],
      context: testTenantContext,
      workspaceToolDisables: [makeWorkspaceToolDisable({ toolId: "tool-b" })],
    });

    const toolset = unwrapOk(
      await resolver.resolve(
        makeResolutionRequest({
          activeToolIds: ["tool-a", "tool-b"],
          shape: makeShapeStructure({ toolSelection: ["tool-a", "tool-b"] }),
        })
      )
    );

    expect(toolset.selectedToolIds).toEqual([toolId("tool-a")]);
  });
});

describe("ToolResolver — MCP host allowlist fails closed (ADR 0002)", () => {
  test("a shape-selected MCP server on an approved host resolves into the effective toolset", async () => {
    const server = makeMcpServer({ host: "mcp.example.com", id: "mcp-1" });
    const resolver = createMemoryToolResolver({
      approvedMcpHosts: [mcpHost("mcp.example.com")],
      context: testTenantContext,
      mcpServers: [server],
    });

    const toolset = unwrapOk(
      await resolver.resolve(
        makeResolutionRequest({
          shape: makeShapeStructure({ mcpServerSelection: ["mcp-1"] }),
        })
      )
    );

    expect(toolset.mcpServers).toEqual([server]);
  });

  test("a shape-selected MCP server on an unapproved host fails the whole resolution with mcp_host_not_allowed", async () => {
    const server = makeMcpServer({ host: "rogue.example.com", id: "mcp-1" });
    const resolver = createMemoryToolResolver({
      approvedMcpHosts: [],
      context: testTenantContext,
      mcpServers: [server],
    });

    const error = unwrapErr(
      await resolver.resolve(
        makeResolutionRequest({
          shape: makeShapeStructure({ mcpServerSelection: ["mcp-1"] }),
        })
      )
    );

    expect(error).toEqual({
      host: mcpHost("rogue.example.com"),
      kind: "mcp_host_not_allowed",
      mcpServerId: server.id,
      workspaceId: testWorkspaceId,
    });
  });
});

describe("ToolResolver — skills are a workspace pool with per-shape selection (ADR 0029)", () => {
  test("only the shape-selected skills resolve out of the workspace pool", async () => {
    const playbook = makeSkill({ id: "skill-playbook" });
    const unselected = makeSkill({ id: "skill-unselected" });
    const resolver = createMemoryToolResolver({
      context: testTenantContext,
      skills: [playbook, unselected],
    });

    const toolset = unwrapOk(
      await resolver.resolve(
        makeResolutionRequest({
          shape: makeShapeStructure({ skillSelection: ["skill-playbook"] }),
        })
      )
    );

    expect(toolset.skills).toEqual([playbook]);
  });
});

describe("McpEgressPolicy — worker-side egress authorization, UI checks not trusted (ADR 0002/0015)", () => {
  test("an approved host authorizes as allowed_mcp_egress", async () => {
    const policy = createMemoryMcpEgressPolicy({
      approvedHosts: [mcpHost("mcp.example.com")],
      context: testTenantContext,
    });

    const allowed = unwrapOk(
      await policy.authorize({
        host: mcpHost("mcp.example.com"),
        mcpServerId: mcpServerId("mcp-1"),
      })
    );

    expect(allowed).toEqual({
      host: mcpHost("mcp.example.com"),
      kind: "allowed_mcp_egress",
      mcpServerId: mcpServerId("mcp-1"),
      workspaceId: testWorkspaceId,
    });
  });

  test("an unapproved host is denied with mcp_host_not_allowed", async () => {
    const policy = createMemoryMcpEgressPolicy({
      approvedHosts: [],
      context: testTenantContext,
    });

    const error = unwrapErr(
      await policy.authorize({
        host: mcpHost("rogue.example.com"),
        mcpServerId: mcpServerId("mcp-1"),
      })
    );

    expect(error.kind).toBe("mcp_host_not_allowed");
  });
});

describe("ToolResolver — beforeTurn additions are additive-only (ADR 0015 §4)", () => {
  test("a beforeTurn addition extends the shape's tool selection", async () => {
    const resolver = createMemoryToolResolver({
      catalogTools: [
        makeCatalogTool({ id: "tool-a" }),
        makeCatalogTool({ id: "tool-b" }),
      ],
      context: testTenantContext,
    });

    const toolset = unwrapOk(
      await resolver.resolve(
        makeResolutionRequest({
          activeToolIds: ["tool-a", "tool-b"],
          addedToolIds: ["tool-b"],
          shape: makeShapeStructure({ toolSelection: ["tool-a"] }),
        })
      )
    );

    expect(new Set(toolset.selectedToolIds)).toEqual(
      new Set([toolId("tool-a"), toolId("tool-b")])
    );
  });

  test("a beforeTurn addition cannot bypass a workspace disable row", async () => {
    const resolver = createMemoryToolResolver({
      catalogTools: [
        makeCatalogTool({ id: "tool-a" }),
        makeCatalogTool({ id: "tool-disabled" }),
      ],
      context: testTenantContext,
      workspaceToolDisables: [
        makeWorkspaceToolDisable({ toolId: "tool-disabled" }),
      ],
    });

    const toolset = unwrapOk(
      await resolver.resolve(
        makeResolutionRequest({
          activeToolIds: ["tool-a", "tool-disabled"],
          addedToolIds: ["tool-disabled"],
          shape: makeShapeStructure({ toolSelection: ["tool-a"] }),
        })
      )
    );

    expect(toolset.selectedToolIds).toEqual([toolId("tool-a")]);
  });

  test("runtime narrowing restricts the turn to the active-tools allowlist without touching the selection layers", async () => {
    const resolver = createMemoryToolResolver({
      catalogTools: [
        makeCatalogTool({ id: "tool-a" }),
        makeCatalogTool({ id: "tool-b" }),
      ],
      context: testTenantContext,
    });

    const toolset = unwrapOk(
      await resolver.resolve(
        makeResolutionRequest({
          activeToolIds: ["tool-a"],
          shape: makeShapeStructure({ toolSelection: ["tool-a", "tool-b"] }),
        })
      )
    );

    expect(toolset.selectedToolIds).toEqual([toolId("tool-a")]);
  });

  test("a tool outside the catalog never resolves, whatever the shape selects (catalog ∩ workspace ∩ shape)", async () => {
    const resolver = createMemoryToolResolver({
      catalogTools: [makeCatalogTool({ id: "tool-a" })],
      context: testTenantContext,
    });

    const toolset = unwrapOk(
      await resolver.resolve(
        makeResolutionRequest({
          activeToolIds: ["tool-a", "tool-ghost"],
          addedToolIds: ["tool-ghost"],
          shape: makeShapeStructure({
            toolSelection: ["tool-a", "tool-ghost"],
          }),
        })
      )
    );

    expect(toolset.selectedToolIds).toEqual([toolId("tool-a")]);
  });
});
