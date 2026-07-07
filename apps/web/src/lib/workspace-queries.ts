import { queryOptions } from "@tanstack/react-query";

import {
  fetchChannel,
  fetchChannelThreads,
  fetchHomeFeed,
  fetchUnread,
  fetchWorkspaceGraph,
  type ShapeStructure,
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
  channelThreads: (workspaceId: string, channelId: string) =>
    ["workspace", workspaceId, "channel", channelId, "threads"] as const,
  graph: (workspaceId: string) => ["workspace", workspaceId, "graph"] as const,
  home: (workspaceId: string) => ["workspace", workspaceId, "home"] as const,
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
 * A channel cannot be created without a shape (ADR 0030), and a shape cannot be authored
 * without the model picker that is sibling #29's deliverable. The shell therefore seeds a
 * minimal default structure so the "New channel" affordance is functional end-to-end. The
 * default model is the run-card's reference id; if the workspace has no BYOK key for it or
 * the catalog lacks it, the ModelRouter fails the create fast (ADR 0036) and the shell
 * surfaces that error verbatim — the teaching moment that a provider key / real shape is
 * needed (key-first onboarding, ADR 0011). Replace this whole path when #29 lands.
 */
export const DEFAULT_MODEL_ID = "anthropic/claude-sonnet-5";

export const defaultShapeStructure = (goal: string): ShapeStructure => ({
  artifactSelection: [],
  mcpServerSelection: [],
  modelId: DEFAULT_MODEL_ID,
  skillSelection: [],
  systemPrompt: `You are the agent for a channel whose goal is: ${goal}`,
  toolSelection: [],
});
