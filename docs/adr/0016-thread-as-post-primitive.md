# ADR 0016 — Thread is the "post" primitive: recency-ordered, nested, channel-scoped

**Status:** accepted (2026-06-29)
**Amends:** ADR 0013 (participation model), ADR 0010 (thread list semantics)

## Context
Round-2 product-shape grill opened with a vision rant (Slack-is-for-sending, Facebook-Workplace
posts > Slack messages, bump-to-top recency, infinite sane nesting, agents in the same control
plane, Slack-Connect cross-company federation, a prioritization layer). Rather than adopt the
rant's maximalism, the user re-grounded it onto the existing product spine.

The load-bearing reframe: the messaging-app failure mode is that **threads are frozen in time**
(pinned to their position in a flat message list). We want threads to behave like **posts**.

## Decision
- **No new layer.** Hierarchy stays **Channel → Thread**. We do **not** introduce a separate
  "Post" primitive between channel and thread. Instead, **Thread absorbs post semantics.**
- **Threads are recency-ordered, not time-frozen.** Any activity in a thread (human *or agent*)
  **bumps it to the top** of its channel's thread list. This is the rant's core ask
  ("why don't threads work that way in anything else?").
- **Threads contain nested comments.** Within a thread, conversation is a **nested tree**
  (reply-to-a-specific-message, branch sub-discussions) rather than a flat linear log. Exact
  participant structure of that tree is a follow-up question (see Open).
- **Product spine is unchanged.** Core remains: a **bespoke agent per channel**; each channel is
  created with a **specific goal**; each thread is **deep-thinking work toward that goal**.
- **Channels are ephemeral / goal-scoped.** A channel is expected to be **turned over when its
  goal is complete** — channels are disposable work units, not permanent rooms. (New; refines the
  channel lifecycle assumed in ADR 0010/0007.)
- **Multiplayer human conversation is a v1 consideration (amends ADR 0013).** Multiple humans
  conversing **within a channel/thread** in a way that **informs the channel's agent** is now
  in-scope for v1 — *not* deferred. The single-agent-per-channel invariant is unchanged; what
  changes is that humans (plural) may participate around that agent. (How exactly humans vs the
  agent sit in the nested tree, and how human talk "informs" the agent as context, is the next
  open question.)
- **Cross-company shared channels ("Slack Connect"-like) stay deferred.** On the radar, **not a
  v1 concern.** Consistent with ADR 0001's trust boundary (model b now; model c reachable).

## Consequences
- The thread list (ADR 0010) is a **recency-sorted feed**, not a creation-ordered list. Unread/
  notify semantics (Round-2 Q-C) now hang off "thread bumped by new activity."
- ADR 0013's "single-player threads / no multiplayer in v1" is **partially superseded**: humans
  may co-participate in a channel's threads in v1. The ThreadAgent stream fan-out and per-thread
  presence (previously a deferred seam) become **near-term** rather than v2-only.
- Channel ephemerality implies lifecycle affordances (complete/archive/turn-over) and affects how
  shapes, threads, and documents are retained or disposed when a channel closes.
- Nested-comment data model touches the per-thread DO message store (ADR 0010 ThreadAgent):
  messages need parent/child structure, not a flat sequence.

## Resolved follow-ups
- **Internal thread structure (Model α):** the agent is one voice *in* the single nested tree;
  a dispatched branch's **subtree is the agent's context window** (ADR 0017).
- **One conversation surface:** humans and the agent are co-authors of the **single thread tree**.
  There is **no separate channel-level human chat**. "Informing the agent" is implicit — it is
  whatever lives in the dispatched subtree; there is no explicit gather/inject step and no
  human-only side channel (keeps ADR 0013's "no human-only social surfaces" instinct intact).

## Open (next grill questions)
- **Channel turn-over mechanics:** archive vs delete; what happens to produced documents.

## Reopen conditions
- If multiplayer-in-thread proves too costly for v1, fall back toward ADR 0013's single-player
  focus with multiplayer as the deferred seam (the seam is preserved either way).
