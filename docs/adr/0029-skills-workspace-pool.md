# ADR 0029 — Skills are workspace-level assets; shapes select them

**Status:** accepted (2026-07-01)
**Amends:** ADR 0005 (skills storage "keyed per shape")

## Context
ADR 0005's storage wording keyed skills per (workspace, **shape**), while its own opt-in
language ("author selects deliberately", the ADR 0004 model) implies a pool to select from.
The typed model chose a workspace-level `Skill` pool with per-shape `skillSelection`; the
divergence needed an explicit ruling.

## Decision
**Skills are workspace-level assets** (parallel to artifacts): authored once, stored as an
R2 object per (workspace, **skill**), and **opted into per shape** via the shape's skill
selection. "Per shape" in ADR 0005 now means *selection*, not *ownership*.

## Consequences
- A playbook written once serves many channels; clones keep working after the source
  channel dies; the curator can offer the existing skill library while authoring.
- ADR 0007 is unchanged: the skill **selection** freezes into the thread snapshot
  (structure) while the skill **markdown** stays live (content) — "structure frozen,
  content live" holds.
- R2 layout becomes `{workspace}/skills/{skill}.md` (adapter-internal; never crosses the
  seam).
