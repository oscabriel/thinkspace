import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Skeleton } from "@thinkspace/ui/components/skeleton";
import { cn } from "@thinkspace/ui/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  Compass,
  Home,
  KeyRound,
  Library,
  Plus,
  Server,
} from "lucide-react";
import { useMemo, useState } from "react";

import { ChannelNavItem } from "@/components/shell/channel-nav-item";
import type { ChannelDirectoryEntry } from "@/lib/api";
import { graphQuery, homeQuery, unreadQuery } from "@/lib/workspace-queries";

const NavLink = ({
  to,
  workspaceId,
  icon: Icon,
  label,
}: {
  readonly to: string;
  readonly workspaceId: string;
  readonly icon: typeof Home;
  readonly label: string;
}) => (
  <Link
    activeOptions={{ exact: true }}
    activeProps={{
      className: "bg-sidebar-accent text-sidebar-accent-foreground",
    }}
    className={cn(
      "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-sidebar-foreground",
      "transition-colors hover:bg-sidebar-accent"
    )}
    params={{ workspaceId }}
    to={to}
  >
    <Icon aria-hidden="true" className="size-4 opacity-80" />
    {label}
  </Link>
);

/**
 * The durable nav unit (ADR 0020): channels grouped Active vs Archived, plus the cross-channel
 * Home and the shared-channel Directory (ADR 0023). Channels come from GET /graph (the visible,
 * non-deleted set). The unread signal is derived by joining GET /unread thread ids against the
 * home feed's threads (which carry channelId) — there is no per-channel unread read, so a
 * channel counts as unread when one of its recently-bumped threads is on the home page. This is
 * approximate at the page boundary and is the recorded staleness tradeoff.
 */
export const WorkspaceSidebar = ({
  workspaceId,
}: {
  readonly workspaceId: string;
}) => {
  const graph = useQuery(graphQuery(workspaceId));
  const home = useQuery(homeQuery(workspaceId));
  const unread = useQuery(unreadQuery(workspaceId));

  const unreadChannelIds = useMemo(() => {
    const unreadThreadIds = new Set((unread.data ?? []).map((u) => u.threadId));
    const ids = new Set<string>();
    for (const thread of home.data?.threads ?? []) {
      if (unreadThreadIds.has(thread.id)) {
        ids.add(thread.channelId);
      }
    }
    return ids;
  }, [home.data, unread.data]);

  const { active, archived } = useMemo(() => {
    const channels = graph.data?.channels ?? [];
    return {
      active: channels.filter((c) => c.lifecycle.state === "active"),
      archived: channels.filter((c) => c.lifecycle.state === "archived"),
    };
  }, [graph.data]);

  return (
    <nav className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3">
      <div className="flex flex-col gap-0.5">
        <NavLink icon={Home} label="Home" to="/w/$workspaceId" workspaceId={workspaceId} />
        <NavLink
          icon={Compass}
          label="Directory"
          to="/w/$workspaceId/directory"
          workspaceId={workspaceId}
        />
        <NavLink
          icon={Library}
          label="Library"
          to="/w/$workspaceId/library"
          workspaceId={workspaceId}
        />
        <NavLink
          icon={KeyRound}
          label="Provider keys"
          to="/w/$workspaceId/settings/providers"
          workspaceId={workspaceId}
        />
        <NavLink
          icon={Server}
          label="MCP servers"
          to="/w/$workspaceId/settings/mcp"
          workspaceId={workspaceId}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between px-2">
          <span className="text-xs font-medium text-muted-foreground">
            Channels
          </span>
          <Link
            aria-label="New channel"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            params={{ workspaceId }}
            to="/w/$workspaceId/channels/new"
          >
            <Plus className="size-4" />
          </Link>
        </div>

        {graph.isPending ? (
          <ChannelListSkeleton />
        ) : (
          <ChannelGroups
            active={active}
            archived={archived}
            unreadChannelIds={unreadChannelIds}
            workspaceId={workspaceId}
          />
        )}
      </div>
    </nav>
  );
};

const ChannelGroups = ({
  active,
  archived,
  unreadChannelIds,
  workspaceId,
}: {
  readonly active: readonly ChannelDirectoryEntry[];
  readonly archived: readonly ChannelDirectoryEntry[];
  readonly unreadChannelIds: ReadonlySet<string>;
  readonly workspaceId: string;
}) => {
  const [showArchived, setShowArchived] = useState(false);

  if (active.length === 0 && archived.length === 0) {
    return (
      <p className="px-2 py-2 text-xs leading-relaxed text-muted-foreground">
        No channels yet. Channels are goals — create one to give an agent its
        purpose.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {active.map((entry) => (
        <ChannelNavItem
          entry={entry}
          key={entry.channelId}
          unread={unreadChannelIds.has(entry.channelId)}
          workspaceId={workspaceId}
        />
      ))}

      {archived.length > 0 && (
        <>
          <button
            aria-expanded={showArchived}
            className="mt-2 flex items-center gap-1 rounded-md px-2 py-1 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-sidebar-foreground"
            onClick={() => setShowArchived((open) => !open)}
            type="button"
          >
            {showArchived ? (
              <ChevronDown aria-hidden="true" className="size-3.5" />
            ) : (
              <ChevronRight aria-hidden="true" className="size-3.5" />
            )}
            Archived ({archived.length})
          </button>
          {showArchived &&
            archived.map((entry) => (
              <ChannelNavItem
                entry={entry}
                key={entry.channelId}
                unread={false}
                workspaceId={workspaceId}
              />
            ))}
        </>
      )}
    </div>
  );
};

const ChannelListSkeleton = () => (
  <div className="flex flex-col gap-2 px-2 py-2">
    {[0, 1, 2, 3].map((row) => (
      <Skeleton className="h-5 w-full" key={row} />
    ))}
  </div>
);
