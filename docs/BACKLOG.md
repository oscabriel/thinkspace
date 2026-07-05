# Thinkspace — Minimal Product Backlog (end-to-end)

**Date:** 2026-07-05 · **Status:** decided — every issue below is buildable without further
grilling. Where a decision was still open, the recommendation is **baked in** and listed in
"Baked decisions" so it can be vetoed as a unit instead of re-litigated per issue.

**MVP definition of done:** a technical team can sign up, create a workspace, register a BYOK
provider key, create a channel with a manually-authored shape, converse in threads with a real
model through AI Gateway, see runs land in realtime, and browse artifacts — all through the web
app, all tenant-guarded, all gates green.

**Sequencing:** E1 → E2 → E4 → E3 → E5 (E7 can start after E4 and run in parallel) → E6 → E7
finish. The MVP line can ship after E1–E5 + E7-core; E6 completes the seam inventory.

---

## Baked decisions (the would-have-been grills — veto here, not per issue)

1. **Cross-tenant probe leak (flagged 2026-07-05):** a cross-tenant channel-id probe currently
   returns `tenant_guard_violation` → 500, distinguishable from the invisible-channel 404.
   **Baked:** edge translates `tenant_guard_violation` to 404 — invisibility-as-nonexistence
   outranks the ADR 0035 §7 status table; amend the table.
2. **ADR 0032 (artifact versioning):** accept as written. Open sub-questions baked: version cap
   = 100 per artifact; trim = delete oldest R2 bytes past cap; diff/compare surface stays out
   of v1.
3. **BYOK key registration:** owner/admin-only `POST /workspace/providers/:provider/key` and
   `DELETE …/key`. Worker calls the Cloudflare REST API (account-scoped API token as a worker
   secret) to write the Secrets Store entry + gateway BYOK alias named by `byokSecretAlias()`,
   then upserts/deletes the `workspace_provider_key` row. The raw key transits the backend
   exactly once, is never logged, never stored in D1, never echoed back.
4. **Invitation email sender:** Resend (worker-friendly HTTP API, generous free tier), wired to
   better-auth's organization-invitation hooks. Domain + API key are env; templates minimal text.
5. **Hub WebSocket authz:** better-auth JWT plugin; client fetches a short-lived JWT; hub DOs
   verify at WS upgrade against the auth origin's JWKS (cached in the DO) and check the
   workspace/member claims against the hub's own address. No session cookie over WS.
6. **Curator scope for MVP:** manual shape form is the v1 authoring path (ADR 0021 already names
   it source of truth). CuratorAgent ships in E6, after the MVP line — the product is usable
   without it; it is not dropped.
7. **MCP v1 shape:** workspace-level MCP server registry (name, host, transport URL) gated by
   the ADR 0002 egress allowlist; catalog tools v1 = MCP-provided tools only (no built-in
   catalog tools yet). Three-layer resolution per ADR 0004 becomes real when this lands.
8. **Dispatch dedupe:** `gestureId` travels into the DO run trigger; `ts_run` gains a unique
   `gesture_id` column; a replayed dispatch returns the existing run receipt (converges like
   the PUT). No D1-side dedupe table.

---

## E1 — ModelRouter slice (fully grilled 2026-07-05; this section is the spec of record)

Decisions of record: read-path only (registration = E3) · design B — DO self-constructs its
gateway model from snapshot modelId + address workspaceId + env, edge `modelRouter.resolve` is
the fail-fast byok gate · alias = pure function `byokSecretAlias(workspaceId, provider)`
(format frozen after docs verification) · registry `workspace_provider_key(workspace_id,
provider, created_at)` with no alias column, read directly by the D1 router adapter · catalog =
models.dev api.json ∩ provider allowlist(+gateway-slug map, +defaultModelSlug) ∩ keyed
providers · composite `ModelId` = `<providerId>/<modelSlug>` · `Model` reshaped to
{id, provider, displayName, cost, limits, capabilities, releaseDate}, tier deleted · edge-cached
fetch (cacheTtl 3600) + per-isolate memoized assembly + keep-last-good · errors:
`model_not_in_catalog` (409), `byok_key_missing` (409), `catalog_unavailable` (503),
`mcp_host_not_allowed` (403) · ToolResolver = real empty-catalog intersection adapter,
McpEgressPolicy stays placeholder (vacuously unreachable) · per-provider AI SDK factory map in
the production adapter layer, @ai-sdk/anthropic only, allowlist ⊆ factory-map invariant ·
scheduled runs skip the byok gate (gateway rejection → run failure path).

