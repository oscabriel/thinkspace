import type { Channel } from "../channel";
import type { AuthzError } from "../errors";
import type { TenantContext } from "../seams/tenant-data-access";

/**
 * Visibility-as-nonexistence (ADR 0019): a private channel is invisible to anyone but its
 * owner, so a non-owner learns nothing about its lifecycle — the check runs before any
 * lifecycle or role gate. A shared channel is visible to every workspace member.
 */
export const channelVisibilityGate = (
  context: TenantContext,
  channel: Channel
): AuthzError | null =>
  channel.visibility.kind === "private" &&
  channel.ownerMemberId !== context.memberId
    ? {
        channelId: channel.id,
        kind: "channel_not_visible",
        memberId: context.memberId,
      }
    : null;

/**
 * ADR 0019: shape edits and channel-lifecycle changes are gated to the channel's owner plus
 * workspace admins (owner/admin roles). A visible member who is neither gets insufficient_role.
 */
export const channelAdminGate = (
  context: TenantContext,
  channel: Channel
): AuthzError | null => {
  const visibility = channelVisibilityGate(context, channel);
  if (visibility !== null) {
    return visibility;
  }

  if (
    context.memberId === channel.ownerMemberId ||
    context.role === "owner" ||
    context.role === "admin"
  ) {
    return null;
  }

  return {
    actualRole: context.role,
    kind: "insufficient_role",
    requiredRole: "admin",
    workspaceId: context.workspaceId,
  };
};

/**
 * Shared authz gate for the write-shaped flows (dispatch, thread creation).
 * Visibility is checked before lifecycle so a non-owner learns nothing about a private
 * channel's archival or deletion.
 */
export const channelWriteGate = (
  context: TenantContext,
  channel: Channel
): AuthzError | null => {
  const visibility = channelVisibilityGate(context, channel);
  if (visibility !== null) {
    return visibility;
  }

  if (channel.lifecycle.state === "deleted") {
    return { channelId: channel.id, kind: "channel_deleted" };
  }

  if (channel.lifecycle.state === "archived") {
    return { channelId: channel.id, kind: "channel_read_only" };
  }

  return null;
};
