# ADR 0001 — Trust boundary: B2B invited-teams

**Status:** accepted (2026-06-28)

## Context
The trust posture chosen up front determines how adversarial every downstream
layer (auth, tenant isolation, MCP egress, spend controls) has to be. Three
postures considered: (a) internal tool, (b) B2B invited-teams, (c) open public SaaS.

## Decision
Build for **(b) B2B invited-teams**, but keep **(c) open public SaaS** reachable
without a rewrite. Members join workspaces by invitation only — no anonymous
self-serve signup in v1.

## Consequences
- Every D1 table carries `workspace_id`.
- All reads/writes go through one tenant-guarded data-access layer; no raw query
  may omit the tenant predicate.
- No Durable Object is ever addressed by a client-supplied name — the Worker
  derives the DO name from the authenticated session.
- Isolation **between** workspaces must be airtight; members **inside** a
  workspace are trusted not to be actively hostile (revisit under model c).
- Heavy abuse hardening (egress allowlists, spend quotas) can be deferred but the
  isolation discipline above is non-negotiable from day one.

## Open sub-question (feeds ADR 0002 / Q2)
Within a workspace, is an admin allowed to point a shape at an **arbitrary** MCP
server / tool, or only at a **vetted registry**?
