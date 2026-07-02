# ADR 0004 — Three-layer tool model; empty-by-default shapes

**Status:** accepted (2026-06-28)
**Refines:** ADR 0003 (resolves its open sub-question)

## Context

Tension surfaced in grill: a globally-available tool registry seemed to fight the
product thesis of _bespoke_ agents. Resolution: "global registry" conflated the
**catalog** (what could be wired in) with **activation** (what an agent actually
uses). Separating them removes the tension — bespoke-ness is selection, not a small
catalog.

## Decision

Tool availability is the **intersection of three layers**:

1. **Global catalog** — a deliberately _wide_ shared palette of vetted first-party
   tools, defined in code. A richer catalog makes agents _more_ bespoke-able, not
   less. (Maps to Think's `getTools()` source.)
2. **Workspace permission** — which catalog entries + which MCP hosts (ADR 0002)
   are permitted in a workspace. The governance / cost / compliance seam. Built as
   a filter now; default = all first-party permitted; per-tool disable rows added
   when curation is wanted (not v1-critical).
3. **Shape selection** — which permitted tools _this specific agent_ uses. A new
   shape starts **empty**; the author opts in to each tool deliberately. Every
   bespoke agent ends up with a unique toolset specific to its task.

Effective toolset for a turn:
`catalog ∩ workspace-permitted ∩ shape-selected  (∩ beforeTurn activeTools)`

## Decision: default shape toolset = EMPTY (pure opt-in)

No agent silently has a tool its author did not consciously grant. Convenience of a
"minimal default" was rejected in favor of explicit capability granting.

## Consequences

- `getTools()` assembles the shape-selected subset; runtime narrowing via
  `beforeTurn.activeTools` (allowlist) stays available (handoff §4).
- Data model needs: global catalog (code/config), `workspace_tool_permissions`
  (seam, mostly empty in v1), and per-shape `tool_selection`.
- Bespoke-ness is enforced _mechanically_ by the empty default, not by convention.
- Keep the catalog wide — palette depth is a feature, not a liability.
