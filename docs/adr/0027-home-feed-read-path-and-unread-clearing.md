# ADR 0027 — Home feed read path + unread clearing

**Status:** accepted (2026-07-01)
**Refines:** ADR 0020 (home = cross-channel recent activity), ADR 0017 (unread = bump by agent output)

## Context

The typed architecture had no query answering ADR 0020's landing surface ("bumped threads
across all my visible channels"), and unread rows could be written (`put_unread`) but never
cleared. ADR 0020's consequences located the cross-channel read at "WorkspaceHub-level",
while ADR 0012 makes WorkspaceHub the one unsharded single-threaded DO and ADR 0010 says
hubs read D1 and push **deltas**.

## Decision

- **Home feed = `TenantDataAccess.listRecentThreads({ limit, before? }) → HomeFeed`** — a
  paginated D1 query (threads ⋈ visible channels, ordered by last activity descending,
  deleted channels excluded). Cold loads hit edge-replicated D1; live updates keep flowing
  as WorkspaceHub `thread_bumped` deltas. ADR 0020's "WorkspaceHub-level" is read as
  describing the delta push, not the query.
- **Unread clears via a `delete_unread` batch command** (`{ memberId, threadId }`), issued
  by the edge when the member opens the thread. Stored `Unread` rows and the typed
  `UnreadReason` detail stay as-is.
- **Unread recipients on bump = thread participants** (the creator plus anyone who has
  commented or dispatched in the thread), not every member with channel visibility —
  matches ADR 0017's "co-participant" language and bounds the fan-out write.

## Consequences

- WorkspaceHub stays thin (ADR 0012); no hub pass-through query on the app-open hot path.
- The mid-read race (a run completing while the member is reading) is accepted as benign at
  v1 scale: worst case a badge clears a beat early or reappears on the next bump.
- Archived channels stop bumping naturally (no dispatch on archived, ADR 0018), so they age
  out of the feed without special-casing.
