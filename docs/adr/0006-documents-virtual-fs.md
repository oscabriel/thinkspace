# ADR 0006 — Documents: virtual FS, no RAG

**Status:** accepted (2026-06-28)

## Context
Cloudflare Agents ships no built-in RAG; FTS5 is chat-history only. Semantic
retrieval would require a self-owned Vectorize + embeddings pipeline (chunking,
embedding cost, index lifecycle) — the biggest build-it-yourself lift. The product
only needs a **small corpus of docs per agent, directly relevant to that agent's
goals**.

## Decision
- **No RAG / no Vectorize in v1 (or as a near-term concern).**
- Use **`@cloudflare/shell`'s workspace virtual FS** (DO-SQLite + R2) as the
  per-agent document store, with **lexical search**.
- Small docs inject into a turn via `configureSession().withContext()`; a
  **"search documents"** capability is exposed as a first-party catalog tool
  (ADR 0004), opt-in per shape.

## Consequences
- No embeddings infra, chunking strategy, or re-embedding cost to own.
- Retrieval is keyword/lexical only — acceptable given small, focused corpora.
- Documents are a per-shape ingredient, stored per (workspace, shape).
- If a large-knowledge-base use case ever appears, semantic RAG is a v2 addition,
  not a v1 assumption.
