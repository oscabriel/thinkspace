# ADR 0005 — Skills: user-authored, markdown-only, R2-backed

**Status:** accepted (2026-06-28)

## Context

A skill is a chunk of procedural knowledge a shape carries (a markdown playbook).
Source research (handoff §4): declarative markdown skills work at runtime with no
redeploy via `fromManifest()` (in-memory) or `r2()` (R2-backed, re-indexes).
Executable script skills need a Node-side esbuild precompile — no in-Worker bundler
— so they are architecturally incompatible with self-serve runtime authoring.

## Decision

- **Markdown-only, user-authored skills in v1.** Users add their own.
- **Executable script skills are out** of the user-authoring path (defer; if ever
  built, first-party-only with a deploy pipeline).
- **Storage = R2-backed (`r2()`), keyed per shape.** Skills persist across
  thread-DO hibernation and are shared by every thread in a channel; an R2 object
  per (workspace, shape) is the durable system of record, and editing re-indexes.
- Skills follow the **opt-in-per-shape** model (ADR 0004): empty by default, author
  selects deliberately.

## Consequences

- `fromManifest` (in-memory) rejected as primary: no system of record, content must
  be re-supplied on every wake.
- Need an R2 layout + a `shape_skills` selection concept in the data model.
- Authoring UX: markdown editor in the shape-builder; live on next turn.
