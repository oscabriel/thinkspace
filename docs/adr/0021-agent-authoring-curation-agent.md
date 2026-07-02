# ADR 0021 — Agent authoring: conversational curation agent (primary) + manual form (full control)

**Status:** accepted (2026-06-29)
**Builds on:** ADR 0003–0006, 0014 (shape = prompt/tools/skills/MCP/docs/model), ADR 0018
(cloneable archived shapes), ADR 0011 (BYOK model access)

## Context
A channel *is* its shape, so creating a channel = authoring an agent. Channels are ephemeral and
created often (ADR 0016/0018), so this flow runs constantly. Resolves handoff Q-F (modality).

## Decision
- **Conversational authoring is the PRIMARY path, driven by a "curation agent."** A first-party
  meta-agent interviews the user, helps them **arrive at the right goal** for the channel, and
  **responsibly populates the shape** (prompt, tool selection within catalog ∩ workspace allowlist
  per ADR 0004, skills, MCP, doc selection, model).
- **Manual form authoring remains available for full control.** Users who want to bypass the
  curation agent can edit the shape directly. The **form is the source of truth**; the curation
  agent *produces a form-shaped config* — it does not invent a parallel representation.
- **Cloning an archived shape (ADR 0018) remains a fast path** into either modality (start from a
  prior shape, then refine conversationally or by hand).

## Consequences
- The product **uses its own agent infrastructure to onboard channel creation** — the curation
  agent is itself an agent (shape + tools), giving it tools to read the workspace's catalog,
  available skills/docs, and write a shape.
- **Cold-start dependency (BYOK, ADR 0011):** the curation agent needs model access, which is
  BYOK-gated. A workspace with no provider key cannot run the curation agent → conversational
  authoring is unavailable until a key exists. This sharpens onboarding ordering (key-first), and
  raises an open question about what the curation agent itself runs on (next).
- The form/shape schema (ADRs 0003–0006, 0014) is the contract the curation agent writes against;
  keeping it the single source of truth means conversational authoring needs no rework if/when the
  form evolves.
- First-party starter templates become **optional** (the curation agent is the primary cold-start
  softener), not a v1 requirement.

## Curation-agent model (resolved 2026-06-29)
- **The curation agent runs on the workspace's own BYOK key** (ADR 0011) — no platform onboarding
  model. **Onboarding starts with adding a provider key**, a deliberate, accepted barrier to entry,
  before channel creation or anything else. This keeps a **single model-routing path** (BYOK
  everywhere, no subsidized/abuse-prone second path) and leaves ADR 0011 intact. The manual form
  is the only no-AI authoring path for a keyless workspace, but in practice key-first means a key
  exists before authoring begins.

## Reopen conditions
- If conversational authoring proves unreliable for complex shapes, promote the manual form to
  co-equal primary rather than fallback.
