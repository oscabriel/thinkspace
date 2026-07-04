import type { Channel } from "../../channel";
import type { ChannelDirectoryEntry } from "../../directory";
import type { MemberId } from "../../ids";
import { ok } from "../../result";
import type {
  ChannelHub,
  ChannelHubAddress,
  ChannelHubEvent,
  MemberPresence,
  WorkspaceActivityEvent,
  WorkspaceHub,
} from "../../seams/realtime-hubs";
import type {
  ChannelListingRequest,
  TenantContext,
} from "../../seams/tenant-data-access";
import { hasSameId, isInTenant } from "./helpers";

export interface MemoryWorkspaceHubConfig {
  readonly activityEvents?: readonly WorkspaceActivityEvent[];
  readonly channels?: readonly Channel[];
  readonly context: TenantContext;
  readonly onActivity?: (event: WorkspaceActivityEvent) => void;
  readonly roster?: readonly MemberId[];
}

export interface MemoryChannelHubConfig {
  readonly address: ChannelHubAddress;
  readonly context: TenantContext;
  readonly events?: readonly ChannelHubEvent[];
  readonly onEvent?: (event: ChannelHubEvent) => void;
  readonly presence?: readonly MemberPresence[];
}

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

export const createMemoryWorkspaceHub = (
  config: MemoryWorkspaceHubConfig
): WorkspaceHub => {
  const activityEvents = [...(config.activityEvents ?? [])];

  return {
    context: config.context,
    getRoster: async () => ok({ members: config.roster ?? [] }),
    listChannels: async (input) =>
      ok({
        entries: (config.channels ?? [])
          .filter((channel) => isInTenant(config.context, channel))
          .filter((channel) => isVisibleToMember(config.context, channel))
          .filter((channel) => matchesListingRequest(input, channel))
          .map(toDirectoryEntry),
        workspaceId: config.context.workspaceId,
      }),
    publishActivity: async (event) => {
      activityEvents.push(event);
      config.onActivity?.(event);
      return ok();
    },
  };
};

export const createMemoryChannelHub = (
  config: MemoryChannelHubConfig
): ChannelHub => {
  const events = [...(config.events ?? [])];

  return {
    address: config.address,
    context: config.context,
    getPresence: async () => ok(config.presence ?? []),
    publishEvent: async (event) => {
      events.push(event);
      config.onEvent?.(event);
      return ok();
    },
  };
};
