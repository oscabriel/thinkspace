import type { Channel, Visibility } from "../channel";
import type { AuthzError, ChannelNotArchivedError } from "../errors";
import { createNotImplementedError } from "../errors";
import type { ChannelId, ShapeId } from "../ids";
import type { Goal } from "../primitives";
import { err, ok } from "../result";
import type { AsyncResult } from "../result";
import type { ModelRoutingError, ModelRouter } from "../seams/model-routing";
import type {
  TenantDataAccess,
  TenantDataAccessError,
} from "../seams/tenant-data-access";
import type {
  ThreadAgentDirectory,
  ThreadAgentError,
  ThreadAgentSnapshot,
} from "../seams/thread-agent";
import type { Shape, ShapeSnapshot, ShapeStructure } from "../shape";
import { channelAdminGate, channelWriteGate } from "./channel-gate";

export type ChannelCrudFlowError =
  | AuthzError
  | ChannelNotArchivedError
  | ModelRoutingError
  | TenantDataAccessError
  | ThreadAgentError;

/**
 * Both ids are edge-minted per creation gesture (ADR 0035): a replay carries the same
 * channelId/shapeId and converges on the same channel-plus-shape pair.
 */
export interface ChannelCreationRequest {
  readonly channelId: ChannelId;
  readonly goal: Goal;
  readonly shapeId: ShapeId;
  readonly structure: ShapeStructure;
  /** ADR 0019: shared to the workspace by default; private is the owner-only escape hatch. */
  readonly visibility?: Visibility;
}

export interface ChannelCreation {
  readonly channel: Channel;
  readonly shape: Shape;
}

export interface ShapeEditRequest {
  readonly channelId: ChannelId;
  readonly structure: ShapeStructure;
}

export interface ShapeEdit {
  /** One receipt per thread the edit re-snapshotted (ADR 0007 explicit update). */
  readonly resnapshots: readonly ThreadAgentSnapshot[];
  readonly shape: Shape;
}

export interface ChannelLifecycleRequest {
  readonly channelId: ChannelId;
}

export interface ChannelLifecycleResult {
  readonly channel: Channel;
}

export interface ChannelCrudFlowDependencies {
  readonly clock: () => Date;
  readonly modelRouter: ModelRouter;
  readonly tenantDataAccess: TenantDataAccess;
  readonly threadAgents: ThreadAgentDirectory;
}

/**
 * Channel + shape CRUD (E5.2; ADR 0018 lifecycle, 0019 ACL, 0007/0030 shape 1:1). A channel
 * is born with its own shape (strict 1:1, channel-owned) in a single batch; shape edits are
 * gated to owner + admins and propagate to the channel's live thread agents via resnapshot;
 * archive/delete follow the archive-first lifecycle. Every write is convergent, so a replayed
 * gesture heals rather than duplicates.
 */
export interface ChannelCrudFlow {
  readonly archiveChannel: (
    input: ChannelLifecycleRequest
  ) => AsyncResult<ChannelLifecycleResult, ChannelCrudFlowError>;
  readonly createChannel: (
    input: ChannelCreationRequest
  ) => AsyncResult<ChannelCreation, ChannelCrudFlowError>;
  readonly deleteChannel: (
    input: ChannelLifecycleRequest
  ) => AsyncResult<ChannelLifecycleResult, ChannelCrudFlowError>;
  readonly editShape: (
    input: ShapeEditRequest
  ) => AsyncResult<ShapeEdit, ChannelCrudFlowError>;
}

