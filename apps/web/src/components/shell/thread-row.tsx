import { cn } from "@thinkspace/ui/lib/utils";

import type { Thread } from "@/lib/api";
import { relativeTime } from "@/lib/format";

/**
 * A single row in a recency feed — the shared unit of the cross-channel Home feed (ADR 0020)
 * and a channel's thread index. Thread navigation (the tree view + composer) is the thread
 * surface, sibling #28; until it lands these rows are non-interactive so the shell never links
 * to a route that does not exist yet. Unread bumps (ADR 0027) mark the name at 600 weight.
 */
export const ThreadRow = ({
  thread,
  unread,
  subtitle,
}: {
  readonly thread: Thread;
  readonly unread: boolean;
  readonly subtitle?: string;
}) => (
  <div className="flex items-baseline justify-between gap-4 border-b border-border px-1 py-3 last:border-b-0">
    <div className="flex min-w-0 flex-col gap-0.5">
      <span
        className={cn(
          "truncate text-sm text-foreground",
          unread && "font-semibold"
        )}
      >
        {thread.name}
      </span>
      {subtitle && (
        <span className="truncate text-xs text-muted-foreground">
          {subtitle}
        </span>
      )}
    </div>
    <div className="flex shrink-0 items-center gap-2">
      {unread && (
        <span
          aria-label="unread"
          className="size-2 rounded-full bg-working"
          title="Unread"
        />
      )}
      {thread.lifecycle.state === "archived" && (
        <span className="text-xs text-muted-foreground">archived</span>
      )}
      <span className="text-xs text-muted-foreground">
        {relativeTime(thread.lastActivityAt)}
      </span>
    </div>
  </div>
);
