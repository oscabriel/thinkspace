import { createNotImplementedError } from "../errors";
import type { ChannelId, CommentId, ThreadId } from "../ids";
import type { CommentBody } from "../primitives";
import { err, ok } from "../result";
import type { AsyncResult } from "../result";
import type { RealtimeHubError, WorkspaceHub } from "../seams/realtime-hubs";
import type {
  TenantDataAccess,
  TenantDataAccessError,
} from "../seams/tenant-data-access";
import type {
  ThreadAgentDirectory,
  ThreadAgentError,
} from "../seams/thread-agent";
import type { ShapeSnapshot } from "../shape";
import { deriveOpeningExcerpt, deriveThreadName } from "../thread";
import type { Comment, Thread } from "../thread";
import { channelWriteGate } from "./channel-gate";

export type ThreadCreationFlowError =
  | RealtimeHubError
  | TenantDataAccessError
  | ThreadAgentError;

/**
 * Both ids are edge-minted per creation gesture (ADR 0034 §2): threadId is the
 * idempotency key, and a replay must carry the same pair for the flow to converge.
 */
export interface ThreadCreationRequest {
  readonly channelId: ChannelId;
  readonly openingBody: CommentBody;
  readonly openingCommentId: CommentId;
  readonly threadId: ThreadId;
}

export interface ThreadCreation {
  readonly openingComment: Comment;
  readonly shapeSnapshot: ShapeSnapshot;
  readonly thread: Thread;
}

export interface ThreadCreationFlowDependencies {
  readonly clock: () => Date;
  readonly tenantDataAccess: TenantDataAccess;
  readonly threadAgents: ThreadAgentDirectory;
  readonly workspaceHub: WorkspaceHub;
}

/**
 * The creation half of a thread's lifecycle (ADR 0034): D1 index row first
 * (insert-if-absent), agent initialize second (first-write-wins), workspace bump last —
 * every write is convergent, so recovery from any crash is replaying the same gesture.
 * Creation does not dispatch (ADR 0017); the edge chains DispatchFlow when the gesture
 * is "create and ask".
 */
export interface ThreadCreationFlow {
  readonly create: (
    input: ThreadCreationRequest
  ) => AsyncResult<ThreadCreation, ThreadCreationFlowError>;
}

export const createThreadCreationFlow = (
  deps: ThreadCreationFlowDependencies
): ThreadCreationFlow => ({
  create: async (input) => {
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

    const shapeLoaded = await deps.tenantDataAccess.getShape({
      shapeId: channel.shapeId,
    });
    if (!shapeLoaded.ok) {
      return shapeLoaded;
    }

    const shape = shapeLoaded.value;
    if (shape === null) {
      return err(
        createNotImplementedError("ThreadCreationFlow.missingShapeRow")
      );
    }

    const createdAt = deps.clock();

    const thread: Thread = {
      channelId: channel.id,
      commentCount: 1,
      createdAt,
      createdByMemberId: context.memberId,
      id: input.threadId,
      lastActivityAt: createdAt,
      lifecycle: { state: "active" },
      name: deriveThreadName(input.openingBody),
      openingExcerpt: deriveOpeningExcerpt(input.openingBody),
      // E8.4: the opening comment is the branch anchor a threadId-only surface reads back.
      rootCommentId: input.openingCommentId,
      working: null,
      workspaceId: context.workspaceId,
    };

    const openingComment: Comment = {
      author: { kind: "member", memberId: context.memberId },
      body: input.openingBody,
      createdAt,
      id: input.openingCommentId,
      parent: { kind: "top_level" },
      threadId: input.threadId,
      workspaceId: context.workspaceId,
    };

    const shapeSnapshot: ShapeSnapshot = {
      shapeId: shape.id,
      snapshottedAt: createdAt,
      structure: shape.structure,
    };

    const written = await deps.tenantDataAccess.batch({
      commands: [{ kind: "create_thread_index", thread }],
      workspaceId: context.workspaceId,
    });
    if (!written.ok) {
      return written;
    }

    const agent = deps.threadAgents.get({
      channelId: channel.id,
      threadId: input.threadId,
      workspaceId: context.workspaceId,
    });

    const initialized = await agent.initialize({
      openingComment,
      shapeSnapshot,
    });
    if (!initialized.ok) {
      return initialized;
    }

    const announced = await deps.workspaceHub.publishActivity({
      bumpedAt: thread.lastActivityAt,
      channelId: channel.id,
      kind: "thread_bumped",
      threadId: thread.id,
    });
    if (!announced.ok) {
      return announced;
    }

    return ok({
      openingComment,
      // The resident snapshot: on a replay this is the original, not a re-mint (§2).
      shapeSnapshot: initialized.value.shapeSnapshot,
      thread,
    });
  },
});
