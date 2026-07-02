# ADR 0014 — Document scope: channel-homed, workspace-aggregated, with provenance

**Status:** accepted (2026-06-29)
**Refines:** ADR 0006 (retrieval), ADR 0013 (sharing)

## Context

ADR 0013 made documents a shared workspace asset. Refinement from grill: documents are
organized at **two levels** — each document is **homed in a channel** (where it was produced,
uploaded, or is relevant), and the **workspace library** is the cross-channel **aggregate of
all documents**. Documents can be **produced** (outputs by agents _or_ humans), not only
uploaded.

## Decision

- **Channel-level documents:** every document has a **home channel**. A channel's (single)
  agent works with its channel's document set by default.
- **Workspace library:** the **aggregate of all channel documents** — a cross-channel
  browse/search surface for members (role-gated), and the pool from which an agent may
  _optionally_ be granted documents homed in other channels.
- **Provenance (new):** a document record tracks origin — uploaded by a human, or **produced
  by an agent/human within a channel** — plus channel association + timestamps (D1 index).
- **Agent access = selection seam (parallel to ADR 0004):** default = the agent's **own
  channel** docs; opt-in to specific workspace-library docs from other channels. Cross-channel
  access is empty by default.
- **Agents can write documents:** a first-party **"create/save document"** capability
  (catalog tool, ADR 0003/0004) lets an agent produce a document that lands in the channel's
  set + workspace library.
- **Retrieval unchanged (ADR 0006):** R2 blobs + virtual FS **lexical** search + inject via
  `configureSession().withContext()`; **no RAG/Vectorize**.

## Consequences

- Storage tiers: **R2** (blobs) + per-channel **virtual FS** (lexical search) + **D1 document
  index** (provenance, home channel, workspace rollup, ACL by role + `workspace_id` per ADR 0001).
- The "search documents" tool searches the agent's **accessible set** (own channel + opted-in
  workspace docs).
- Workspace-library view = a role-gated D1 query across channels.
- **Produced documents create a write path:** agent tool → save → D1 index + virtual FS + R2;
  must respect the tenant guard + explicit write-permission (ADR 0001 authz gotcha).
- One-agent-per-channel (confirmed v1 invariant) keeps a channel's docs ≈ that agent's primary
  corpus.
