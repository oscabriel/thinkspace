import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Button } from "@thinkspace/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@thinkspace/ui/components/empty";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@thinkspace/ui/components/message-scroller";
import { Skeleton } from "@thinkspace/ui/components/skeleton";
import {
  ArrowLeft,
  History,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { CommentItem } from "@/components/thread/comment-item";
import { RunCardLive } from "@/components/thread/run-card-live";
import type { ActiveRun } from "@/components/thread/run-card-live";
import { ThreadComposer } from "@/components/thread/thread-composer";
import {
  ApiRequestError,
  type BranchSnapshot,
  type Comment,
  appendComment,
  clearThreadUnread,
  dispatchThread,
} from "@/lib/api";
import { useChannelHub } from "@/lib/hub-socket";
import type { ChannelHubEvent } from "@/lib/hub-socket";
import { uuidv7 } from "@/lib/ids";
import { branchQuery } from "@/lib/thread-queries";
import {
  channelQuery,
  channelThreadsQuery,
  workspaceKeys,
} from "@/lib/workspace-queries";

/** A run that has not settled after this long is shown as failed — no spinner in a void. */
const RUN_STALE_MS = 120_000;

/** Depth of each comment for indentation: walk parent links within the loaded slice. */
const depthOf = (comment: Comment, byId: Map<string, Comment>): number => {
  let depth = 0;
  let current = comment;
  while (current.parent.kind === "nested") {
    const parent = byId.get(current.parent.parentCommentId);
    if (parent === undefined || depth > 12) {
      break;
    }
    depth += 1;
    current = parent;
  }
  return depth;
};

const ThreadView = () => {
  const { channelId, threadId, workspaceId } = Route.useParams();
  const { root, run } = Route.useSearch();
  const queryClient = useQueryClient();

  const channel = useQuery(channelQuery(workspaceId, channelId));
  const threads = useQuery(channelThreadsQuery(workspaceId, channelId));
  const threadEntry = threads.data?.threads.find(
    (thread) => thread.id === threadId
  );
  const threadName = threadEntry?.name ?? "Thread";

  // ADR 0027: opening a thread clears the member's unread for it.
  useEffect(() => {
    let cancelled = false;
    clearThreadUnread(workspaceId, threadId)
      .then(() => {
        if (!cancelled) {
          queryClient.invalidateQueries({
            queryKey: workspaceKeys.unread(workspaceId),
          });
        }
      })
      .catch(() => {
        // A failed clear is benign — the badge simply lingers until the next read succeeds.
      });
    return () => {
      cancelled = true;
    };
  }, [queryClient, threadId, workspaceId]);

  // The branch anchor: the ?root= the create-and-ask navigation carries (immediate), else the
  // server-persisted rootCommentId on the thread index row (E8.4). Only a legacy row that
  // predates the column (null root) still falls through to the teaching empty state.
  const rootCommentId =
    typeof root === "string" && root.length > 0
      ? root
      : (threadEntry?.rootCommentId ?? null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-col gap-1 border-border border-b px-6 py-4">
        <Link
          className="inline-flex w-fit items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
          params={{ channelId, workspaceId }}
          to="/w/$workspaceId/channels/$channelId"
        >
          <ArrowLeft className="size-3.5" />
          {channel.data?.goal ?? "Channel"}
        </Link>
        <h1 className="font-semibold text-foreground text-lg leading-snug tracking-tight">
          {threadName}
        </h1>
      </header>

      {rootCommentId !== null ? (
        <ThreadConversation
          channelId={channelId}
          initialRunId={run}
          rootCommentId={rootCommentId}
          threadId={threadId}
          workspaceId={workspaceId}
        />
      ) : threads.isPending ? (
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-6">
          <Skeleton className="h-16 w-3/4" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <MissingRootNotice />
      )}
    </div>
  );
};

/**
 * The full thread, anchored at its root comment (ADR 0025 ancestors + subtree). The branch read
 * is the rendered truth; the channel hub is a delta nudge (baked decision 5) that invalidates it
 * on `comment_added` / `run_lifecycle_changed`, and a 5s branch poll is the socket-down fallback.
 * In-flight runs render as live run cards from the dispatch receipt and settle when their output
 * comment lands in the refetched branch (ADR 0028).
 */
const ThreadConversation = ({
  channelId,
  initialRunId,
  rootCommentId,
  threadId,
  workspaceId,
}: {
  readonly channelId: string;
  readonly initialRunId?: string;
  readonly rootCommentId: string;
  readonly threadId: string;
  readonly workspaceId: string;
}) => {
  const queryClient = useQueryClient();
  const branch = useQuery(
    branchQuery(workspaceId, { channelId, rootCommentId, threadId })
  );
  // The create-and-ask run rides in on ?run= (the receipt does not survive navigation) so the
  // opening dispatch gets a live card exactly like an in-thread one.
  const [activeRuns, setActiveRuns] = useState<readonly ActiveRun[]>(() =>
    initialRunId
      ? [{ runId: initialRunId, startedAt: Date.now(), status: "running" }]
      : []
  );

  const comments = useMemo<readonly Comment[]>(
    () =>
      branch.data
        ? [...branch.data.ancestors, ...branch.data.subtree]
        : [],
    [branch.data]
  );
  const byId = useMemo(
    () => new Map(comments.map((comment) => [comment.id, comment])),
    [comments]
  );
  const latestCommentId = comments.at(-1)?.id ?? rootCommentId;

  const refetchBranch = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: branchQuery(workspaceId, {
        channelId,
        rootCommentId,
        threadId,
      }).queryKey,
    });
  }, [channelId, queryClient, rootCommentId, threadId, workspaceId]);

  const onEvent = useCallback(
    (event: ChannelHubEvent) => {
      if (event.threadId !== threadId) {
        return;
      }
      refetchBranch();
      if (event.kind === "comment_added") {
        // The output comment for the oldest in-flight run has landed — retire that card.
        setActiveRuns((runs) => runs.slice(1));
      }
    },
    [refetchBranch, threadId]
  );

  const hubStatus = useChannelHub({ channelId, onEvent, workspaceId });

  // Sweep runs that never settled (a failed run publishes run_lifecycle_changed with no output
  // comment; without a run-state read the client infers failure from the absence + time).
  useEffect(() => {
    if (activeRuns.length === 0) {
      return;
    }
    const timer = setInterval(() => {
      const now = Date.now();
      setActiveRuns((runs) =>
        runs
          .map((run) =>
            run.status === "running" && now - run.startedAt > RUN_STALE_MS
              ? { ...run, status: "failed" as const }
              : run
          )
          .filter((run) => !(run.status === "failed" && now - run.startedAt > RUN_STALE_MS * 1.5))
      );
    }, 15_000);
    return () => clearInterval(timer);
  }, [activeRuns.length]);

  const dispatch = useMutation({
    mutationFn: () =>
      dispatchThread(workspaceId, {
        channelId,
        gestureId: uuidv7(),
        targetCommentId: latestCommentId,
        threadId,
      }),
    onError: (error) => {
      const kind =
        error instanceof ApiRequestError ? error.kind : "unknown_error";
      toast.error(`Could not dispatch the agent: ${kind}`);
    },
    onSuccess: (receipt) => {
      setActiveRuns((runs) => [
        ...runs,
        { runId: receipt.runId, startedAt: Date.now(), status: "running" },
      ]);
      refetchBranch();
    },
  });

  const branchKey = branchQuery(workspaceId, {
    channelId,
    rootCommentId,
    threadId,
  }).queryKey;

  // BACKLOG E7.4 optimistic append: the member's reply lands in the branch immediately
  // (nested under the latest comment) and is reconciled by the hub comment_added event or
  // the onSettled refetch. commentId is the idempotency key, so a retry converges (E8.4).
  const reply = useMutation<
    Comment,
    Error,
    { readonly body: string; readonly commentId: string },
    { readonly previous: BranchSnapshot | undefined }
  >({
    mutationFn: (input) =>
      appendComment(workspaceId, {
        body: input.body,
        channelId,
        commentId: input.commentId,
        gestureId: uuidv7(),
        parentCommentId: latestCommentId,
        threadId,
      }),
    onError: (error, _input, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(branchKey, context.previous);
      }
      const kind =
        error instanceof ApiRequestError ? error.kind : "unknown_error";
      toast.error(`Could not post your reply: ${kind}`);
    },
    onMutate: (input) => {
      const previous =
        queryClient.getQueryData<BranchSnapshot>(branchKey);
      const optimistic: Comment = {
        author: { kind: "member", memberId: "" },
        body: input.body,
        createdAt: new Date().toISOString(),
        id: input.commentId,
        parent: { kind: "nested", parentCommentId: latestCommentId },
        threadId,
        workspaceId,
      };
      if (previous !== undefined) {
        queryClient.setQueryData<BranchSnapshot>(branchKey, {
          ...previous,
          subtree: [...previous.subtree, optimistic],
        });
      }
      return { previous };
    },
    onSettled: () => refetchBranch(),
  });

  if (branch.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-6">
        <Skeleton className="h-16 w-3/4" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (branch.isError) {
    const kind =
      branch.error instanceof ApiRequestError
        ? branch.error.kind
        : "unknown_resource";
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-8">
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TriangleAlert />
            </EmptyMedia>
            <EmptyTitle>Thread unavailable</EmptyTitle>
            <EmptyDescription>
              This thread could not be loaded ({kind}).
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <>
      <MessageScrollerProvider>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto w-full max-w-2xl gap-4 px-6 py-6">
              {comments.map((comment) => (
                <MessageScrollerItem key={comment.id}>
                  <CommentItem comment={comment} depth={depthOf(comment, byId)} />
                </MessageScrollerItem>
              ))}
              {activeRuns.map((run) => (
                <MessageScrollerItem key={run.runId} scrollAnchor>
                  <RunCardLive run={run} />
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton direction="end" />
        </MessageScroller>
      </MessageScrollerProvider>

      <footer className="shrink-0 border-border border-t px-6 py-4">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
          <ThreadComposer
            onSubmit={(body) => reply.mutate({ body, commentId: uuidv7() })}
            pending={reply.isPending}
            placeholder="Reply in this thread…"
            submitLabel="Reply"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
              <span
                aria-hidden="true"
                className={
                  hubStatus === "open"
                    ? "size-2 rounded-full bg-success"
                    : "size-2 rounded-full bg-muted-foreground"
                }
              />
              {hubStatus === "open"
                ? "Live"
                : hubStatus === "connecting"
                  ? "Connecting…"
                  : "Reconnecting — updates may lag"}
            </span>
            <Button
              disabled={dispatch.isPending}
              onClick={() => dispatch.mutate()}
              size="sm"
              variant="outline"
            >
              {dispatch.isPending ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              Ask the agent to continue
            </Button>
          </div>
        </div>
      </footer>
    </>
  );
};

/**
 * Residual empty state (E8.4): the server now persists rootCommentId on every thread it
 * creates, so this is reachable only for a legacy dev row written before the column existed
 * (nullable, no backfill). Such a thread has no branch anchor to rehydrate from.
 */
const MissingRootNotice = () => (
  <div className="mx-auto w-full max-w-2xl px-6 py-8">
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <History />
        </EmptyMedia>
        <EmptyTitle>History not available</EmptyTitle>
        <EmptyDescription>
          This thread predates full-history support, so its opening comment cannot
          be located. Newer threads open with their complete history.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  </div>
);

export const Route = createFileRoute(
  "/w/$workspaceId/channels/$channelId/threads/$threadId"
)({
  component: ThreadView,
  validateSearch: (
    search: Record<string, unknown>
  ): { root?: string; run?: string } => ({
    root: typeof search.root === "string" ? search.root : undefined,
    run: typeof search.run === "string" ? search.run : undefined,
  }),
});
