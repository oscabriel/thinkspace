# ADR 0036 — ModelRouter slice: live key-gated catalog, BYOK routing, DO-self-constructed gateway model

**Status:** accepted (2026-07-05)
**Refines:** ADR 0004 (three-layer tool model), ADR 0033 (DO addressing), ADR 0035 (edge/DO
completion-flow self-construction)
**Supersedes in part:** ADR 0011 (curated→live catalog; model tier→cost; alias `<workspace>`→
`ws-<workspaceId>-<provider>` — three inline notes added there)
**Amends:** ADR 0035 §7 (adds four domain-error → HTTP-status rows)
**Source-grounded:** BACKLOG "E1 — ModelRouter slice" (spec of record) + "E1.1 spike findings"
(verified 2026-07-05 against live Cloudflare docs, `@ai-sdk/anthropic` source, and pinned
alchemy/vitest-pool-workers clones). This ADR records the whole slice **as decided** — E1.2
through E1.9 — after implementation.

## Context

ADR 0011 fixed the economics (AI Gateway + BYOK-only, key-gated catalog) but left the read-path
mechanics as a sketch: it named a _curated_ catalog, a `tier`-shaped model, and a bare
`cf-aig-byok-alias: <workspace>`. Turning that into code — a DO that constructs a real gateway
`LanguageModel` per turn, an edge that fails fast when a workspace lacks a key, and a catalog
assembled from a live source — forced a set of concrete decisions and surfaced two facts that
reshaped the design. A verification spike (E1.1) pinned the alias/Secrets-Store naming anatomy,
the exact `@ai-sdk/anthropic` gateway recipe, the alchemy `AiGateway` resource, and — critically
— that the planned in-worker `fetchMock` no longer exists, forcing the test-mocking mechanism to
change. This ADR is the decision record for the entire slice; registration (the write half) is
E3 and out of scope here.

Two code facts shaped everything:

1. **The gateway model cannot be injected into the DO.** A `LanguageModel` field does not
   survive hibernation, and a Think turn can run in a fresh wake. So the DO must be able to
   _self-construct_ its model from what survives a wake — the snapshotted `modelId`, the address
   triple (ADR 0033), and `env` — exactly as ADR 0035 §2 established for the completion flow.
2. **The catalog has a live upstream but an unreliable one.** models.dev is the source of model
   metadata; a read-path turn must not fail because that fetch blipped. So the catalog is cached,
   memoized, and keep-last-good, and only a cold miss with nothing cached is an error.

## Decision

### 1. Design B — the DO self-constructs the gateway model; the edge is the fail-fast BYOK gate

Routing responsibility splits across the trust boundary:

- **Edge (`modelRouter.resolve`) is the fail-fast BYOK gate.** Before a run is ever triggered,
  the edge resolves the shape's `modelId` against the workspace, in this **fixed order**:
  **parse provider** (split the composite `ModelId` at its `/`; an unknown provider needs no
  separate gate — it simply has no registry row) → **registry
  check** (is there a `workspace_provider_key` row for `(workspaceId, provider)`?) →
  **catalog membership** (is the model in the live key-gated catalog?). The first failing gate
  returns its error and no run starts. Ordering is load-bearing: the missing-key answer
  (`byok_key_missing`) is cheaper and more actionable than a catalog miss, and a provider that
  fails to parse can never have a key, so provider-parse is first.
- **DO self-constructs the model from the snapshot + address + env.** At turn time the DO takes
  the snapshotted `modelId`, decodes `workspaceId` from its own name (ADR 0033), derives the BYOK
  alias with `byokSecretAlias(workspaceId, provider)`, and builds the provider gateway model from
  `env`. Nothing is injected; everything needed survives a wake. Test injection uses
  `ThreadAgentSeed.testModel`, mirroring ADR 0035's injected-override pattern — the
  self-construction never fires when a test model is seeded.

`resolve` returns a `ModelRoute { model, secretAlias, gatewayMetadata }`; the DO does not re-run
the gate (the edge already did), it constructs from the snapshot.

**Rejected — Design A (DO holds an injected router or the edge hands the DO a constructed
model):** both die on hibernation exactly as ADR 0035 §2 found for the completion flow.

### 2. Composite `ModelId` = `<providerId>/<modelSlug>`

