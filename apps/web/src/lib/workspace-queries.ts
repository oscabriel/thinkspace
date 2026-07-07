import { queryOptions } from "@tanstack/react-query";

import {
  fetchChannel,
  fetchChannelShape,
  fetchChannelThreads,
  fetchHomeFeed,
  fetchProviders,

  fetchModels,
  fetchUnread,
  fetchWorkspaceGraph,
} from "./api";

/**
 * TanStack Query is the shell's convergence mechanism. No realtime event fires on channel
 * lifecycle changes (recorded gap; the hub only pushes thread/run deltas, ADR 0010), so the
 * sidebar and feeds re-read D1 rather than react to a socket. Staleness policy:
 *   - graph (sidebar): stale-while-focused; refetched on window focus and on channel
 *     create/archive mutations (invalidated below). No timer — channel sets change on human
 *     action, which we already invalidate on.
 *   - home + unread ("what moved while I was away", ADR 0020): a 30s poll plus focus refetch,
 *     since agent bumps have no shell-side socket until the thread surface (#28) lands.
 * The full-fidelity live feed is #28's WS integration; the shell converges on a timer.
 */
const HOME_POLL_MS = 30_000;

export const workspaceKeys = {
  all: (workspaceId: string) => ["workspace", workspaceId] as const,
  channel: (workspaceId: string, channelId: string) =>
    ["workspace", workspaceId, "channel", channelId] as const,
  channelShape: (workspaceId: string, channelId: string) =>
    ["workspace", workspaceId, "channel", channelId, "shape"] as const,
  channelThreads: (workspaceId: string, channelId: string) =>
    ["workspace", workspaceId, "channel", channelId, "threads"] as const,
  graph: (workspaceId: string) => ["workspace", workspaceId, "graph"] as const,
  home: (workspaceId: string) => ["workspace", workspaceId, "home"] as const,
  providers: (workspaceId: string) =>
    ["workspace", workspaceId, "providers"] as const,

  models: (workspaceId: string) =>
    ["workspace", workspaceId, "models"] as const,
  unread: (workspaceId: string) =>
    ["workspace", workspaceId, "unread"] as const,
};

export const graphQuery = (workspaceId: string) =>
  queryOptions({
    queryFn: () => fetchWorkspaceGraph(workspaceId),
    queryKey: workspaceKeys.graph(workspaceId),
  });

export const homeQuery = (workspaceId: string) =>
  queryOptions({
    queryFn: () => fetchHomeFeed(workspaceId),
    queryKey: workspaceKeys.home(workspaceId),
    refetchInterval: HOME_POLL_MS,
  });

export const unreadQuery = (workspaceId: string) =>
  queryOptions({
    queryFn: () => fetchUnread(workspaceId),
    queryKey: workspaceKeys.unread(workspaceId),
    refetchInterval: HOME_POLL_MS,
    select: (data) => data.unread,
  });

/**
 * Which providers the workspace has keyed (E7.2, ADR 0011). Read-through convergence like the
 * graph: no realtime event fires on key registration, so the settings page and the key-first
 * teaching banner re-read after a register/remove mutation invalidates this key. Registry facts
 * only — never key material.
 */
export const providersQuery = (workspaceId: string) =>
  queryOptions({
    queryFn: () => fetchProviders(workspaceId),
    queryKey: workspaceKeys.providers(workspaceId),
    select: (data) => data.providers,
  });

export const channelQuery = (workspaceId: string, channelId: string) =>
  queryOptions({
    queryFn: () => fetchChannel(workspaceId, channelId),
    queryKey: workspaceKeys.channel(workspaceId, channelId),
  });

export const channelThreadsQuery = (workspaceId: string, channelId: string) =>
  queryOptions({
    queryFn: () => fetchChannelThreads(workspaceId, channelId),
    queryKey: workspaceKeys.channelThreads(workspaceId, channelId),
    refetchInterval: HOME_POLL_MS,
  });

/**
 * The model picker's data source (E7.5): the live catalog ∩ the workspace's keyed providers
 * (ADR 0011 / 0036). Stable per workspace — a provider key registration changes it, so it is
 * refetched on window focus rather than a timer; an empty list is the honest "no key yet" signal.
 */
export const modelsQuery = (workspaceId: string) =>
  queryOptions({
    queryFn: () => fetchModels(workspaceId),
    queryKey: workspaceKeys.models(workspaceId),
    select: (data) => data.models,
  });

/**
 * A channel's live shape structure (ADR 0007 config-as-data) — the edit form's prefill so an
 * owner re-authors from real values. Read on demand when the shape route mounts; invalidated by
 * an edit alongside the channel/graph queries.
 */
export const channelShapeQuery = (workspaceId: string, channelId: string) =>
  queryOptions({
    queryFn: () => fetchChannelShape(workspaceId, channelId),
    queryKey: workspaceKeys.channelShape(workspaceId, channelId),
  });
