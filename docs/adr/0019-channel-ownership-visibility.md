# ADR 0019 — Channel ownership, visibility, and permissions

**Status:** accepted (2026-06-29)
**Builds on:** ADR 0008 (better-auth org roles: owner/admin/member), ADR 0016 (channels ephemeral,
multiplayer), ADR 0001 (trust boundary; cross-company reachable)

## Context
Channels are now cheap, ephemeral, goal-scoped work units that multiple humans co-inhabit
(ADR 0016). That demands a concrete per-channel permission model, and it gates the navigation
(handoff Q-E) and discovery (handoff Q-H) questions.

## Decision
- **Owner = creator.** Every channel has a single owner: the member who created it.
- **Shared-to-workspace by default; optional private (owner-only) mode.** Since the point is
  co-working and using each other's agents, default visibility is workspace-wide. Private is the
  escape hatch for solo or sensitive work.
- **Any member can create a channel** (and therefore define its shape). Channels are cheap and
  disposable; gating creation behind admins would kill the turn-over flow (ADR 0018).
- **Shape edits gated to owner + workspace admins.** Anyone who can *see* a channel can
  **converse** in it (co-author the thread tree) and **dispatch** its agent; only owner + admins
  can change the shape (prompt/tools/skills/MCP/docs/model).

## Cross-workspace ("Slack Connect") forward path — DEFERRED, not v1
The per-channel ACL generalizes cleanly to cross-company without redesign (records the intended
mechanism; still out of v1 scope per ADR 0016/0001):
- An **admin initiates a connect** between two workspaces (a workspace-to-workspace trust edge).
- Once connected, members of **either** workspace can create **shared channels** spanning both,
  each with a specific goal ("integrate X into Y", "solve blockers with X on Y").
- Visibility/permission semantics are the same per-channel model, with membership drawn from both
  connected workspaces. No new primitive required — just a trust edge + cross-workspace membership.

## Consequences
- Introduces a **product-level per-channel ACL** layered on better-auth's workspace roles
  (ADR 0008): {owner, visibility(shared|private), can-edit-shape = owner+admins}.
- The sidebar (Q-E) and any discovery surface (Q-H) read from this visibility model: a member sees
  shared channels + their own private channels.
- The deferred cross-workspace path means the ACL and membership model should not assume a channel's
  members are a subset of exactly one workspace — keep that seam open (do not architect it out).

## Reopen conditions
- If shared-by-default proves too noisy at scale, consider opt-in visibility or sectioning, but
  keep creation ungated.
