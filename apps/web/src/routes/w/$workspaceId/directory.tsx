import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useParams } from "@tanstack/react-router";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@thinkspace/ui/components/empty";
import { Input } from "@thinkspace/ui/components/input";
import { Skeleton } from "@thinkspace/ui/components/skeleton";
import { cn } from "@thinkspace/ui/lib/utils";
import { Archive, Compass, Hash, Lock } from "lucide-react";
import { useMemo, useState } from "react";

import type { ChannelDirectoryEntry } from "@/lib/api";
import { graphQuery, memberLabel, membersQuery } from "@/lib/workspace-queries";

type StatusFilter = "active" | "archived" | "all";

/**
 * The shared-channel directory (ADR 0023): a browsable, searchable index of the workspace's
 * channels keyed on goal / owner / status, separate from the sidebar, so a member can find and
 * jump into channels they are not already tracking. There is no dedicated directory HTTP read
 * yet (the seam's directory listing is unrouted), so v1 filters the GET /graph payload — the
 * same visibility model as the sidebar (shared channels plus the member's own private ones).
 * Owner is labelled by display name from the roster read (GET /members, E8.6), falling back to
 * the truncated member id while the roster loads or for a member absent from it.
 */
const Directory = () => {
  const { workspaceId } = useParams({ from: "/w/$workspaceId" });
  const graph = useQuery(graphQuery(workspaceId));
  const members = useQuery(membersQuery(workspaceId));
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (graph.data?.channels ?? []).filter((entry) => {
      const matchesStatus =
        status === "all" ? true : entry.lifecycle.state === status;
      const matchesQuery =
        needle.length === 0 || entry.goal.toLowerCase().includes(needle);
      return matchesStatus && matchesQuery;
    });
  }, [graph.data, query, status]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-foreground text-xl tracking-tight">
          Channel directory
        </h1>
        <p className="text-muted-foreground text-sm">
          Find and jump into shared channels across the workspace.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <Input
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search channels by goal…"
          value={query}
        />
        <div className="flex items-center gap-1 text-sm">
          {(["active", "archived", "all"] as const).map((option) => (
            <button
              className={cn(
                "rounded-full px-3 py-1 capitalize transition-colors",
                status === option
                  ? "bg-primary font-medium text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              )}
              key={option}
              onClick={() => setStatus(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {graph.isPending ? (
        <DirectorySkeleton />
      ) : results.length > 0 ? (
        <div className="flex flex-col gap-2">
          {results.map((entry) => (
            <DirectoryCard
              entry={entry}
              key={entry.channelId}
              ownerName={memberLabel(members.data, entry.ownerMemberId)}
              workspaceId={workspaceId}
            />
          ))}
        </div>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Compass />
            </EmptyMedia>
            <EmptyTitle>No channels match</EmptyTitle>
            <EmptyDescription>
              Channels are shared by default — as your team creates goal-scoped
              channels, they show up here for anyone to discover and join.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
};

const DirectoryCard = ({
  entry,
  ownerName,
  workspaceId,
}: {
  readonly entry: ChannelDirectoryEntry;
  readonly ownerName: string;
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
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/40"
      params={{ channelId: entry.channelId, workspaceId }}
      to="/w/$workspaceId/channels/$channelId"
    >
      <div className="flex items-start gap-2">
        <GlyphIcon
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
        <span className="text-foreground text-sm leading-snug">
          {entry.goal}
        </span>
      </div>
      <div className="flex items-center gap-2 pl-6 text-muted-foreground text-xs">
        <span className="capitalize">{entry.visibility.kind}</span>
        <span aria-hidden="true">·</span>
        <span>{archived ? "archived" : "active"}</span>
        <span aria-hidden="true">·</span>
        <span className="truncate">owner {ownerName}</span>
      </div>
    </Link>
  );
};

const DirectorySkeleton = () => (
  <div className="flex flex-col gap-2">
    {[0, 1, 2].map((row) => (
      <Skeleton className="h-20 w-full rounded-xl" key={row} />
    ))}
  </div>
);

export const Route = createFileRoute("/w/$workspaceId/directory")({
  component: Directory,
});
