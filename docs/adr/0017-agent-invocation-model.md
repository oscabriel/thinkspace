# ADR 0017 — Agent invocation model: reactive + scheduled only; explicit/predictable action

**Status:** accepted (2026-06-29)
**Builds on:** ADR 0016 (thread = post; agent is a dispatchable voice in the nested tree)

## Context

ADR 0016 settled that a thread is a nested comment tree (Model α) in which the channel's single
agent is a dispatchable voice, and a branch's subtree is the agent's context window. Open: when
does the agent act _on its own_ vs only when addressed? This also decides whether async/scheduled
work is a v1 pillar (handoff Q-D) and what "unread/notify" means (handoff Q-C).

Three candidate behaviors were considered:

1. **Reactive (dispatch-only):** acts only when explicitly addressed/dispatched on a branch;
   may complete **asynchronously** and **bump the thread on completion**.
2. **Scheduled:** runs on a schedule/cron; bumps on completion with no human in the loop.
3. **Autonomous/ambient:** watches the tree and jumps into branches **unprompted**.

## Decision

- **Ship 1 + 2 in v1. Defer 3.**
- **Guiding tenet: explicit or predictable action only.** The agent acts when **explicitly
  dispatched** (1) or on a **predictable schedule** (2). Surprising/unexpected/ambient agent
  behavior is **not desirable** and is out of scope.
- **(1) Reactive + async is the spine.** Dispatch the agent on a branch; the run may be
  long/async; **completion bumps the thread**. This is the "branch off → send agent to explore →
  it comes back with feedback" loop.
- **(2) Scheduled runs are a v1 differentiator.** Recurring/cron runs (digests, periodic checks)
  bump on completion. Async + scheduled durable execution is therefore a **committed v1 infra
  pillar** (Think supports scheduling/long-running natively).
- **(3) Autonomous ambient replies = reachable seam, not v1.** Noisy, costly (runs on every human
  comment), and contrary to the explicit/predictable tenet. Do not architect it out.

## Consequences

- **Unread/notify (handoff Q-C) falls out for free:** "unread" = a thread bumped by **agent
  output you haven't seen** (async or scheduled completion), plus human co-participant activity.
  Not driven by a stream of human messages.
- v1 commits to a **durable run lifecycle** (dispatch → running → complete/failed → bump),
  resumable streams, and a scheduler. This is what justifies a persistent Slack-like shell over a
  plain chat box.
- Humans co-participating in a tree (ADR 0016) does **not** trigger the agent; the agent ignores
  ambient human chatter until dispatched. Human talk informs the agent only as **context** when it
  is next dispatched on that subtree.

## Scheduled-run destination (resolved 2026-06-29)

- **Default: a schedule owns one fixed thread.** Each run appends a new top-level comment there
  and **bumps that one thread** (e.g. a "Daily Digest" thread that floats up each morning with
  prior runs nested beneath). Avoids the thread-spam failure mode (fresh-thread-per-run) that
  made bot threads unmanageable in Slack/Discord. Per-schedule choice of fresh-thread is a
  deferred (v2) escape hatch. A schedule is thus a property **of a thread**, not a thread factory.

## Reopen conditions

- If users want light proactivity, (3) can be added behind an explicit per-channel opt-in without
  breaking the tenet (predictable because the user turned it on).
