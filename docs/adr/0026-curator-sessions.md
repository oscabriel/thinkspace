# ADR 0026 — Curator sessions: stateful interview; draft = goal + shape

**Status:** accepted (2026-07-01)
**Refines:** ADR 0021 (conversational authoring primary; form is source of truth)

## Context
ADR 0021 has the curator both **sharpen the goal** and **populate the shape** through a
multi-turn interview, but the first typed seam was a one-shot `draftShape(prompt) → { shape }`:
the goal output was missing entirely and the conversation had no home.

## Decision
- **The curator draft is `{ goal, shape }`** — form-shaped (the manual form remains the
  source of truth); the goal is a first-class output alongside the `ShapeStructure`.
- **Authoring happens in stateful, per-member curator sessions.** `startSession()` opens a
  session; `send(message)` returns a `CuratorTurn { reply, draft | null }` whose draft
  refines turn by turn. Session state lives in the curator runtime — production: the
  workspace-scoped curator Think agent (a DO), sessions keyed per member — matching
  ADR 0021's "the curation agent is itself an agent" and the persistent workspace
  meta-knowledge in CONTEXT.md.

## Consequences
- Seam: `CuratorAgent = { startSession, send }`; sending into an unknown session fails with
  a typed `curator_session_not_found` error.
- Concurrent authoring by different members never shares a transcript (sessions are
  per member).
- The memory adapter scripts turns for tests; the production adapter maps sessions onto the
  curator DO's conversation state.
