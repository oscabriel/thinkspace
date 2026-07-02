# ADR 0008 — Auth/identity: better-auth (self-hosted, in-stack)

**Status:** accepted (2026-06-28)
**Source-grounded:** verified against local clone `github.com/better-auth` (v1.6.x)

## Context

Auth/identity is 100% ours to build (the Cloudflare Agents SDK validates nothing).
Candidates were better-auth (self-hosted, in-stack) and WorkOS (hosted IdP). Verified
in source:

- **better-auth**: native Cloudflare Workers support (smoke-tested fixture rejecting
  `node:` API leakage), native **D1** (v1.5+), an **organization plugin** providing
  `organization`/`member`/`invitation`/role tables, **SSO (SAML/OIDC) + SCIM** plugins,
  and a **JWT + JWKS** path for stateless edge/DO verification.
- **WorkOS**: hosted B2B identity (outsources credential storage + liability), strong
  SSO/SCIM, but external/paid, lives outside D1, and the local clone only shows
  Node-based example apps (no edge-native path).

## Decision

Use **better-auth**, self-hosted in our Worker against our D1.

## Consequences

- better-auth's **organization plugin owns the tenant graph**: its `organization` **is**
  our **Workspace**, its `member` **is** our **Member**, and we adopt its **role** model
  (owner/admin/member + dynamic roles). Invitations come from its `invitation` table.
- Our domain tables (channels, shapes, threads, unread) **foreign-key into** better-auth's
  org/member tables in the **same D1** — collapses "identity" + most of "tenant graph"
  into one in-stack library. Pre-resolves much of Q7.
- Identity is handed to a ThreadAgent DO via a **JWT** forwarded through `agent.fetch()`,
  verified against the **JWKS** endpoint at the edge / in `onBeforeConnect`.
- We own the security posture (self-hosted) — a deliberate trade vs WorkOS's outsourced
  liability. SSO/SCIM available via plugins when enterprise procurement demands them.
- **D1 caveat:** no interactive transactions — multi-statement atomicity uses D1 `batch()`
  (better-auth already does this; our own writes must too).
