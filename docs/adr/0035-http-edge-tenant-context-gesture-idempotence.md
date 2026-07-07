# ADR 0035 — HTTP edge: tenant context and gesture idempotence

**Status:** accepted (2026-07-05)
**Refines:** ADR 0001 (trust boundary), ADR 0008 (better-auth), ADR 0009 (shared D1),
ADR 0017 (runs), ADR 0033 (addressing, idempotence boundary), ADR 0034 (creation flow)

## Context

The flows are done; nothing speaks HTTP. Two decisions were deliberately left open rather
than improvised: how production constructs `createRunCompletionFlow` inside a Durable
Object when no member is acting at settle time, and how a request becomes a
`TenantContext` (`{memberId, role, workspaceId}`) out of better-auth session/org state.
Grilling those pulled in everything they touch: workspace scoping, the edge's error
vocabulary, the gesture routes, and what happens to the starter scaffold.

Two code facts shaped everything. First: in the D1 adapter, `workspaceId` guards every
read and write, `memberId` matters only to member-visibility listings (sidebar/directory
channel listings, home feed), and `role` is not yet read anywhere — so "system context"
is a *type* problem, not a behavior problem. Second: the production DO's `completionFlow`
field cannot be "injected by the worker host": a field does not survive hibernation, and
a Think submission can settle via `onSubmissionStatus` in a fresh wake. Any
injection-based wiring loses the flow exactly when it matters.

## Decision

### 1. `SystemContext` — a union widened only at the `TenantDataAccess` boundary

`createD1TenantDataAccess` accepts `TenantContext | SystemContext`, where
`SystemContext = { kind: "system", workspaceId }`. The tenant guard reads `workspaceId`
from either. `TenantContext` itself is untouched — every other seam, fixture, and test
keeps the flat member shape; only the data-access adapter learns the distinction (by the
`kind` tag on the new variant).

Member-visibility reads (`sidebar`/`directory` channel listings, home feed) **fail
closed** under a system context with an `AuthzError`: no system-side caller needs them
(settle needs `listChannelThreads` + `batch`; the reconciliation sweep needs per-run
reads), and "the sidebar as seen by nobody" is a meaningless question — returning all
channels would invent an answer for it. If a future system path genuinely needs an
unfiltered listing, it gets designed then, not inherited silently.

**Rejected — restructuring `TenantContext` into `{workspaceId, actor}`:** more
principled, but ripples through ~24 files for a distinction one adapter cares about.
**Rejected — a synthetic system member:** fabricated identity that would leak into
unread rows or authz errors the moment anything attributes writes to it.

### 2. The DO lazily self-constructs its completion flow; injection stays as a test override

At settle time: `this.completionFlow ??= buildCompletionFlow(env, address)` — decode the
address from the DO name (ADR 0033), build a `SystemContext` from its `workspaceId`, and
compose `createD1TenantDataAccess({context, db: env.DB})` with the production hub
adapters addressed from the same triple. Everything needed survives a wake: `env` and the
name. Test binders keep injecting the field exactly as today; the `??=` never fires when
they do. The `completionFlow === null` guard remains as a type-narrowing fallback, and
the contract tests pinning fail-soft behavior now document the injected-override path.

**Rejected — constructor wiring** (the address is deliberately decoded lazily; contract
binders address DOs by random names and seed afterward) **and RPC/fetch configuration**
(broken by hibernation, as above).

### 3. Workspace identity is request-resident: path-scoped, never session-resident

Domain routes carry the workspace explicitly (`/api/w/:workspaceId/...`), and the edge
resolves membership for `(session.userId, path.workspaceId)`. better-auth's
`activeOrganizationId` is at most a last-used-workspace hint for client redirects — never
an authz input.

