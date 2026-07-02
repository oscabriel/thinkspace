# ADR 0011 — Model routing: AI Gateway + BYOK-only (Secrets Store)

**Status:** accepted (2026-06-29)
**Source-grounded:** live web research on Cloudflare AI Gateway (2025–2026 docs/changelogs).

## Context
A model is a shape ingredient; every turn spends provider money. Decided: how calls route,
who pays, how keys are stored, and what bounds runaway cost. The user prioritized BYOK.
Research confirmed AI Gateway supports BYOK multi-tenant: the inference bill always follows
the key that authorized the request, and one gateway can carry N tenants' N keys.

## Decision
- **Routing:** all model calls through **Cloudflare AI Gateway** (Think → Vercel AI SDK →
  Gateway baseURL). Gateway core features are free.
- **Billing: BYOK-only.** Each workspace supplies its own provider key; **their** provider
  account is billed. We carry **no** provider keys, **no** inference-cost risk, and do **not**
  use Unified Billing. The managed-billing seam is **dropped** (committed BYOK-only).
- **Key storage: Cloudflare Secrets Store + per-tenant aliases.** Keys stored AES-encrypted,
  `ai_gateway`-scoped, RBAC + audit; selected per request via `cf-aig-byok-alias: <workspace>`.
  Raw key never travels in request traffic.
- **Catalog:** curated, and **key-gated** — a shape may use only models from providers the
  workspace has keyed. Per-provider defaults (e.g. Anthropic → **Sonnet** default, **Opus**
  premium, **Haiku** cheap). Slots into ADR 0004's workspace-permission seam.

## Security boundary (load-bearing caveat)
AI Gateway does **not** isolate tenants — gateway auth tokens are **account-scoped** (any
`AI Gateway Run` token reaches every gateway incl. BYOK creds). **Our backend is the isolation
boundary:** better-auth session → workspace → its alias, enforced in the tenant-guarded
data-access layer (ADR 0001). **Never** send a tenant key from the browser; backend-only.
Enable the authenticated gateway (`cf-aig-authorization`).

## Abuse controls (lightened by BYOK)
Customer eats inference cost → spend caps become a **feature we offer** (AI Gateway dollar
**spend-limits**, scoped via `cf-aig-metadata` workspace tags). Our residual risk is
**rate-abuse**: gateway **rate limits** + Think **`maxSteps`** per-turn cap. MCP egress
allowlist (ADR 0002) remains the exfil control.

## Consequences
- **Accepted onboarding friction:** a new workspace has **no usable agent** until it adds a
  provider key (key-gated catalog) and builds a shape (empty-by-default, ADR 0004). Target
  customers are technical teams who will bring keys.
- Per-workspace usage attribution via `cf-aig-metadata` (workspace_id), ≤5 tags/request.
- One gateway for all tenants (account limit 10–20 gateways — fine). Max BYOK stored keys
  per account is **undocumented** — verify with Cloudflare before assuming thousands.