A model is identified by a single branded string, `<providerId>/<modelSlug>` (e.g.
`anthropic/claude-sonnet-5`), pattern `^[^/]+/[^/]+$`. `formatModelId(providerId, modelSlug)` and
`parseModelId(modelId)` are the constructor/destructor. This makes the provider recoverable from
the id alone — the edge's provider-parse gate (§1) needs no side table — and keys the catalog and
route maps directly.

### 3. `Model` reshaped; `tier` deleted

`Model = { id, provider, displayName, cost, limits, capabilities, releaseDate }`, every field
carried from models.dev (cost = per-token `{cacheRead, cacheWrite, input, output}`; limits =
`{context, output}`; capabilities = `{attachment, reasoning, structuredOutput, toolCall}`). The
old `tier` enum (`modelTierSchema`) is **deleted**: "premium/cheap" was a hand-maintained proxy
for what live `cost` now states factually. Model-picker UX (E7.5) ranks on real cost and limits,
not a tier label. This supersedes ADR 0011's per-provider tier framing (Opus premium / Haiku
cheap).

### 4. BYOK alias = a pure function; Secrets Store name anatomy

`byokSecretAlias(workspaceId, provider) = ws-<workspaceId>-<provider>` (lowercase,
hyphen-delimited), frozen by spike finding 1. A standalone pure function, not an adapter method —
both the edge (to build the `ModelRoute`) and the DO (to set the header) call it, and it has no
I/O.

**Secrets Store name anatomy (spike finding 1, verified):** AI Gateway resolves a BYOK key by the
Secrets Store secret **name** `{gateway_id}_{provider_slug}_{alias}`. The
`cf-aig-byok-alias: <alias>` header carries **only the `{alias}` component**; the gateway and
provider come from the request URL path, and the `secret_id` is not used for runtime lookup.
Omitting the header falls back to alias `default`.

**Why the `-<provider>` suffix, on the record:** because `{provider_slug}` is already its own name
component, a bare `ws-<workspaceId>` alias would **not** collide across providers. We keep the
provider suffix for **self-documenting, self-contained uniqueness — not collision avoidance**.
This corrects ADR 0011's sketch, which implied the suffix prevented a cross-provider clash.
Naming constraints: the only documented Secrets Store rule is "no spaces" (hyphens, underscores,
digits, mixed case all appear in official examples; the OpenAPI `secret_name` schema has no
`maxLength`/`pattern`). Our ~80-char names are validated empirically when E3.1 first writes one.
`ai_gateway` is a confirmed Secrets Store scope value.

### 5. Registry table `workspace_provider_key` — no alias column

`workspace_provider_key(workspace_id, provider, created_at)`, `PRIMARY KEY (workspace_id,
provider)` (migration 0003). It records _that a workspace has keyed a provider_ — nothing more.
There is deliberately **no `alias` column**: the alias is a pure function of `(workspaceId,
provider)` (§4), so storing it would be a denormalized duplicate that could drift. The D1 router
adapter reads this table directly for the registry gate (§1) and for `listAvailableModels`
(catalog ∩ keyed). The raw key never lands in D1 — it lives only in Secrets Store, written by the
E3 registration path.

### 6. Catalog = models.dev ∩ allowlist ∩ keyed providers, cached and fail-soft

The catalog is assembled live, not curated:

- **Source:** `GET https://models.dev/api.json`, ridden on the worker's **global fetch** with the
  Cloudflare edge-cache hint `cf: { cacheEverything: true, cacheTtl: 3600 }` (1h). Riding global
  fetch is what lets the miniflare `outboundService` mock intercept it in tests (§12).
- **Filter:** intersect with the provider allowlist (`{ modelsDevId, gatewaySlug, provider,
defaultModelSlug }`, v1 = anthropic only), descending only into allowlisted providers.
- **Boundary parse:** a loose zod schema per model — unknown keys tolerated and stripped. A single
  malformed model is **skipped and logged, never fatal** ("skip, don't fail"); a malformed or
  absent provider block is skipped.
- **Memo + keep-last-good:** the assembled `Model[]` is memoized per isolate (~1h TTL, matching
  the edge window), concurrent refreshes deduped onto one in-flight fetch. A failed refresh that
  has a prior good catalog serves the **stale** one (keep-last-good). Only a **cold miss with no
  last-good** surfaces `catalog_unavailable`.
