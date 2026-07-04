# ADR 0033 — ThreadAgent addressing: the DO name IS the address; RunId IS the submissionId

**Status:** accepted (2026-07-03)
**Refines:** ADR 0009 (persistence tiers), ADR 0015 (pin set), ADR 0017 (runs), ADR 0028 (DO-resident run reads)
**Verified against:** `docs/sdk-signature-verification.md` (`agents@0.17.1` / `@cloudflare/think@0.11.1` @ clone `2351e5c`) + `partyserver@0.5.8` (installed pin)

## Context

The `ThreadAgent` seam carries a `ThreadAgentAddress` (`workspaceId`, `channelId`,
`threadId`), and the dispatch flow reaches agents through
`ThreadAgentDirectory.get(address)` — synchronous and infallible, with the memory adapter
documenting the intended semantics: "an agent exists at every address, created on first
get." That is exactly a DO namespace's guarantee. But production has no path that gives a
Durable Object its address: the contract suites seed it via `applyTestSeed`, and the
production DO returns `not_implemented` until seeded. Three open decisions block the
dispatch→completion round-trip slice:

1. How the production directory maps an address to a DO (address ⇄ DO name).
2. Where the address *resides* inside the DO (its tenant guard and every error payload
   need it).
3. How a domain `Run` relates to a Think **submission** (the SDK has no "run" primitive;
   `submitMessages` accepts a caller-supplied `submissionId` — `think.ts:9302`).

Constraints established at the pins:

- `getAgentByName(namespace, name)` is the paved named-DO addressing path
  (`index.ts:12877`); it is async, and `getServerByName` awaits a `setName` RPC on the
  stub per call — one extra round-trip per directory `get`.
- In `partyserver@0.5.8`, `this.name` is a getter over `ctx.id.name` — populated for any
  named DO from construction onward, on every entry point (fetch, RPC, alarm), on current
  workerd. DOs addressed via `idFromString`/`newUniqueId` have no name and the getter
  throws.
- Think validates nothing about `submissionId`'s format, and re-submitting an existing
  `submissionId` is idempotent — it returns the existing submission.
- Domain ids are `z.string().min(1)` brands — **no format guarantee**. Any encoding of
  several ids into one name must be injective by construction, not by convention.

## Decision

### 1. DO name = canonical injective encoding of the full address triple

A shared codec module (`adapters/thread-agent-address.ts`, the `comment-tree.ts` pattern)
owns both directions:

```
encodeThreadAgentAddress(address): string   // encodeURIComponent per segment, "/"-joined:
                                            // {ws}/{ch}/{th}
decodeThreadAgentAddress(name): ThreadAgentAddress | null   // null = not an address
```

Per-segment `encodeURIComponent` makes the join injective (an encoded segment can never
contain `/`) and the name URL-safe (compatible with `routeAgentRequest`'s
`/agents/{class}/{name}` if we ever route HTTP/WS straight to the DO). Memory and
production directories both use the codec — the memory directory's current raw
`join("/")` key is a latent collision for ids containing `/` and is replaced.

The production `ThreadAgentDirectory` is a pure thin adapter:
`get(address)` returns a caller-side wrapper whose methods lazily await
`getAgentByName(env.THREAD_AGENT, encode(address))` (stub promise cached, so the
`setName` round-trip is paid once per wrapper), mapping seam `schedule` → DO
`scheduleRun` as already pinned.

**Rejected — D1 mapping table (address → DO id):** adds a write at thread creation, a read
per dispatch, and a creation race, all to replicate what the namespace already guarantees.
Deleting it and substituting the pure function loses nothing: it fails the deletion test.

**Rejected — name = `threadId` alone:** ids carry no global-uniqueness guarantee, and the
tenant boundary would vanish from the identity — a colliding or forged threadId in another
workspace would route to the *same* DO, leaving isolation to resident state. With the full
triple, cross-tenant traffic routes to a *different* DO by construction; the in-DO tenant
guard becomes defense in depth rather than the only wall.

**Rejected — encoding-version prefix (`v1/…`):** a re-encoded name is a different DO, so
any v2 encoding implies dual-lookup-with-fallback for all pre-cutover threads forever — a
cost the prefix does not reduce; it only identifies the decoder *after* the fallback
lookup has already found the object. The address triple's containment is the most stable
fact in the domain (ADR 0016/0018, made physical here), so the realistic "encoding change"
is an escaping bug, and the insurance for that is the codec's injectivity contract tests
(adversarial ids: `/`, `%`, unicode), not a version tag. A forced re-addressing (e.g. the
ADR 0009 per-tenant-D1 residency escape hatch) would be a namespace-level migration with
its own directory logic regardless.

### 2. Address residency: derived from `this.name`, lazily, memoized

The name is routing-derived and tamper-proof — the caller cannot lie about it — so the
identity *is* the address. The DO decodes `this.name` on first seam-method use and
memoizes it. Decoding is lazy **not** because the name is unavailable earlier (on this
partyserver pin it is available from construction), but because the constructor must
never throw on a non-address name — the contract binders address DOs by random UUID
names and seed afterward — and because `applyTestSeed`'s explicit address remains the
test override, taking precedence over decoding.

Fail-closed: a DO whose name does not decode (or that has no name — unique-id
addressing) returns a dedicated error from every seam method:

