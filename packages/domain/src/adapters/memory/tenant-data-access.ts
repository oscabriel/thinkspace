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
  DataAccessContext,
  TenantContext,
  TenantDataAccess,
  TenantDataAccessError,
  TenantWriteCommand,
  TenantWriteReceipt,
  WorkspaceMember,
} from "../../seams/tenant-data-access";
import type { Shape } from "../../shape";
import type { Skill } from "../../skill";
import type { Thread } from "../../thread";
import type { WorkspaceToolDisable } from "../../tool";
import type { Unread } from "../../unread";
import type { Workspace } from "../../workspace";
import {
  hasSameId,
  idKey,
  isInTenant,
  requireMemberContext,
  tenantGuardViolation,
} from "./helpers";
import type { TenantScoped } from "./helpers";

export interface MemoryTenantDataAccessConfig<
  Context extends DataAccessContext = TenantContext,
> {
  readonly artifacts?: readonly Artifact[];
  readonly channelFavorites?: readonly ChannelFavorite[];
  readonly channels?: readonly Channel[];
  readonly context: Context;
  readonly mcpHostApprovals?: readonly McpHostApproval[];
  readonly mcpServers?: readonly McpServer[];
  readonly members?: readonly WorkspaceMember[];
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
  readonly members: Map<string, WorkspaceMember>;
  readonly schedules: Map<string, Schedule>;
  readonly shapes: Map<string, Shape>;
  readonly skills: Map<string, Skill>;
  readonly threads: Map<string, Thread>;
  readonly unread: Map<string, Unread>;
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
  context: DataAccessContext,
  value: TenantScoped
): TenantDataAccessError | null =>
  isInTenant(context, value)
    ? null
    : tenantGuardViolation(context, value.workspaceId);

type CommandOfKind<Kind extends TenantWriteCommand["kind"]> = Extract<
  TenantWriteCommand,
  { kind: Kind }
>;

const scopedValueByKind: {
  [Kind in TenantWriteCommand["kind"]]: (
    command: CommandOfKind<Kind>,
    state: MemoryTenantDataAccessState
  ) => TenantScoped | null;
} = {
  create_thread_index: (command) => command.thread,
  delete_channel_favorite: (command, state) =>
    state.channelFavorites.get(channelFavoriteKey(command)) ?? null,
  delete_mcp_host_approval: (command, state) =>
    state.mcpHostApprovals.get(idKey(command.host)) ?? null,
  delete_mcp_server: (command, state) =>
    state.mcpServers.get(idKey(command.mcpServerId)) ?? null,
  delete_schedule: (command, state) =>
    state.schedules.get(idKey(command.scheduleId)) ?? null,
  delete_skill: (command, state) =>
    state.skills.get(idKey(command.skillId)) ?? null,
  delete_unread: (command, state) =>
    state.unread.get(unreadKey(command)) ?? null,
  delete_workspace_tool_disable: (command, state) =>
    state.workspaceToolDisables.get(idKey(command.toolId)) ?? null,
  put_artifact_index: (command) => command.artifact,
  put_channel: (command) => command.channel,
  put_channel_favorite: (command) => command.favorite,
  put_mcp_host_approval: (command) => command.hostApproval,
  put_mcp_server: (command) => command.mcpServer,
  put_schedule: (command) => command.schedule,
  put_shape: (command) => command.shape,
  put_skill: (command) => command.skill,
  put_thread_index: (command) => command.thread,
  put_unread: (command) => command.unread,
  put_workspace_tool_disable: (command) => command.toolDisable,
};

const commandScopedValue = (
  command: TenantWriteCommand,
  state: MemoryTenantDataAccessState
): TenantScoped | null =>
  (
    scopedValueByKind[command.kind] as (
      command: TenantWriteCommand,
      state: MemoryTenantDataAccessState
    ) => TenantScoped | null
  )(command, state);

