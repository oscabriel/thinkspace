# ADR 0018 — Channel lifecycle: archive-by-default, explicit delete; documents outlive the channel

**Status:** accepted (2026-06-29)
**Builds on:** ADR 0016 (channels are ephemeral/goal-scoped), ADR 0014 (documents channel-homed +
workspace-aggregated), ADR 0007 (archive over hard-delete)

## Context

ADR 0016 made channels **goal-scoped and ephemeral** — expected to be turned over when their goal
is complete. Ephemeral channels are only viable if **closing one is safe and lossless**. Three
things have a stake in a channel's death: its **threads** (work history), its **shape** (the
bespoke agent config), and its **documents** (channel-homed + workspace-aggregated, ADR 0014).

## Decision

- **Archive-by-default; hard-delete is a separate, explicit action.** "Completing" a channel
  **archives** it (consistent with ADR 0007's archive-over-delete lean). Hard-delete is a
  distinct, deliberate action — not the default completion path.
- **On archive:** threads become **read-only** but remain **browsable and searchable**; the agent
  can no longer be dispatched. Reactivatable.
- **Shape is preserved and cloneable.** An archived channel's shape can be **cloned into a new
  channel** — finishing one goal seeds the next from the same agent config (feeds handoff Q-F
  templating/cloning).
- **Documents are durable workspace artifacts, decoupled from channel lifetime.** Documents
  produced in a channel **survive both archive AND hard-delete**. They remain live in the
  **workspace document library** even after their origin channel is gone. Provenance (ADR 0014)
  still records the originating channel, which may now be archived or deleted (a dangling/tombstone
  reference is acceptable).

## Consequences

- **Document lifetime is fully independent of channel lifetime.** The workspace library is the
  durable home; channels are disposable producers. This is core to the "agents produce durable
  value" story and is what makes turning channels over **safe**.
- Per-thread DO retention/GC: hard-delete may reclaim ThreadAgent DOs and thread storage, but the
  document-extraction/copy into the workspace library must happen **before** (or independent of)
  that teardown so no artifact is lost.
- Provenance index (ADR 0014, D1) must tolerate **orphaned origin references** (channel archived
  or deleted) without breaking document access or search.
- Channel "complete/archive/delete" needs explicit lifecycle affordances in the shell.

## Reopen conditions

- If orphaned-provenance references prove confusing, add a "channel deleted" tombstone record
  rather than a raw dangling id.