```
{ kind: "thread_agent_unaddressable", doName: string }   // new ThreadAgentError variant
```

It executes nothing. The variant is honest where `not_implemented` was a placeholder
lie — an undecodable name is a bad route, a forged name, or a directory-bypassing caller,
not unfinished code — and `doName` carries no tenant data *by construction* (it failed to
decode into ids). `not_implemented` reverts to meaning only "unfinished." The variant is
pinned by a workers-binder contract test (garbage-named DO, call `run`, expect the
variant); the memory adapter cannot construct an unaddressable agent and that asymmetry
is accepted — this error is a production-substrate fact, not seam behavior.

Consequences for the seam: `ThreadAgentInitializeRequest` stays as-is (no address
widening); pre-initialize calls on a *well-named* DO can now return a proper
`thread_agent_uninitialized` error naming the right thread.

**Rejected — persist address at `initialize`:** a second source of truth that can drift
from the name, an extra write, and pre-initialize calls remain addressless.
**Rejected — caller carries address per call:** widens every method's interface and asks
the DO to trust caller payloads for its own identity — the tenant guard would validate
claims against claims.

### 3. RunId = submissionId; the domain run row stays the source of truth

`run(trigger)` keeps its current shape — mint `RunId`, write the queued `ts_run` row —
and the Think turn layer composes on top: `submitMessages(branchMessages,
{ submissionId: runId, idempotencyKey: runId, ... })`. One id, no mapping table.
`getRun`/`listRuns` remain reads of `ts_run` (already contract-pinned);
`inspectSubmission(runId)` is the diagnostic/reconciliation view, never the read path.
Terminal submission status maps onto the run lifecycle when the completion hook fires
`createRunCompletionFlow.settle`.

This instantiates the pattern `sdk-signature-verification.md` §2 pinned for schedules:
**the domain store is the source of truth; the SDK primitive is the mechanism, referenced
from the domain row — never the reverse.** The run↔submission layer is therefore additive
to the committed adapter, not a rewrite.

**Idempotence boundary — decided:** `idempotencyKey = runId` covers *internal* retries
only (a re-submit for an already-written run row replays idempotently). It cannot and
does not address duplicate *dispatches* — a double-click or network retry reaching the
dispatch flow twice mints two runs and two agent replies, and v1 accepts that at the
domain layer. Deliberately re-dispatching the same comment is legitimate (ADR 0017's
explicit trigger), so a domain-level dedupe key would encode wrong UX policy.
**Duplicate-dispatch suppression is the HTTP edge's concern** (client-minted
request id per dispatch gesture, swallowed before the flow runs); the round-trip slice
must not solve it in the DO.

**Reconciliation invariant — mechanism deferred:** every non-terminal `ts_run` row must
eventually settle; **the DO's wake path is the designated reconciliation point.** A crash
between submission-terminal and our completion hook leaves a `running` row that ADR 0028
surfaces to users, so the invariant is real — but the mechanism stays unbuilt until the
round-trip slice lets us observe Think's drain-on-wake at the pin (it may already replay
the completion path; a hand-rolled `onStart` sweep designed against guessed semantics
risks double-settling). Worst case while deferred is a stuck-looking run, not corruption;
`inspectSubmission(runId)` is the reconciliation read whenever the sweep is built.

## Non-goals

- **Thread creation is out of scope.** Something must write the D1 thread-index row and
  call `initialize` (opening comment + shape snapshot) across two stores with no
  transaction; that ordering-and-recovery design belongs to the thread-creation flow in
  the round-trip slice. This ADR only guarantees the flow's substrate: the DO exists at
  every address, `initialize` is idempotent-shaped (re-puts the same snapshot/comment),
  and dispatch's `thread_agent_uninitialized` is the detectable, retryable half-crash
  state. "Exists at every address" is not a creation story.

## Consequences

- The directory adapter has no storage, no failure modes, and no creation step: first
  `get` materializes the agent — the semantics the memory adapter already contract-pins.
- A DO name is immutable, so the address triple is physically permanent. Threads already
  never migrate across channels or workspaces (ADR 0016/0018); this makes that structural.
- **Id minting rule (policy, not schema):** production ids are minted by us — UUIDv7 with
  a type prefix (`ws-…`, `ch-…`, `th-…`, `run-…`) — at the flow/edge layer when creation
  lands. The zod schemas stay permissive (they are the acceptance boundary, and
  better-auth mints its own ids that `WorkspaceId` may absorb); the codec stays defensive
  so a rule-bending id can still never collide names.
- CuratorAgent follows the same pattern later (`CuratorSessionId` ⇄ DO name per
  `sdk-signature-verification.md` §1) with its own codec — same module shape, different
  segments.
- New contract surface for the round-trip slice: codec round-trip + injectivity
  (adversarial ids containing `/`, `%`, unicode); a workers-binder test that a
  name-addressed DO derives its own address with no seed; the
  `thread_agent_unaddressable` variant on a garbage-named DO; the `RunId = submissionId`
  equality once the Think layer lands (`sdk-signature-verification.md` §"contract tests
  to pin").
- Any future rename of DO seam methods must keep dodging SDK-reserved names (`schedule`,
  `state`, `sql`, `name`, …) — `name` is now load-bearing for identity as well.