ADR 0033 made addressing routing-derived and tamper-proof; session-resident workspace
state would reintroduce exactly the ambient-authority ambiguity that design removed (a
gesture composed against workspace A silently retargeting to B after a switch in another
tab). Path-scoped, the URL, the tenant guard, and the DO name are the same value checked
at three layers. This also dissolves "what does a request without an active org do?" —
for domain routes the state does not exist: a request either names a workspace the user
is a member of, or it does not. Only session-only bootstrap routes ("list my
workspaces") live outside a workspace scope.

### 4. The resolution seam lives in `apps/server`: one function, one middleware

`resolveTenantContext(request, workspaceId) → AsyncResult<TenantContext,
TenantResolutionError>` plus a thin Hono middleware that puts the context on `c.var`.
The edge is where HTTP/auth world translates into domain world — the same role the test
binders play for the workers harness. `packages/domain` never learns HTTP or better-auth
exist.

Every value entering a `TenantContext` passes the branded zod schemas (`memberIdSchema`,
`roleSchema`, `workspaceIdSchema`), so a drifted better-auth shape fails loudly at the
boundary. The error vocabulary and its HTTP mapping:

| Variant              | Meaning                                             | Status |
| -------------------- | --------------------------------------------------- | ------ |
| `unauthenticated`    | no/expired/invalid session                          | 401    |
| `not_a_member`       | valid session, no member row for the path workspace | 404    |
| `malformed_identity` | member row fails the branded parse                  | 500    |

`not_a_member` is 404, not 403: the domain already models invisibility-as-nonexistence
(an invisible channel reads as `null`), and 403 would confirm workspace existence to a
non-member. `malformed_identity` (e.g. a dynamic role outside `owner/admin/member`) is
*our* configuration drift, not the caller's fault — it must page us, not deny users
quietly.

### 5. Session via better-auth, member row by rule

Session verification is `auth.api.getSession({headers})`, full stop — cookie signatures,
expiry, and revocation stay in the library. For the member lookup, the pinned rule:
**if the pinned better-auth version has a first-class "member of org X" read (explicit
org id, not active-org-shaped), use it; otherwise query the `member` table directly via
the committed drizzle schema** (`where userId = ? and organizationId = ?` → `{id, role}`).
Schema coupling is already sunk cost — ADR 0008 foreign-keys our domain tables into
better-auth's org/member tables — so the API buys no decoupling; the rule just prefers
the library surface when it actually fits. If verification shows the plugin's APIs want
a different table orientation, reworking our schema to fit beats fighting the library.

The seam costs two D1 round trips per request (session + member); better-auth's
`cookieCache` can eliminate the first later. Known cost, not a now-problem.

### 6. Minimal organization-plugin scope

`organization()` is added to `createAuth()` with defaults: creator becomes `owner`;
`owner/admin/member` maps 1:1 onto `roleSchema`; no teams, no dynamic roles, no SSO/SCIM.
Workspace creation is better-auth's own org-create endpoint, already mounted under
`/api/auth/*` — no custom route, no domain involvement. **Invitations are deferred**: the
invite flow needs an email sender we do not have; until then a workspace has exactly its
creator, and multi-member workspaces in tests are seeded directly in D1.
`getWorkspaceGraph` stays `notImplemented` — nothing on the creation/dispatch/settle
paths reads it; when it lands it reads the better-auth tables per ADR 0008.

A replicant verification pass against a pinned better-auth clone gates trusting any of
these shapes: the session response shape, the `member` table columns, the role strings,
whether a first-class member-by-org read exists (§5's rule), what org-create writes (is
the creator's member row atomic with the org row?), and whether the plugin demands an
email sender even with invitations unused.

### 7. Gesture surface: PUT-create (idempotent), POST-dispatch (at-least-once, contract-first)

- **`PUT /api/w/:workspaceId/channels/:channelId/threads/:threadId`** with body
  `{openingCommentId, openingBody, ask?: {gestureId}}`. PUT because it is true: the
  client names the resource and replay converges (ADR 0034 §2). Always `200` with the
  `ThreadCreation` receipt — a replay is indistinguishable from a first create (batch
  writes have no read-back; ADR 0034's accepted wrinkle), so there is no `201`.
- **"Create and ask" is the optional `ask` block**: the edge chains `DispatchFlow` after
  creation (ADR 0034 §6), targeting the opening comment. One round trip for the
  commonest gesture; the response then carries the run receipt too.
- **`POST /api/w/:workspaceId/channels/:channelId/threads/:threadId/dispatch`** with body
  `{gestureId, targetCommentId}`.
- Handlers do exactly: resolve context, brand-parse the body, compose the flow with real
  adapters, translate `Result` errors. Path ids that fail brand-parse are `404` (a
  malformed id cannot name anything). Domain-error → status translation
  (`channel_not_visible` → 404, gate/authz → 403, rest → 500) lives in one shared
  translator module, not per-route.

The ModelRouter slice (ADR 0036) adds four domain-error rows to that shared translator:

| Domain error           | Meaning                                                    | Status |
| ---------------------- | ---------------------------------------------------------- | ------ |
| `model_not_in_catalog` | shape's `modelId` is not in the live key-gated catalog     | 409    |
| `byok_key_missing`     | workspace has no `workspace_provider_key` for the provider | 409    |
| `catalog_unavailable`  | cold catalog miss, no last-good to serve                   | 503    |
| `mcp_host_not_allowed` | MCP host outside the ADR 0002 egress allowlist             | 403    |

**Dispatch duplicate suppression: contract now, enforcement later.** ADR 0033 assigned
suppression to the edge ("swallowed before the flow runs") and forbade solving it in the
DO. The client-minted `gestureId` (UUIDv7, ADR 0033's minting rule) is **required on the
wire from day one**, but v1 does not enforce uniqueness — dispatch is documented
at-least-once, worst case a doubled agent reply, never corruption. The wire contract is
the expensive thing to retrofit (a new required field breaks clients); enforcement — an
edge-owned reserve-first `gestureId → runId` table in D1, outside the domain seam — adds
later with zero API change. This is recorded debt, not a gap.

> **Enforced by E5.3 (baked decision 8).** The debt is retired, but the enforcement site
> moved off this ADR's sketch: rather than an edge-owned D1 `gestureId → runId` table, the
> `gestureId` now travels into the ThreadAgent run trigger, and `ts_run` (DO-SQLite) carries
> a UNIQUE `gesture_id` column. A replayed dispatch converges on the existing run's receipt
> inside the DO — deterministically reported as queued — exactly like the PUT creation
> gesture converges on its resident snapshot. No D1-side dedupe table exists. This supersedes
> ADR 0033's "solve it at the edge, never in the DO" note: the DO is the single authority on
> its own run identity, so dedupe belongs where the run is minted (pinned in the ThreadAgent
> contract suite, both binders, plus an edge double-POST test).

### 8. JWT/JWKS is deferred to the hub-connection slice

ADR 0008 envisioned identity reaching a DO as a JWT through `agent.fetch()`. The
architecture moved: the edge resolves `TenantContext` itself and composes flows that call
DO methods inside the same Worker trust boundary (ADR 0001) — nothing in this slice
crosses a boundary needing stateless token verification. Cookie-session resolution is the
only identity mechanism built here. JWT/JWKS remains the designated mechanism for hub
WebSocket authz (`onBeforeConnect`, per `docs/sdk-signature-verification.md` §4/§5) —
deferred deliberately, not dropped.

## Consequences

- **The starter scaffold dies first, in its own commit**: the demo `/ai` Gemini route and
  the orpc surface (`packages/api`) bypass the domain layer entirely; a parallel fake
  edge invites drift while the real one is built.
- **`packages/auth` folds into `apps/server`** (`src/auth.ts`): with `packages/api` gone
  it has one consumer and one 43-line file — pure indirection. The auth *schema* stays in
  `@thinkspace/db` (shared-schema territory). If `apps/web` ever wants a typed better-auth
  client, the type exports from `apps/server`; a package gets re-extracted only when real
  content justifies it.
- New union acceptance in both `TenantDataAccess` adapters + contract pins: system
  context passes the tenant guard, member-visibility reads fail closed.
- `buildCompletionFlow` lands in `thread-agent.ts` beside the DO; the workers contract
  binder keeps injecting.
- New edge surface in `apps/server`: `resolveTenantContext` + middleware unit-tested
  against seeded auth tables; workers tests drive a real creation gesture over HTTP.
- The replicant verification checklist (§6) runs before the seam trusts any better-auth
  shape; its findings may rework our member-lookup or schema per §5's rule.
- Deferred, recorded: invitations (§6), JWT/JWKS (§8), `getWorkspaceGraph` (§6).
  Dispatch-dedupe enforcement (§7) shipped in E5.3 — see the §7 amendment above.

## §6 verification record (2026-07-05)

Verified against better-auth at our lockfile pin `1.6.22` — clone worktree
`~/Developer/clones/github.com/better-auth/better-auth-v1.6.22`, tag `v1.6.22` =
`a90d061de7cdbd60e796230aadf5d1082add1fe2` (do-not-update). All shapes confirmed; no
schema rework triggered. File references below are within that clone.

1. **Session response shape** — `auth.api.getSession({headers})` returns
   `{session, user} | null` (`packages/better-auth/src/api/routes/session.ts:32`).
   Base session fields: `id, createdAt, updatedAt, userId, expiresAt, token,
   ipAddress?, userAgent?` (`packages/core/src/db/schema/session.ts:9`). The org
   plugin adds optional `activeOrganizationId` to the session model. `null` maps to
   `unauthenticated`.
2. **`member` table columns** — `id, organizationId (FK organization.id), userId
   (FK user.id), role (text, default "member"), createdAt`
   (`plugins/organization/schema.ts`, `MemberDefaultFields` + `memberSchema`). No
   `updatedAt`.
3. **Role strings** — defaults are exactly `owner/admin/member`
   (`plugins/organization/access/statement.ts:37`); `creatorRole` defaults to
   `"owner"` (`routes/crud-org.ts:193`). Maps 1:1 onto `roleSchema`. Caveat, accepted:
   the plugin treats `member.role` as a comma-separated *list* in permission checks
   (`permission.ts:12`), and `updateMemberRole` called with an array writes
   `"a,b"` (`organization.ts:117`). Under our minimal scope nothing writes
   multi-role; if one ever appears, the branded parse fails →
   `malformed_identity` → 500, which is §4's intended page-us behavior.
4. **First-class "member of org X" read** — none that fits. `getActiveMember` is
   active-org-shaped; `getActiveMemberRole` takes an explicit `organizationId` but
   returns `{role}` only — no member `id`, which `TenantContext` needs; the full
   point-read `findMemberByOrgId` is internal org-adapter surface, not public
   `auth.api`; and any `auth.api` call re-runs session middleware (a redundant
   session lookup). **§5's rule therefore resolves to the direct drizzle query**
   (`where userId = ? and organizationId = ?` → `{id, role}`).
5. **Org-create writes** — org row and creator member row are two sequential
   awaited adapter writes with **no transaction** (`routes/crud-org.ts:179` then
   `:212`); slug uniqueness is also check-then-insert. A crash between the writes
   leaves a memberless org — invisible under our 404-for-non-members rule, an
   acceptable orphan. Note: org-create also sets the new org active on the session
   by default, so the `session` table needs the `activeOrganizationId` column even
   though we never read it for authz.
6. **Email sender** — not required. `sendInvitationEmail?` is optional
   (`plugins/organization/types.ts:254`) and both call sites guard on presence
   (`routes/crud-invites.ts:400,582`); the plugin runs fine with invitations unused
   and no sender configured.

Implied schema additions when the plugin lands (our `packages/db/src/schema/auth.ts`
has only user/session/account/verification today): `organization`, `member`,
`invitation` tables plus `session.activeOrganizationId`. Useful extra: `addMember`
is a server-only endpoint (`routes/crud-members.ts:51`) — an alternative to raw D1
seeding for multi-member test workspaces, though direct seeding remains the pinned
approach.
