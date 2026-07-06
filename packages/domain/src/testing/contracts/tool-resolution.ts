import type { McpServer } from "../../mcp";
import type { McpHost } from "../../primitives";
import type { TenantContext } from "../../seams/tenant-data-access";
import type {
  McpEgressPolicy,
  ToolResolutionRequest,
  ToolResolver,
} from "../../seams/tool-resolution";
import type { ShapeStructure } from "../../shape";
import type { Skill } from "../../skill";
import type { CatalogTool, WorkspaceToolDisable } from "../../tool";
import type { ContractTestApi } from "../contract-api";
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
} from "../fixtures";

export interface ToolResolverSeed {
  readonly approvedMcpHosts?: readonly McpHost[];
  readonly catalogTools?: readonly CatalogTool[];
  readonly context: TenantContext;
  readonly mcpServers?: readonly McpServer[];
  readonly skills?: readonly Skill[];
  readonly workspaceToolDisables?: readonly WorkspaceToolDisable[];
}

export type ToolResolverFactory = (
  seed: ToolResolverSeed
) => Promise<ToolResolver> | ToolResolver;

export interface McpEgressPolicySeed {
  readonly approvedHosts?: readonly McpHost[];
  readonly context: TenantContext;
}

export type McpEgressPolicyFactory = (
  seed: McpEgressPolicySeed
) => Promise<McpEgressPolicy> | McpEgressPolicy;

/**
 * Which catalog an adapter resolves against.
 * - `populated`: a stocked catalog exists, so the full three-layer model
 *   (catalog ∩ workspace permission ∩ shape selection) is observable — the
 *   memory adapter's semantics.
 * - `empty`: the v1 production reality (E1.6) — no built-in tools, no MCP
 *   registry (E6.3) — so every resolution silently intersects to an empty
 *   effective toolset, echoing artifactAccessScope through.
 */
export type ToolResolutionCatalog = "empty" | "populated";

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

/** The v1 empty-catalog production semantics (E1.6): silent intersect to an empty toolset. */
const defineEmptyCatalogToolResolverPins = (input: {
  readonly api: ContractTestApi;
  readonly makeToolResolver: ToolResolverFactory;
}): void => {
  const { describe, expect, test } = input.api;
  const { makeToolResolver } = input;

  describe("ToolResolver — empty catalog silently intersects to an empty toolset (E1.6)", () => {
    test("shape-selected tools, beforeTurn additions, and active narrowing all drop out — no unknown-tool error", async () => {
      const resolver = await makeToolResolver({
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

      expect(toolset.catalogTools).toEqual([]);
      expect(toolset.selectedToolIds).toEqual([]);
    });

    test("shape-selected skills resolve to nothing (no workspace skill pool yet)", async () => {
      const resolver = await makeToolResolver({
        context: testTenantContext,
        skills: [makeSkill({ id: "skill-playbook" })],
      });

      const toolset = unwrapOk(
        await resolver.resolve(
          makeResolutionRequest({
            shape: makeShapeStructure({ skillSelection: ["skill-playbook"] }),
          })
        )
      );

      expect(toolset.skills).toEqual([]);
    });

    test("a shape-selected MCP server on an unapproved host does NOT fail — it is vacuously unreachable", async () => {
      const server = makeMcpServer({ host: "rogue.example.com", id: "mcp-1" });
      const resolver = await makeToolResolver({
        approvedMcpHosts: [],
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

      expect(toolset.mcpServers).toEqual([]);
    });

    test("artifactAccessScope is echoed through unchanged and the workspace id is carried", async () => {
      const resolver = await makeToolResolver({ context: testTenantContext });
      const request = makeResolutionRequest();

      const toolset = unwrapOk(await resolver.resolve(request));

      expect(toolset.artifactAccessScope).toEqual(request.artifactAccessScope);
      expect(toolset.workspaceId).toBe(testWorkspaceId);
    });
  });
};

/** The full three-layer catalog ∩ workspace ∩ shape semantics (memory adapter). */
const definePopulatedCatalogToolResolverPins = (input: {
  readonly api: ContractTestApi;
  readonly makeToolResolver: ToolResolverFactory;
}): void => {
  const { describe, expect, test } = input.api;
  const { makeToolResolver } = input;

  describe("ToolResolver — default-permit workspace tool disables (ADR 0004)", () => {
    test("a shape-selected catalog tool resolves without any workspace permission row", async () => {
      const resolver = await makeToolResolver({
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
      const resolver = await makeToolResolver({
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
      const resolver = await makeToolResolver({
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
      const resolver = await makeToolResolver({
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
      const resolver = await makeToolResolver({
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

  describe("ToolResolver — beforeTurn additions are additive-only (ADR 0015 §4)", () => {
    test("a beforeTurn addition extends the shape's tool selection", async () => {
      const resolver = await makeToolResolver({
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
      const resolver = await makeToolResolver({
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
      const resolver = await makeToolResolver({
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
      const resolver = await makeToolResolver({
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
};

/** Worker-side MCP egress authorization pins (skipped for adapters without an egress policy). */
const defineMcpEgressPolicyPins = (input: {
  readonly api: ContractTestApi;
  readonly makeMcpEgressPolicy: McpEgressPolicyFactory;
}): void => {
  const { describe, expect, test } = input.api;
  const { makeMcpEgressPolicy } = input;

  describe("McpEgressPolicy — worker-side egress authorization, UI checks not trusted (ADR 0002/0015)", () => {
    test("an approved host authorizes as allowed_mcp_egress", async () => {
      const policy = await makeMcpEgressPolicy({
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
      const policy = await makeMcpEgressPolicy({
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
};

/** Pins the ToolResolver + McpEgressPolicy seam semantics on whichever adapters the factories build. */
export const defineToolResolutionContract = (input: {
  readonly api: ContractTestApi;
  /**
   * Optional: an adapter with no egress policy of its own (the v1 production
   * ToolResolver, whose WorkerMcpEgressPolicy is still a placeholder) omits this
   * and the egress pins are skipped.
   */
  readonly makeMcpEgressPolicy?: McpEgressPolicyFactory;
  readonly makeToolResolver: ToolResolverFactory;
  /** Defaults to `populated` — the full three-layer semantics. */
  readonly catalog?: ToolResolutionCatalog;
}): void => {
  const { makeMcpEgressPolicy, makeToolResolver } = input;
  const catalog = input.catalog ?? "populated";

  if (catalog === "empty") {
    defineEmptyCatalogToolResolverPins({ api: input.api, makeToolResolver });
  } else {
    definePopulatedCatalogToolResolverPins({
      api: input.api,
      makeToolResolver,
    });
  }

  if (makeMcpEgressPolicy) {
    defineMcpEgressPolicyPins({ api: input.api, makeMcpEgressPolicy });
  }
};
