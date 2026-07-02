import type { Artifact } from "../../artifact";
import type { Channel, ChannelFavorite } from "../../channel";
import type { ChannelDirectoryEntry } from "../../directory";
import type { ShapeOwnershipViolationError } from "../../errors";
import type { ChannelId } from "../../ids";
import type { McpHostApproval, McpServer } from "../../mcp";
import { err, ok } from "../../result";
import type { Schedule } from "../../run";
import type {
  ChannelListingRequest,
  TenantContext,
  TenantDataAccess,
  TenantDataAccessError,
  TenantWriteCommand,
  TenantWriteReceipt,
} from "../../seams/tenant-data-access";
import type { Shape } from "../../shape";
import type { Skill } from "../../skill";
import type { Thread } from "../../thread";
import type { WorkspaceToolDisable } from "../../tool";
import type { Unread } from "../../unread";
import type { Member, Workspace } from "../../workspace";
import {
  hasSameId,
  idKey,
  isInTenant,
  tenantGuardViolation,
  type TenantScoped,
} from "./helpers";

export interface MemoryTenantDataAccessConfig {
  readonly artifacts?: readonly Artifact[];
  readonly channelFavorites?: readonly ChannelFavorite[];
  readonly channels?: readonly Channel[];
  readonly context: TenantContext;
  readonly mcpHostApprovals?: readonly McpHostApproval[];
  readonly mcpServers?: readonly McpServer[];
  readonly members?: readonly Member[];
  readonly schedules?: readonly Schedule[];
  readonly shapes?: readonly Shape[];
  readonly skills?: readonly Skill[];
  readonly threads?: readonly Thread[];
  readonly unread?: readonly Unread[];
  readonly workspace: Workspace;
  readonly workspaceToolDisables?: readonly WorkspaceToolDisable[];
}

interface MemoryTenantDataAccessState {
  readonly artifacts: Map<string, Artifact>;
  readonly channelFavorites: Map<string, ChannelFavorite>;
  readonly channels: Map<string, Channel>;
  readonly mcpHostApprovals: Map<string, McpHostApproval>;
  readonly mcpServers: Map<string, McpServer>;
  readonly members: Map<string, Member>;
  readonly schedules: Map<string, Schedule>;
  readonly shapes: Map<string, Shape>;
  readonly skills: Map<string, Skill>;
  readonly threads: Map<string, Thread>;
  readonly unread: Map<string, Unread>;
  readonly workspace: Workspace;
  readonly workspaceToolDisables: Map<string, WorkspaceToolDisable>;
}

const mapById = <Value extends { readonly id: string }>(
  values: readonly Value[]
): Map<string, Value> =>
  new Map(values.map((value) => [idKey(value.id), value]));

const unreadKey = (unread: Pick<Unread, "memberId" | "threadId">): string =>
  `${unread.memberId}:${unread.threadId}`;

const channelFavoriteKey = (
  favorite: Pick<ChannelFavorite, "channelId" | "memberId">
): string => `${favorite.memberId}:${favorite.channelId}`;

const isVisibleToMember = (context: TenantContext, channel: Channel): boolean =>
  channel.visibility.kind === "shared" ||
  hasSameId(channel.ownerMemberId, context.memberId);

const matchesListingRequest = (
  request: ChannelListingRequest,
  channel: Channel
): boolean => {
  if (channel.lifecycle.state === "deleted") {
    return false;
  }

  if (request.kind === "sidebar") {
    return true;
  }

  const { ownerMemberId, query, status } = request.search;
  if (
    ownerMemberId !== null &&
    !hasSameId(channel.ownerMemberId, ownerMemberId)
  ) {
    return false;
  }

  if (
    query !== null &&
    !channel.goal.toLowerCase().includes(query.toLowerCase())
  ) {
    return false;
  }

  return status === null || channel.lifecycle.state === status;
};

