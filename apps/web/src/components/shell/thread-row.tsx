import { cn } from "@thinkspace/ui/lib/utils";

import type { Thread } from "@/lib/api";
import { relativeTime } from "@/lib/format";

/** A thread rendered as a scan-friendly post; channelLabel keeps the same unit coherent on Home. */
export const ThreadRow = ({ thread, unread, channelLabel, authorName }: {
  readonly thread: Thread;
  readonly unread: boolean;
  readonly channelLabel?: string;
  readonly authorName?: string;
}) => {
  const archived = thread.lifecycle.state === "archived";
  return <article className={cn("flex flex-col gap-2 border-b px-1 py-5 last:border-b-0", archived && "text-muted-foreground")}>
    <div className="flex items-start justify-between gap-4">
      <h2 className={cn("text-sm font-semibold leading-snug", unread && "font-semibold", archived && "text-muted-foreground")}>{thread.name}</h2>
      {unread && <span aria-label="unread" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
    </div>
    {thread.openingExcerpt && <p className="line-clamp-3 text-[0.9375rem] leading-6 text-foreground/90">{thread.openingExcerpt}</p>}
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {channelLabel && <span>{channelLabel}</span>}
      {channelLabel && <span aria-hidden="true">·</span>}
      {authorName && <span>{authorName}</span>}
      <span aria-hidden="true">·</span>
      <span>{relativeTime(thread.lastActivityAt)}</span>
      <span aria-hidden="true">·</span>
      <span>{Math.max(0, thread.commentCount - 1)} {thread.commentCount === 2 ? "reply" : "replies"}</span>
      {archived && <><span aria-hidden="true">·</span><span>archived</span></>}
    </div>
  </article>;
};
