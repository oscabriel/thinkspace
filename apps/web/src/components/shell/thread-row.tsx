import { cn } from "@thinkspace/ui/lib/utils";

import type { Thread } from "@/lib/api";
import { relativeTime } from "@/lib/format";

/**
 * A single row in a recency feed — the shared unit of the cross-channel Home feed (ADR 0020)
 * and a channel's thread index. Thread navigation (the tree view + composer) is the thread
 * surface, sibling #28; until it lands these rows are non-interactive so the shell never links
 * to a route that does not exist yet. Unread bumps (ADR 0027) mark the name at 600 weight.
 *
 * Context line (E8.6): the Home feed passes `channelLabel` (the channel goal — goal-as-label,
 * no name column exists) so a cross-channel row says which channel it belongs to, and both
 * feeds pass `authorName` (the opener's display name from the roster read) so a row reads as a
 * person, not a truncated member id. Each is optional: the channel view omits the redundant
 * label, and either falls back gracefully to nothing while the roster/graph loads.
 */
export const ThreadRow = ({
  thread,
  unread,
  channelLabel,
  authorName,
}: {
  readonly thread: Thread;
  readonly unread: boolean;
  readonly channelLabel?: string;
  readonly authorName?: string;
}) => {
  const context = [channelLabel, authorName].filter(Boolean).join(" · ");

  return (
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
        {context && (
          <span className="truncate text-xs text-muted-foreground">
            {context}
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
};
