# ADR 0030 — Shape↔Channel is strictly 1:1; clones copy with provenance

**Status:** accepted (2026-07-01)
**Refines:** ADR 0007 (snapshotting), ADR 0018 (cloneable shapes), ADR 0019 (shape-edit rights), ADR 0021 ("a channel *is* its shape")

## Context
`Channel.shapeId` referenced a mutable `Shape` row with nothing pinning cardinality. A shape
shared by two channels would break ADR 0019's edit rights (channel A's owner could mutate
channel B's agent) and ADR 0007's "editing a shape is safe for in-flight threads" reasoning,
which assumes an edit lands on exactly one channel.

## Decision
- **Strict 1:1, channel-owned.** Every channel has exactly its own `Shape` row, created in
  the same `TenantWriteBatch` as the channel. The invariant is enforced in the
  tenant-guarded data layer (a Shape is only ever written alongside / on behalf of its one
  channel); no circular foreign key.
- **Clone = copy.** Cloning (ADR 0018) copies the `ShapeStructure` into a fresh Shape for
  the new channel and records provenance:
  `Shape.clonedFrom = { channelId, shapeId } | null`.
- **Shape stays a distinct entity** so v2 Templates slot in as a separate reusable concept
  without rework.

## Consequences
- ADR 0019 edit rights stay coherent: the channel's owner + workspace admins edit that
  channel's shape and nothing else moves.
- Clone provenance survives archive/delete of the source channel (a dangling reference is
  acceptable, mirroring ADR 0018's artifact stance).