const toDirectoryEntry = (channel: Channel): ChannelDirectoryEntry => ({
  channelId: channel.id,
  goal: channel.goal,
  lifecycle: channel.lifecycle,
  ownerMemberId: channel.ownerMemberId,
  visibility: channel.visibility,
});

const validateScopedValue = (
  context: TenantContext,
  value: TenantScoped
): TenantDataAccessError | null =>
  isInTenant(context, value)
    ? null
    : tenantGuardViolation(context, value.workspaceId);

const commandScopedValue = (
  command: TenantWriteCommand,
  state: MemoryTenantDataAccessState
): TenantScoped | null => {
  switch (command.kind) {
    case "delete_channel_favorite":
      return state.channelFavorites.get(channelFavoriteKey(command)) ?? null;
    case "delete_mcp_host_approval":
      return state.mcpHostApprovals.get(idKey(command.host)) ?? null;
    case "delete_schedule":
      return state.schedules.get(idKey(command.scheduleId)) ?? null;
    case "delete_skill":
      return state.skills.get(idKey(command.skillId)) ?? null;
    case "delete_unread":
      return state.unread.get(unreadKey(command)) ?? null;
    case "delete_workspace_tool_disable":
      return state.workspaceToolDisables.get(idKey(command.toolId)) ?? null;
    case "put_artifact_index":
      return command.artifact;
    case "put_channel":
      return command.channel;
    case "put_channel_favorite":
      return command.favorite;
    case "put_mcp_host_approval":
      return command.hostApproval;
    case "put_mcp_server":
      return command.mcpServer;
    case "put_schedule":
      return command.schedule;
    case "put_shape":
      return command.shape;
    case "put_skill":
      return command.skill;
    case "put_thread_index":
      return command.thread;
    case "put_unread":
      return command.unread;
    case "put_workspace_tool_disable":
      return command.toolDisable;
  }
};

/** ADR 0030: a Shape row is only ever written alongside / on behalf of its one channel. */
const validateShapeOwnership = (
  context: TenantContext,
  commands: readonly TenantWriteCommand[],
  state: MemoryTenantDataAccessState
): ShapeOwnershipViolationError | null => {
  const owningChannelByShapeId = new Map<string, ChannelId>();
  for (const channel of state.channels.values()) {
    owningChannelByShapeId.set(idKey(channel.shapeId), channel.id);
  }

  for (const command of commands) {
    if (command.kind !== "put_channel") {
      continue;
    }

    const owningChannelId = owningChannelByShapeId.get(
      idKey(command.channel.shapeId)
    );
    if (
      owningChannelId !== undefined &&
      !hasSameId(owningChannelId, command.channel.id)
    ) {
      return {
        kind: "shape_ownership_violation",
        shapeId: command.channel.shapeId,
        violation: { kind: "shape_already_owned", owningChannelId },
        workspaceId: context.workspaceId,
      };
    }

    owningChannelByShapeId.set(
      idKey(command.channel.shapeId),
      command.channel.id
    );
  }

  for (const command of commands) {
    if (command.kind !== "put_shape") {
      continue;
    }

    if (!owningChannelByShapeId.has(idKey(command.shape.id))) {
      return {
        kind: "shape_ownership_violation",
        shapeId: command.shape.id,
        violation: { kind: "unowned_shape_write" },
        workspaceId: context.workspaceId,
      };
    }
  }

  return null;
};

