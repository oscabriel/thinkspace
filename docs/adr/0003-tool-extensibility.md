# ADR 0003 — Tool extensibility: first-party registry + MCP; defer Code Mode

**Status:** accepted (2026-06-28)

## Context
A shape's tools can be sourced from: a first-party prebuilt registry, user-supplied
MCP servers (ADR 0002), or user-authored code tools (Code Mode). User code
reintroduces the full model-(c) adversarial surface (untrusted execution — the code
*is* the egress, no host to allowlist) that ADRs 0001/0002 deliberately deferred.
MCP already covers the "we need a custom integration" use case for B2B teams.

## Decision
- **First-party prebuilt registry in v1** — platform-built, vetted tools
  (e.g. web search, HTTP fetch, calculator, date/time, "search this channel's docs").
  Effectively zero marginal per-tenant security surface.
- **User-supplied MCP in v1** — allowlisted per ADR 0002.
- **User-authored code tools (Code Mode) deferred to v2.**

## Consequences
- A freshly-created shape is useful before any MCP wiring exists.
- "Custom integration" pressure is routed to MCP, not Code Mode.
- The codemode package is out of scope for v1 (revisit when sandboxing budget exists).

## Resolved sub-question
Global vs workspace-curatable registry → resolved by **ADR 0004**: global *catalog*,
workspace permission as a deferred seam, bespoke-ness via empty-by-default shape
selection. ("Global" applies to the catalog, never to activation.)