export const createChannelCrudFlow = (
  deps: ChannelCrudFlowDependencies
): ChannelCrudFlow => {
  const { context } = deps.tenantDataAccess;

  /**
   * The shape's model must be usable by this workspace before the shape is written or
   * dispatched (ADR 0011/0036). `resolve` is the fail-fast BYOK gate over the same live
   * catalog ∩ keyed-providers set `listAvailableModels` exposes, but with the precise
   * byok_key_missing / model_not_in_catalog discrimination the edge maps to 409.
   */
  const validateModel = async (
    structure: ShapeStructure
  ): AsyncResult<null, ModelRoutingError> => {
    const route = await deps.modelRouter.resolve({
      modelId: structure.modelId,
    });
    return route.ok ? ok(null) : route;
  };

  const loadVisibleChannel = async (
    channelId: ChannelId
  ): AsyncResult<Channel, ChannelCrudFlowError> => {
    const loaded = await deps.tenantDataAccess.getChannel({ channelId });
    if (!loaded.ok) {
      return loaded;
    }
    if (loaded.value === null) {
      return err({
        channelId,
        kind: "channel_not_visible",
        memberId: context.memberId,
      });
    }
    return ok(loaded.value);
  };

  return {
    archiveChannel: async (input) => {
      const channelLoaded = await loadVisibleChannel(input.channelId);
      if (!channelLoaded.ok) {
        return channelLoaded;
      }
      const channel = channelLoaded.value;

      const adminGate = channelAdminGate(context, channel);
      if (adminGate !== null) {
        return err(adminGate);
      }

      if (channel.lifecycle.state === "deleted") {
        return err({ channelId: channel.id, kind: "channel_deleted" });
      }
      // Idempotent: re-archiving an archived channel returns it unchanged (ADR 0018).
      if (channel.lifecycle.state === "archived") {
        return ok({ channel });
      }

      const archived: Channel = {
        ...channel,
        lifecycle: { archivedAt: deps.clock(), state: "archived" },
      };
      const written = await deps.tenantDataAccess.batch({
        commands: [{ channel: archived, kind: "put_channel" }],
        workspaceId: context.workspaceId,
      });
      if (!written.ok) {
        return written;
      }

      return ok({ channel: archived });
    },

    createChannel: async (input) => {
      const validated = await validateModel(input.structure);
      if (!validated.ok) {
        return validated;
      }

      const createdAt = deps.clock();
      const shape: Shape = {
        clonedFrom: null,
        createdAt,
        id: input.shapeId,
        structure: input.structure,
        updatedAt: createdAt,
        workspaceId: context.workspaceId,
      };
      const channel: Channel = {
        createdAt,
        goal: input.goal,
        id: input.channelId,
        lifecycle: { state: "active" },
        ownerMemberId: context.memberId,
        shapeId: input.shapeId,
        visibility: input.visibility ?? { kind: "shared" },
        workspaceId: context.workspaceId,
      };

      // Strict 1:1 (ADR 0030): the shape and its one channel are written in the same batch,
      // so the ownership invariant admits the shape row alongside its referencing channel.
      const written = await deps.tenantDataAccess.batch({
        commands: [
          { kind: "put_shape", shape },
          { channel, kind: "put_channel" },
        ],
        workspaceId: context.workspaceId,
      });
      if (!written.ok) {
        return written;
      }

      return ok({ channel, shape });
    },

    deleteChannel: async (input) => {
      const channelLoaded = await loadVisibleChannel(input.channelId);
      if (!channelLoaded.ok) {
        return channelLoaded;
      }
      const channel = channelLoaded.value;

      const adminGate = channelAdminGate(context, channel);
      if (adminGate !== null) {
        return err(adminGate);
      }

      // Idempotent: a replayed delete of an already-deleted channel converges (ADR 0018).
      if (channel.lifecycle.state === "deleted") {
        return ok({ channel });
      }
      // Archive-first (ADR 0018): hard-delete is only reachable from the archived state.
      if (channel.lifecycle.state === "active") {
        return err({ channelId: channel.id, kind: "channel_not_archived" });
      }

      const deleted: Channel = {
        ...channel,
        lifecycle: {
          archivedAt: channel.lifecycle.archivedAt,
          deletedAt: deps.clock(),
          state: "deleted",
        },
      };
      const written = await deps.tenantDataAccess.batch({
        commands: [{ channel: deleted, kind: "put_channel" }],
        workspaceId: context.workspaceId,
      });
      if (!written.ok) {
        return written;
      }

      return ok({ channel: deleted });
    },

    editShape: async (input) => {
      const channelLoaded = await loadVisibleChannel(input.channelId);
      if (!channelLoaded.ok) {
        return channelLoaded;
      }
      const channel = channelLoaded.value;

      // Visibility + lifecycle (an archived channel is read-only) then owner/admin role.
      const writeGate = channelWriteGate(context, channel);
      if (writeGate !== null) {
        return err(writeGate);
      }
      const adminGate = channelAdminGate(context, channel);
      if (adminGate !== null) {
        return err(adminGate);
      }

      const validated = await validateModel(input.structure);
      if (!validated.ok) {
        return validated;
      }

      const shapeLoaded = await deps.tenantDataAccess.getShape({
        shapeId: channel.shapeId,
      });
      if (!shapeLoaded.ok) {
        return shapeLoaded;
      }
      if (shapeLoaded.value === null) {
        return err(
          createNotImplementedError("ChannelCrudFlow.missingShapeRow")
        );
      }

      const updatedAt = deps.clock();
      const shape: Shape = {
        ...shapeLoaded.value,
        structure: input.structure,
        updatedAt,
      };

      // D1 is the source of truth; write it first, then propagate to the live thread DOs.
      const written = await deps.tenantDataAccess.batch({
        commands: [{ kind: "put_shape", shape }],
        workspaceId: context.workspaceId,
      });
      if (!written.ok) {
        return written;
      }

      /**
       * ADR 0007 explicit-update: each existing thread agent snapshotted the shape at
       * creation, so on edit we push the new structural snapshot to every thread DO. Each
       * resnapshot is an idempotent slot upsert, so a partial-failure replay re-writes the
       * same shape and re-propagates without duplication.
       */
      const threadIndex = await deps.tenantDataAccess.listChannelThreads({
        channelId: channel.id,
      });
      if (!threadIndex.ok) {
        return threadIndex;
      }

      const snapshot: ShapeSnapshot = {
        shapeId: shape.id,
        snapshottedAt: updatedAt,
        structure: input.structure,
      };

      const resnapshots: ThreadAgentSnapshot[] = [];
      for (const thread of threadIndex.value.threads) {
        const agent = deps.threadAgents.get({
          channelId: channel.id,
          threadId: thread.id,
          workspaceId: context.workspaceId,
        });
        const resnapshotted = await agent.resnapshot({
          shapeSnapshot: snapshot,
        });
        if (!resnapshotted.ok) {
          return resnapshotted;
        }
        resnapshots.push(resnapshotted.value);
      }

      return ok({ resnapshots, shape });
    },
  };
};