const applyCommand = (
  command: TenantWriteCommand,
  state: MemoryTenantDataAccessState
): void => {
  switch (command.kind) {
    case "delete_channel_favorite":
      state.channelFavorites.delete(channelFavoriteKey(command));
      return;
    case "delete_mcp_host_approval":
      state.mcpHostApprovals.delete(idKey(command.host));
      return;
    case "delete_schedule":
      state.schedules.delete(idKey(command.scheduleId));
      return;
    case "delete_skill":
      state.skills.delete(idKey(command.skillId));
      return;
    case "delete_unread":
      state.unread.delete(unreadKey(command));
      return;
    case "delete_workspace_tool_disable":
      state.workspaceToolDisables.delete(idKey(command.toolId));
      return;
    case "put_artifact_index":
      state.artifacts.set(idKey(command.artifact.id), command.artifact);
      return;
    case "put_channel":
      state.channels.set(idKey(command.channel.id), command.channel);
      return;
    case "put_channel_favorite":
      state.channelFavorites.set(
        channelFavoriteKey(command.favorite),
        command.favorite
      );
      return;
    case "put_mcp_host_approval":
      state.mcpHostApprovals.set(
        idKey(command.hostApproval.host),
        command.hostApproval
      );
      return;
    case "put_mcp_server":
      state.mcpServers.set(idKey(command.mcpServer.id), command.mcpServer);
      return;
    case "put_schedule":
      state.schedules.set(idKey(command.schedule.id), command.schedule);
      return;
    case "put_shape":
      state.shapes.set(idKey(command.shape.id), command.shape);
      return;
    case "put_skill":
      state.skills.set(idKey(command.skill.id), command.skill);
      return;
    case "put_thread_index":
      state.threads.set(idKey(command.thread.id), command.thread);
      return;
    case "put_unread":
      state.unread.set(unreadKey(command.unread), command.unread);
      return;
    case "put_workspace_tool_disable":
      state.workspaceToolDisables.set(
        idKey(command.toolDisable.toolId),
        command.toolDisable
      );
      return;
  }
};

const getTenantScoped = async <Value extends TenantScoped>(
  context: TenantContext,
  value: Value | undefined
) => {
  if (value === undefined) {
    return ok(null);
  }

  const violation = validateScopedValue(context, value);
  return violation === null ? ok(value) : err(violation);
};

