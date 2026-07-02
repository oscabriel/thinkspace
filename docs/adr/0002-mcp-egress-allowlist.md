# ADR 0002 — MCP egress: per-workspace owner-approved allowlist

**Status:** accepted (2026-06-28)

## Context
MCP is the most paved part of the Cloudflare Agents stack
(`this.addMcpServer(name, url)` persists + auto-restores), which makes it the
easiest exfiltration foot-gun. Under the B2B trust model (ADR 0001), the blast
radius of a malicious MCP server is one workspace's data — docs, message history,
tool outputs — silently shipped to an attacker endpoint. No cross-tenant boundary
need be crossed for catastrophic data loss.

Stances considered: **open** (any URL — a model-(c) posture in disguise),
**registry-only** (curated marketplace; blocks "bring your own internal MCP"),
**allowlist-per-workspace** (arbitrary hosts, but each approved into the
workspace's allowlist).

## Decision
**Allowlist-per-workspace, owner-approved hosts.** An admin may reference any MCP
server when building a shape, but the target **host** must be approved into that
workspace's egress allowlist by a workspace **owner** before the agent can reach
it. Egress from agents is restricted to approved hosts.

## Consequences
- Need a `workspace_mcp_allowlist` concept (host + who approved + when) in D1.
- Adding egress becomes a deliberate, auditable owner action — not a one-line
  accident or a prompt-injection payload.
- Preserves the key B2B desire: "connect our internal Jira/Linear MCP server."
- Egress enforcement must live at the Worker/agent boundary, not in the UI
  (a member or injected prompt must not be able to bypass it).
- Verified against the SDK clone @ 2351e5c (2026-07-01): the hibernation-restore path
  reconnects straight from the persisted `cf_agents_mcp_servers` row without re-running any
  add-time check — the allowlist gate must run **before** the row is persisted, and revoking
  a host must delete the row via `removeMcpServer` (else it reconnects on the next wake).
  See `docs/sdk-signature-verification.md` §3.
- Degrades cleanly toward model (c): tighten the default allowlist to
  registry-only and gate custom hosts behind verification/payment.

## Open
- Granularity of approval: host vs full URL vs OAuth-app identity. (Lean host.)
- Does an approved host imply all paths on it? (Lean yes for v1; revisit.)