/** ADR 0030: a Shape row is only ever written alongside / on behalf of its one channel. */
const validateShapeOwnership = (
  context: DataAccessContext,
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

const applyCommandByKind: {
  [Kind in TenantWriteCommand["kind"]]: (
    command: CommandOfKind<Kind>,
    state: MemoryTenantDataAccessState
  ) => void;
} = {
  create_thread_index: (command, state) => {
    const key = idKey(command.thread.id);
    if (!state.threads.has(key)) {
      state.threads.set(key, command.thread);
    }
  },
  delete_channel_favorite: (command, state) => {
    state.channelFavorites.delete(channelFavoriteKey(command));
  },
  delete_mcp_host_approval: (command, state) => {
    state.mcpHostApprovals.delete(idKey(command.host));
  },
  delete_mcp_server: (command, state) => {
    state.mcpServers.delete(idKey(command.mcpServerId));
  },
  delete_schedule: (command, state) => {
    state.schedules.delete(idKey(command.scheduleId));
  },
  delete_skill: (command, state) => {
    state.skills.delete(idKey(command.skillId));
  },
  delete_unread: (command, state) => {
    state.unread.delete(unreadKey(command));
  },
  delete_workspace_tool_disable: (command, state) => {
    state.workspaceToolDisables.delete(idKey(command.toolId));
  },
  put_artifact_index: (command, state) => {
    state.artifacts.set(idKey(command.artifact.id), command.artifact);
  },
  put_channel: (command, state) => {
    state.channels.set(idKey(command.channel.id), command.channel);
  },
  put_channel_favorite: (command, state) => {
    state.channelFavorites.set(
      channelFavoriteKey(command.favorite),
      command.favorite
    );
  },
  put_mcp_host_approval: (command, state) => {
    state.mcpHostApprovals.set(
      idKey(command.hostApproval.host),
      command.hostApproval
    );
  },
  put_mcp_server: (command, state) => {
    state.mcpServers.set(idKey(command.mcpServer.id), command.mcpServer);
  },
  put_schedule: (command, state) => {
    state.schedules.set(idKey(command.schedule.id), command.schedule);
  },
  put_shape: (command, state) => {
    state.shapes.set(idKey(command.shape.id), command.shape);
  },
  put_skill: (command, state) => {
    state.skills.set(idKey(command.skill.id), command.skill);
  },
  put_thread_index: (command, state) => {
    state.threads.set(idKey(command.thread.id), command.thread);
  },
  put_unread: (command, state) => {
    state.unread.set(unreadKey(command.unread), command.unread);
  },
  put_workspace_tool_disable: (command, state) => {
    state.workspaceToolDisables.set(
      idKey(command.toolDisable.toolId),
      command.toolDisable
    );
  },
};

const applyCommand = (
  command: TenantWriteCommand,
  state: MemoryTenantDataAccessState
): void => {
  (
    applyCommandByKind[command.kind] as (
      command: TenantWriteCommand,
      state: MemoryTenantDataAccessState
    ) => void
  )(command, state);
};

const getTenantScoped = async <Value extends TenantScoped>(
  context: DataAccessContext,
  value: Value | undefined
) => {
  if (value === undefined) {
    return ok(null);
  }

  const violation = validateScopedValue(context, value);
  return violation === null ? ok(value) : err(violation);
};

export const createMemoryTenantDataAccess = <
  Context extends DataAccessContext = TenantContext,
>(
  config: MemoryTenantDataAccessConfig<Context>
): TenantDataAccess<Context> => {
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
    members: new Map(
      (config.members ?? []).map((member) => [idKey(member.memberId), member])
    ),
    schedules: mapById(config.schedules ?? []),
    shapes: mapById(config.shapes ?? []),
    skills: mapById(config.skills ?? []),
    threads: mapById(config.threads ?? []),
    unread: new Map(
      (config.unread ?? []).map((unread) => [unreadKey(unread), unread])
    ),
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
      const member = requireMemberContext(config.context);
      if (!member.ok) {
        return member;
      }

      return ok({
        channels: [...state.channels.values()]
          .filter((channel) => isInTenant(config.context, channel))
          .filter((channel) => channel.lifecycle.state !== "deleted")
          .filter((channel) => isVisibleToMember(member.value, channel))
          .map(toDirectoryEntry),
        workspaceId: config.context.workspaceId,
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
    listChannelThreads: async (input) =>
      ok({
        channelId: input.channelId,
        /** ADR 0020: recency-ordered — the bump order, most recent activity first. */
        threads: [...state.threads.values()]
          .filter(
            (thread) =>
              isInTenant(config.context, thread) &&
              hasSameId(thread.channelId, input.channelId)
          )
          .toSorted(
            (left, right) =>
              right.lastActivityAt.getTime() - left.lastActivityAt.getTime()
          ),
        workspaceId: config.context.workspaceId,
      }),
    listChannels: async (input) => {
      const member = requireMemberContext(config.context);
      if (!member.ok) {
        return member;
      }

      return ok({
        entries: [...state.channels.values()]
          .filter((channel) => isInTenant(config.context, channel))
          .filter((channel) => isVisibleToMember(member.value, channel))
          .filter((channel) => matchesListingRequest(input, channel))
          .map(toDirectoryEntry),
        workspaceId: config.context.workspaceId,
      });
    },
    listMcpHostApprovals: async () =>
      ok(
        [...state.mcpHostApprovals.values()].filter((approval) =>
          isInTenant(config.context, approval)
        )
      ),
    listMcpServers: async () =>
      ok(
        [...state.mcpServers.values()].filter((server) =>
          isInTenant(config.context, server)
        )
      ),
    listMemberUnread: async (input) =>
      ok(
        [...state.unread.values()].filter(
          (unread) =>
            isInTenant(config.context, unread) &&
            hasSameId(unread.memberId, input.memberId)
        )
      ),
    listMembers: async () =>
      ok({
        members: [...state.members.values()]
          .filter((member) => isInTenant(config.context, member))
          .toSorted((left, right) =>
            left.memberId.localeCompare(right.memberId)
          )
          .map((member) => ({
            displayName: member.displayName,
            memberId: member.memberId,
          })),
        workspaceId: config.context.workspaceId,
      }),
    listRecentThreads: async (input) => {
      const member = requireMemberContext(config.context);
      if (!member.ok) {
        return member;
      }

      const visibleChannelIds = new Set(
        [...state.channels.values()]
          .filter((channel) => isInTenant(config.context, channel))
          .filter((channel) => channel.lifecycle.state !== "deleted")
          .filter((channel) => isVisibleToMember(member.value, channel))
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
        .toSorted(
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
    listWorkspaceThreadAddresses: async () =>
      ok({
        /** ADR 0037 decision 4: every tenant thread's DO address — no visibility filter. */
        addresses: [...state.threads.values()]
          .filter((thread) => isInTenant(config.context, thread))
          .map((thread) => ({
            channelId: thread.channelId,
            threadId: thread.id,
          })),
        workspaceId: config.context.workspaceId,
      }),
    listWorkspaceToolDisables: async () =>
      ok(
        [...state.workspaceToolDisables.values()].filter((toolDisable) =>
          isInTenant(config.context, toolDisable)
        )
      ),
  };
};
