import type { Channel } from "../../channel";
import type { ChannelDirectoryEntry } from "../../directory";
import { createNotImplementedError } from "../../errors";
import type { MemberId } from "../../ids";
import { err, ok } from "../../result";
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
import type { ShapeSnapshot } from "../../shape";
import { hasSameId, idKey, isInTenant, tenantGuardViolation } from "./helpers";

export interface MemoryWorkspaceHubConfig {
  readonly activityEvents?: readonly WorkspaceActivityEvent[];
  readonly channels?: readonly Channel[];
  readonly context: TenantContext;
  readonly roster?: readonly MemberId[];
}

export interface MemoryChannelHubConfig {
  readonly address: ChannelHubAddress;
  readonly context: TenantContext;
  readonly events?: readonly ChannelHubEvent[];
  readonly onEvent?: (event: ChannelHubEvent) => void;
  readonly presence?: readonly MemberPresence[];
  readonly shapeSnapshots?: readonly ShapeSnapshot[];
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
      return ok();
    },
  };
};

export const createMemoryChannelHub = (
  config: MemoryChannelHubConfig
): ChannelHub => {
  const events = [...(config.events ?? [])];
  const snapshots = new Map(
    (config.shapeSnapshots ?? []).map((snapshot) => [
      idKey(snapshot.shapeId),
      snapshot,
    ])
  );

  return {
    address: config.address,
    context: config.context,
    createThread: async (input) => {
      if (!isInTenant(config.context, input.thread)) {
        return err(
          tenantGuardViolation(config.context, input.thread.workspaceId)
        );
      }

      if (!isInTenant(config.context, input.openingComment)) {
        return err(
          tenantGuardViolation(config.context, input.openingComment.workspaceId)
        );
      }

      if (!hasSameId(input.thread.channelId, config.address.channelId)) {
        return err(
          tenantGuardViolation(config.context, input.thread.workspaceId)
        );
      }

      const shapeSnapshot = snapshots.get(idKey(input.shapeId));
      if (shapeSnapshot === undefined) {
        return err(createNotImplementedError("MemoryChannelHub.createThread"));
      }

      return ok({
        openingComment: input.openingComment,
        shapeSnapshot,
        thread: input.thread,
      });
    },
    getPresence: async () => ok(config.presence ?? []),
    publishEvent: async (event) => {
      events.push(event);
      config.onEvent?.(event);
      return ok();
    },
  };
};
