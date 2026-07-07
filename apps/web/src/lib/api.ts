import { env } from "@thinkspace/env/web";

/**
 * The tenant-guarded read/write surface (apps/server/src/{reads,channels}.ts) lives under
 * `${VITE_SERVER_URL}/api/w/:workspaceId/*`. Every call rides the better-auth session cookie
 * (credentials: "include"); the server resolves the acting member from the path workspaceId
 * (never from an active-org claim) and fails closed — a non-member 404s, an invisible channel
 * 404s. These are the JSON wire shapes: Dates serialize to ISO strings, so every timestamp is
 * a string here, not a Date. The web app deliberately does not depend on @thinkspace/domain —
 * these mirror the domain interfaces (packages/domain/src/{channel,thread,unread,directory}.ts,
 * seams/tenant-data-access.ts) by hand to stay decoupled from the zod/Date layer.
 */

export type Visibility = { readonly kind: "shared" } | { readonly kind: "private" };

export type ChannelLifecycle =
  | { readonly state: "active" }
  | { readonly state: "archived"; readonly archivedAt: string }
  | {
      readonly state: "deleted";
      readonly archivedAt: string | null;
      readonly deletedAt: string;
    };

export type ThreadLifecycle =
  | { readonly state: "active" }
  | { readonly state: "archived"; readonly archivedAt: string };

export interface ChannelDirectoryEntry {
  readonly channelId: string;
  readonly goal: string;
  readonly lifecycle: ChannelLifecycle;
  readonly ownerMemberId: string;
  readonly visibility: Visibility;
}

export interface WorkspaceGraph {
  readonly channels: readonly ChannelDirectoryEntry[];
  readonly workspaceId: string;
}

export interface Channel {
  readonly createdAt: string;
  readonly goal: string;
  readonly id: string;
  readonly lifecycle: ChannelLifecycle;
  readonly ownerMemberId: string;
  readonly shapeId: string;
  readonly visibility: Visibility;
  readonly workspaceId: string;
}

export interface Thread {
  readonly channelId: string;
  readonly createdAt: string;
  readonly createdByMemberId: string;
  readonly id: string;
  readonly lastActivityAt: string;
  readonly lifecycle: ThreadLifecycle;
  readonly name: string;
  readonly workspaceId: string;
}

export interface HomeFeed {
  readonly threads: readonly Thread[];
  readonly workspaceId: string;
}

export interface ThreadIndex {
  readonly channelId: string;
  readonly threads: readonly Thread[];
  readonly workspaceId: string;
}

export type UnreadReason =
  | { readonly kind: "agent_output"; readonly commentId: string; readonly runId: string }
  | { readonly kind: "co_participant_activity"; readonly commentId: string };

export interface Unread {
  readonly bumpedAt: string;
  readonly memberId: string;
  readonly reasons: readonly UnreadReason[];
  readonly threadId: string;
  readonly workspaceId: string;
}

/** The edge error envelope (ADR 0035 §7): every non-2xx carries `{ error: { kind } }`. */
export interface ApiError {
  readonly status: number;
  readonly kind: string;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly kind: string;

  constructor({ status, kind }: ApiError) {
    super(`request failed (${status}): ${kind}`);
    this.name = "ApiRequestError";
    this.status = status;
    this.kind = kind;
  }
}

const apiBase = (workspaceId: string) =>
  `${env.VITE_SERVER_URL}/api/w/${encodeURIComponent(workspaceId)}`;

/** Cookie-authenticated fetch against the tenant surface; throws ApiRequestError on non-2xx. */
const apiFetch = async <T>(
  workspaceId: string,
  path: string,
  init?: RequestInit
): Promise<T> => {
  const response = await fetch(`${apiBase(workspaceId)}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { kind?: string };
    } | null;
    throw new ApiRequestError({
      kind: body?.error?.kind ?? "unknown_error",
      status: response.status,
    });
  }
  return (await response.json()) as T;
};

export const fetchWorkspaceGraph = (workspaceId: string) =>
  apiFetch<WorkspaceGraph>(workspaceId, "/graph");

export const fetchHomeFeed = (workspaceId: string) =>
  apiFetch<HomeFeed>(workspaceId, "/home");

export const fetchUnread = (workspaceId: string) =>
  apiFetch<{ unread: readonly Unread[] }>(workspaceId, "/unread");

export const fetchChannel = (workspaceId: string, channelId: string) =>
  apiFetch<Channel>(workspaceId, `/channels/${encodeURIComponent(channelId)}`);

export const fetchChannelThreads = (workspaceId: string, channelId: string) =>
  apiFetch<ThreadIndex>(
    workspaceId,
    `/channels/${encodeURIComponent(channelId)}/threads`
  );

/**
 * Channel creation is a convergent upsert (PUT /channels/:channelId, ADR 0034): the client
 * mints both the channelId and the shapeId so a replay lands the same channel-plus-shape pair.
 * The channel is born with its shape (ADR 0030 strict 1:1); a full shape needs a model picker
 * (sibling #29), so the shell ships a minimal default structure — see DEFAULT_SHAPE below.
 */
export interface CreateChannelInput {
  readonly channelId: string;
  readonly goal: string;
  readonly shapeId: string;
  readonly shape: ShapeStructure;
  readonly visibility?: Visibility;
}

export interface ShapeStructure {
  readonly artifactSelection: readonly string[];
  readonly mcpServerSelection: readonly string[];
  readonly modelId: string;
  readonly skillSelection: readonly string[];
  readonly systemPrompt: string;
  readonly toolSelection: readonly string[];
}

export const createChannel = (workspaceId: string, input: CreateChannelInput) =>
  apiFetch<Channel>(
    workspaceId,
    `/channels/${encodeURIComponent(input.channelId)}`,
    {
      body: JSON.stringify({
        goal: input.goal,
        shape: input.shape,
        shapeId: input.shapeId,
        ...(input.visibility ? { visibility: input.visibility } : {}),
      }),
      method: "PUT",
    }
  );

export const archiveChannel = (workspaceId: string, channelId: string) =>
  apiFetch<Channel>(
    workspaceId,
    `/channels/${encodeURIComponent(channelId)}/archive`,
    { method: "POST" }
  );