- **E1.1 — Verification spike (timeboxed, first).** Verify against real docs/pinned clones, not
  memory: `cf-aig-byok-alias` semantics + Secrets Store naming constraints (freezes the alias
  format); gateway anthropic path + header names + dummy-apiKey tolerance in @ai-sdk/anthropic;
  whether alchemy 0.91.2 (clone @ d58304f8) ships an AiGateway resource; whether vitest-pool-workers
  fetchMock intercepts DO-outbound fetches (fallback: miniflare service-binding mock gateway).
  Output: short notes appended to this file or the ADR draft.
- **E1.2 — Domain types.** Composite `modelIdSchema`; reshaped `Model` (drop `modelTierSchema`,
  fix two test fixtures); `model_not_in_catalog` + `catalog_unavailable` error kinds;
  `byokSecretAlias()`; provider allowlist constant {modelsDevId, gatewaySlug, provider,
  defaultModelSlug}, v1 = anthropic only.
- **E1.3 — Migration 0003.** `workspace_provider_key` drizzle schema + generated migration.
- **E1.4 — Catalog assembly module.** models.dev fetch w/ edge cache → allowlist filter →
  loose boundary zod schema (skip-don't-fail per model, log skips) → `Model[]`; per-isolate
  memo w/ ~1h TTL; keep-last-good on refresh failure; `catalog_unavailable` on cold-miss.
- **E1.5 — D1 ModelRouter adapter + contract suite.** `resolve` (parse provider → registry
  check → catalog membership → route w/ derived alias) and `listAvailableModels` (catalog ∩
  keyed). New `testing/contracts/model-routing.ts` bound to memory (updated for new types) and
  production (fetchMock fixture) binders. Pins: key-gating, happy resolve, byok_key_missing,
  model_not_in_catalog, catalog_unavailable, tenant guard.
- **E1.6 — Real ToolResolver.** Empty-catalog intersection semantics (silent intersect, echo
  artifactAccessScope); bind the existing tool-resolution contract suite to it.
- **E1.7 — DO getModel self-construction.** Provider→factory map (+ allowlist⊆map invariant
  unit test); @ai-sdk/anthropic dep; gateway headers (cf-aig-authorization, byok alias,
  cf-aig-metadata workspace tag); extend `CompletionFlowEnv`; delete public `modelOverride` +
  no-model gate; seed-carried test model via `ThreadAgentSeed`; port turn-layer tests.
- **E1.8 — Edge wiring + red-test rewrite.** Swap real ModelRouter/ToolResolver into
  `buildDispatchFlow`; add the four `domainErrorStatus` rows; rewrite the two deliberately-red
  dispatch tests into happy paths (registry-row helper + fetchMock fixtures); add
  byok_key_missing and model_not_in_catalog negative pins at the edge.
- **E1.9 — IaC.** `AI_GATEWAY_URL` + `AI_GATEWAY_TOKEN` bindings in alchemy.run.ts (AiGateway
  resource if E1.1 confirms it; else manual gateway + documented .env.example); gateway test
  literals in both workers harnesses.
- **E1.10 — Docs.** ADR 0036 (all of the above); "superseded by 0036" notes in ADR 0011
  (curated→live catalog, tier→cost, alias format); error-table rows appended to ADR 0035 §7;
  CONTEXT.md next-phase update.

## E2 — Wake-path reconciliation sweep

- **E2.1 — Sweep implementation + pins.** On DO wake, scan `ts_run` for terminal-but-unsettled
  runs and replay settlement through the (self-constructed) completion flow; the fail-soft
  `console.error` path in `settle()` defines exactly what is recovered. Workers pins: a lost
  settlement is replayed on next wake; an already-settled run is not double-settled
  (idempotent fan-out).

## E3 — BYOK key registration (read path's write half; baked decision 3)

- **E3.1 — Cloudflare API client.** Minimal typed client for Secrets Store write/delete +
  gateway BYOK alias attach/detach, driven by `byokSecretAlias()`; account API token as worker
  secret; no key material in logs or error bodies (redaction test).
- **E3.2 — Edge routes + registry writes.** POST/DELETE key routes, owner/admin role gate,
  `workspace_provider_key` upsert/delete, workers tests with a mocked CF API
  (`listAvailableModels` flips accordingly — end-to-end key-gating pin).

## E4 — Realtime client path: hub WebSocket authz (baked decision 5)

- **E4.1 — JWT mint.** better-auth JWT plugin + JWKS endpoint; short-lived token carrying
  workspace/member claims; edge route for the client to fetch it.
- **E4.2 — Hub verification.** Hub DOs verify JWT at WS upgrade against cached JWKS; claims
  must match the hub's decoded address (workspace / channel-visibility); reject = 4401 close.
  Workers pins: valid token connects and receives published events; wrong-workspace token and
  expired token rejected.

## E5 — Edge surface completion + recorded debt

- **E5.1 — Read surface.** Expose the TenantDataAccess read paths the client needs over HTTP:
  workspace graph (`getWorkspaceGraph` — implement it), channel list/detail, thread list per
  channel, branch/comment reads (DO `loadBranch` via directory), home feed + unread (ADR 0027).
  Same middleware/translation discipline as gestures.ts.
- **E5.2 — Channel + shape CRUD gestures.** Create/archive/delete channel (ADR 0018 lifecycle,
  0019 ACL), manual shape create/edit (ADR 0007 config-as-data; model picker validates against
  `listAvailableModels`), shape→DO resnapshot propagation.
- **E5.3 — Dispatch dedupe.** Baked decision 8: gestureId into the run trigger, unique
  `gesture_id` in `ts_run`, replay returns the existing receipt; retire the ADR 0035 §7 debt note.
- **E5.4 — Cross-tenant probe fix.** Baked decision 1: `tenant_guard_violation` → 404 at the
  edge; amend 0035 §7 table; flip the existing pin.
- **E5.5 — Invitations.** better-auth org invitations + Resend sender (baked decision 4);
  invite/accept flow tests with a mocked sender.

## E6 — Remaining seams (post-MVP-line, completes the placeholder inventory)

- **E6.1 — SkillStore.** R2 markdown + adapter-owned D1 index (per sdk-signature-verification
  mapping); CRUD per seam; contract suite bound memory + production; skills feed the effective
  toolset/system prompt per ADR 0005/0029.
- **E6.2 — ArtifactStore.** Accept ADR 0032 (baked decision 2): identity + append-only
  versions, head pointer, R2 key `${workspaceId}/artifacts/${artifactId}/${versionId}`, D1
  versions table, search-sees-head; version cap 100, trim deletes oldest bytes.
- **E6.3 — ToolResolver v2 + McpEgressPolicy.** Baked decision 7: MCP server registry, egress
  allowlist enforcement (gate BEFORE persistence — the hibernation-restore bypass is verified
  real), real three-layer resolution; renegotiate the E1.6 empty-catalog contract pins; pin the
  ADR 0015 §4 gotchas (MCP persist/restore across hibernation, additive beforeTurn).
- **E6.4 — CuratorAgent.** One DO per member (verified mapping), sessions + goal-bearing
  drafts per ADR 0021/0026; conversational authoring on top of the E5.2 manual form.

## E7 — Web app (TanStack Start; core screens unblock the MVP line)

- **E7.1 — Baseline.** Fix pre-existing JSX/tsc errors so repo-root `tsc --noEmit` is green;
  wire better-auth client + session handling against the server origin.
- **E7.2 — Onboarding.** Sign-up/sign-in, create workspace, provider-key registration UI (E3),
  key-first onboarding per ADR 0011 (no usable agent until a key exists — say so in the UI).
- **E7.3 — Workspace shell.** Sidebar channels (workspace graph), home feed + unread (ADR
  0020/0027), channel directory (ADR 0023).
- **E7.4 — Thread surface.** Thread tree view, composer, PUT-create + POST-dispatch gestures,
  run lifecycle via hub WS (E4), optimistic comment append.
- **E7.5 — Shape form + model picker.** Manual shape authoring against E5.2; model picker
  rendered from `listAvailableModels` (live catalog data: names, cost, limits, capabilities).
- **E7.6 — Library (post-MVP polish).** Artifact library over E6.2; version history view.
