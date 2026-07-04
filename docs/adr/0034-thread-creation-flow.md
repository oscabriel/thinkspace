# ADR 0034 — Thread creation: an idempotent flow keyed by an edge-minted ThreadId; D1 row first, initialize second

**Status:** proposed (2026-07-03)
**Refines:** ADR 0009 (persistence tiers), ADR 0016 (thread containment), ADR 0017 (runs),
ADR 0020 (thread naming), ADR 0030 (Shape↔Channel 1:1), ADR 0033 (addressing)

## Context

ADR 0033 deliberately scoped thread creation out: something must write the D1 thread-index
row and call `ThreadAgent.initialize` (opening comment + shape snapshot) across two stores
with no transaction. ADR 0033 guarantees only the substrate: the DO exists at every
address, `initialize` is idempotent-shaped (re-puts the same snapshot/comment), and
dispatching at a well-named-but-empty agent fails closed with
`thread_agent_uninitialized`. "Exists at every address" is not a creation story — this ADR
is.

The round-trip acceptance test currently stands in for the flow by seeding the row and
calling `initialize` directly; that sequence is exactly what this flow owns.

## Decision

### 1. A `ThreadCreationFlow` module in the domain flow layer

One method behind the seam — a deep module in the DispatchFlow/RunCompletionFlow mold:

```
createThreadCreationFlow({ tenantDataAccess, threadAgents, workspaceHub, clock, ids })
  .create({ channelId, openingBody, threadId }) →
    AsyncResult<{ openingComment, shapeSnapshot, thread }, ThreadCreationFlowError>
```

The interface hides: the channel authz gate, snapshot minting from the channel's live
shape, thread/comment assembly, the two-store write ordering, and the announce. Callers
(the HTTP edge) learn one call; tests exercise everything through it. Adapters vary
beneath it at the existing seams (memory and production both bind) — real seams, no new
ones.

### 2. `threadId` is caller-minted and is the idempotency key

The edge mints the `ThreadId` per creation *gesture* (UUIDv7, `th-…`, per ADR 0033's
minting rule) and passes it in. The flow is then a replayable function of its inputs:

- `put_thread_index` is an upsert on `thread.id`;
- `initialize` re-puts the same opening comment and snapshot;
- the announce re-publishes an event, not state.

Replaying the same creation request converges to the same state. Recovery from any crash
is therefore *replay*, not repair: the client re-issues the gesture with the same
`threadId`. (This mirrors ADR 0033's idempotence boundary: duplicate-gesture suppression
and id minting live at the edge; the flow itself is honest about being re-runnable.)

**Rejected — flow-minted ThreadId:** a retry after a lost response mints a second thread;
the client cannot heal a half-created thread it cannot name.

### 3. Ordering: D1 thread-index row first, `initialize` second, announce last

The D1 row is the source of truth for the thread's *existence* (ADR 0009 index tier; the
"domain store first, mechanism second" pattern of ADR 0033 §3). Writing it first means
every crash leaves a state where everything durable is reachable from the index:

| Crash point                  | Observable state                                        | Detection                                                        | Heal                       |
| ---------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------- |
| before D1 write              | nothing happened                                        | creation call failed                                              | plain retry                |
| after D1, before initialize  | thread listed; agent empty                              | dispatch/open fails closed with `thread_agent_uninitialized`      | replay the creation gesture |
| after initialize, before announce | thread fully created; surfaces stale until next bump | none needed — state is complete                                   | replay (re-announces) or next bump |

`thread_agent_uninitialized` is the *designed* half-crash state: fail-closed, names the
exact thread, and cannot mint runs at an empty agent (ADR 0016/0028). The reverse order
(initialize first) leaves durable opening-comment state in a DO that no index row reaches —
invisible orphan state that a replay with a fresh id would strand forever.

### 4. Snapshot minted from the channel's live shape at creation

`getChannel` → authz gate (visibility before lifecycle, as in DispatchFlow; archived =
`channel_read_only`, deleted = `channel_deleted`) → `getShape(channel.shapeId)` →
`ShapeSnapshot { shapeId, snapshottedAt: clock(), structure }`. ADR 0007's
"structure frozen at creation" is realized here: this is the only moment a thread's
snapshot is minted from the live shape; later shape edits reach existing threads only via
explicit `resnapshot`.

### 5. Thread name: derived from the opening body at creation

v1 derives the name as a pure truncation of the opening body (ADR 0020: auto-generated,
member-editable). Model-generated naming is an async improvement that composes later
(a rename write after the first run) without touching this flow's interface.

### 6. Creation does not dispatch

The flow creates; it does not trigger a run. If the product gesture is
"create thread and ask the agent," the edge chains DispatchFlow after creation — reusing
the dispatch spine's authz, receipt, and announcements rather than duplicating a second
run-minting path inside creation (ADR 0017: dispatch is the only human-initiated trigger).

### 7. `ChannelHub.createThread` is superseded and removed from the seam

It has zero callers outside its own adapters and duplicates what this flow owns
(shape-snapshot resolution, tenant checks) — it fails the deletion test. The hub seam
keeps presence/events/roster; creation is a flow over TenantDataAccess +
ThreadAgentDirectory. The announce is `WorkspaceHub.publishActivity({ kind:
"thread_bumped" })` — bump-driven surfaces pick the new thread up like any other activity.

## Consequences

- New contract surface: flow tests over memory adapters (created thread readable via
  `listChannelThreads`; dispatch works immediately after creation; replay converges), and
  a workers-binder test pinning the half-crash path (row present + empty agent → dispatch
  fails `thread_agent_uninitialized`; replaying `create` heals it).
- The seam change (drop `createThread` from `ChannelHub`, delete both adapters' bodies)
  lands with the flow implementation.
- The round-trip acceptance test's hand-seeding is replaced by a `create(...)` call once
  the flow exists.
- A never-replayed half-created thread remains listed and empty until the member retries
  or archives it — accepted for v1 (same worst-case class as ADR 0033's deferred
  reconciliation: stuck-looking, never corrupt).
