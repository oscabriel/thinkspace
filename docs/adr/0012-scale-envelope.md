# ADR 0012 — Scale envelope & non-goals

**Status:** accepted (2026-06-29)

## Context

Real-world usage is expected to be **very small** on every dimension. But the design must
**theoretically** hold up to the upper bound of the assumed bands (Q10) — and explicitly
**not** beyond, where the architecture's single-threaded-hub assumptions would break. This
ADR fixes that envelope as a contract so future work neither under-builds nor over-builds.

## Decision — supported ceiling (design to this; expect far less)

| Dimension                                 | Supported ceiling | Notes                                                                           |
| ----------------------------------------- | ----------------- | ------------------------------------------------------------------------------- |
| Concurrent **online members / workspace** | **low hundreds**  | the binding constraint — `WorkspaceHub` is the one unsharded single-threaded DO |
| **Channels / workspace**                  | **dozens**        | one `ChannelHub` DO each (idle ≈ free)                                          |
| **Threads (total)**                       | **millions**      | D1 holds only metadata → well under 10 GB                                       |
| Concurrent **active threads** (inference) | **hundreds**      | bounded by AI Gateway + each workspace's BYOK provider rate limits              |
| **Total workspaces**                      | **thousands**     | DO population effectively unbounded; D1 metadata stays small                    |

## Non-goals (explicitly NOT built for)

- Tens of thousands of **concurrent online members in a single workspace**.
- Mega-corp company-wide single-workspace deployments.
- Viral consumer-scale / "mega hit" growth.

## Consequences

- **ADR 0010's two-tier hub stands as-is** — no `WorkspaceHub` sub-sharding is built. Presence
  is already pushed to channel hubs (keeps the workspace socket lean), which is what makes
  "low hundreds online" comfortable.
- **Known escape hatch (documented, not built):** if a customer ever exceeds the band,
  sub-shard `WorkspaceHub` by member-bucket. Treat crossing the ceiling as a deliberate future
  project, not a silent scaling cliff — add monitoring on per-workspace online-member counts.
- No premature optimization for beyond-band scale; engineering effort stays on v1 surface.
