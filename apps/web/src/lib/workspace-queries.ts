import { queryOptions } from "@tanstack/react-query";

import {
  fetchArtifact,
  fetchArtifacts,
  fetchArtifactVersionContent,
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
  artifact: (workspaceId: string, artifactId: string) =>
    ["workspace", workspaceId, "artifact", artifactId] as const,
  artifactContent: (
    workspaceId: string,
    artifactId: string,
    versionId: string
  ) =>
    [
      "workspace",
      workspaceId,
      "artifact",
      artifactId,
      "content",
      versionId,
    ] as const,
  artifacts: (workspaceId: string) =>
    ["workspace", workspaceId, "artifacts"] as const,
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

 * The Library reads (E7.6). Artifact writes come from agent runs only — there is no browser
 * write path — so these are read-only and, like the sidebar graph, have no realtime socket
 * (ADR 0010 pushes thread/run deltas, not artifact writes). They refetch on window focus; a
 * run that lands a new artifact surfaces on the next Library visit rather than live. Content
 * is addressed by immutable version id (ADR 0032), so `artifactContentQuery` never goes stale.
 */
export const artifactsQuery = (workspaceId: string) =>
  queryOptions({
    queryFn: () => fetchArtifacts(workspaceId),
    queryKey: workspaceKeys.artifacts(workspaceId),
    select: (data) => data.artifacts,
  });

export const artifactQuery = (workspaceId: string, artifactId: string) =>
  queryOptions({
    queryFn: () => fetchArtifact(workspaceId, artifactId),
    queryKey: workspaceKeys.artifact(workspaceId, artifactId),
  });

export const artifactContentQuery = (
  workspaceId: string,
  artifactId: string,
  versionId: string
) =>
  queryOptions({
    queryFn: () =>
      fetchArtifactVersionContent(workspaceId, artifactId, versionId),
    queryKey: workspaceKeys.artifactContent(workspaceId, artifactId, versionId),
    staleTime: Number.POSITIVE_INFINITY,
  });

/**
 * A channel cannot be created without a shape (ADR 0030), and a shape cannot be authored
 * without the model picker that is sibling #29's deliverable. The shell therefore seeds a
 * minimal default structure so the "New channel" affordance is functional end-to-end. The
 * default model is the run-card's reference id; if the workspace has no BYOK key for it or
 * the catalog lacks it, the ModelRouter fails the create fast (ADR 0036) and the shell
 * surfaces that error verbatim — the teaching moment that a provider key / real shape is
 * needed (key-first onboarding, ADR 0011). Replace this whole path when #29 lands.
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
