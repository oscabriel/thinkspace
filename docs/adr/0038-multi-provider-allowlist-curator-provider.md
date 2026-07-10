# ADR 0038 — OpenAI joins the provider allowlist; curator model = earliest-keyed provider

**Status:** accepted (2026-07-09)
**Refines:** ADR 0021 (curator runs on workspace BYOK), ADR 0026 (curator sessions),
ADR 0036 (ModelRouter slice — retires its "v1 = anthropic only" framing in §6/§9; every other
mechanism in 0036 is reused unchanged)

## Context

E1.2 baked "v1 allowlists a single provider — Anthropic" into the allowlist, the AI SDK factory
map, the provider-settings surface, and — most subtly — the curator, whose model is
`allowlist[0]`'s default slug (`defaultCuratorModelId`, ADR 0021 note). The first real-key
smoke test surfaced the product need: a workspace whose only key is OpenAI must be able to run
every agent, curator included. ADR 0036 anticipated this — composite `ModelId` carries the
provider, `byokSecretAlias` and the Secrets Store name anatomy are provider-generic, the catalog
is assembled per-allowlist-entry, and the factory map is keyed by provider with a unit-tested
**allowlist ⊆ factory-map** invariant — so widening is additive everywhere except the curator,
which had no rule for choosing a provider when more than one exists.

## Decision

### 1. OpenAI is allowlisted

`providerAllowlist` gains `{ provider: "openai", gatewaySlug: "openai", modelsDevId: "openai",
defaultModelSlug: "gpt-5.5" }` (models.dev verified 2026-07-09). `gatewayModelFactories.openai`
is built on `@ai-sdk/openai` at the dist-tag matching `ai@6` (mirror the `@ai-sdk/anthropic`
`ai-v6` pin of 0036 §9 — **not** `latest`), pointed at the AI Gateway `openai` path segment with
the same three `cf-aig-*` headers. The exact baseURL anatomy (whether the SDK expects the
trailing `/v1` the anthropic recipe needed) must be code-verified against the pinned SDK source
before implementation, exactly as 0036 §9 was.

### 2. Curator provider = the workspace's earliest-keyed provider

The curator's model is no longer `allowlist[0]`: it is the **default model of the workspace's
earliest-keyed provider** — the `workspace_provider_key` row with the lowest `created_at`
(provider ASC as tie-break), composed with that provider's `defaultModelSlug`. Deterministic,
data-driven, no schema change, and identical to today's behaviour for every existing
anthropic-only workspace.

- **Resolved at the edge, fail closed.** The curator routes' BYOK gate (`apps/server/src/curator.ts`)
  becomes the resolver: read the registry, pick the earliest-keyed provider, resolve its default
  model through the model router. A workspace with no keyed provider stays 409
  `byok_key_missing` before any DO round-trip — unchanged semantics, now provider-agnostic.
- **Carried to the DO, surviving hibernation.** The edge passes the resolved `ModelId` into the
  curator seam (`startSession`); the DO persists it in its own SQLite state and `getModel`
  self-constructs from the stored id (ADR 0036 §1 self-construction — nothing injected survives
  a wake). Sessions predating the upgrade fall back to `defaultCuratorModelId()` (dev-only data).

**Rejected — per-workspace curator-model setting:** the durable future path (a workspace picks
its curator's provider/model in settings), but it needs UI + schema for a decision no user has
asked to make yet. Earliest-keyed is a sensible default that the setting can later override.
**Rejected — DO reads the registry itself:** a raw D1 read from the DO bypasses the
tenant-data-access seam (the same debt as the `mcp.ts` raw `SELECT`) and re-runs a gate the edge
already ran, against ADR 0036 §1's split of responsibilities.

## Consequences

- The provider-settings surface renders one row per allowlist entry (its hardcoded
  anthropic-only list and "renders exactly one row, honestly" comments retire).
- The live catalog and channel model picker gain OpenAI models for keyed workspaces with no code
  change (0036 §6 already intersects per-entry).
- Thread dispatch needs no change: the edge gate parses the provider from the shape's `ModelId`
  (0036 §1) and the DO self-constructs via the factory map.
- The Secrets Store 100-secret cap (0036 recorded risk) is consumed up to 2× faster per
  workspace; still a non-blocker at dev/MVP scale.
- The `allowlist ⊆ factory-map` invariant test now covers two providers; a keyed-but-
  unconstructable provider remains a latent 500 guarded by that test.

## Addendum — live BYOK verification (2026-07-10, first real-key smoke test)

The real-key smoke test (OpenAI, workspace-registered via the settings route) proved the full
chain — Secrets Store write → gateway substitution → real model reply through the curator — after
two live findings that amend the ADR 0036 §9 recipe:

1. **The gateway resolves `cf-aig-byok-alias` only when its `store_id` is set** to the Secrets
   Store holding the `{gateway_id}_{provider_slug}_{alias}` secrets. Alchemy 0.91.2's AiGateway
   resource doesn't know the field and its per-run PUT resets it, so `alchemy.run.ts` re-asserts
   it (GET-merge-PUT, idempotent) after the resource settles.
2. **A present provider-auth header is forwarded verbatim** (substitution suppressed) — 0036 §9's
   recorded contingency proved real. Both gateway factories blank the SDK's dummy credential
   (`Authorization: ""` for openai, `x-api-key: ""` for anthropic); the gateway treats an empty
   header as absent and substitutes. The anthropic blank follows the same gateway logic but stays
   live-unverified until an anthropic key is registered.

Recorded gaps from the same session (debt, not design changes): a streamed in-stream provider
error (e.g. a preview-locked model over the Responses API) leaves the run "Running" until the
client's stale timeout — the run-state-read debt (0028) plus in-stream error settlement; and the
allowlist `defaultModelSlug` is not guaranteed to be in the models.dev catalog (models.dev dropped
gpt-5.5 the day the 5.6 family shipped), so the picker may offer no model a given provider account
can actually run while the curator default still works.
