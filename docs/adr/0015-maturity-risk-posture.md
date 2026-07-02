# ADR 0015 — Maturity risk posture: Medium (contain + stay patch-capable)

**Status:** accepted (2026-06-29)

## Context

The architecture rests on `@cloudflare/agents` (0.17.1), `think` (0.11.1), `@cloudflare/shell`
(0.4.1) — all **pre-1.0, `@experimental`, repo not accepting external PRs**. Risks: (1) API
churn with no semver protection, (2) bugs unfixable upstream, (3) abandonment/pivot risk.
Blast radius already reduced by prior decisions: **Code Mode deferred** (ADR 0003 → no
`codemode`), **skills markdown-only** (ADR 0005 → no esbuild/executable-skill churn). Live
exposure = 3 packages used in their most-paved capacities (config-as-data, MCP, virtual FS).

## Decision — Medium mitigation posture

1. **Pin exact versions** of agents/think/shell as a **matched set** (no `^` ranges); upgrades
   are deliberate + manual, never automatic.
2. **Thin anti-corruption layer** around only the load-bearing touchpoints — the `BespokeAgent`
   facade, shape/config loading, MCP wiring, the hub DOs — so SDK types don't leak across the
   codebase and churn is contained to one module. (Not a full abstraction — avoid aiming blind.)
3. **Behavioral contract tests** asserting the §4 gotchas hold on every bump: sync
   `getModel/getTools/getSystemPrompt`; `beforeTurn.tools` additive-only; MCP persist/restore
   across hibernation; readonly-connection authz boundary; `configure()/getConfig()`
   config-as-data. A bump breaking any of these **fails CI before prod**.
4. **Fork-readiness:** keep a per-version source clone (baseline `2351e5c`) + the ability to
   vendor + patch (patch-package or vendored fork) for any blocking bug. Constrain usage to a
   subset we could realistically self-maintain. Do **not** fork pre-emptively.

Rejected: **Light** (breakage scatters), **Heavy** (over-abstracts before churn is located).

## Strategic acceptance

The engine choice bets the product on an experimental, un-upstreamable Cloudflare stack. The
user **consciously accepts this risk** — actively interested in exploring these technologies —
with Medium making the bet _survivable_, not risk-free. Engine choice is **not** reopened (the
per-thread-DO economics justify it).

## Consequences

- Establishes a versioning + upgrade discipline and a contract-test suite as CI gates.
- The anti-corruption layer is a real v1 build item, not optional.
- Per-version clones are part of the repo hygiene / runbook.