export const createMemoryTenantDataAccess = (
  config: MemoryTenantDataAccessConfig
): TenantDataAccess => {
  const state: MemoryTenantDataAccessState = {
    artifacts: mapById(config.artifacts ?? []),
    channelFavorites: new Map(
      (config.channelFavorites ?? []).map((favorite) => [
        channelFavoriteKey(favorite),
        favorite,
      ])
    ),
    channels: mapById(config.channels ?? []),
    mcpHostApprovals: new Map(
      (config.mcpHostApprovals ?? []).map((approval) => [
        idKey(approval.host),
        approval,
      ])
    ),
    mcpServers: mapById(config.mcpServers ?? []),
    members: mapById(config.members ?? []),
    schedules: mapById(config.schedules ?? []),
    shapes: mapById(config.shapes ?? []),
    skills: mapById(config.skills ?? []),
    threads: mapById(config.threads ?? []),
    unread: new Map(
      (config.unread ?? []).map((unread) => [unreadKey(unread), unread])
    ),
    workspace: config.workspace,
    workspaceToolDisables: new Map(
      (config.workspaceToolDisables ?? []).map((toolDisable) => [
        idKey(toolDisable.toolId),
        toolDisable,
      ])
    ),
  };

  return {
    batch: async (input) => {
      if (!hasSameId(input.workspaceId, config.context.workspaceId)) {
        return err(tenantGuardViolation(config.context, input.workspaceId));
      }

      for (const command of input.commands) {
        const scopedValue = commandScopedValue(command, state);
        const violation =
          scopedValue === null
            ? null
            : validateScopedValue(config.context, scopedValue);

        if (violation !== null) {
          return err(violation);
        }
      }

      const ownershipViolation = validateShapeOwnership(
        config.context,
        input.commands,
        state
      );
      if (ownershipViolation !== null) {
        return err(ownershipViolation);
      }

      for (const command of input.commands) {
        applyCommand(command, state);
      }

      const receipt: TenantWriteReceipt = {
        commandCount: input.commands.length,
        workspaceId: config.context.workspaceId,
      };

      return ok(receipt);
    },
    context: config.context,
    getArtifact: async (input) =>
      getTenantScoped(
        config.context,
        state.artifacts.get(idKey(input.artifactId))
      ),
    getChannel: async (input) =>
      getTenantScoped(
        config.context,
        state.channels.get(idKey(input.channelId))
      ),
    getMcpHostApproval: async (input) =>
      getTenantScoped(
        config.context,
        state.mcpHostApprovals.get(idKey(input.host))
      ),
    getMcpServer: async (input) =>
      getTenantScoped(
        config.context,
        state.mcpServers.get(idKey(input.mcpServerId))
      ),
    getSchedule: async (input) =>
      getTenantScoped(
        config.context,
        state.schedules.get(idKey(input.scheduleId))
      ),
    getShape: async (input) =>
      getTenantScoped(config.context, state.shapes.get(idKey(input.shapeId))),
    getSkill: async (input) =>
      getTenantScoped(config.context, state.skills.get(idKey(input.skillId))),
    getWorkspaceGraph: async () => {
      if (!hasSameId(state.workspace.id, config.context.workspaceId)) {
        return err(tenantGuardViolation(config.context, state.workspace.id));
      }

      return ok({
        members: [...state.members.values()].filter((member) =>
          isInTenant(config.context, member)
        ),
        workspace: state.workspace,
      });
    },
    listArtifacts: async () =>
      ok({
        artifacts: [...state.artifacts.values()].filter((artifact) =>
          isInTenant(config.context, artifact)
        ),
        workspaceId: config.context.workspaceId,
      }),
    listChannelFavorites: async (input) =>
      ok(
        [...state.channelFavorites.values()].filter(
          (favorite) =>
            isInTenant(config.context, favorite) &&
            hasSameId(favorite.memberId, input.memberId)
        )
      ),
    listChannels: async (input) =>
      ok({
        entries: [...state.channels.values()]
          .filter((channel) => isInTenant(config.context, channel))
          .filter((channel) => isVisibleToMember(config.context, channel))
          .filter((channel) => matchesListingRequest(input, channel))
          .map(toDirectoryEntry),
        workspaceId: config.context.workspaceId,
      }),
    listChannelThreads: async (input) =>
      ok({
        channelId: input.channelId,
        threads: [...state.threads.values()].filter(
          (thread) =>
            isInTenant(config.context, thread) &&
            hasSameId(thread.channelId, input.channelId)
        ),
        workspaceId: config.context.workspaceId,
      }),
    listMemberUnread: async (input) =>
      ok(
        [...state.unread.values()].filter(
          (unread) =>
            isInTenant(config.context, unread) &&
            hasSameId(unread.memberId, input.memberId)
        )
      ),
    listRecentThreads: async (input) => {
      const visibleChannelIds = new Set(
        [...state.channels.values()]
          .filter((channel) => isInTenant(config.context, channel))
          .filter((channel) => channel.lifecycle.state !== "deleted")
          .filter((channel) => isVisibleToMember(config.context, channel))
          .map((channel) => idKey(channel.id))
      );

      const threads = [...state.threads.values()]
        .filter((thread) => isInTenant(config.context, thread))
        .filter((thread) => visibleChannelIds.has(idKey(thread.channelId)))
        .filter(
          (thread) =>
            input.before === null ||
            thread.lastActivityAt.getTime() < input.before.getTime()
        )
        .sort(
          (left, right) =>
            right.lastActivityAt.getTime() - left.lastActivityAt.getTime()
        )
        .slice(0, input.limit);

      return ok({ threads, workspaceId: config.context.workspaceId });
    },
    listSkills: async () =>
      ok(
        [...state.skills.values()].filter((skill) =>
          isInTenant(config.context, skill)
        )
      ),
    listWorkspaceToolDisables: async () =>
      ok(
        [...state.workspaceToolDisables.values()].filter((toolDisable) =>
          isInTenant(config.context, toolDisable)
        )
      ),
  };
};
