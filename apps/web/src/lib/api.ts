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
 * A model the workspace may author into a shape: the live models.dev catalog ∩ the providers the
 * workspace has keyed (ADR 0011 key-first, ADR 0036 BYOK gate), served by GET /models. Mirrors
 * the domain `Model` (packages/domain/src/model.ts) by hand — `releaseDate` is the ISO date
 * string it serializes to. An empty list means no provider key is registered yet.
 */
export interface ModelCost {
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly input: number;
  readonly output: number;
}

export interface ModelLimits {
  readonly context: number;
  readonly output: number;
}

export interface ModelCapabilities {
  readonly attachment: boolean;
  readonly reasoning: boolean;
  readonly structuredOutput: boolean;
  readonly toolCall: boolean;
}

export interface Model {
  readonly capabilities: ModelCapabilities;
  readonly cost: ModelCost;
  readonly displayName: string;
  readonly id: string;
  readonly limits: ModelLimits;
  readonly provider: string;
  readonly releaseDate: string;
}

export const fetchModels = (workspaceId: string) =>
  apiFetch<{ models: readonly Model[] }>(workspaceId, "/models");

/**
 * Channel creation is a convergent upsert (PUT /channels/:channelId, ADR 0034): the client
 * mints both the channelId and the shapeId so a replay lands the same channel-plus-shape pair.
 * The channel is born with its authored shape (ADR 0030 strict 1:1) — the member picks the model
 * and writes the system prompt at birth (E7.5), so there is no default structure any more.
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
  // The wire response is the flow's ChannelCreation envelope, not a bare Channel.
  apiFetch<{ channel: Channel; shape: Shape }>(
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

/**
 * BYOK key-status (E7.2, ADR 0011 key-first). GET /providers is the read half of the provider-key
 * surface: it returns which providers this workspace has keyed and when — registry facts only,
 * NEVER key material (the raw key lives solely in Cloudflare Secrets Store and never transits a
 * read). A provider absent from this list has no key and cannot run an agent; a present provider
 * opens the byok gate (ADR 0036). Any member may read this status.
 */
export interface ProviderKeyStatus {
  readonly createdAt: string;
  readonly provider: string;
}

export const fetchProviders = (workspaceId: string) =>
  apiFetch<{ providers: readonly ProviderKeyStatus[] }>(
    workspaceId,
    "/providers"
  );

/**
 * Register a workspace's raw provider key. Owner/admin only — a member is rejected with
 * `insufficient_role` (403). The key is sent exactly once, in this POST body, and is never
 * echoed back: the response carries only the provider id. Callers must clear the input after a
 * successful submit — the raw key must not linger in component state.
 */
export const registerProviderKey = (
  workspaceId: string,
  provider: string,
  key: string
) =>
  apiFetch<{ provider: string }>(
    workspaceId,
    `/providers/${encodeURIComponent(provider)}/key`,
    { body: JSON.stringify({ key }), method: "POST" }
  );

/** Revoke a workspace's provider key (owner/admin only). Idempotent server-side. */
export const removeProviderKey = (workspaceId: string, provider: string) =>
  apiFetch<{ provider: string }>(
    workspaceId,
    `/providers/${encodeURIComponent(provider)}/key`,
    { method: "DELETE" }
  );

/* ── E7.4 thread surface ─────────────────────────────────────────────────────
 * The thread interior: the branch read (ADR 0025 ancestors + subtree), the two write
 * gestures (PUT create / POST dispatch, both idempotent on client-minted ids), unread
 * clearing (ADR 0027), and the short-lived hub-connect token (baked decision 5). Mirrors
 * packages/domain/src/{thread,run}.ts and seams/thread-agent.ts by hand — Dates are ISO
 * strings on the wire. */

export type CommentAuthor =
  | { readonly kind: "member"; readonly memberId: string }
  | {
      readonly channelId: string;
      readonly facet:
        | { readonly kind: "channel_agent" }
        | {
            readonly kind: "sub_agent";
            readonly name: string;
            readonly runId: string;
          };
      readonly kind: "agent";
    };

export type CommentParent =
  | { readonly kind: "top_level" }
  | { readonly kind: "nested"; readonly parentCommentId: string };

