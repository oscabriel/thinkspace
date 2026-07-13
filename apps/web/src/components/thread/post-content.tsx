import { Skeleton } from "@thinkspace/ui/components/skeleton";
import { cn } from "@thinkspace/ui/lib/utils";
import type { ReactNode } from "react";

const avatarInitial = (label: string): string =>
  label.trim().charAt(0).toLocaleUpperCase() || "?";

/**
 * Shared social-post geometry for feed posts and thread comments. The 28px avatar and 12px
 * gutter are deliberate: attribution and prose align to one stable content column everywhere.
 */
export const PostContent = ({
  avatarLabel,
  children,
  className,
  header,
}: {
  readonly avatarLabel: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly header: ReactNode;
}) => (
  <div
    className={cn(
      "grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-x-3",
      className
    )}
  >
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-foreground text-xs"
    >
      {avatarInitial(avatarLabel)}
    </span>
    <header className="flex min-h-7 min-w-0 items-center gap-2 text-meta text-muted-foreground">
      {header}
    </header>
    <div className="col-start-2 mt-2 min-w-0">{children}</div>
  </div>
);

/** Loading twin for PostContent; callers supply body lines so the placeholder matches its surface. */
export const PostContentSkeleton = ({
  children,
  className,
  headerWidth = "w-32",
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly headerWidth?: string;
}) => (
  <div
    className={cn(
      "grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-x-3",
      className
    )}
  >
    <Skeleton className="size-7 rounded-full" />
    <div className="flex min-h-7 items-center">
      <Skeleton className={cn("h-3", headerWidth)} />
    </div>
    <div className="col-start-2 mt-2 min-w-0">{children}</div>
  </div>
);
