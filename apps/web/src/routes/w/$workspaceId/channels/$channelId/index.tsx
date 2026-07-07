import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@thinkspace/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@thinkspace/ui/components/empty";
import { Skeleton } from "@thinkspace/ui/components/skeleton";
import { Archive, Hash, Lock, MessagesSquare, Settings2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ThreadRow } from "@/components/shell/thread-row";
import { ThreadComposer } from "@/components/thread/thread-composer";
import { ApiRequestError, archiveChannel, createThread } from "@/lib/api";
import { uuidv7 } from "@/lib/ids";
import {
  channelQuery,
  channelThreadsQuery,
  membersQuery,
  workspaceKeys,
} from "@/lib/workspace-queries";

/**
 * The channel container (E7.4, owning the E7.3 read-only scaffold wholesale): the channel
 * header + archive affordance, the recency-sorted thread index (ADR 0020, "the same feed scoped
 * to one channel"), and the "start a thread" composer. Creating a thread is a create-and-ask
 * gesture (ADR 0034 §6): one PUT mints the opening comment *and* dispatches the channel agent
 * at it, so a member's first message and the agent's first turn are one atomic, replayable
 * action. On success we navigate into the thread view carrying the just-minted root comment id
 * so the branch renders instantly; the server now persists rootCommentId on the thread row
 * (E8.4), so links from the feed recover it directly — no localStorage bridge.
 */
const ChannelView = () => {
  const { channelId, workspaceId } = Route.useParams();
  const channel = useQuery(channelQuery(workspaceId, channelId));
  const threads = useQuery(channelThreadsQuery(workspaceId, channelId));
  const members = useQuery(membersQuery(workspaceId));
  const queryClient = useQueryClient();
  const navigate = useNavigate();
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

  const startThread = useMutation({
    mutationFn: (openingBody: string) => {
      const threadId = uuidv7();
      const openingCommentId = uuidv7();
      return createThread(workspaceId, {
        askGestureId: uuidv7(),
        channelId,
        openingBody,
        openingCommentId,
        threadId,
      });
    },
    onError: (error) => {
      const kind =
        error instanceof ApiRequestError ? error.kind : "unknown_error";
      toast.error(`Could not start thread: ${kind}`);
    },
    onSuccess: (receipt) => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.channelThreads(workspaceId, channelId),
      });
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.home(workspaceId),
      });
      navigate({
        params: { channelId, threadId: receipt.thread.id, workspaceId },
        search: { root: receipt.openingComment.id, run: receipt.run?.runId },
        to: "/w/$workspaceId/channels/$channelId/threads/$threadId",
      });
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
  const GlyphIcon = channel.data.visibility.kind === "private" ? Lock : Hash;

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
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  onClick={() =>
                    navigate({
                      params: { channelId, workspaceId },
                      to: "/w/$workspaceId/channels/$channelId/shape",
                    })
                  }
                  size="sm"
                  variant="ghost"
                >
                  <Settings2 className="size-4" />
                  Edit shape
                </Button>
                <Button
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setConfirmingArchive(true)}
                  size="sm"
                  variant="ghost"
                >
                  <Archive className="size-4" />
                  Archive
                </Button>
              </div>
            ))}
        </div>
        <div className="flex items-center gap-2 pl-7 text-muted-foreground text-xs">
          <span className="capitalize">{channel.data.visibility.kind}</span>
          <span aria-hidden="true">·</span>
          <span>{archived ? "archived" : "active"}</span>
          <span aria-hidden="true">·</span>
          <span>
            owner{" "}
            {members.data?.get(channel.data.ownerMemberId) ??
              channel.data.ownerMemberId.slice(0, 8)}
          </span>
        </div>
      </header>

      {archived ? null : (
        <ThreadComposer
          onSubmit={(body) => startThread.mutate(body)}
          pending={startThread.isPending}
          placeholder="Start a thread — describe the work and ask the channel agent…"
          submitLabel="Start thread"
        />
      )}

      {threads.isPending ? (
        <FeedSkeleton />
      ) : threads.data && threads.data.threads.length > 0 ? (
        <div className="flex flex-col">
          {threads.data.threads.map((thread) => (
            <Link
              className="rounded-md transition-colors hover:bg-muted/50"
              key={thread.id}
              params={{ channelId, threadId: thread.id, workspaceId }}
              search={{ root: thread.rootCommentId ?? undefined }}
              to="/w/$workspaceId/channels/$channelId/threads/$threadId"
            >
              <ThreadRow
                authorName={members.data?.get(thread.createdByMemberId)}
                thread={thread}
                unread={false}
              />
            </Link>
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
              Threads are where the work happens. Start one above — your message
              opens the thread and dispatches the channel&apos;s agent.
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

export const Route = createFileRoute(
  "/w/$workspaceId/channels/$channelId/"
)({
  component: ChannelView,
});