export interface Comment {
  readonly author: CommentAuthor;
  readonly body: string;
  readonly createdAt: string;
  readonly id: string;
  readonly parent: CommentParent;
  readonly threadId: string;
  readonly workspaceId: string;
}

/** ADR 0025: the dispatch context slice — ancestor path (oldest first) + the branch subtree. */
export interface BranchSnapshot {
  readonly ancestors: readonly Comment[];
  readonly branch: { readonly rootCommentId: string; readonly threadId: string };
  readonly subtree: readonly Comment[];
}

/** The dispatch receipt (ThreadAgentRunReceipt): a queued run the client can render at once. */
export interface RunReceipt {
  readonly queuedRun: {
    readonly channelId: string;
    readonly id: string;
    readonly lifecycle: "queued";
    readonly queuedAt: string;
    readonly threadId: string;
    readonly workspaceId: string;
  };
  readonly runId: string;
  readonly threadId: string;
}

/** The creation receipt; `run` is present only when the gesture was "create and ask". */
export interface ThreadCreationReceipt {
  readonly openingComment: Comment;
  readonly run?: RunReceipt;
  readonly thread: Thread;
}

export const fetchBranch = (
  workspaceId: string,
  input: {
    readonly channelId: string;
    readonly rootCommentId: string;
    readonly threadId: string;
  }
) =>
  apiFetch<BranchSnapshot>(
    workspaceId,
    `/channels/${encodeURIComponent(input.channelId)}/threads/${encodeURIComponent(
      input.threadId
    )}/branches/${encodeURIComponent(input.rootCommentId)}`
  );

/**
 * PUT create-and-ask (ADR 0034 §6): mints the opening comment and, when `askGestureId` is
 * given, chains a dispatch at it. The client mints threadId, openingCommentId and the gesture
 * id; a replay of the same ids converges on the same thread-plus-run receipt.
 */
export const createThread = (
  workspaceId: string,
  input: {
    readonly askGestureId?: string;
    readonly channelId: string;
    readonly openingBody: string;
    readonly openingCommentId: string;
    readonly threadId: string;
  }
) =>
  apiFetch<ThreadCreationReceipt>(
    workspaceId,
    `/channels/${encodeURIComponent(input.channelId)}/threads/${encodeURIComponent(
      input.threadId
    )}`,
    {
      body: JSON.stringify({
        openingBody: input.openingBody,
        openingCommentId: input.openingCommentId,
        ...(input.askGestureId
          ? { ask: { gestureId: input.askGestureId } }
          : {}),
      }),
      method: "PUT",
    }
  );

/** POST dispatch: re-run the channel agent at an existing target comment (baked decision 8). */
export const dispatchThread = (
  workspaceId: string,
  input: {
    readonly channelId: string;
    readonly gestureId: string;
    readonly targetCommentId: string;
    readonly threadId: string;
  }
) =>
  apiFetch<RunReceipt>(
    workspaceId,
    `/channels/${encodeURIComponent(input.channelId)}/threads/${encodeURIComponent(
      input.threadId
    )}/dispatch`,
    {
      body: JSON.stringify({
        gestureId: input.gestureId,
        targetCommentId: input.targetCommentId,
      }),
      method: "POST",
    }
  );

/** ADR 0027: clear the acting member's unread for a thread when they open it. */
export const clearThreadUnread = (workspaceId: string, threadId: string) =>
  apiFetch<{ ok: true }>(
    workspaceId,
    `/threads/${encodeURIComponent(threadId)}/read`,
    { method: "POST" }
  );

/** Baked decision 5: the short-lived hub-connect JWT the WS client rides in `?token=`. */
export const fetchHubToken = (workspaceId: string) =>
  apiFetch<{ token: string }>(workspaceId, "/token");


/**
 * A channel's live shape (GET /channels/:channelId/shape) — the edit form's prefill source so an
 * owner re-authors from real values rather than blanking the config. Only `structure` is used by
 * the form; the ids/timestamps ride along for completeness (Dates serialize to ISO strings).
 */
export interface Shape {
  readonly createdAt: string;
  readonly id: string;
  readonly structure: ShapeStructure;
  readonly updatedAt: string;
  readonly workspaceId: string;
}

