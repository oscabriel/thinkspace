import { createNotImplementedError } from "../errors";
import type { ChannelId, CommentId, GestureId, ThreadId } from "../ids";
import type { CommentBody } from "../primitives";
import { err, ok } from "../result";
import type { AsyncResult } from "../result";
import type { ChannelHub, RealtimeHubError } from "../seams/realtime-hubs";
import type { WorkspaceHub } from "../seams/realtime-hubs";
import type {
  TenantDataAccess,
  TenantDataAccessError,
  TenantWriteCommand,
} from "../seams/tenant-data-access";
import type {
  ThreadAgentDirectory,
  ThreadAgentError,
} from "../seams/thread-agent";
import type { Comment } from "../thread";
import { channelWriteGate } from "./channel-gate";

export type CommentAppendFlowError =
  | RealtimeHubError
  | TenantDataAccessError
  | ThreadAgentError;

/**
 * A member's mid-thread reply (E8.4). commentId is edge-minted per gesture and is the
 * idempotency key: a replay carries the same commentId, so the DO's insert converges on the
 * one comment and the bump/unread/hub fan-out re-runs idempotently (upsert index + unread).
 * gestureId rides the wire for uniform gesture telemetry; convergence keys on commentId.
 */
export interface CommentAppendRequest {
  readonly body: CommentBody;
  readonly channelId: ChannelId;
  readonly commentId: CommentId;
  readonly gestureId: GestureId;
  readonly parentCommentId: CommentId;
  readonly threadId: ThreadId;
}

export interface CommentAppendFlowDependencies {
  readonly channelHub: ChannelHub;
  readonly clock: () => Date;
  readonly tenantDataAccess: TenantDataAccess;
  readonly threadAgents: ThreadAgentDirectory;
  readonly workspaceHub: WorkspaceHub;
}

/**
 * The member-append spine (E8.4): append a reply into the thread's resident tree, then fan
 * the same deltas a run settlement does (bump + unread + hub events). Mirrors DispatchFlow's
 * structure — gate the channel, act on the DO, announce — but appends without triggering a Run.
 */
export interface CommentAppendFlow {
  readonly append: (
    input: CommentAppendRequest
  ) => AsyncResult<Comment, CommentAppendFlowError>;
}

export const createCommentAppendFlow = (
  deps: CommentAppendFlowDependencies
): CommentAppendFlow => ({
  append: async (input) => {
    const { context } = deps.tenantDataAccess;

    const loaded = await deps.tenantDataAccess.getChannel({
      channelId: input.channelId,
    });
    if (!loaded.ok) {
      return loaded;
    }

    const channel = loaded.value;
    if (channel === null) {
      return err({
        channelId: input.channelId,
        kind: "channel_not_visible",
        memberId: context.memberId,
      });
    }

    const gateError = channelWriteGate(context, channel);
    if (gateError !== null) {
      return err(gateError);
    }

    const createdAt = deps.clock();
    const comment: Comment = {
      author: { kind: "member", memberId: context.memberId },
      body: input.body,
      createdAt,
      id: input.commentId,
      parent: { kind: "nested", parentCommentId: input.parentCommentId },
      threadId: input.threadId,
      workspaceId: context.workspaceId,
    };

    const agent = deps.threadAgents.get({
      channelId: channel.id,
      threadId: input.threadId,
      workspaceId: context.workspaceId,
    });

    const appended = await agent.appendComment({ comment });
    if (!appended.ok) {
      return appended;
    }

    // First-write-wins convergence: the DO returns the ORIGINAL comment on a replayed
    // commentId, so every downstream timestamp (bump, unread, hub) derives from it and a
    // retry re-fans-out the same instants instead of re-bumping the thread to "now".
    const landed = appended.value.comment;

    // The bump reads the D1 index row and rewrites its lastActivityAt, exactly as run
    // settlement does — participants (minus the author, who just posted) get a
    // co-participant unread. The whole bump is one atomic batch (ADR 0027).
    const indexLoaded = await deps.tenantDataAccess.getThread({
      threadId: input.threadId,
    });
    if (!indexLoaded.ok) {
      return indexLoaded;
    }

    const thread = indexLoaded.value;
    if (thread === null) {
      return err(
        createNotImplementedError("CommentAppendFlow.missingThreadIndexRow")
      );
    }

    const unreadWrites = appended.value.participants
      .filter((participant) => participant !== context.memberId)
      .map(
        (participant): TenantWriteCommand => ({
          kind: "put_unread",
          unread: {
            bumpedAt: landed.createdAt,
            memberId: participant,
            reasons: [
              { commentId: landed.id, kind: "co_participant_activity" },
            ],
            threadId: input.threadId,
            workspaceId: context.workspaceId,
          },
        })
      );

    const written = await deps.tenantDataAccess.batch({
      commands: [
        {
          kind: "put_thread_index",
          thread: { ...thread, lastActivityAt: landed.createdAt },
        },
        {
          kind: "update_thread_summary",
          summary: appended.value.summary,
          threadId: input.threadId,
        },
        ...unreadWrites,
      ],
      workspaceId: context.workspaceId,
    });
    if (!written.ok) {
      return written;
    }

    const commentAnnounced = await deps.channelHub.publishEvent({
      authorKind: "member",
      commentId: landed.id,
      kind: "comment_added",
      threadId: input.threadId,
    });
    if (!commentAnnounced.ok) {
      return commentAnnounced;
    }

    const bumpAnnounced = await deps.workspaceHub.publishActivity({
      bumpedAt: landed.createdAt,
      channelId: channel.id,
      kind: "thread_bumped",
      threadId: input.threadId,
    });
    if (!bumpAnnounced.ok) {
      return bumpAnnounced;
    }

    return ok(landed);
  },
});
