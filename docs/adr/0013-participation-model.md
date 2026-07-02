# ADR 0013 — Participation model: single-player threads; multiplayer = shared workspace assets

**Status:** accepted (2026-06-29)

## Context
"Slack-adjacent, lean away" collapses to one load-bearing question: is a thread single-player
or multiplayer? The structural twist (a channel *is* an agent, not a human chatroom) already
pulls away from Slack; the participation model completes the identity.

## Decision
- **Single-player threads are the focus.** Each member has their **own private** conversations
  (threads) with a channel's agent. The shared asset is the *agent* (the shape); the private
  thing is each person's threads. The ThreadAgent (ADR 0010) streams to **one human's devices**.
- **"Multiplayer" = shared workspace assets, not multiple humans in a thread.** Members join a
  workspace to **use each other's agents** (and build their own) and to **access shared
  documents**. Collaboration happens at the *asset* level (agents + documents), not in-thread.
- **Multiplayer threads (multiple humans + agent in one thread) are a reachable seam, NOT a v1
  focus.** Keep it possible (don't architect it out) but don't build it now.
- **No human-only social surfaces in v1:** no human↔human DMs, no calls/huddles, no message
  reactions. (Reactions are v2-at-most.)
- **Social bones live at the channel level** (presence, activity, thread list per ADR 0010);
  conversations themselves are private.

## Consequences
- Real-time stays honest: no human-to-human concurrency/turn-taking inside a thread to solve.
- The shell's "keep" bones: workspace + invited members + roles, channel sidebar, threads,
  unread, channel-level presence, composer. The "drop" bones: DMs, calls, reactions, @-mention
  people into a chat, social chatter in channels.
- Documents being a **shared workspace asset** refines ADR 0006's storage model — see the
  follow-up (workspace document library + per-shape selection).
- Multiplayer-thread seam: ThreadAgent stream fan-out + per-thread human presence must not be
  designed *out*, but remain unbuilt.
