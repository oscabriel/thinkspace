# ADR 0028 — Run observability: DO-resident reads; sub-agent activity nested in the run

**Status:** accepted (2026-07-01)
**Refines:** ADR 0017 (durable run lifecycle), ADR 0022 (visible sub-agent fan-out)

## Context

Runs are minted inside the ThreadAgent DO but no seam could read one back — a reconnect
mid-run lost all in-flight state, making ADR 0017's durable lifecycle unobservable exactly
when durability matters. ADR 0022 additionally requires sub-agent activity to render as
nested, inspectable nodes **with their own status**, yet sub-agents existed in the model only
as authors of already-completed comments.

## Decision

- **Run state stays DO-resident and is read through the ThreadAgent seam:**
  `getRun(runId) → RunDetail | null` and `listRuns() → Run[]`. No D1 run index in v1;
  channel and home surfaces stay bump-driven (no cross-channel "running" badges). A D1 run
  index remains a purely additive later step if audit/usage queries are ever wanted.
- **Sub-agent work is state OF the parent run, not a run itself:**
  `RunDetail = { run, subAgentActivity[] }`, where `SubAgentActivity` carries the facet name
  and a running/complete/failed status with timestamps and (on completion) the output
  comment id. Dispatch and Schedule remain the **only two** Run triggers (ADR 0017); facet
  identity (ADR 0022) is intact.
- **`SubAgentFacet.runId` on comments refers to the PARENT run** that spawned the facet.

## Consequences

- In-thread UI: live status streams over the ThreadAgent socket; reconnects recover via
  `getRun`/`listRuns`; the fan-out renders anchored at the dispatch target.
- Sub-agent completions do **not** bump threads; only parent-run completion bumps
  (ADR 0017).
