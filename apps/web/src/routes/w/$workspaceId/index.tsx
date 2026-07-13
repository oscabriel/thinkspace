import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useParams } from "@tanstack/react-router";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@thinkspace/ui/components/empty";
import { Inbox } from "lucide-react";
import { useMemo } from "react";

import { ThreadRow, ThreadRowSkeleton } from "@/components/shell/thread-row";
import {
  graphQuery,
  homeQuery,
  memberLabel,
  membersQuery,
  unreadQuery,
} from "@/lib/workspace-queries";

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
  // E8.6: client-side context join. The channel label comes from the sidebar graph already in
  // cache (goal-as-label, ADR 0027 directory entries); the author name from the roster read.
  // Neither blocks the feed — a still-loading lookup just omits that fragment of the row.
  const graph = useQuery(graphQuery(workspaceId));
  const members = useQuery(membersQuery(workspaceId));

  const unreadThreadIds = useMemo(
    () => new Set((unread.data ?? []).map((u) => u.threadId)),
    [unread.data]
  );

  const channelGoals = useMemo(
    () =>
      new Map(
        (graph.data?.channels ?? []).map((channel) => [
          channel.channelId,
          channel.goal,
        ])
      ),
    [graph.data]
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
            <Link
              className="rounded-md transition-colors hover:bg-muted/50"
              key={thread.id}
              params={{
                channelId: thread.channelId,
                threadId: thread.id,
                workspaceId,
              }}
              search={{ root: thread.rootCommentId ?? undefined }}
              to="/w/$workspaceId/channels/$channelId/threads/$threadId"
            >
              <ThreadRow
                authorName={memberLabel(members.data, thread.createdByMemberId)}
                channelLabel={channelGoals.get(thread.channelId)}
                thread={thread}
                unread={unreadThreadIds.has(thread.id)}
              />
            </Link>
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
  <div className="flex flex-col">
    {[0, 1, 2, 3, 4].map((row) => (
      <ThreadRowSkeleton key={row} />
    ))}
  </div>
);

export const Route = createFileRoute("/w/$workspaceId/")({
  component: HomeFeed,
});
