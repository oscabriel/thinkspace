import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { Button } from "@thinkspace/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@thinkspace/ui/components/empty";
import { Skeleton } from "@thinkspace/ui/components/skeleton";
import { Archive, Hash, Lock, MessagesSquare } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ThreadRow } from "@/components/shell/thread-row";
import { ApiRequestError, archiveChannel } from "@/lib/api";
import {
  channelQuery,
  channelThreadsQuery,
  workspaceKeys,
} from "@/lib/workspace-queries";

/**
 * The channel container: the channel's header plus its thread index rendered as the recency
 * feed scoped to one channel (ADR 0020 "the same feed scoped to one channel"). This is the
 * shell-level channel surface — the thread tree view, composer, and gesture dispatch are the
 * thread surface, sibling #28, which mounts under this route. Archive is the one lifecycle
 * affordance wired here (POST /channels/:id/archive); it invalidates the sidebar graph so the
 * channel drops into the Archived group without a socket event (recorded staleness gap).
 */
const ChannelView = () => {
  const { channelId, workspaceId } = useParams({
    from: "/w/$workspaceId/channels/$channelId",
  });
  const channel = useQuery(channelQuery(workspaceId, channelId));
  const threads = useQuery(channelThreadsQuery(workspaceId, channelId));
  const queryClient = useQueryClient();
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  const archive = useMutation({
    mutationFn: () => archiveChannel(workspaceId, channelId),
    onError: (error) => {
      const kind =
        error instanceof ApiRequestError ? error.kind : "unknown_error";
      toast.error(`Could not archive channel: ${kind}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.graph(workspaceId),
      });
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.channel(workspaceId, channelId),
      });
      toast.success("Channel archived");
      setConfirmingArchive(false);
    },
  });

  if (channel.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-8">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (channel.isError || !channel.data) {
    const kind =
      channel.error instanceof ApiRequestError
        ? channel.error.kind
        : "unknown_resource";
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-8">
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Channel unavailable</EmptyTitle>
            <EmptyDescription>
              This channel does not exist or is not visible to you ({kind}).
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const archived = channel.data.lifecycle.state === "archived";
  const GlyphIcon =
    channel.data.visibility.kind === "private" ? Lock : Hash;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-3 border-border border-b pb-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-2">
            {archived ? (
              <Archive
                aria-hidden="true"
                className="mt-1 size-5 shrink-0 text-muted-foreground"
              />
            ) : (
              <GlyphIcon
                aria-hidden="true"
                className="mt-1 size-5 shrink-0 text-muted-foreground"
              />
            )}
            <h1 className="font-semibold text-foreground text-xl leading-snug tracking-tight">
              {channel.data.goal}
            </h1>
          </div>
          {!archived &&
            (confirmingArchive ? (
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  disabled={archive.isPending}
                  onClick={() => archive.mutate()}
                  size="sm"
                  variant="destructive"
                >
                  {archive.isPending ? "Archiving…" : "Confirm archive"}
                </Button>
                <Button
                  onClick={() => setConfirmingArchive(false)}
                  size="sm"
                  variant="ghost"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmingArchive(true)}
                size="sm"
                variant="ghost"
              >
                <Archive className="size-4" />
                Archive
              </Button>
            ))}
        </div>
        <div className="flex items-center gap-2 pl-7 text-muted-foreground text-xs">
          <span className="capitalize">{channel.data.visibility.kind}</span>
          <span aria-hidden="true">·</span>
          <span>{archived ? "archived" : "active"}</span>
          <span aria-hidden="true">·</span>
          <span>owner {channel.data.ownerMemberId.slice(0, 8)}</span>
        </div>
      </header>

      {threads.isPending ? (
        <FeedSkeleton />
      ) : threads.data && threads.data.threads.length > 0 ? (
        <div className="flex flex-col">
          {threads.data.threads.map((thread) => (
            <ThreadRow key={thread.id} thread={thread} unread={false} />
          ))}
        </div>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessagesSquare />
            </EmptyMedia>
            <EmptyTitle>No threads yet</EmptyTitle>
            <EmptyDescription>
              Threads are where the work happens. The thread composer is coming
              soon — start a conversation and dispatch the channel&apos;s agent.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
};

const FeedSkeleton = () => (
  <div className="flex flex-col gap-3">
    {[0, 1, 2].map((row) => (
      <Skeleton className="h-12 w-full" key={row} />
    ))}
  </div>
);

export const Route = createFileRoute("/w/$workspaceId/channels/$channelId")({
  component: ChannelView,
});
