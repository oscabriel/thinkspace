# ADR 0039 — Deployment environments: prod stage on think-space.app

**Status:** accepted (2026-07-11)
**Refines:** ADR 0008 (better-auth — cross-subdomain cookies), ADR 0011 (AI Gateway + BYOK —
shared gateway hazard), ADR 0035 (HTTP edge — trusted origins)

## Context

The 2026-07-10 first deploy landed under alchemy's default stage. `DEFAULT_STAGE` falls back to
`$USER` (`alchemy/src/scope.ts:165-169`), so the deploy ran under stage `oscargabriel` and baked
the Caddy dev origin (`thinkspace.gneiss.run`) into the live workers via the
`caddyDevOrigin ?? env` fallbacks (`alchemy.run.ts` origins, plus the `server.url` → `*.workers.dev`
fallback for `VITE_SERVER_URL`). The result is a deployment that is not independently usable: its
auth origin, CORS origin, invitation-link origin and web→server URL all point at the developer's
tunnel or a `workers.dev` host rather than a product domain.

We need a named, repeatable production deployment on **think-space.app** that is isolated from
dev data and carries no dev-origin leaks — landed as code + docs, with the first real deploy run
by the head session after review.

Verified against the local alchemy 0.91.2 source:

- alchemy stage-suffixes every physical resource name (`scope.ts:349`,
  `[appName, ...chain, id, stage].join("-")`), so a `prod` stage auto-isolates D1 / R2 / DO
  namespaces / workers with zero extra wiring.
- `Worker` and `TanStackStart` both accept `domains` (`cloudflare/worker.ts:305-334`; TanStackStart
  wraps Worker). Attaching a domain auto-provisions the proxied DNS record + TLS in the zone
  (`cloudflare/custom-domain.ts`), apex included — no manual DNS records.
- The AI Gateway does **not** stage-suffix: `gatewayName: "thinkspace"` is a pinned literal
  (`alchemy.run.ts`), so every stage adopts the same physical gateway, and the resource's delete
  phase deletes it unconditionally (`cloudflare/ai-gateway.ts:178-195`). 0.91.2 has no
  `delete:false` / `adopt` escape hatch. This is the shared-gateway destroy hazard.

## Decision

### 1. Two named stages, one registrable domain

| Stage | Selected by              | Web (TanStackStart) origin       | Server (Worker) origin              |
| ----- | ------------------------ | -------------------------------- | ----------------------------------- |
| dev   | default / any non-`prod` | `caddyDevOrigin ?? CORS_ORIGIN`  | `caddyDevOrigin ?? BETTER_AUTH_URL` |
| prod  | `ALCHEMY_STAGE=prod`     | `https://think-space.app` (apex) | `https://api.think-space.app`       |

Topology: **web at the apex `think-space.app`; server at `api.think-space.app`.** Same registrable
domain → same-site cookies, no third-party-cookie exposure. `www.think-space.app` is out of scope.

`isProd = app.stage === "prod"` drives a single stage-driven origin block. better-auth lives on the
**server** worker (it serves JWKS and issues cookies), so `authUrl` / `BETTER_AUTH_URL` = the
server origin; the browser calls the **web** origin, so `corsOrigin` / `INVITATION_ORIGIN` = the web
origin. Every dev-origin leak is closed in prod: both `VITE_SERVER_URL` bindings resolve to the
server origin (fixing the `server.url` → `workers.dev` fallback), and `INVITATION_ORIGIN` resolves
to the web origin rather than the raw env fallback.

Custom domains attach only in prod: `domains: ["api.think-space.app"]` on the server,
`domains: ["think-space.app"]` on the web app; `undefined` in dev. The server keeps `url: true` as
a `workers.dev` fallback.

### 2. Per-stage data isolation for free

Because alchemy stage-suffixes physical names, the `prod` stage provisions its own D1 database, R2
buckets, and Durable Object namespaces/workers with no extra configuration. Dev and prod never
share application state.

### 3. Cross-subdomain cookies gated on a prod-only binding

`crossSubDomainCookies` and `session.cookieCache { enabled: true, maxAge: 60 }` are enabled in prod.
Rather than hardcode the domain literal into the auth code (which every stage runs), the cookie
domain is passed in as a **binding**, `AUTH_COOKIE_DOMAIN = ".think-space.app"`, present only in the
prod stage and **absent in dev**. `apps/server/src/auth.ts` reads `env.AUTH_COOKIE_DOMAIN`; its
presence is the sole prod signal that turns both features on. In dev the binding is absent, both
features stay off, and cookies behave byte-for-byte as before. `trustedOrigins` resolves to
`https://think-space.app` in prod because prod `CORS_ORIGIN` is the web apex.

### 4. Secrets split: fresh prod auth secret, shared everything else

