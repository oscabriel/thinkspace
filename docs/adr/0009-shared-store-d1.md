# ADR 0009 — Shared/relational store: D1 (not Postgres-via-Hyperdrive)

**Status:** accepted (2026-06-28)
**Source-grounded:** local clones `cloudflare/agents`, `better-auth`; live web research on
PlanetScale Postgres + Hyperdrive (2025–2026, incl. post-cutoff changelogs).

## Context
Proposal on the table: drop D1 entirely; use **PlanetScale Postgres via Cloudflare
Hyperdrive** for app/auth/shared data, individual DOs for agent state, R2 for blobs —
motivated by "use DOs as much as we can."

**Decisive reframe — DO-maximalism is already maxed.** better-auth **cannot** be backed by
a Durable Object's SQLite (adapter interface requires an external persistent DB —
`better-auth/packages/core/src/db/adapter`; DO SQLite is per-instance/request-scoped). The
`cloudflare/agents` repo agrees from the other side: cross-tenant relational data does not
live in a DO — parent DOs keep only a small in-SQLite registry for in-memory listing, and
the repo's own guidance is "build `listConversations` with **KV/D1**." No cross-DO SQL.
→ Per-agent/conversation state already lives in DO-SQLite (ThreadAgent + hubs); R2 holds
blobs. The auth/tenant graph **must** be an external shared DB regardless. The only open
choice is **which** external DB. It does not change how DO-centric the rest of the system is.

## "No D1 at all" is a real, fully-supported story (considered, not chosen)
- PlanetScale Postgres GA Oct 2025; Hyperdrive **officially** supports it.
- better-auth's **Postgres adapter is first-class / more battle-tested** than its v1.5 D1 path,
  with **real interactive transactions** (vs D1's `batch()` workaround).
- better-auth + Hyperdrive + Postgres is proven (`zpg6/better-auth-cloudflare`,
  **Drizzle + postgres.js**) — *if* you avoid the Kysely dialect (sign-in hang, better-auth
  issue #2274), use a small pool (`max: 5`), and create the client in-handler.

## Decision
Use **D1** as the single shared/relational store for v1 (better-auth tables + our domain
tables foreign-keyed into them, same D1, partitioned by `workspace_id` per ADR 0001).

## Rationale (workload fit)
The shared/auth layer = small relational metadata, **read on the hot path of ~every request**
(authz/session/membership), globally distributed B2B tenants, modest writes.
- **Postgres-via-Hyperdrive is weak for exactly this:** single-origin-region → uncached reads
  pay geographic RTT (and authz reads are the hottest); Hyperdrive's cache is **TTL-only, no
  write-invalidation** → unsafe for authz, and session-expiry queries use STABLE functions
  (`NOW()`) which Hyperdrive now **refuses to cache** (Feb 2026). So auth reads hit origin anyway.
- **D1 fits it:** edge-native + **free auto read-replication across 6 regions**; one edge store
  for the whole relational layer; paved path in this ecosystem.
- Postgres's real wins (interactive tx, unlimited headroom) **don't pay off here** — the layer
  is mostly single-row CRUD + occasional org/member/invite batch (covered by `batch()`); heavy
  data is in DO-SQLite + R2, so the 10 GB ceiling is moot.

## Consequences / constraints
- No interactive transactions → multi-statement atomicity via D1 `batch()` (our writes too).
- Single shared D1, `workspace_id`-partitioned; per-tenant D1 remains an escape hatch via the
  data-access layer if a residency/isolation customer ever appears.
- Reads can use the Sessions API (bookmarks) for read-your-writes when needed.

## Reopen conditions (would flip to PlanetScale Postgres)
1. Tenants cluster in a **single region** (D1's edge-replication edge evaporates).
2. **Heavy cross-tenant relational/analytical** workloads (reporting, billing analytics) emerge.
3. Strategic: deep **Postgres affinity**, desire for **branching**-based safer migrations, or a
   **portability / off-Cloudflare** hedge for the system-of-record.
