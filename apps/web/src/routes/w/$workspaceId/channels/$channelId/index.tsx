import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@thinkspace/ui/components/empty";
import { MessagesSquare, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { ThreadRow, ThreadRowSkeleton } from "@/components/shell/thread-row";
import { ThreadComposer } from "@/components/thread/thread-composer";
import { ApiRequestError, createThread } from "@/lib/api";
import { uuidv7 } from "@/lib/ids";
import {
  channelQuery,
  channelThreadsQuery,
  memberLabel,
  membersQuery,
  workspaceKeys,
} from "@/lib/workspace-queries";

/**
 * The channel's Threads tab (E7.4): the recency-sorted thread index (ADR 0020, "the same feed
 * scoped to one channel") rendered as posts, plus the "start a thread" composer. The channel
 * header, meta, archive affordance, and tab bar live in the parent layout route
 * (`$channelId.tsx`), so they persist across the Threads/Artifacts/Shape tabs. Creating a thread
 * is a create-and-ask
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
  const startThread = useMutation({
    mutationFn: (openingBody: string) =>
      createThread(workspaceId, {
        askGestureId: uuidv7(),
        channelId,
        openingBody,
        openingCommentId: uuidv7(),
        threadId: uuidv7(),
      }),
    onError: (error) =>
      toast.error(
        `Could not start thread: ${error instanceof ApiRequestError ? error.kind : "unknown_error"}`
      ),
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
  if (!channel.data) {
    return null;
  }
  const archived = channel.data.lifecycle.state !== "active";
  return (
    <div className="flex flex-col gap-6">
      {!archived && (
        <ThreadComposer
          onSubmit={(body) => startThread.mutate(body)}
          pending={startThread.isPending}
          placeholder="Start a thread — describe the work and ask the channel agent…"
          submitLabel="Start thread"
        />
      )}
      {threads.isPending ? (
        <FeedSkeleton />
      ) : threads.isError ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TriangleAlert />
            </EmptyMedia>
            <EmptyTitle>Threads unavailable</EmptyTitle>
            <EmptyDescription>Try again in a moment.</EmptyDescription>
          </EmptyHeader>
        </Empty>
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
                authorName={memberLabel(members.data, thread.createdByMemberId)}
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
  <div className="flex flex-col">
    {[0, 1, 2].map((row) => (
      <ThreadRowSkeleton key={row} />
    ))}
  </div>
);

export const Route = createFileRoute("/w/$workspaceId/channels/$channelId/")({
  component: ChannelView,
});
