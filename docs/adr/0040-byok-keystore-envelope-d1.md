# ADR 0040 — BYOK KeyStore port: envelope-encrypted D1 dissolves the Secrets Store 100-secret cap

**Status:** accepted (2026-07-11)
**Supersedes in part:** ADR 0011 (its key-storage half — "Cloudflare Secrets Store + per-tenant
aliases" is now one adapter's concern, not the only path)
**Amends:** ADR 0036 §4-5 (`byokSecretAlias`/`byokSecretName`/Secrets Store name anatomy become the
legacy adapter's concern) and **dissolves** ADR 0036's "Secrets Store 100-secret scale blocker"
recorded risk; refines ADR 0038 (the addendum's verbatim-header finding is the mechanism this ADR
depends on)
**Source-grounded:** BACKLOG E11.8; live-verified Secrets Store limits
(developers.cloudflare.com/secrets-store, 2026-07-11); ADR 0038 addendum §2's live BYOK smoke test.

## Context

Cloudflare Secrets Store is still open beta: **100 secrets/account, 1 store/account, 1024-byte
values**. At one secret per workspace×provider (`byokSecretName = {gateway_id}_{provider_slug}_
{alias}`), ~50-100 workspaces exhaust the account — the hard GA blocker recorded in ADR 0036 and
docs/CONTEXT.md.

We do not need Secrets Store. ADR 0038's addendum §2 proved live that **AI Gateway forwards a
_present_ provider-auth header verbatim** (BYOK substitution suppressed; an empty header triggers
substitution). So we can store keys ourselves, decrypt at the edge/DO, and send the real header
through the gateway — keeping gateway logging/spend-limits while removing the cap. ADR 0036's
`byok.ts` comment already anticipated "a pending KeyStore-port decision."

## Decision

### 1. A `KeyStore` port with two adapters

`packages/domain/src/seams/key-store.ts` defines the port: `writeKey(provider, rawKey)`,
`deleteKey(provider)`, and `resolveProviderAuth({ modelId })` → a `ResolvedProviderAuth` that is
either `{ kind: "header", value }` (the decrypted raw key the gateway forwards verbatim) or
`{ kind: "alias", alias }` (the `cf-aig-byok-alias` the gateway substitutes). Context-bound like
`ModelRouter`/`ProviderKeyRegistry` (scoped to `context.workspaceId`); the raw key crosses
`writeKey` once and is returned by resolve only as a transient `header` value.

- **`EnvelopeD1KeyStore` is the production default.** AES-256-GCM via WebCrypto; the master key is
  a new worker secret `BYOK_MASTER_KEY` (base64 32 bytes); ciphertext + IV live in a new
  `workspace_provider_key.key_ciphertext` column as `v1:<ivBase64>:<ctBase64>`. It writes the
  registry row and the ciphertext in one D1 upsert (re-registration replaces the ciphertext and
  preserves `created_at`, so ADR 0038 §2's earliest-keyed curator ordering is untouched).
- **`SecretsStoreKeyStore` is the retained legacy adapter** — today's `createCloudflareByokClient`
  write path plus the `workspace_provider_key` row, ordered exactly as the E3.2 route was (secret
  first on write, row first on delete, so a row never outlives a live secret). `resolveProviderAuth`
  is pure: it returns `byokSecretAlias(workspaceId, provider)` with no I/O, so a resolve-only holder
  (the DO) needs no Secrets Store binding.

`createKeyStore({ context, env })` selects the adapter: `BYOK_MASTER_KEY` bound → envelope; unbound
(test env, or a stage that has not provisioned it) → legacy. The legacy adapter builds its
Cloudflare client lazily so the selector never requires the Secrets Store bindings for a resolve.

### 2. The header path: the gateway forwards the decrypted key verbatim

`gatewayModelFactories` (anthropic/openai) gain an optional `providerAuth` option. `kind: "header"`
→ the raw key is the provider's real auth header (anthropic `x-api-key: <key>`, openai
`Authorization: Bearer <key>`), which the gateway forwards verbatim (ADR 0038 addendum §2). `kind:
"alias"` (or the option absent) → today's behavior exactly: the real header is blanked (the gateway
reads an empty header as absent and substitutes the Secrets Store secret) and `cf-aig-byok-alias`
is set. Absent-option back-compat keeps every existing turn byte-identical.

### 3. The DO wake path: ciphertext via a narrow tenant-scoped seam read, decrypt to a transient field

The DO's `getModel` is synchronous, but envelope decrypt (a D1 read + WebCrypto) is async. So the
thread agent (`run`) and curator (`send`) **pre-resolve** provider auth before the synchronous turn
begins and stash it in a plain instance field the synchronous `getModel` reads. The field never
touches `ctx.storage`, so no plaintext survives hibernation — the raw key exists transiently in
memory only between decrypt and header injection.

The ciphertext read is a **new narrow tenant-scoped seam method on tenant-data-access** —
`getProviderKeyCiphertext({ provider })` — NOT a raw DO→D1 SELECT (the class ADR 0038 §Rejected
barred) and NOT KV (eventual consistency would make a just-registered key flaky on first run). The
envelope adapter reads through this seam and decrypts with the env master key.

**Fail closed.** `resolveProviderAuth` fails the run/turn closed, exactly like today's edge byok
gate: a missing registry row → `byok_key_missing`; a ciphertext that will not open (wrong master
key, corrupt IV/ciphertext, failed GCM tag) → `byok_key_undecryptable`. Neither ever decrypts to
garbage or surfaces a raw crypto error.

### 4. Redaction discipline (invariant, tested)

The raw key never lands in a log, a thrown error, a response body, or a D1 plaintext column. The
sealed column value is `v1:<iv>:<ct>` and never embeds the plaintext; every decrypt failure throws
a fixed key-free message mapped to a typed routing envelope. Tests assert redaction at the crypto,
memory-adapter, and production-D1 layers (the `key_ciphertext` column is verified sealed at rest).

### 5. Registry-row semantics unchanged

`workspace_provider_key(workspace_id, provider, created_at)` still records _that_ a provider is
keyed; the router/curator/catalog reads (`model-routing.ts`) are semantically unchanged. The new
`key_ciphertext` column is additive and read only by the envelope adapter.

## Migration

- **Schema:** migration `0009_busy_maria_hill.sql` — `ALTER TABLE workspace_provider_key ADD
  key_ciphertext text`. Additive and backward-compatible: existing rows have `NULL` ciphertext.
  Alchemy auto-applies migrations on deploy.
- **Existing keys (the dev smoke workspace's openai key):** a row with `NULL` ciphertext predates
  the envelope adapter. The envelope resolver **falls back to the legacy alias** for such a row, so
  the gateway keeps substituting the still-live Secrets Store secret and no run breaks at deploy
  time. To move a key onto the envelope path, **re-register it via the settings UI** — the write
  seals the raw key into `key_ciphertext`, and the next resolve returns a `header`. `byokSecretAlias`
  / `byokSecretName` are retained but are legacy-adapter-only.
- **Rotation:** rotating `BYOK_MASTER_KEY` invalidates every sealed row (they will not open under
  the new key). The rotation procedure is: re-encrypt all rows — read each `key_ciphertext` under
  the old master key, re-seal under the new one, write back — as a one-shot maintenance pass, then
  swap the secret. Until such a pass exists, rotation is a re-register of every key. (No live D1 is
  touched by this ADR's work; rotation tooling is follow-up.)

## Consequences

- The Secrets Store 100-secret scale blocker (ADR 0036) is dissolved; workspace count is bounded
  only by D1. The legacy adapter and Secrets Store wiring (including `alchemy.run.ts`'s BYOK store
  link) remain for the transition and as a fallback.
- `BYOK_MASTER_KEY` is bound in `packages/infra/alchemy.run.ts` via `alchemy.secret.env`
  (names-only in docs; the value is never logged). Its presence is what selects the envelope
  adapter in production.
- Scheduled runs (ADR 0036 §10) resolve provider auth through the same KeyStore at turn time; a key
  revoked since scheduling now fails the run closed at decrypt rather than only at the gateway.

## Deferred — the second half of E11.8

This ADR ships the KeyStore port. The **tiered any-provider allowlist** (letting a workspace key any
provider, not only the curated allowlist) is **issue #56 and lands separately** — it builds on this
port but is an independent decision.
