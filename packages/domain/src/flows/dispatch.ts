import { createNotImplementedError } from "../errors";
import type { ChannelId, CommentId, GestureId, ThreadId } from "../ids";
import { err } from "../result";
import type { AsyncResult } from "../result";
import type { RunTrigger } from "../run";
import type { ModelRoutingError, ModelRouter } from "../seams/model-routing";
import type { ChannelHub, RealtimeHubError } from "../seams/realtime-hubs";
import type {
  TenantDataAccess,
  TenantDataAccessError,
} from "../seams/tenant-data-access";
import type {
  ThreadAgentDirectory,
  ThreadAgentError,
  ThreadAgentRunReceipt,
} from "../seams/thread-agent";
import type {
  McpEgressPolicy,
  ToolResolutionError,
  ToolResolver,
} from "../seams/tool-resolution";
import { channelWriteGate } from "./channel-gate";

export type DispatchFlowError =
  | ModelRoutingError
  | RealtimeHubError
  | TenantDataAccessError
  | ThreadAgentError
  | ToolResolutionError;

export interface DispatchRequest {
  readonly channelId: ChannelId;
  /** The client-minted idempotency key; a replay carrying it converges (E5.3). */
  readonly gestureId: GestureId;
  readonly targetCommentId: CommentId;
  readonly threadId: ThreadId;
}

export interface DispatchFlowDependencies {
  readonly channelHub: ChannelHub;
  readonly mcpEgressPolicy: McpEgressPolicy;
  readonly modelRouter: ModelRouter;
  readonly tenantDataAccess: TenantDataAccess;
  readonly threadAgents: ThreadAgentDirectory;
  readonly toolResolver: ToolResolver;
}

/** The dispatch spine (ADR 0017): the only human-initiated way to trigger a Run. */
export interface DispatchFlow {
  readonly dispatch: (
    input: DispatchRequest
  ) => AsyncResult<ThreadAgentRunReceipt, DispatchFlowError>;
}

export const createDispatchFlow = (
  deps: DispatchFlowDependencies
): DispatchFlow => ({
  dispatch: async (input) => {
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
      return err(createNotImplementedError("DispatchFlow.missingShapeRow"));
    }

    const toolset = await deps.toolResolver.resolve({
      artifactAccessScope: {
        artifactIds: shape.structure.artifactSelection,
        homeChannelArtifactIds: [],
        kind: "shape_artifact_selection",
      },
      beforeTurnAdditions: { addedToolIds: [], kind: "additive_tools_only" },
      runtimeNarrowing: {
        activeToolIds: shape.structure.toolSelection,
        kind: "active_tools_allowlist",
      },
      shape: shape.structure,
    });
    if (!toolset.ok) {
      return toolset;
    }

    const egressResults = await Promise.all(
      toolset.value.mcpServers.map((server) =>
        deps.mcpEgressPolicy.authorize({
          host: server.host,
          mcpServerId: server.id,
        })
      )
    );
    for (const egress of egressResults) {
      if (!egress.ok) {
        return egress;
      }
    }

    const route = await deps.modelRouter.resolve({
      modelId: shape.structure.modelId,
    });
    if (!route.ok) {
      return route;
    }

    const agent = deps.threadAgents.get({
      channelId: input.channelId,
      threadId: input.threadId,
      workspaceId: context.workspaceId,
    });

    const trigger: RunTrigger = {
      dispatch: {
        byMemberId: context.memberId,
        gestureId: input.gestureId,
        targetCommentId: input.targetCommentId,
      },
      kind: "dispatch",
    };

    const receipt = await agent.run(trigger);
    if (!receipt.ok) {
      return receipt;
    }

    const published = await deps.channelHub.publishEvent({
      kind: "run_lifecycle_changed",
      runId: receipt.value.runId,
      threadId: receipt.value.threadId,
    });
    if (!published.ok) {
      return published;
    }

    return receipt;
  },
});
