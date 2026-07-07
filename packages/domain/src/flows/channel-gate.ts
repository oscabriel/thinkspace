import type { Channel } from "../channel";
import type { AuthzError } from "../errors";
import type { TenantContext } from "../seams/tenant-data-access";

/**
 * Shared authz gate for the write-shaped flows (dispatch, thread creation).
 * Visibility is checked before lifecycle so a non-owner learns nothing about a private
 * channel's archival or deletion.
 */
export const channelWriteGate = (
  context: TenantContext,
  channel: Channel
): AuthzError | null => {
  if (
    channel.visibility.kind === "private" &&
    channel.ownerMemberId !== context.memberId
  ) {
    return {
      channelId: channel.id,
      kind: "channel_not_visible",
      memberId: context.memberId,
    };
  }

  if (channel.lifecycle.state === "deleted") {
    return { channelId: channel.id, kind: "channel_deleted" };
  }

  if (channel.lifecycle.state === "archived") {
    return { channelId: channel.id, kind: "channel_read_only" };
  }

  return null;
};

/**
 * Shared visibility gate for the read-shaped surface (ADR 0035): a private channel is
 * invisible to non-owners → channel_not_visible. Reads carry no lifecycle gate — an
 * archived or deleted channel a member can already see stays readable (history), so this
 * checks visibility only and never leaks a private channel to a non-owner.
 */
export const channelReadGate = (
  context: TenantContext,
  channel: Channel
): AuthzError | null => {
  if (
    channel.visibility.kind === "private" &&
    channel.ownerMemberId !== context.memberId
  ) {
    return {
      channelId: channel.id,
      kind: "channel_not_visible",
      memberId: context.memberId,
    };
  }

  return null;
};
