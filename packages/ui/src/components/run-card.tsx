import { Skeleton } from "@thinkspace/ui/components/skeleton";
import { cn } from "@thinkspace/ui/lib/utils";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import * as React from "react";

/**
 * Run card — the rendering of "agents propose, people decide" (DESIGN.md §5).
 * A run's output lands in the thread as a structured, attributed card with
 * explicit human controls. Status is never carried by color alone.
 */

type RunStatus = "queued" | "running" | "complete" | "failed";

const RunCard = ({
  className,
  status,
  ...props
}: React.ComponentProps<"article"> & { status: RunStatus }) => (
  <article
    data-slot="run-card"
    data-status={status}
    aria-busy={status === "running" || status === "queued"}
    className={cn(
      "group/run-card flex w-full min-w-0 flex-col gap-4 rounded-xl border bg-card p-5 text-card-foreground",
      className
    )}
    {...props}
  />
);

const RunCardHeader = ({
  className,
  ...props
}: React.ComponentProps<"header">) => (
  <header
    data-slot="run-card-header"
    className={cn("flex min-w-0 items-start justify-between gap-3", className)}
    {...props}
  />
);

const RunCardTitle = ({
  className,
  children,
  ...props
}: React.ComponentProps<"h3">) => (
  <h3
    data-slot="run-card-title"
    className={cn(
      "min-w-0 text-base leading-snug font-semibold text-balance",
      className
    )}
    {...props}
  >
    {children}
  </h3>
);

const runStatusDotVariants = cva("size-1.5 shrink-0 rounded-full", {
  defaultVariants: { status: "queued" },
  variants: {
    status: {
      complete: "bg-success",
      failed: "bg-destructive",
      queued: "bg-muted-foreground",
      running: "animate-pulse bg-working motion-reduce:animate-none",
    },
  },
});

const runStatusLabels: Record<RunStatus, string> = {
  complete: "Complete",
  failed: "Failed",
  queued: "Queued",
  running: "Running",
};

const RunCardStatus = ({
  className,
  status,
  children,
  ...props
}: React.ComponentProps<"span"> &
  Required<Pick<VariantProps<typeof runStatusDotVariants>, "status">>) => (
  <span
    data-slot="run-card-status"
    className={cn(
      "inline-flex shrink-0 items-center gap-1.5 text-[0.8125rem] font-medium text-muted-foreground",
      className
    )}
    {...props}
  >
    <span aria-hidden="true" className={runStatusDotVariants({ status })} />
    {children ?? runStatusLabels[status as RunStatus]}
  </span>
);

const RunCardBody = ({ className, ...props }: React.ComponentProps<"div">) => (
  <div
    data-slot="run-card-body"
    className={cn(
      "flex max-w-[70ch] min-w-0 flex-col gap-3 text-[0.9375rem] leading-[1.6] wrap-break-word",
      className
    )}
    {...props}
  />
);

/** Skeleton body for a running card — never a spinner in a void (DESIGN.md §5). */
const RunCardBodySkeleton = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div
    data-slot="run-card-body-skeleton"
    aria-hidden="true"
    className={cn("flex flex-col gap-2.5", className)}
    {...props}
  >
    <Skeleton className="h-3.5 w-4/5" />
    <Skeleton className="h-3.5 w-full" />
    <Skeleton className="h-3.5 w-3/5" />
  </div>
);

/** Labeled section for structured run output: Caveats, To do. */
const RunCardSection = ({
  className,
  label,
  children,
  ...props
}: React.ComponentProps<"section"> & { label: string }) => (
  <section
    data-slot="run-card-section"
    className={cn("flex min-w-0 flex-col gap-1.5", className)}
    {...props}
  >
    <h4 className="text-[0.8125rem] font-medium">{label}</h4>
    <ul className="flex list-disc flex-col gap-1 pl-4 text-sm leading-relaxed marker:text-muted-foreground">
      {children}
    </ul>
  </section>
);

/** Inline mono chip for file paths, branches, and model ids — mono means code. */
const RunCardCodeChip = ({
  className,
  ...props
}: React.ComponentProps<"code">) => (
  <code
    data-slot="run-card-code-chip"
    className={cn(
      "rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[0.875em] whitespace-nowrap",
      className
    )}
    {...props}
  />
);

/** Attribution edge: agent name, model chip, duration (Meta type). */
const RunCardMeta = ({
  className,
  ...props
}: React.ComponentProps<"footer">) => (
  <footer
    data-slot="run-card-meta"
    className={cn(
      "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground [&>[data-agent]]:font-medium [&>[data-agent]]:text-foreground",
      className
    )}
    {...props}
  />
);

/** Decisive action row: primary affirmative, secondary, destructive-as-text. */
const RunCardActions = ({
  className,
  ...props
}: React.ComponentProps<"div">) => (
  <div
    data-slot="run-card-actions"
    className={cn("flex flex-wrap items-center gap-2 pt-1", className)}
    {...props}
  />
);

export {
  RunCard,
  RunCardHeader,
  RunCardTitle,
  RunCardStatus,
  RunCardBody,
  RunCardBodySkeleton,
  RunCardSection,
  RunCardCodeChip,
  RunCardMeta,
  RunCardActions,
};
export type { RunStatus };
