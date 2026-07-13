# ADR 0031 — Artifact rendering = sandboxed separate-origin viewer

**Status:** proposed (2026-07-03)
**Refines:** ADR 0001 (trust boundary), ADR 0014 (document scope), ADR 0024 (artifacts = any media)

## Context

ADR 0024 admits HTML as artifact content, and the emerging agent workflow leans into it: coding
agents emit standalone HTML plan docs/reports because HTML is reader-optimized where markdown is
writer-optimized. The Workspace Library is only useful for these if it **renders** them at a URL,
not just stores bytes.

Rendered agent HTML is **untrusted active content**. ADR 0001 trusts members-inside-a-workspace
not to be hostile, but agent output is model-generated and steerable by anything in the context
window (tool results, MCP content, pasted text) — prompt injection can smuggle live JS into a plan
doc. Model (c) open SaaS must also stay reachable. The industry-converged recipe
(googleusercontent.com, githubusercontent.com, claudeusercontent.com; web.dev "securely hosting
user data"; ArchiveBox security docs) is: **origin isolation is the security boundary;
sanitization alone is insufficient** (Google security engineering, in writing).

## Decision

Rendered artifact content is served **only** from a dedicated **sandbox domain** — a separate
registrable domain (not a subdomain of the app domain; cookie scope), e.g.
`*.<sandbox-domain>` → a thin viewer Worker streaming from R2. Defense in depth, all layers
mandatory:

1. **Per-artifact random subdomain** (`<random>.<sandbox-domain>`, wildcard DNS → viewer Worker).
   A single shared sandbox host isolates content from the app but not tenants from each other;
   per-content subdomains close that (web.dev recommendation). Cheap on Cloudflare.
2. **Strict CSP response headers**: inline CSS/JS and `data:`/`blob:` URIs only; **all external
   network blocked** (scripts, styles, fonts, images, fetch/XHR/WebSocket), plus
   `Content-Security-Policy: sandbox allow-scripts` and `X-Content-Type-Options: nosniff`. The
   viewer origin never sets cookies and has no storage. Forcing self-contained pages is also the
   fix for unreliable styling: no CDN links → deterministic rendering.
3. **In-app embedding** via `<iframe sandbox="allow-scripts">` — never `allow-same-origin`
   together with `allow-scripts` (the framed page could reach up and strip its own sandbox).
4. **Auth across the origin boundary**: the viewer origin never sees the app session. The app
   mints a **short-TTL signed view token** scoped to `{workspaceId, artifactId}`, embedded in the
   viewer URL; the Worker verifies it and streams the bytes. Tokens are bearer capabilities —
   minutes-scale TTL, single-artifact scope, minted only for members the tenant guard admits
   (ADR 0001 discipline extends across origins).
5. **Sanitization is an optional depth layer, never the boundary.** No reliance on DOMPurify
   defaults (bypass history; defaults require hand-tuning).
6. **Render only on explicit view.** The Library board shows metadata cards; no auto-executing
   live thumbnails in v1 (a thumbnail is untrusted JS running on page load).

Applies to all **active** content types (`text/html`, `image/svg+xml`); inert media (images,
video, pdf-as-download) flows through the same viewer origin and headers for uniformity.

## Consequences

- New infra: sandbox domain registration + wildcard DNS/cert, viewer Worker, R2 read binding —
  all in `alchemy.run.ts` alongside the (currently missing) R2 bucket.
- API grows a token-minting endpoint gated by the tenant-guarded data-access layer.
- Agents must emit **self-contained** HTML (inline everything); this becomes shape/skill guidance
  and a documented artifact contract. A per-artifact size cap is set at write time (enforced via
  `byteLength`; precedent: Claude Code artifacts cap at 16 MiB).
- Artifacts remain workspace-private: viewer URLs are useless without a fresh token; there is no
  public-link surface in v1 (revisit with model c).
- ADR 0003's "no sandboxing budget" deferral is unchanged — this ADR buys _rendering_ isolation
  only, not code execution for tools.

## Open sub-questions

- Submit the sandbox domain to the Public Suffix List once stable?
- Longer-lived share links (token-in-URL durability vs. revocation) — deferred until sharing
  outside the viewer flow is a requirement.
