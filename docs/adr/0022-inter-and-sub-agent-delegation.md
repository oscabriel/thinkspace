# ADR 0022 — Inter-agent & sub-agent delegation

**Status:** accepted (2026-06-29)
**Builds on:** ADR 0016 (one agent per channel; Model α nested tree), ADR 0017 (explicit/
predictable action only), grounded in Think sub-agent routing (`design/sub-agent-routing.md`
@ clone 2351e5c)

## Context
Think provides first-class sub-agents: child DOs via `parent.subAgent(Cls, name)`, isolated
SQLite, colocation, an `onBeforeSubAgent` permission gate, a parent-owned registry, and child
schedules stored in the parent's scheduler. The question (handoff Q-G) is how delegation fits the
one-agent-per-channel invariant and the explicit/predictable tenet.

## Decision
- **Internal sub-agent delegation within a channel is allowed (v1).** A channel's agent, within an
  explicitly-dispatched run, MAY fan out to Think sub-agents to do scoped/parallel exploration and
  fold results back into the dispatched branch.
- **It does NOT violate one-agent-per-channel.** Sub-agents are **facets of the channel's single
  agent identity**, not separate channel agents. The user-facing identity stays one-per-channel.
- **Sub-agent activity is VISIBLE in the UI — not hidden.** Delegation renders as **nested,
  inspectable activity in the thread tree** (Model α). The user can see what the agent is doing.
  This reinforces the explicit/predictable tenet (ADR 0017): transparency over hidden magic. (This
  is the one amendment to the original "defer user-facing fan-out" recommendation — fan-out is
  surfaced, not deferred.)
- **Triggering stays explicit.** Sub-agents are *how* an explicitly-dispatched run does its work,
  not new autonomous actors; results surface predictably back into the tree.
- **Gating:** sub-agent creation/addressing is gated via `onBeforeSubAgent` plus the workspace
  tool/MCP allowlists (ADR 0002/0004). External sub-agent addressability stays locked down.
- **Cross-channel agent-to-agent handoff = v2, seam only.** Think supports it
  (`getAgentByName` / external sub-agent URLs), but it crosses the user-facing one-agent boundary
  and risks the "surprising action" ruled out in ADR 0017. Keep reachable, do not build, do not let
  it silently break the invariant.

## Consequences
- The thread/tree data model and renderer must represent **sub-agent runs as nested nodes** with
  their own status (running/complete) that bump the thread on completion (ADR 0017).
- Sub-agent schedules ride the parent ThreadAgent's scheduler (per Think) — no independent alarm
  slots; account for this in the run-lifecycle design.
- Cross-channel handoff must not be architected out: keep agent identity/addressing capable of
  cross-DO reference even though it is unused in v1.

## Reopen conditions
- If visible sub-agent activity overwhelms the tree UI, add collapse/summarize affordances rather
  than hiding delegation outright.
