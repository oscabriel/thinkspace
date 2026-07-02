# ADR 0024 — Artifacts are arbitrary media (renames/broadens "Document")

**Status:** accepted (2026-06-29)
**Amends:** ADR 0006 (documents = virtual FS + lexical search; no RAG), ADR 0014 (document scope)

The durable workspace asset previously called a **Document** is renamed **Artifact** and broadened:
it may be **any** media — markdown, image, video, HTML, etc. — not only text. "Document" implied a
text/markdown file; the real concept is any durable produced-or-uploaded asset, so the canonical
ubiquitous-language term is now **Artifact** (ADR 0006/0014 retain the old word as historical
record).

## Consequence
- ADR 0006's **lexical/full-text search** only applies to **text-extractable** artifacts. Non-text
  artifacts (images, video, binaries) are discoverable by **metadata** (name, type, provenance,
  tags), not full-text. Still **no RAG** (ADR 0006 holds).
- Storage stays R2 + virtual FS (ADR 0006) with the D1 provenance/index (ADR 0014); the index must
  carry media type and metadata so mixed-media artifacts are searchable.
- All other artifact rules are unchanged: channel-homed + workspace-aggregated, agents can produce
  them, durable in the **Workspace Library** surviving channel deletion (ADR 0014/0018).
