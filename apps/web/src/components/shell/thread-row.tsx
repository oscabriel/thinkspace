import { Link } from "@tanstack/react-router";
import { Skeleton } from "@thinkspace/ui/components/skeleton";
import { cn } from "@thinkspace/ui/lib/utils";

import {
  PostContent,
  PostContentSkeleton,
} from "@/components/thread/post-content";
import type { Thread } from "@/lib/api";
import { relativeTime } from "@/lib/format";

/** A thread rendered as a scan-friendly post; channelLabel keeps the same unit coherent on Home. */
export const ThreadRow = ({
  thread,
  unread,
  workspaceId,
  authorName,
  channelLabel,
}: {
  readonly thread: Thread;
  readonly unread: boolean;
  readonly workspaceId: string;
  readonly authorName?: string;
  readonly channelLabel?: string;
}) => {
  const archived = thread.lifecycle.state === "archived";
  const author = authorName || "Member";
  const replyCount = Math.max(0, thread.commentCount - 1);
  const route = {
    params: {
      channelId: thread.channelId,
      threadId: thread.id,
      workspaceId,
    },
    to: "/w/$workspaceId/channels/$channelId/threads/$threadId" as const,
  };

  return (
    <article
      className={cn(
        "relative border-b px-1 py-5 transition-colors last:border-b-0 hover:bg-muted/50",
        archived && "text-muted-foreground"
      )}
    >
      <PostContent
        avatarLabel={author}
        header={
          <>
            <span className="truncate font-medium text-foreground">
              {author}
            </span>
            {channelLabel && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{channelLabel}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="shrink-0">
              {relativeTime(thread.lastActivityAt)}
            </span>
          </>
        }
      >
        <div className="flex items-start justify-between gap-4">
          <Link
            {...route}
            className={cn(
              "font-medium text-title leading-snug after:absolute after:inset-0 after:rounded-md focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2",
              unread && "font-semibold"
            )}
            search={{ root: thread.rootCommentId ?? undefined }}
          >
            {thread.name}
          </Link>
          {unread && (
            <span
              aria-label="unread"
              className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
            />
          )}
        </div>
        {thread.openingExcerpt && (
          <p
            className={cn(
              "mt-2 line-clamp-3 max-w-[70ch] text-[0.9375rem] leading-6",
              archived ? "text-muted-foreground" : "text-foreground/90"
            )}
          >
            {thread.openingExcerpt}
          </p>
        )}
        <div className="relative z-10 mt-3 flex flex-wrap items-center gap-2 text-meta text-muted-foreground">
          <span>
            {replyCount} {replyCount === 1 ? "reply" : "replies"}
          </span>
          {archived && (
            <>
              <span aria-hidden="true">·</span>
              <span>archived</span>
            </>
          )}
          {thread.working && (
            <Link
              {...route}
              aria-label="Channel agent working; view run"
              className="inline-flex items-center gap-1.5 rounded-full bg-working/10 px-2 py-1 font-medium text-foreground transition-colors hover:bg-working/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              search={{
                root: thread.rootCommentId ?? undefined,
                run: thread.working.runId,
              }}
            >
              <span
                aria-hidden="true"
                className="size-2 rounded-full bg-working"
              />
              Working
            </Link>
          )}
        </div>
      </PostContent>
    </article>
  );
};

/** Post-shaped loading placeholder with the same avatar gutter and prose column as loaded posts. */
export const ThreadRowSkeleton = () => (
  <div className="border-b px-1 py-5 last:border-b-0">
    <PostContentSkeleton>
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="mt-2 h-3.5 w-full" />
      <Skeleton className="mt-2 h-3.5 w-4/5" />
      <Skeleton className="mt-3 h-3 w-20" />
    </PostContentSkeleton>
  </div>
);
