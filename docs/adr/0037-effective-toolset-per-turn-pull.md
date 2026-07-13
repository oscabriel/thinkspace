# ADR 0037 — Effective toolset reaches the ThreadAgent DO by per-turn pull; MCP delivery is connection reconciliation; revoke fans out via the directory

**Status:** accepted (2026-07-07)
**Refines:** ADR 0004 (three-layer tool model), ADR 0007 (config-as-data), ADR 0002 (egress
allowlist), ADR 0036 (empty-catalog ToolResolver v1 → v2)
**Source-grounded:** `packages/domain/src/adapters/production/tool-resolution.ts` (E6.3
resolver), `packages/domain/src/adapters/production/thread-agent.ts` (skills-per-turn
precedent, `getTools()` stub), pinned `agents`/`@cloudflare/think` type surface
(`Agent.addMcpServer`/`removeMcpServer`, `Think.waitForMcpConnections`, MCP tools auto-merged
into the turn's toolset).

## Context

ToolResolver v2 (E6.3) resolves the full `EffectiveToolset` from D1, but nothing delivers the
result into the ThreadAgent DO: `getTools()` returns `{}` and no MCP server is ever connected.
The question recorded at wave-7 close: does the resolved toolset reach the DO inside the shape
snapshot (push at initialize/resnapshot), inside the run trigger (push at dispatch), or by the
DO resolving per turn (pull)?

Facts that shaped the answer:

1. **Baked decision 7 froze the first-party catalog empty** — v1 tools are exclusively
   MCP-provided, and the SDK manages MCP connections as durable DO state
   (`addMcpServer`/`removeMcpServer`) and auto-merges their tools into the turn's toolset.
   So "delivering `mcpServers`" means reconciling connections, not returning tools from
   `getTools()`.
2. **Scheduled runs carry no gesture** (E5.3) — a trigger-push design leaves them toolless.
3. **The snapshot already carries the selection layer** (`mcpServerSelection`,
   `toolSelection`, `skillSelection` — ADR 0007). What changes out from under a long-lived DO
   is layer 2 — registry rows, host approvals, tool disables — exactly the layer revocation
   lives in. Snapshot-push would freeze revocations until a resnapshot fan-out.
4. **Per-turn pull already has precedent in this DO**: effective skills reload at the top of
   `run` (prompt assembly is synchronous), and the home channel's artifact set is documented
   as "resolved dynamically at dispatch time".

## Decision

1. **Per-turn pull.** At the top of `run` — beside the skills preload — the DO resolves the
   `EffectiveToolset` with `createCatalogWorkspaceShapeToolResolver` over its own D1 data
   access (the same address-derived `SystemContext` the completion flow uses), feeding the
   resolver the resident snapshot's selections. Layer-2 workspace facts are therefore fresh
   on every turn, for dispatched and scheduled runs alike, and enforcement lives at the same
   trust boundary as `McpEgressPolicy` — never in caller-supplied trigger payloads.
2. **MCP delivery = connection reconciliation.** After resolving, the DO diffs
   `EffectiveToolset.mcpServers` against its live SDK connections: `addMcpServer` for newly
   resolved servers (each authorized through `McpEgressPolicy` first — the gate stays at the
   worker boundary), `removeMcpServer` for connections no longer resolved. The SDK merges
   MCP tools into the turn's toolset; `getTools()` keeps returning the (empty-in-v1)
   first-party catalog mapping, which is now deliberate rather than a stub.
3. **Resolution failure fails the run closed.** A `ToolResolutionError` (tenant guard,
   unapproved host) becomes a `RunFailure` — never a silently-empty toolset.
4. **Revocation is per-turn-fresh by construction, plus an immediate fan-out.** Idle DOs
   self-heal at their next turn; to sever live connections at revoke time, the edge MCP
   registry delete/host-revoke route enumerates the workspace's threads (D1 `thread` rows →
   `ThreadAgentDirectory`) and calls a new seam method that drops the named server's
   connection. Revoke is rare; the fan-out cost is acceptable (mirrors the E5.2 shape
   resnapshot propagation).
5. **The resolver's skills layer wires to `dataAccess.listSkills()`** (the read already on
   `TenantDataAccess`), settling "adapter-owned index vs TenantDataAccess read" in favor of
   the tenant-guarded read; the R2 `skill` index stays a storage detail. The DO continues to
   load skill _bodies_ itself via `loadSelectedSkillContents` — `EffectiveToolset.skills`
   carries index entries, not markdown.

## Considered options

- **Snapshot-push** (resolved toolset frozen into `ThreadAgentSnapshot` at
  initialize/resnapshot): rejected — freezes layer-2 revocations until an explicit fan-out,
  turning every registry write into a workspace-wide resnapshot storm to stay correct.
- **Trigger-push** (edge resolves at dispatch, passes the toolset in `RunTrigger`): rejected —
  scheduled runs have no gesture and would run toolless; and the trigger payload is
  caller-adjacent, weakening the "UI checks are not trusted" boundary ADR 0002 pins.

## Consequences

- The dispatch edge no longer needs to resolve the toolset at all; `ToolResolver` moves to a
  DO-side dependency (edge keeps it only for reads like the shape form's selectable lists).
- Turn start gains one D1 round-trip batch (registry + approvals + disables + skills); this
  rides the same wake path that already loads skills and is amortized by
  `waitForMcpConnections` (enable it, default timeout) so first turns don't race connection
  setup.
- The hibernation-restore path may briefly reconnect a since-revoked server before the next
  turn's reconciliation; the egress gate ran before that server ever entered the registry
  (ADR 0002), and the revoke fan-out (decision 4) closes the window for live DOs.
