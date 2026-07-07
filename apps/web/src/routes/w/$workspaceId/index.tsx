import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useParams } from "@tanstack/react-router";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@thinkspace/ui/components/empty";
import { Skeleton } from "@thinkspace/ui/components/skeleton";
import { Inbox } from "lucide-react";
import { useMemo } from "react";

import { ThreadRow } from "@/components/shell/thread-row";
import { homeQuery, unreadQuery } from "@/lib/workspace-queries";

/**
 * The landing surface (ADR 0020): "what moved while I was away" — bumped threads across every
 * visible channel, recency-sorted, from GET /home. Unread rows (GET /unread, ADR 0027) mark
 * the threads that changed by agent output or a co-participant. This is the v1 prioritization
 * pillar; the per-channel view is the same feed scoped to one channel.
 */
const HomeFeed = () => {
  const { workspaceId } = useParams({ from: "/w/$workspaceId" });
  const home = useQuery(homeQuery(workspaceId));
  const unread = useQuery(unreadQuery(workspaceId));

  const unreadThreadIds = useMemo(
    () => new Set((unread.data ?? []).map((u) => u.threadId)),
    [unread.data]
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-foreground text-xl tracking-tight">
          Recent activity
        </h1>
        <p className="text-muted-foreground text-sm">
          What moved across your channels while you were away.
        </p>
      </header>

      {home.isPending ? (
        <FeedSkeleton />
      ) : home.data && home.data.threads.length > 0 ? (
        <div className="flex flex-col">
          {home.data.threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              unread={unreadThreadIds.has(thread.id)}
            />
          ))}
        </div>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle>Nothing has moved yet</EmptyTitle>
            <EmptyDescription>
              When an agent finishes a run or a teammate replies, the thread
              bumps to the top here. Create a channel and start a thread to give
              an agent something to do.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
};

const FeedSkeleton = () => (
  <div className="flex flex-col gap-3">
    {[0, 1, 2, 3, 4].map((row) => (
      <Skeleton className="h-12 w-full" key={row} />
    ))}
  </div>
);

export const Route = createFileRoute("/w/$workspaceId/")({
  component: HomeFeed,
});