export const fetchChannelShape = (workspaceId: string, channelId: string) =>
  apiFetch<Shape>(
    workspaceId,
    `/channels/${encodeURIComponent(channelId)}/shape`
  );

/**
 * Edit a channel's shape (PUT /channels/:channelId/shape, owner/admin only). The server
 * re-validates the model against the BYOK gate + live catalog and resnapshots the channel's live
 * threads (ADR 0007 explicit update). Surfaces 403 insufficient_role and 409
 * byok_key_missing / model_not_in_catalog verbatim for teaching copy.
 */
export const editChannelShape = (
  workspaceId: string,
  channelId: string,
  shape: ShapeStructure
) =>
  apiFetch<Channel>(
    workspaceId,
    `/channels/${encodeURIComponent(channelId)}/shape`,
    { body: JSON.stringify({ shape }), method: "PUT" }
  );


/**
 * The Library read surface (E7.6, apps/server/src/artifacts.ts) mirroring
 * packages/domain/src/artifact.ts over the wire. Artifacts are agent-authored (or member
 * uploads), versioned append-only with a head pointer (ADR 0032); the list/detail reads see
 * the head projection while the version history exposes superseded versions newest-first.
 * `mediaKind` drives search on the server (ADR 0024); the browser keys rendering off
 * `contentType` under ADR 0031's trust boundary. Dates serialize to ISO strings, as everywhere.
 */
export type ArtifactMediaKind =
  | { readonly kind: "text_extractable" }
  | { readonly kind: "binary" };

export type ArtifactOrigin =
  | { readonly kind: "agent"; readonly runId: string; readonly threadId: string }
  | {
      readonly kind: "member_upload";
      readonly threadId: string | null;
      readonly uploadedByMemberId: string;
    };

/** One immutable version's bytes-metadata + provenance (ADR 0032). */
export interface ArtifactVersion {
  readonly artifactId: string;
  readonly byteLength: number;
  readonly contentType: string;
  readonly createdAt: string;
  readonly id: string;
  readonly mediaKind: ArtifactMediaKind;
  readonly origin: ArtifactOrigin;
  readonly r2Key: string;
  readonly workspaceId: string;
}

/** The stable artifact identity projected over its head version (ADR 0032). */
export interface Artifact {
  readonly byteLength: number;
  readonly contentType: string;
  readonly createdAt: string;
  readonly headVersionId: string;
  readonly homeChannelId: string;
  readonly id: string;
  readonly mediaKind: ArtifactMediaKind;
  readonly name: string;
  readonly origin: ArtifactOrigin;
  readonly r2Key: string;
  readonly updatedAt: string;
  readonly workspaceId: string;
}

export interface ArtifactDetail {
  readonly artifact: Artifact;
  readonly versions: readonly ArtifactVersion[];
}

export const fetchArtifacts = (workspaceId: string) =>
  apiFetch<{ artifacts: readonly Artifact[] }>(workspaceId, "/artifacts");

export const fetchArtifact = (workspaceId: string, artifactId: string) =>
  apiFetch<ArtifactDetail>(
    workspaceId,
    `/artifacts/${encodeURIComponent(artifactId)}`
  );

/**
 * A pinned version's raw bytes. The server serves these with `Content-Security-Policy:
 * sandbox` + `nosniff` (ADR 0031) so agent-authored content stays inert. The browser fetches
 * the bytes as a Blob (cookie-authed, same as every read) and renders from an object URL,
 * which keeps auth identical to the JSON reads and avoids a cross-origin cookie dependency on
 * <img>/navigation loads. Throws ApiRequestError on non-2xx, mirroring apiFetch.
 */
export const fetchArtifactVersionContent = async (
  workspaceId: string,
  artifactId: string,
  versionId: string
): Promise<Blob> => {
  const response = await fetch(
    `${apiBase(workspaceId)}/artifacts/${encodeURIComponent(
      artifactId
    )}/versions/${encodeURIComponent(versionId)}/content`,
    { credentials: "include" }
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { kind?: string };
    } | null;
    throw new ApiRequestError({
      kind: body?.error?.kind ?? "unknown_error",
      status: response.status,
    });
  }
  return await response.blob();
};
