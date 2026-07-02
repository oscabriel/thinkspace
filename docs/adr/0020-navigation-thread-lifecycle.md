# ADR 0020 — Navigation, landing surface, and thread lifecycle

**Status:** accepted (2026-06-29)
**Builds on:** ADR 0016 (thread = recency-bumped post), ADR 0017 (bump-on-agent-output = unread),
ADR 0018 (archive-by-default), ADR 0019 (channel visibility)

## Context
With threads as recency-bumped posts and channels ephemeral, navigation must make "what changed /
what should I look at" obvious. Resolves handoff Q-E.

## Decision
- **Sidebar = channels.** The sidebar lists the member's visible channel set (shared + own
  private, per ADR 0019), grouped **Active vs Archived**, with optional favorites/pinning. Channels
  are the durable nav unit; threads live inside a channel view. Kept flat-ish (no heavy foldering)
  since channels are cheap and turned over.
- **Landing = cross-channel "Recent activity" home.** On open, the member sees bumped threads
  across all their channels, sorted by last activity (agent completions, scheduled runs, human
  comments). **This is the v1 form of the "prioritization" pillar** — the home answers "what moved
  while I was away" and is the strongest justification for a persistent always-on shell. A channel
  view is the same feed scoped to one channel.
- **Thread lifecycle:** any member creates a thread; threads are **auto-named** from the opening
  prompt (editable); the thread list is the **recency-sorted feed**; threads **archive**
  (read-only, searchable) by default rather than hard-delete, mirroring channel lifecycle (0018).

## Consequences
- The bump-on-activity model (ADR 0016/0017) becomes the **universal sort key** for both the
  per-channel thread list and the cross-channel home feed.
- The home feed must aggregate activity across all of a member's visible channels — a
  cross-channel read path (WorkspaceHub-level, ADR 0010) feeding a recency-ranked list.
- Auto-naming implies a cheap title-generation step at thread creation (from the opening prompt).

## Reopen conditions
- If the flat sidebar gets unwieldy at high channel counts, add sections/foldering (kept simple
  for v1 deliberately).
