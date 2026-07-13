# ADR 0041 — Thread-index activity summary: DO truth projected on write receipts, never counted in D1

**Status:** accepted (2026-07-12)
**Refines:** ADR 0016/0017 (bump semantics — preserved), ADR 0027 (feed read path + atomic
bump batch), ADR 0028 (run state DO-resident; amends its "no D1 run index" with a bounded
summary), ADR 0034 (creation flow seeds the summary)

## Context

The #61 feed-as-posts surface needs three facts per visible thread: the opening excerpt, an
honest reply count, and whether the channel agent is working there (brass chip, The Quiet
Chrome Rule). None of them live on the D1 thread-index row, so wave 12 shipped an interim
`enrichThreads` read (`apps/server/src/reads.ts`) that does **one DO branch read per visible
thread per request**, counts only the loaded root branch, and carries no run identity at all
— the chip was deferred to #64. ADR 0028 pinned run state as DO-resident with **no D1 run
index in v1** and feeds staying bump-driven; a 50-thread feed re-deriving thread facts
through 50 DO reads is that decision's unpaid bill.

## Decision

### 1. Three summary fields on the thread-index row

`threadSchema` (the D1 projection row) gains:

- `openingExcerpt` — derived **once at creation** from the opening comment's body; the
  280-char word-boundary truncation moves from `reads.ts` into the domain next to
  `deriveThreadName` as a pinned derivation (ADR 0034 §5 mold). Comments are immutable, so
  the excerpt never needs maintenance.
- `commentCount` — the **cross-branch total** of comments resident in the thread's DO.
- `working` — `{ runId, since } | null`: the most recently queued **unsettled** run
  (queued or running), or null when every run is settled. `runId` feeds the `?run=` deep
  link; a thread is Working (CONTEXT.md) iff this is non-null.

All three default for legacy rows (`""` / `0` / `null`) — the `rootCommentId` precedent: no
required backfill, rows heal on their next activity. A one-shot reconcile script over the
existing DO read is optional polish, not a migration dependency.

### 2. Projection on receipts — the DO is the only counter

The summary is **copied from DO truth carried on every mutating receipt**, never
incremented in D1. The `ThreadAgent` seam methods that mutate resident state
(`appendComment`, `run`) and the settlement callback (`RunSettlement`) each return the
DO-computed summary (`commentCount` + `working`), and the flows write it onto the index row
**in the same atomic batch** as their existing bump/unread writes (ADR 0027).

Why projection is the only correct shape here: every mutation path is idempotent by replay
(a replayed `appendComment` returns the ORIGINAL comment; a replayed dispatch returns the
original receipt — ADR 0034/0035). A D1-side `count + 1` double-counts under exactly those
replays; copying the DO's current totals is idempotent, monotone-correct, and self-healing
— any later event overwrites any earlier staleness. Concurrency falls out for free: when
one of two live runs settles, the DO computes `working` over **all** resident runs, so the
flag stays truthful without the flows knowing how many runs exist.

### 3. Bump semantics unchanged; two new non-bumping index writes

ADR 0017 stands: only a landed comment and a completed run bump `lastActivityAt`. The
summary adds two index writes that deliberately do NOT bump:

- **Dispatch/fire** sets `working` (the flow's first index write ever) — starting work is
  not activity.
- **Failed settlement** clears `working` — today the failed branch writes nothing; it must
  now write the summary, still with no bump and no unread (the UnreadReason vocabulary
  keeps no failure variant, ADR 0017).

### 4. Staleness is bounded by the existing reconciliation, and the chip is advisory

A dropped settlement (DO dies after the run, before the callback) leaves `working` stale
until the DO's wake-path reconciliation (ADR 0017/0035 §2) re-delivers settlement or any
next event projects fresh truth. The chip is presence-grade signal, not a lock — no
behavior may gate on `working`.

### 5. Reads

`enrichThreads` is deleted; channel thread index and Home feed serve the summary straight
off the row. Payload shapes (`ThreadIndex`, `HomeFeed`) change only by `Thread`'s new
fields.

## Rejected

- **D1-side counters** (increment on append, decrement on settle) — double-counts under
  first-write-wins replays, drifts under partial-batch failures, and ends in a
  reconciliation job that re-derives DO truth anyway. Skip to the truth.
- **A full D1 run index** — ADR 0028's rejection stands. The summary is one nullable run
  reference plus one integer, not a queryable run table; run detail stays a DO read.
- **Read-time fan-out with a cache** — still N+1 when cold, and invalidating on DO writes
  is this same projection wearing worse clothes.

## Consequences

- The dispatch flow acquires its first thread-index write; the failed-settlement path
  acquires one too. Both are new seam-contract-test surface (memory + production adapters).
- `CommentAppend`, `ThreadAgentRunReceipt`, and `RunSettlement` grow a summary payload —
  a breaking seam change inside the repo, invisible outside it.
- D1 migration: three columns with defaults, no backfill required.
