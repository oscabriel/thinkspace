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
| 0024 | Artifacts = any media (renames/broadens "Document"); lexical search only for text-extractable, others by metadata; no RAG (amends 0006, 0014)                                                                                                          | accepted             |
| 0025 | Branch context window = ancestor path + subtree (amends 0016)                                                                                                                                                                                           | accepted             |
| 0026 | Curator = stateful per-member sessions; draft = goal + shape (refines 0021)                                                                                                                                                                             | accepted             |
| 0027 | Home feed = paginated TenantDataAccess read; unread cleared via delete_unread; unread recipients = thread participants (refines 0017, 0020)                                                                                                             | accepted             |
| 0028 | Run reads DO-resident (getRun/listRuns); sub-agent activity nested in RunDetail, not a Run (refines 0017, 0022)                                                                                                                                         | accepted             |
| 0029 | Skills = workspace-level pool, per-shape selection (amends 0005)                                                                                                                                                                                        | accepted             |
| 0030 | Shape↔Channel strict 1:1, channel-owned; clone = copy + provenance (refines 0007, 0018, 0019, 0021)                                                                                                                                                     | accepted             |

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

**Contract tests COMPLETE (2026-07-01)** — `packages/domain/test/` pins the seam contracts
against the memory adapters (`bun test`, wired into turbo as `test`): branch context window
(0025), DO-resident run reads + nested SubAgentActivity (0028), config-as-data snapshots
(0007/0015), default-permit tool disables + additive-only beforeTurn + fail-closed MCP
egress (0002/0004/0015), home-feed visibility/pagination + delete_unread (0027), curator
sessions (0026), tenant-guard atomicity, and the Shape↔Channel 1:1 invariant (0030) — now
**enforced in the tenant-guarded data layer** with a typed `shape_ownership_violation`
error. The ADR 0015 §4 SDK gotchas (sync getModel/getTools, MCP persist/restore across
hibernation) still need pinning against the real SDK once production adapters exist.

**Next phase:** SDK-signature verification against the local clone (ADR 0015), then first
behavior slices with TDD and a phased build plan (`/improve` / Plan agent).

## Deferred / v2 / to-verify (explicit v1 boundary)

- **v2 features:** Code Mode / user code tools (0003) · executable script skills (0005) ·
  semantic RAG/Vectorize (0006) · full shape content-version freeze (0007) · multiplayer
  threads (0013) · message reactions (0013) · channel/folder doc scoping (0014) · workspace
  tool/model permission curation UI (0004/0011) · managed-billing tier — dropped, BYOK-only (0011).
- **Seams to build now (features deferred):** workspace tool/model permission filter (0004),
  per-shape doc selection across channels (0014), multiplayer-thread fan-out not architected out (0013).
- **Escape hatches (documented, unbuilt):** per-tenant D1 for residency (0009) · WorkspaceHub
  sub-shard by member-bucket if band exceeded (0012) · fork/vendor SDK on blocking bug (0015).
- **To verify with Cloudflare:** max BYOK stored keys per account (0011, undocumented).
