# CONTEXT — Bespoke Multi-Tenant Agent App

**Status:** design grill in progress (started 2026-06-28)
**Engine:** Cloudflare Agents + `@cloudflare/think` (chosen; see handoff §3)

## Product in one line

A multi-tenant, Slack-_adjacent_ app where end users build bespoke "shape" agents.
A **shape** = a user-defined agent config: system prompt, tools, skills, MCP servers, artifacts, model.

## Interface model

- **Workspace** = tenant; has invited members.
- **Channel** = hosts **exactly one** bespoke agent (a channel _is_ an agent); **goal-scoped and
  ephemeral** (turned over when its goal is complete).
- **Thread** = the **post primitive**: a unit of deep-thinking work toward the channel's goal,
  **recency-ordered** (any activity bumps it to the top) with **nested comments** inside; humans
  may co-participate in a way that informs the channel's agent (ADR 0016).

## Language (ubiquitous language)

The canonical glossary. Definitions say what each term IS; **Avoid** lists rejected synonyms.

### Tenancy & membership

**Workspace**: The tenant boundary; owns members, channels, the workspace library (artifacts), and billing.
_Avoid_: org (it's the better-auth implementation term), team, account.

**Member**: A user's membership in a workspace, carrying a role (owner/admin/member).
_Avoid_: user (a user is the person; the membership is the Member).

### Channel & agent

**Channel**: A goal-scoped, ephemeral surface hosting **exactly one** bespoke agent (a channel
_is_ an agent). Has an owner, a visibility (shared or private), a goal, and a lifecycle (active →
archived → optionally deleted). Turned over when its goal is complete.
_Avoid_: room, chat, conversation (those are Threads), bot.

**Shape**: The config that defines a channel's agent — prompt, tools, skills, MCP servers,
artifact selection, and model. Snapshotted at creation; cloneable into a new channel.
_Avoid_: agent config, persona, template (a template is a _reusable_ shape).

**Goal**: The specific, searchable objective a channel exists to accomplish; the reason it is
created and the trigger for its eventual turn-over.

### Conversation structure

**Thread**: The **post primitive** — a body-less container that holds a _forest_ of top-level
comments and is the unit of recency/bumping inside a channel. Recency-ordered (any activity bumps
it to the top); multiplayer-capable (ADR 0016). The thread's opening content is just its first
top-level comment; the thread itself carries only metadata (name — auto-generated, editable —
lifecycle, last-activity).
_Avoid_: conversation, chat, session.

**Comment**: The atomic node of content inside a thread, authored by a human member **or** the
channel's agent, arranged in a nested tree. Replying = adding a child comment.
_Avoid_: message, post (see below), entry, turn.

**Top-level comment**: A comment whose parent is the **thread** itself (depth 1). A thread may
hold several (the human's opener, plus e.g. each scheduled run's output per ADR 0017).

**Nested comment**: A comment whose parent is **another comment**. Enables reply-to-a-reply and
sub-discussions without clogging the parent.

**Post**: _Avoid_ as a structural primitive — retired in ADR 0016. Informal synonym only, for "a
thread as it appears in the recency feed." The thing people intuitively call a post is a
**top-level comment**.

### Agent action & lifecycle

**Dispatch**: The explicit act of invoking a channel's agent **at a specific comment**, asking it
to reply there. The human-initiated trigger (ADR 0017).
_Avoid_: send, summon, trigger, invoke, run, @-mention.

**Run**: A single execution of the agent, produced by **either** a dispatch or a scheduled fire.
Has a lifecycle (queued → running → complete/failed); on completion it authors a comment and
bumps the thread. The unifying concept — Dispatch and Schedule are its two (and only two) triggers
(ADR 0017).
_Avoid_: job, task, execution, invocation.

**Branch**: The dispatch context slice anchored at a comment: the **ancestor path** (the
thread's top-level comment down to that comment) **plus the subtree rooted at it**. A branch
**is exactly the context window** the agent sees when dispatched there; ancestor-siblings are
excluded (ADR 0016, amended by 0025).
_Avoid_: subtree (now only half the story), fork, sub-thread.

**Bump**: Moving a thread to the top of its feed because of new activity (a new comment or a
completed run). The core recency behavior (ADR 0016/0017).
_Avoid_: resurface, ping, surface, refloat.

**Schedule**: A recurring run definition **bound to one thread**; each fire is a run that appends
a top-level comment and bumps that thread (ADR 0017).
_Avoid_: cron, job, recurring task, reminder.

### Authoring & delegation

**Curator** (a.k.a. Curation Agent): The first-party **system agent** that lives outside the
channel system and "lives" persistently in the **New Channel** entry point. Scoped to the
workspace, with its own product-supplied system prompt + tools, its own meta-set of workspace
knowledge, and **full access to the workspace library**. It helps the user create the right kinds
of channels — effective, achievable goals and bespoke agents shaped to accomplish them. It has
**no goal, channel, or lifecycle** of its own, but runs on workspace BYOK like any agent
(ADR 0021). Authoring happens in per-member curator **sessions** that refine a draft
(**goal + shape**) turn by turn (ADR 0026).
_Avoid_: onboarding bot, wizard, assistant.

**Sub-agent**: An internal helper the channel's agent spawns **within a run** for scoped/parallel
work — a **facet of the channel's single agent identity, not a separate agent** (ADR 0022).
Visible in the tree.
_Avoid_: child agent, facet (Think's implementation term), worker.

**Template**: A _reusable_ shape offered as a starting point for a new channel.
_Avoid_: preset, blueprint.

**Clone**: A copy of an existing (often archived) channel's shape used to seed a new channel
(ADR 0018).
_Avoid_: fork, duplicate, copy.

### Assets & surfaces

**Artifact**: A durable workspace asset produced by an agent or uploaded by a member — **any**
media (markdown, image, video, HTML, …), not only text. Channel-homed (provenance) but
workspace-aggregated; **survives its origin channel's deletion** (ADR 0018). Full-text/lexical
search applies to text-extractable artifacts; others are found by metadata. No RAG (ADR 0006/0014).
_Note:_ ADRs 0006/0014/0018 call this "Document(s)"; **Artifact** is the canonical term going
forward (broadened because content is not always a text file).
_Avoid_: document, file, attachment.

**Workspace Library**: The durable, workspace-level home for all artifacts; outlives channels.
_Avoid_: doc store, drive, vault.

**Directory**: The searchable index of shared channels (goal/owner/status) for finding channels
you are not in (ADR 0023).
_Avoid_: catalog (reserved for the tool catalog), index.

**Home**: The v1 cross-channel prioritization surface — your bumped threads across all your
channels ("what moved while I was away", ADR 0020).
_Avoid_: feed, inbox, dashboard.

**Activity Feed**: Reserved name for the **deferred** workspace-wide firehose of all channel
activity (ADR 0023) — distinct from Home.

**Unread**: A thread carrying **agent output you haven't seen** (a completed run or scheduled
output), plus co-participant activity — not a human-message counter (ADR 0017).
_Avoid_: notifications, badge.

### Channel attributes & access

**Owner**: The member who created a channel; holds shape-edit rights alongside admins (ADR 0019).

**Visibility**: A channel is **Shared** (workspace-visible, default) or **Private** (owner-only)
(ADR 0019).

**Channel lifecycle**: **Active → Archived** (read-only, searchable) **→ Deleted** (explicit;
artifacts survive) (ADR 0018).

**Role**: A member is **owner / admin / member** (better-auth org roles, ADR 0008).

**Catalog**: The first-party registry of tools available to shapes (ADR 0004). Reserved term —
not reused for channel discovery (see **Directory**).
_Avoid_: reusing "catalog" for anything but tools.

## Decisions log

_(ADRs land in `docs/adr/`; this table is the running index.)_

| #    | Decision                                                                                                                                                                                                                                                | Status               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| —    | Engine = Cloudflare Agents + Think                                                                                                                                                                                                                      | accepted (pre-grill) |
| 0001 | Trust boundary = B2B invited-teams (model b), keep (c) reachable                                                                                                                                                                                        | accepted             |
| 0002 | MCP egress = per-workspace owner-approved host allowlist                                                                                                                                                                                                | accepted             |
| 0003 | Tools = first-party registry + MCP; defer Code Mode to v2                                                                                                                                                                                               | accepted             |
| 0004 | Three-layer tool model (catalog ∩ workspace ∩ shape); empty-by-default shapes                                                                                                                                                                           | accepted             |
| 0005 | Skills = user-authored, markdown-only, R2-backed per shape                                                                                                                                                                                              | accepted             |
| 0006 | Documents = virtual FS + lexical search; no RAG                                                                                                                                                                                                         | accepted             |
| 0007 | Shape versioning = snapshot-at-creation + explicit update; freeze structure, content live                                                                                                                                                               | accepted             |
| 0008 | Auth = better-auth (self-hosted, D1); org plugin owns workspace/member/invite/role                                                                                                                                                                      | accepted             |
| 0009 | Shared store = D1 (PlanetScale-PG-via-Hyperdrive considered, not chosen)                                                                                                                                                                                | accepted             |
| 0010 | Real-time = two-tier hubs (WorkspaceHub + ChannelHub), per-channel sharding, presence in channel hubs                                                                                                                                                   | accepted             |
| 0011 | Model routing = AI Gateway + BYOK-only (CF Secrets Store aliases); key-gated catalog                                                                                                                                                                    | accepted             |
| 0012 | Scale envelope = upper bound of assumed bands; non-goals beyond (no WorkspaceHub sub-shard)                                                                                                                                                             | accepted             |
| 0013 | Participation = single-player threads; multiplayer = shared workspace assets; no human-only social                                                                                                                                                      | accepted             |
| 0014 | Documents = channel-homed + workspace-aggregated, with provenance; agents can produce docs                                                                                                                                                              | accepted             |
| 0015 | Maturity risk = Medium posture (pin set + thin ACL + contract tests + fork-ready); risk accepted                                                                                                                                                        | accepted             |
| 0016 | Thread = post primitive (recency-ordered, nested); channels ephemeral/goal-scoped; multiplayer-informs-agent is v1; Slack-Connect deferred (amends 0013, 0010)                                                                                          | accepted             |
| 0017 | Agent invocation = reactive(+async) + scheduled only; defer ambient; tenet: explicit/predictable action only; unread = bump-by-agent-output                                                                                                             | accepted             |
| 0018 | Channel lifecycle = archive-by-default + explicit delete; threads read-only on archive; shape cloneable; documents are durable workspace artifacts surviving archive AND delete                                                                         | accepted             |
| 0019 | Channel ACL = owner(creator); shared-by-default + optional private; any member creates; shape-edits owner+admins; see⇒converse+dispatch. Slack-Connect forward path = admin-initiated workspace trust edge + cross-workspace shared channels (deferred) | accepted             |
| 0020 | Navigation = channels-as-sidebar (Active/Archived + favorites); cross-channel recent-activity home = v1 prioritization surface; auto-named recency-sorted archivable threads (handoff Q-E)                                                              | accepted             |
| 0021 | Authoring = conversational "curation agent" (primary, populates shape responsibly + sharpens goal) + manual form (full control, source of truth) + clone-archived; templates optional (handoff Q-F)                                                     | accepted             |
| 0022 | Delegation = internal sub-agent fan-out within a channel allowed + VISIBLE in tree (facets of the one agent identity), gated by onBeforeSubAgent+allowlists; cross-channel handoff = v2 seam (handoff Q-G)                                              | accepted             |
| 0023 | Discovery = minimal searchable shared-channel directory (goal/owner/status) in v1; full workspace activity feed deferred (handoff Q-H)                                                                                                                  | accepted             |
| 0024 | Artifacts = any media (renames/broadens "Document"); lexical search only for text-extractable, others by metadata; no RAG (amends 0006, 0014)                                                                                                           | accepted             |
| 0025 | Branch context window = ancestor path + subtree (amends 0016)                                                                                                                                                                                           | accepted             |
| 0026 | Curator = stateful per-member sessions; draft = goal + shape (refines 0021)                                                                                                                                                                             | accepted             |
| 0027 | Home feed = paginated TenantDataAccess read; unread cleared via delete_unread; unread recipients = thread participants (refines 0017, 0020)                                                                                                             | accepted             |
| 0028 | Run reads DO-resident (getRun/listRuns); sub-agent activity nested in RunDetail, not a Run (refines 0017, 0022)                                                                                                                                         | accepted             |
| 0029 | Skills = workspace-level pool, per-shape selection (amends 0005)                                                                                                                                                                                        | accepted             |
| 0030 | Shape↔Channel strict 1:1, channel-owned; clone = copy + provenance (refines 0007, 0018, 0019, 0021)                                                                                                                                                     | accepted             |
| 0031 | Artifact rendering = sandboxed separate-origin viewer (per-artifact subdomain, no-external-network CSP, sandboxed iframe, short-TTL view tokens; sanitization never the boundary) (refines 0001, 0014, 0024)                                            | proposed             |
| 0032 | Artifact versioning = immutable versions behind a stable identity; provenance per version; search sees head only; no mutate, no delete in v1 (refines 0014, 0018, 0024)                                                                                 | proposed             |
| 0033 | ThreadAgent addressing = DO name is the injectively-encoded address triple (shared codec, no mapping table); address derived lazily from `this.name`, fail-closed `thread_agent_unaddressable`; RunId = submissionId, domain run row source of truth (refines 0009, 0015, 0017, 0028) | accepted             |
| 0034 | Thread creation = idempotent flow keyed by edge-minted ids (ThreadId + opening CommentId); insert-if-absent D1 index row first, first-write-wins initialize second, workspace bump last (the only announce); `thread_agent_uninitialized` = the designed retryable half-crash state; `ChannelHub.createThread` superseded (refines 0007, 0009, 0016, 0017, 0020, 0030, 0033)  | accepted             |
| 0035 | HTTP edge: path-scoped workspace identity → `resolveTenantContext` in apps/server (401/404/500 vocabulary); SystemContext union at the TenantDataAccess boundary only, member-visibility reads fail closed; DO lazily self-constructs its completion flow (`??=`, hibernation-proof); PUT-create + POST-dispatch gestures, `gestureId` contract-now/enforce-later; JWT/JWKS + invitations deferred (refines 0001, 0008, 0009, 0017, 0033, 0034) | accepted             |
| 0036 | ModelRouter slice: design B (DO self-constructs gateway model from snapshot modelId + address workspaceId + env; edge `modelRouter.resolve` = fail-fast BYOK gate, order parse-provider→registry→catalog); composite `ModelId`; `Model` reshaped, tier→cost; `byokSecretAlias` frozen `ws-<ws>-<provider>`; `workspace_provider_key` registry (no alias col); live models.dev∩allowlist∩keyed catalog (edge-cache 3600 + memo + keep-last-good); four error kinds/statuses; empty-catalog ToolResolver v1; `@ai-sdk/anthropic@^3.0.93` gateway recipe; scheduled runs skip the gate; miniflare `outboundService` mock (supersedes 0011 in part; refines 0004, 0033, 0035; amends 0035 §7) | accepted             |
| 0037 | Effective toolset by per-turn pull: DO resolves at turn start (dispatched + scheduled) over its own D1 access feeding the snapshot's selections; MCP delivery = SDK connection reconciliation (`addMcpServer`/`removeMcpServer`, egress-gated per connect); resolution failure fails the run closed; registry revoke fans out `removeMcpServer` via the directory; resolver skills layer = `dataAccess.listSkills()` (refines 0002, 0004, 0007, 0036)                                                                                                                                                              | accepted             |
| 0038 | OpenAI joins the provider allowlist (`@ai-sdk/openai` at the `ai@6`-matching pin, gateway recipe code-verified before implementation); curator model = default model of the workspace's **earliest-keyed provider** (registry `created_at` ASC, provider ASC tie-break), edge-resolved and passed to the DO at `startSession` (persisted in DO SQLite, `getModel` self-constructs from it), 409 `byok_key_missing` when unkeyed; per-workspace curator-model setting deferred (refines 0021, 0026, 0036)                                                                                                          | accepted             |
| 0039 | Deployment environments: two named stages (dev / `prod`), one registrable domain — web at apex `think-space.app`, server at `api.think-space.app` (same-site cookies). `isProd = app.stage === "prod"` drives a stage-driven origin block (literal prod hosts vs `caddyDevOrigin ?? env`), closes the `VITE_SERVER_URL`→`workers.dev` and `INVITATION_ORIGIN` dev-origin leaks, and attaches custom domains only in prod. Per-stage data isolation via alchemy's name-suffixing (free). `crossSubDomainCookies` + `session.cookieCache{60}` gated on a prod-only `AUTH_COOKIE_DOMAIN` binding (absent in dev). Fresh prod `BETTER_AUTH_SECRET` via gitignored `.env.prod` (override, prod-only); all other secrets shared. Shared-gateway destroy hazard (single `gatewayName:"thinkspace"`, unconditional delete in alchemy 0.91.2) → guardrail: never `alchemy destroy` a stage while another is live; dedicated-shared-scope extraction = fast-follow; path-routing rejected (refines 0008, 0011, 0035) | accepted             |
| 0040 | BYOK `KeyStore` port + two adapters: `EnvelopeD1KeyStore` (production default — AES-256-GCM seals the raw key into `workspace_provider_key.key_ciphertext` via WebCrypto + a `BYOK_MASTER_KEY` worker secret; the edge/DO decrypts and sends the real provider-auth header the gateway forwards verbatim) and `SecretsStoreKeyStore` (retained legacy — today's Secrets Store `cf-aig-byok-alias` substitution). DO obtains ciphertext via a narrow tenant-scoped `getProviderKeyCiphertext` seam read (never a raw SELECT) and decrypts to a transient non-hibernating field; resolve fails closed (`byok_key_missing`/`byok_key_undecryptable`). Migration 0009 adds the nullable ciphertext column (additive; legacy rows fall back to the alias until re-registered). Dissolves 0036's 100-secret scale blocker. **§6-8 (E11.9): tiered any-provider allowlist** — `ProviderAllowEntry` gains `tier`(verified/best-effort/unsupported)/`authKind`/`routing`/`upstreamBaseUrl`; the ~157-provider long tail is BUILD-TIME-GENERATED data (`provider-allowlist.generated.ts` from `scripts/refresh-provider-allowlist.ts`, NOT a live dep), openai/anthropic stay hand-authored (verified / best-effort-until-keyed); one generic `@ai-sdk/openai-compatible` `.chat()` factory rides the same verbatim-header mechanism (native slug or `/compat/<slug>` Custom Provider route); ModelId regex widened to allow slashes in the model slug (aggregator `org/model` ids); `POST /providers/:p/key` 422s Tier-C `provider_unsupported`; Custom Provider provisioning is a narrow best-effort seam whose default adapter is an honest UNVERIFIED no-op (CF API surface unverified; native long-tail slugs unsmoke-tested). (supersedes 0011's key-storage half; amends 0036 §4-5, dissolves its scale-blocker note; refines 0038, retires its hand-curated-allowlist framing) | accepted             |

## Persistence tiers (locked)

- **Shared/relational (D1):** better-auth org graph (workspace=org / member / invite / role)
  - our domain tables (channels, shapes, thread index, unread), `workspace_id`-partitioned,
    one tenant-guarded data-access layer, `batch()` for atomicity. (ADR 0008, 0009)
- **Per-agent/conversation (DO-SQLite):** ThreadAgent (= BespokeAgent extends Think, one DO
  per thread) holds messages/context/snapshotted shape; hub DOs hold rosters/registries.
- **Blobs (R2 + virtual FS):** skill markdown (per shape); artifacts ("documents" in ADR
  0006/0014) channel-homed +
  workspace-aggregated (lexical search, no RAG) with a D1 provenance/index; agents can produce
  docs. (ADR 0005, 0006, 0014)
- **Invariant (v1):** a **channel hosts exactly one agent** (the structural twist; shards hubs).

## DO-maximalism — where the boundary actually is

Per-agent/conversation state → DOs; blobs → R2; **shared/relational/auth → external DB (D1),
not a DO** (better-auth can't be DO-backed; no cross-DO SQL). This is already "as DO-centric
as the architecture allows." (ADR 0009)

## Open questions (grill tree)

**Round 1 COMPLETE** — Q1–Q12 → ADRs 0001–0015.
**Round 2 (product shape) COMPLETE** — ADRs 0016–0023. Summary of landed product shape:

- Thread-as-post (0016); Model α internal structure (agent = dispatchable voice in nested tree,
  subtree = context window) (0016/0017); one conversation surface, humans + agent co-author the
  single tree, no separate channel chat (0016).
- Invocation = reactive(+async) + scheduled only, explicit/predictable action only; unread =
  bump-by-agent-output (C, 0017); scheduled run = one fixed bump-on-fire thread (0017).
- Channel lifecycle = archive-by-default + explicit delete; cloneable shape; artifacts durable in
  workspace library, surviving delete (0018).
- Channel ACL = owner(creator), shared-by-default + optional private, any member creates,
  shape-edits owner+admins; Slack-Connect forward path sketched, deferred (B, 0019).
- Navigation = channels-as-sidebar, cross-channel recent-activity home = v1 prioritization
  surface, auto-named recency-sorted archivable threads (E, 0020).
- Authoring = conversational curation agent (primary) + manual form (source of truth) +
  clone-archived; curation agent runs on workspace BYOK, key-first onboarding (F, 0021).
- Delegation = internal sub-agent fan-out within a channel, VISIBLE in the tree (facets of the one
  identity), gated; cross-channel handoff = v2 seam (G, 0022).
- Discovery = minimal searchable shared-channel directory in v1; activity feed deferred (H, 0023).
- Artifacts = any media; renames/broadens "Document"; search by full-text (text) or metadata
  (other); no RAG (0024).

**Domain-modeling (vocabulary) pass COMPLETE** — the `## Language` section is the canonical
ubiquitous language: Thread/Comment/top-level/nested/Post-retired; Dispatch/Run/Branch/Bump/
Schedule; Curator/Sub-agent/Template/Clone; Artifact/Workspace Library/Directory/Home/Activity
Feed/Unread; Owner/Visibility/Channel-lifecycle/Role/Catalog.

**Type-audit grill (Round 3) COMPLETE (2026-07-01)** — the `/docs-to-types` skeleton was
audited against ADRs 0001–0024; the gaps it surfaced were grilled and landed as ADRs
0025–0030: branch = ancestors + subtree; curator sessions with goal-bearing drafts; home-feed
read path on TenantDataAccess; unread clearing; DO-resident run reads + SubAgentActivity;
skills = workspace pool; Shape↔Channel strict 1:1.

**Contract tests (updated 2026-07-04)** — per-seam contract suites live in
`packages/domain/src/testing/contracts/*`, parameterized over adapter factories and bound
twice: memory binders in `test/` (`bun test`) and workers binders in `test-workers/`
(`vitest` + `@cloudflare/vitest-pool-workers`, real D1 + DO-SQLite). Production adapters
now pinned: D1 TenantDataAccess (incl. `create_thread_index` insert-if-absent), the
ThreadAgent DO (a Think DO — turn layer included: RunId = submissionId,
dispatch→completion with a stubbed model, failure path, first-write-wins `initialize`),
the address codec + name-derived DO identity + `thread_agent_unaddressable` (0033), the
production ThreadAgentDirectory, and the hub DOs' publish→recent-log path. The
dispatch→completion **round-trip acceptance test** runs the whole spine on real adapters
under miniflare (`test-workers/round-trip.acceptance.test.ts`), with the thread created
by ThreadCreationFlow; `test-workers/thread-creation.flow.test.ts` pins ADR 0034's
half-crash heal on the production binders. ADR 0035 pins (2026-07-05): SystemContext
passes the tenant guard and member-visibility reads fail closed (both binders); the DO
self-constructs its completion flow when none is injected
(`test-workers/completion-self-construct.test.ts`). The HTTP edge has its own workers
suite in `apps/server/test-workers/` (real D1 + better-auth sign-up/org-create):
`resolveTenantContext`'s full error vocabulary, the PUT creation gesture (200 + receipt,
replay convergence, 401/404/400), and the dispatch route's wire contract — dispatch runs
to the placeholder ToolResolver seam and that stop is pinned so the ModelRouter slice
must renegotiate. Remaining ADR 0015 §4 SDK gotchas (MCP persist/restore across
hibernation, additive beforeTurn on the real SDK) still need pinning as those adapters
land.

**SDK-signature verification COMPLETE (2026-07-01)** — `docs/sdk-signature-verification.md`
verifies the matched set (`agents@0.17.1`, `@cloudflare/think@0.11.1`,
`@cloudflare/shell@0.4.1` @ clone `2351e5c`) against the seams. All five ADR 0015 §3 gotchas
confirmed real; two sharpened: MCP hibernation-restore reconnects from the persisted row and
bypasses ANY add-time egress gate (gate before persistence; revoke = `removeMcpServer`), and
the readonly-connection boundary does NOT gate `@callable` RPC. Key adapter mappings:
run↔submission (`submitMessages`/`inspectSubmission`), `appendComment`↔`addMessages`
(parentId tree = comment tree), curator sessions = one DO per member, domain Schedule =
source of truth over the SDK alarm row, skills/artifacts = adapter-owned D1 index over
read-only R2 primitives. The doc ends with the 7 contract tests to pin once production
adapters exist.

**Next phase:** the **ModelRouter slice (E1) is DONE** (ADR 0036 accepted + implemented
2026-07-05): composite `ModelId`, reshaped `Model` (tier→live cost), frozen
`byokSecretAlias`, `workspace_provider_key` registry (migration 0003), the live
models.dev∩allowlist∩keyed catalog (edge-cache + memo + keep-last-good), the D1
ModelRouter fail-fast BYOK gate (parse-provider→registry→catalog), the real
empty-catalog ToolResolver, the DO's self-constructed AI-Gateway model
(`@ai-sdk/anthropic@^3.0.93`), the edge wiring + four domain-error rows, and the AI
Gateway IaC bindings. It deleted the DO's `modelOverride` + no-model gate and rewrote the
two placeholder-seam edge tests into happy paths; the workers contract binder now drives
the production adapters through a miniflare `outboundService` mock gateway. The HTTP edge +
auth slice is DONE too (ADR 0035, 2026-07-05): better-auth organization plugin +
org/member/invitation tables, `resolveTenantContext` + middleware in apps/server,
PUT-create / POST-dispatch gestures over real HTTP, SystemContext union, DO completion
flow self-construction. **Next up per backlog sequencing: E2 — wake-path reconciliation
sweep** (on DO wake, replay terminal-but-unsettled runs through the self-constructed
completion flow; idempotent), then **E4 — hub WebSocket authz** (better-auth JWT/JWKS,
hub-DO verification at WS upgrade). Recorded debt from 0035: dispatch-dedupe enforcement,
invitations (needs an email sender), JWT/JWKS for hub WebSocket authz (E4),
`getWorkspaceGraph`. Recorded risk from 0036 — the Secrets Store 100-secret/account open-beta
cap — is **RESOLVED via the KeyStore port (ADR 0040):** `EnvelopeD1KeyStore` seals keys into D1
(no per-account cap), the default over the retained legacy Secrets Store adapter. Remaining
memory-only seams: CuratorAgent, McpEgressPolicy + ToolResolver v2 (E6.3),
ArtifactStore (ADR 0032 reshape pending), SkillStore.

## Deferred / v2 / to-verify (explicit v1 boundary)

- **v2 features:** Code Mode / user code tools (0003) · executable script skills (0005) ·
  semantic RAG/Vectorize (0006) · full shape content-version freeze (0007) · multiplayer
  threads (0013) · message reactions (0013) · channel/folder doc scoping (0014) · workspace
  tool/model permission curation UI (0004/0011) · managed-billing tier — dropped, BYOK-only (0011).
- **Seams to build now (features deferred):** workspace tool/model permission filter (0004),
  per-shape doc selection across channels (0014), multiplayer-thread fan-out not architected out (0013).
- **Escape hatches (documented, unbuilt):** per-tenant D1 for residency (0009) · WorkspaceHub
  sub-shard by member-bucket if band exceeded (0012) · fork/vendor SDK on blocking bug (0015).
- **Recorded scale risk (0036) — RESOLVED (ADR 0040):** the Secrets Store open beta = 100
  production secrets per account was the recorded GA blocker (one secret per workspace×provider
  caps at ~100 single-provider workspaces). ADR 0040's `EnvelopeD1KeyStore` (the production
  default) removes the cap: keys are AES-256-GCM-sealed into D1's `key_ciphertext` column, not
  Secrets Store, so workspace count is bounded only by D1. The legacy `SecretsStoreKeyStore`
  adapter is retained; existing keys re-register to migrate. (Also resolves 0011's "undocumented"
  BYOK-key-count note.)
