# ADR 0007 — Shape versioning: snapshot-at-creation

**Status:** accepted (2026-06-28)

## Context
A channel hosts one shape; threads are conversations against it. When an admin edits
the shape, in-flight threads must not mutate mid-conversation (jarring, non-reproducible),
yet new threads should get the new shape. The stack makes snapshotting the *idiomatic*
choice: each ThreadAgent is its own DO with its own SQLite (`think_config`), loaded sync
on wake (`getConfig()`); live propagation would force a per-turn D1 re-read via
`beforeTurn` — more coupling, worse UX.

## Decision
- **Snapshot-at-creation.** A thread is born with the resolved shape and keeps it.
- **Explicit "update this thread's agent to the latest" action** re-snapshots on demand.
- **Snapshot granularity (option b):** freeze **structural config** (prompt, model id,
  tool selection, skill refs, doc refs) into the thread's `think_config` at creation;
  let **referenced heavy content** (skill markdown in R2, doc files in virtual FS) be
  read **live** (current version). Accepted trade-off: "structure frozen, content live."

## Consequences
- No global shape version-history system needed in v1 (copy-on-create into thread DO).
- Editing a shape is safe for in-flight threads (structure unaffected until explicit update).
- Content fixes (skill/doc edits) reach live threads — usually desirable.
- Split-brain is acknowledged; **full content-version freeze is a v2 governance feature**
  if reproducible audit is ever required.
- New threads created after an edit get the new structural config automatically.
