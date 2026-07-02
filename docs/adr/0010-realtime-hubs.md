# ADR 0010 — Real-time hubs: two-tier, per-channel sharding, presence in channel hubs

**Status:** accepted (2026-06-28)

## Context

Real-time fan-out is needed at three grains. A single per-workspace hub would serialize
all of a tenant's real-time work through one single-threaded DO (handoff §4 hot-hub
warning). The "channel = one agent" model provides a free shard key.

## Decision — three grains, two hub tiers

1. **ThreadAgent DO (per thread)** — streams conversation tokens to clients in that thread
   (finest grain; already settled). Holds the snapshotted shape (ADR 0007).
2. **ChannelHub DO (per channel)** — owns the channel's thread list, **channel-scoped
   presence + typing**, new-thread fan-out, and **orchestrates thread creation**: reads the
   current shape from D1 → creates the ThreadAgent → snapshots structural config (ADR 0007).
   This is where the heavy/frequent real-time work shards.
3. **WorkspaceHub DO (per workspace)** — thin; owns the channel sidebar, workspace roster,
   unread badges, and structural fan-out (channel created, member added). Low-frequency,
   structural events only.

## Presence

- **Channel-scoped presence/typing lives in ChannelHub** (pushed down to keep the always-on
  workspace socket light).
- If a global "who's online in the workspace" indicator is wanted, it's a **thin
  connect/disconnect liveness signal** to WorkspaceHub ("user has ≥1 active session") —
  not the per-channel churn.

## Consequences

- An active client may hold up to 3 WebSockets: WorkspaceHub (persistent), ChannelHub
  (while viewing a channel), ThreadAgent (while in a thread). Accepted fan-out cost.
- **Hard rule (handoff §4):** rosters/presence persist in each hub's DO-SQLite, never
  in-memory maps (lost on hibernation).
- ChannelHub is the channel's real-time DO and the thread-creation orchestrator — ties the
  hub layer to shape snapshotting (ADR 0007).
- Hubs read/write D1 for the thread index + unread source-of-truth and push deltas.
