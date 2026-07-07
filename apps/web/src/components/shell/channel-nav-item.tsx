import { Link } from "@tanstack/react-router";
import { cn } from "@thinkspace/ui/lib/utils";
import { Archive, Hash, Lock } from "lucide-react";

import type { ChannelDirectoryEntry } from "@/lib/api";

/**
 * A sidebar channel row. There is no channel-name column (accepted decision) — the goal string
 * is the label, clamped to two lines. Unread is the only badge (DESIGN §5 "no unread-count
 * badge storms"): an unread channel renders its goal at 600 weight. Archived channels render
 * muted with an archive glyph; private channels carry a lock glyph, shared a hash.
 */
export const ChannelNavItem = ({
  entry,
  unread,
  workspaceId,
}: {
  readonly entry: ChannelDirectoryEntry;
  readonly unread: boolean;
  readonly workspaceId: string;
}) => {
  const archived = entry.lifecycle.state === "archived";
  const GlyphIcon = archived
    ? Archive
    : entry.visibility.kind === "private"
      ? Lock
      : Hash;

  return (
    <Link
      activeOptions={{ exact: false }}
      activeProps={{
        className: "bg-sidebar-accent text-sidebar-accent-foreground",
      }}
      className={cn(
        "flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
        "hover:bg-sidebar-accent",
        archived ? "text-muted-foreground" : "text-sidebar-foreground"
      )}
      params={{ channelId: entry.channelId, workspaceId }}
      to="/w/$workspaceId/channels/$channelId"
    >
      <GlyphIcon
        aria-hidden="true"
        className="mt-0.5 size-3.5 shrink-0 opacity-70"
      />
      <span
        className={cn(
          "line-clamp-2 leading-snug",
          unread && !archived && "font-semibold text-sidebar-foreground"
        )}
      >
        {entry.goal}
      </span>
    </Link>
  );
};