- **Keyed intersection** happens in the router (`listAvailableModels`): the catalog ∩ the
  workspace's keyed providers.

This is the live realization of ADR 0011's key-gated catalog and supersedes its "curated" wording.

### 7. Error kinds and HTTP statuses

Four domain errors, mapped at the edge (E1.8 adds the rows to the shared translator and to ADR
0035 §7):

| Domain error           | Meaning                                                    | Status |
| ---------------------- | ---------------------------------------------------------- | ------ |
| `model_not_in_catalog` | shape's `modelId` is not in the live key-gated catalog     | 409    |
| `byok_key_missing`     | workspace has no `workspace_provider_key` for the provider | 409    |
| `catalog_unavailable`  | cold catalog miss, no last-good to serve                   | 503    |
| `mcp_host_not_allowed` | MCP host outside the egress allowlist (ADR 0002)           | 403    |

`409` for the two "your request is inconsistent with current workspace state" cases (fixable by
adding a key or picking a listed model); `503` for the transient upstream outage; `403` for the
egress-policy denial. `mcp_host_not_allowed` is defined now for the ToolResolver seam but
**vacuously unreachable in v1** (§8).

### 8. ToolResolver v1 — empty-catalog intersection

The real ToolResolver (E1.6) implements ADR 0004's three-layer model (catalog ∩ workspace
permission ∩ shape selection) against an **empty tool catalog**: there are no built-in tools and
no MCP registry yet (that is E6.3). Resolution is a **silent intersect** — unknown tools a shape
selects are dropped without error — yielding an empty effective toolset; `artifactAccessScope` is
echoed through unchanged. Because no MCP server ever survives the empty catalog, `McpEgressPolicy`
stays a placeholder and `mcp_host_not_allowed` (§7) is vacuously unreachable. E6.3 renegotiates
these empty-catalog contract pins.

### 9. AI SDK factory map + `@ai-sdk/anthropic` pin + gateway recipe

- **Per-provider factory map** in the production adapter layer: `provider → gateway-model
factory`. v1 = anthropic only. Invariant, unit-tested: **allowlist ⊆ factory-map** — every
  allowlisted provider has a factory (a provider you can key but not construct is a latent 500).
- **Dependency pin: `@ai-sdk/anthropic@^3.0.93`** — npm dist-tag `ai-v6`, matches `ai@6.0.202`.
  **Not `latest`** (4.x targets ai v7, incompatible).
- **Gateway recipe (code-verified against `@ai-sdk/anthropic@3.0.93`):**
  `createAnthropic({ baseURL, apiKey, headers })` where
  - `baseURL = https://gateway.ai.cloudflare.com/v1/{accountId}/{gatewayName}/anthropic/v1` — the
    **trailing `/v1` is mandatory** (the SDK builds `${baseURL}/messages`);
  - `apiKey` = any non-empty **dummy** string (`loadApiKey` returns strings verbatim; it throws
    only when both the arg and the env var are absent);
  - `headers`:
    - `cf-aig-authorization: Bearer <AI_GATEWAY_TOKEN>` — **required** on the plain-HTTPS fetch the
      SDK makes (the docs' binding exemption applies only to a real gateway _binding_, which the
      SDK does not use);
    - `cf-aig-byok-alias: <alias>` — the `byokSecretAlias` value (§4);
    - `cf-aig-metadata: <JSON, ≤5 keys>` — carries the workspace attribution tag, emitted as
      `{"workspace": <workspaceId>}` (ADR 0011);
      extra keys beyond 5 are dropped by the gateway.
  - `options.headers` spreads last, so the SDK's unavoidable dummy `x-api-key` can be overridden
    with `''` if a stray header proves to matter — smoke-test once against the real gateway.

### 10. Scheduled runs skip the BYOK gate

A scheduled fire (ADR 0017) has no edge request in front of it to run `modelRouter.resolve`, so it
**does not** pass the fail-fast BYOK gate. If the workspace's key was removed since the schedule
was created, the DO constructs the model anyway and the **gateway rejects the call → the run
fails** through the normal `run_failure` path. This is deliberate: a schedule is not the place to
re-litigate key state, and a failed run is the correct, observable outcome (ADR 0028).

## Consequences, risks, and recorded facts