A **fresh** prod `BETTER_AUTH_SECRET` — never the dev value — is supplied via a gitignored
`packages/infra/.env.prod`, loaded with `override: true` **only** when `ALCHEMY_STAGE=prod`, after
the existing dotenv loads so it wins over any dev value. Everything else is shared across stages and
stays in `packages/infra/.env`, inherited by prod: `AI_GATEWAY_TOKEN`, `BYOK_CF_STORE_ID`,
`BYOK_CF_API_TOKEN`, `RESEND_API_KEY`, `INVITATION_FROM`, `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN`. Origins are code literals in prod, so `BETTER_AUTH_URL` / `CORS_ORIGIN` /
`INVITATION_ORIGIN` are not read in the prod stage. `.env.prod` therefore need only carry the fresh
secret. No secret value appears in source; `.env.example` documents the input **names** only.

### 5. Shared-gateway destroy hazard + guardrail

The single physical AI Gateway (`gatewayName: "thinkspace"`) is adopted by every stage, and alchemy
0.91.2 deletes it unconditionally on any stage's destroy — there is no `delete:false`/`adopt`
escape hatch in this version. **`alchemy destroy` of any stage while another stage is live tears
down the shared gateway and breaks model routing for the surviving stage.** The guardrail:
**NEVER `alchemy destroy` any stage while another stage is live.** Extracting the AI Gateway into a
dedicated shared scope (so per-stage destroys stop touching it) is a documented fast-follow, not in
this ADR. The runbook restates this guardrail in bold.

## Alternatives considered

**Rejected — path-based routing (single worker, `/api/*` on one origin).** Would avoid a second
custom domain, but it couples web and server deploys, complicates the cookie/CORS story, and gives
up the clean apex+api split that yields same-site cookies for free. The apex/api topology on one
registrable domain is simpler and strictly same-site.

**Deferred — dedicated shared scope for the AI Gateway.** The correct long-term fix for the destroy
hazard (§5), but it is additive and the operational guardrail suffices for now.

## Consequences

- A `prod` stage is deployable and independently usable; dev is byte-for-byte unchanged in its
  resolved bindings (the `prod` branch is inert for any non-`prod` stage).
- The `AUTH_COOKIE_DOMAIN` binding is optional in the inferred `server.Env` type; dev workers never
  carry it.
- The shared-gateway destroy hazard is a live operational risk until the fast-follow lands; the
  guardrail is the only mitigation in this version.

## Appendix — Prod deploy runbook

**This runbook is executed by the head session; it is documentation, not an instruction to run any
alchemy command as part of this issue.**

### Pre-requisites

- The `think-space.app` zone is active on the deploying Cloudflare account.
- No conflicting DNS records exist for the apex `think-space.app` or `api.think-space.app` (alchemy
  auto-provisions proxied records + TLS; pre-existing records would conflict).
- The Resend sender in `INVITATION_FROM` is verified for the sending domain.
- `packages/infra/.env` holds the shared secrets (see §4).
- `packages/infra/.env.prod` exists (gitignored) and defines a **fresh** `BETTER_AUTH_SECRET`
  that differs from the dev value. No other keys are required.

### First-deploy order of operations

1. Confirm the pre-requisites above.
2. From `packages/infra`, run the deploy with the prod stage selected:
   `ALCHEMY_STAGE=prod bun run deploy` (with `CADDY_DEV_HOST` unset). alchemy provisions the
   stage-suffixed D1/R2/DO resources, attaches the apex and `api.` custom domains (DNS + TLS), and
   binds the prod origins and `AUTH_COOKIE_DOMAIN`.
3. Allow the custom-domain TLS certificates to finish provisioning before verifying.

### Verification steps

- **JWKS reachable:** `https://api.think-space.app/api/auth/jwks` returns the key set (hub WS JWT
  verification depends on it — `AUTH_JWKS_URL`).
- **Cookie domain:** after sign-in, the session cookie carries `Domain=.think-space.app` and is sent
  to both the apex and `api.` subdomain.
- **Invitation link origin:** a sent invitation's accept link points at `https://think-space.app`
  (the web apex), not a dev tunnel or `workers.dev` host.
- **Hub WS JWT:** an authenticated WebSocket to a channel/workspace hub upgrades successfully (the
  connect JWT verifies against the JWKS above).
- **No dev-origin leaks:** the deployed web app calls `https://api.think-space.app`
  (`VITE_SERVER_URL`); no `thinkspace.gneiss.run` or `*.workers.dev` origin appears in any binding.

### Destroy guardrail

**NEVER run `alchemy destroy` against any stage while another stage is live.** The AI Gateway is a
single shared physical resource (`gatewayName: "thinkspace"`) adopted by every stage, and alchemy
0.91.2 deletes it unconditionally on destroy — tearing it down breaks model routing for every
surviving stage. Until the dedicated-shared-scope fast-follow lands, this guardrail is the only
protection.
