# ADR 0023 — Workspace discovery: minimal shared-channel directory

**Status:** accepted (2026-06-29)
**Builds on:** ADR 0019 (shared-by-default visibility), ADR 0020 (recent-activity home),
ADR 0013 (multiplayer = shared workspace assets)

## Context
Channels are shared-by-default (ADR 0019) but ephemeral and potentially numerous. The
"use each other's agents" value (ADR 0013) only pays off if shared channels are **findable**.
Resolves handoff Q-H.

## Decision
- **Ship a minimal, searchable shared-channel directory in v1.** A browsable/searchable index of
  the workspace's shared channels keyed on **goal, owner, and status (active/archived)**, separate
  from the member's own sidebar, so members can find and jump into channels they are not already
  tracking.
- **Defer the full workspace-wide activity feed (v2+).** The cross-channel recent-activity home
  (ADR 0020) already curates "what's happening in *my* channels"; a firehose feed of every channel
  risks recreating the overload the product exists to escape.

## Consequences
- Discovery reads from the same visibility model as the sidebar (ADR 0019): the directory lists
  shared channels (plus the member's own private ones), respecting per-channel ACL.
- Requires a workspace-level queryable index of channels (goal/owner/status) — a D1 read path
  (channels table already workspace-partitioned, ADR 0009).
- Goal text becomes a first-class, searchable field on a channel (reinforces channels being
  goal-scoped, ADR 0016).

## Reopen conditions
- If demand for ambient awareness grows, add a curated (not firehose) activity feed, reusing the
  recent-activity ranking from ADR 0020.