### Secrets Store 100-secret scale blocker (recorded risk — RESOLVED by ADR 0040)

**[Resolved by ADR 0040 — 2026-07-11]** The scale blocker below is dissolved: the BYOK `KeyStore`
port's `EnvelopeD1KeyStore` (the production default) seals keys into D1's `key_ciphertext` column
instead of Secrets Store, so workspace count is no longer capped at 100. §4-5's `byokSecretAlias`
/ `byokSecretName` / Secrets Store name anatomy become the retained legacy `SecretsStoreKeyStore`
adapter's concern; every other §-mechanism here is reused unchanged. The original recorded risk
stands as history below.

Spike finding 2, verified: the Secrets Store open beta caps at **100 production secrets per
account, one store per account**. One secret per workspace×provider means even ~100
single-provider workspaces hit the cap. **Fine for dev/MVP scale.** Before GA scale, the path is
the Cloudflare **limit-increase request form**, or an alternative key-storage architecture.
Gateway counts are _not_ the constraint (10 free / 20 paid gateways per account; BYOK requests are
exempt from the unified-billing 200 req/60s cap). This supersedes ADR 0011's "max BYOK stored keys
per account is undocumented" note — it is now documented at 100.

### Test-mocking mechanism: miniflare `outboundService`, not `fetchMock`

Spike finding 5, verified: `@cloudflare/vitest-pool-workers` **0.18.0 removed the `fetchMock`
export from `cloudflare:test`** (the in-worker fetch patch is a verified no-op passthrough). The
DO-outbound question is therefore moot. The mechanism is a **miniflare `outboundService` mock
gateway**: `outboundService: "AI_GATEWAY_MOCK"` plus a `workers: [{ name: "AI_GATEWAY_MOCK",
modules: true, scriptPath: … }]` entry (the 0.18.0 pool schema is `.passthrough()`, so no API
change). The mock branches on `new URL(req.url).hostname === "gateway.ai.cloudflare.com"` and
passes everything else through — the models.dev catalog fetch rides the _same_ outbound.
`outboundService` dispatches the worker's global `fetch()` at the workerd layer, so it reaches
DO-originated absolute-URL calls and is immune to the DO-storage isolation-proxy caveat; a plain
`serviceBindings` entry would **not** intercept the SDK's absolute-URL fetch. Per-test response
variation comes from branching on request body/headers/`cf-aig-metadata` inside the mock worker,
not per-test interceptor registration (the outbound is fixed at miniflare startup). The canonical
mock lives at `packages/domain/test-workers/outbound-mock.mjs`, wired via
`packages/domain/vitest.workers.config.ts`.

### IaC (E1.9)

alchemy `0.91.2` ships `AiGateway` (`import { AiGateway } from "alchemy/cloudflare"`, verified at
the `v0.91.2` tag). Used with `authentication: true`; the prop is **`gatewayName`, not `name`**
(the published docs example's `name:` is silently ignored), pinned to an explicit stable value so
one shared gateway does not fragment across stages. The resource emits no url/token outputs:
`AI_GATEWAY_URL` is a plain-string binding derived from `accountId` + `gatewayName` (or `.env`),
`AI_GATEWAY_TOKEN` is `alchemy.secret.env.…` (an account-created token documented in
`.env.example`), same pattern as the existing `BETTER_AUTH` bindings.

### Other consequences

- ADR 0011 is superseded on three specific points (see its inline notes): curated → live catalog,
  model `tier` → live `cost`, alias `<workspace>` → `ws-<workspaceId>-<provider>`. The rest of
  0011 (BYOK-only economics, account-scoped-token isolation caveat, spend controls) stands.
- The DO's public `modelOverride` field and the no-model gate are **deleted** (E1.7); the model is
  always the snapshotted one, test-injected via `ThreadAgentSeed.testModel`.
- The edge gains four `domainErrorStatus` rows and rewrites its two deliberately-red
  placeholder-seam dispatch tests into happy paths, with `byok_key_missing` and
  `model_not_in_catalog` negative pins (E1.8).
- Open, deferred: real MCP catalog + egress enforcement (E6.3, revives `mcp_host_not_allowed`);
  the Secrets Store scale path above; the one gateway smoke-test of the stray `x-api-key` header
  (§9) before the first real production call.
