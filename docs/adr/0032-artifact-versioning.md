# ADR 0032 — Artifact versioning = immutable versions behind a stable identity

**Status:** proposed (2026-07-03)
**Refines:** ADR 0014 (document scope), ADR 0018 (channel lifecycle), ADR 0024 (artifacts = any media)

## Context

The `Artifact` type and the `ArtifactStore` seam are deliberately write-once (`get`/`put`/
`search`; no update, no `updatedAt`). Plan-doc artifacts break that assumption from two sides:
members want to **edit** a plan in the Library, and agents want to **re-publish** an updated plan
to the same place as a session continues (the "live URL that updates in place" behavior users now
expect from first-party artifact hosting). Choices: mutate in place, or version.

## Decision

**Version, never mutate.** An artifact is a **stable identity** (id, name, home channel, viewer
URL) over an **append-only sequence of immutable versions**:

- Every write — agent publish, agent re-publish, member edit, member re-upload — **appends a
  version**; bytes are never overwritten. `contentType`, `byteLength`, and **provenance move to
  the version** (`origin: agent {runId, threadId} | member_upload {memberId}` per version), so an
  agent-drafted, human-edited plan keeps its full history. The artifact row keeps identity fields
  plus a **head pointer** and gains `updatedAt`.
- R2 key convention becomes `${workspaceId}/artifacts/${artifactId}/${versionId}` (supersedes the
  memory adapter's versionless key).
- The `ArtifactStore` seam stays minimal: `put` against an existing artifact id appends a version
  and advances head; `get` returns head by default, a pinned version on request. No `delete` in
  v1 (durability per ADR 0018); version history is retained, with a per-artifact version cap as
  the only retention lever.
- **Search sees only the head version** (lexical for text-extractable, metadata otherwise, per
  ADR 0024); superseded versions are reachable from the artifact's history, not from search.
- Viewer URLs (ADR 0031) address the identity and render head — re-publishing updates what the
  URL shows without changing the URL; version-pinned view is an explicit variant.

## Consequences

- `Artifact` splits into artifact (identity + head) and `ArtifactVersion` (bytes metadata +
  provenance); the D1 index (tenant-data-access seam: `ArtifactIndex`, `put_artifact_index`)
  gains a versions table — this lands in the first domain migration alongside the R2 bucket.
- Contract tests pin the new semantics: put-to-existing-id appends and advances head; history is
  immutable; tenant guard holds per version.
- ADR 0014's provenance story strengthens: provenance is per-version, so "who/what produced this"
  survives edits instead of being overwritten by them.
- Concurrent edits resolve by append order (last append is head) — acceptable under ADR 0001's
  members-not-hostile posture; no locking/CRDT in v1.

## Open sub-questions

- Version cap value and what "trim" means for R2 bytes (delete oldest vs. archive tier).
- Diff/compare surface in the Library (nice-to-have; not v1).
