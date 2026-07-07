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
 * Which layer-1 catalog an adapter resolves against.
 * - `populated`: a stocked first-party catalog exists, so the full three-layer model
 *   (catalog ∩ workspace permission ∩ shape selection) plus the workspace skill pool is
 *   observable — the memory adapter's semantics.
 * - `mcp_only`: the v1 production reality (E6.3, baked decision 7) — no first-party catalog
 *   tools and no workspace skill pool yet (E6.1), so layer 1 is MCP-provided tools only. The
 *   MCP registry + host allowlist layer is fully real; first-party tool / skill selections
 *   silently intersect to empty.
 */
export type ToolResolutionCatalog = "mcp_only" | "populated";

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

/**
 * The MCP registry + host allowlist layer (ADR 0002/0004). Real for BOTH catalogs: memory
 * seeds servers/approvals in config, production reads them from the D1 MCP registry — same
 * fail-closed intersection either way.
 */
const defineMcpResolutionPins = (input: {
  readonly api: ContractTestApi;
  readonly makeToolResolver: ToolResolverFactory;
}): void => {
  const { describe, expect, test } = input.api;
  const { makeToolResolver } = input;

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

    test("a registered MCP server the shape does NOT select is left out (shape-selection layer)", async () => {
      const server = makeMcpServer({ host: "mcp.example.com", id: "mcp-1" });
      const resolver = await makeToolResolver({
        approvedMcpHosts: [mcpHost("mcp.example.com")],
        context: testTenantContext,
        mcpServers: [server],
      });

      const toolset = unwrapOk(
        await resolver.resolve(
          makeResolutionRequest({
            shape: makeShapeStructure({ mcpServerSelection: [] }),
          })
        )
      );

      expect(toolset.mcpServers).toEqual([]);
    });
  });

  describe("ToolResolver — invariant envelope", () => {
    test("artifactAccessScope is echoed through unchanged and the workspace id is carried", async () => {
      const resolver = await makeToolResolver({ context: testTenantContext });
      const request = makeResolutionRequest();

      const toolset = unwrapOk(await resolver.resolve(request));

      expect(toolset.artifactAccessScope).toEqual(request.artifactAccessScope);
      expect(toolset.workspaceId).toBe(testWorkspaceId);
    });
  });
};

/**
 * v1 MCP-only catalog semantics (E6.3): first-party tools still silently intersect to empty
 * (baked decision 7 froze the catalog), but the skills layer is now the tenant-guarded
 * `listSkills()` read (ADR 0037 decision 5) — so a shape-selected skill DOES resolve.
 */
const defineMcpOnlyCatalogPins = (input: {
  readonly api: ContractTestApi;
  readonly makeToolResolver: ToolResolverFactory;
}): void => {
  const { describe, expect, test } = input.api;
  const { makeToolResolver } = input;

  describe("ToolResolver — v1 catalog is MCP-only (baked decision 7)", () => {
    test("shape-selected first-party tools, beforeTurn additions, and active narrowing all drop out — no unknown-tool error", async () => {
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

    test("shape-selected skills resolve out of the tenant-guarded workspace pool (ADR 0037 decision 5)", async () => {
      const playbook = makeSkill({ id: "skill-playbook" });
      const resolver = await makeToolResolver({
        context: testTenantContext,
        skills: [playbook, makeSkill({ id: "skill-unselected" })],
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
};

/** The full three-layer catalog ∩ workspace ∩ shape semantics over a stocked first-party catalog. */
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
   * Optional: an adapter that provides its own worker-side egress policy binds it here so the
   * egress pins run; adapters without one omit it and those pins are skipped.
   */
  readonly makeMcpEgressPolicy?: McpEgressPolicyFactory;
  readonly makeToolResolver: ToolResolverFactory;
  /** Defaults to `populated` — the full three-layer semantics over a first-party catalog. */
  readonly catalog?: ToolResolutionCatalog;
}): void => {
  const { makeMcpEgressPolicy, makeToolResolver } = input;
  const catalog = input.catalog ?? "populated";

  defineMcpResolutionPins({ api: input.api, makeToolResolver });

  if (catalog === "populated") {
    definePopulatedCatalogToolResolverPins({
      api: input.api,
      makeToolResolver,
    });
  } else {
    defineMcpOnlyCatalogPins({ api: input.api, makeToolResolver });
  }

  if (makeMcpEgressPolicy) {
    defineMcpEgressPolicyPins({ api: input.api, makeMcpEgressPolicy });
  }
};
