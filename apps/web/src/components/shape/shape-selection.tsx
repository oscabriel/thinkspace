import type { UseQueryResult } from "@tanstack/react-query";
import { Checkbox } from "@thinkspace/ui/components/checkbox";
import { Label } from "@thinkspace/ui/components/label";
import { Skeleton } from "@thinkspace/ui/components/skeleton";
import { cn } from "@thinkspace/ui/lib/utils";
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { ApiRequestError } from "@/lib/api";

/**
 * One multi-select section of the shape form (E10.5) — skills, MCP servers, or artifacts. Each
 * pool is a member-visible read that already exists end-to-end (E8.2 / ADR 0032); the ThreadAgent
 * resolves the frozen selection per turn (ADR 0037), so this surface only authors the id list a
 * shape carries. Presentation follows the model picker's vocabulary (DESIGN "The Reading Room"):
 * the checkbox is the one cobalt affordance (data-checked tint), rows stay neutral. Loading,
 * error, and empty follow the form's existing patterns — an empty pool is not an error but a
 * quiet one-line pointer to where the items are authored, never a blank void.
 */
export const ShapeSelectionSection = <TItem,>({
  label,
  description,
  result,
  itemId,
  itemLabel,
  itemMeta,
  emptyState,
  selected,
  onToggle,
  disabled,
}: {
  readonly label: string;
  readonly description: string;
  readonly result: UseQueryResult<readonly TItem[]>;
  readonly itemId: (item: TItem) => string;
  readonly itemLabel: (item: TItem) => string;
  /** Optional right-aligned mono metadatum (e.g. the MCP host) rendered per row. */
  readonly itemMeta?: (item: TItem) => string | undefined;
  /** The quiet one-line copy shown when the pool is empty — a pointer, not a card. */
  readonly emptyState: ReactNode;
  readonly selected: readonly string[];
  readonly onToggle: (id: string) => void;
  readonly disabled?: boolean;
}) => (
  <div className="flex flex-col gap-2">
    <Label className="text-sm">{label}</Label>
    <p className="text-muted-foreground text-xs">{description}</p>
    <SelectionBody
      disabled={disabled}
      emptyState={emptyState}
      itemId={itemId}
      itemLabel={itemLabel}
      itemMeta={itemMeta}
      label={label}
      onToggle={onToggle}
      result={result}
      selected={selected}
    />
  </div>
);

const SelectionBody = <TItem,>({
  label,
  result,
  itemId,
  itemLabel,
  itemMeta,
  emptyState,
  selected,
  onToggle,
  disabled,
}: {
  readonly label: string;
  readonly result: UseQueryResult<readonly TItem[]>;
  readonly itemId: (item: TItem) => string;
  readonly itemLabel: (item: TItem) => string;
  readonly itemMeta?: (item: TItem) => string | undefined;
  readonly emptyState: ReactNode;
  readonly selected: readonly string[];
  readonly onToggle: (id: string) => void;
  readonly disabled?: boolean;
}) => {
  if (result.isPending) {
    return (
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-9 w-2/3 rounded-lg" />
      </div>
    );
  }

  if (result.isError) {
    const kind =
      result.error instanceof ApiRequestError
        ? result.error.kind
        : "unknown_error";
    return (
      <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
        Could not load {label.toLowerCase()} ({kind}).
      </p>
    );
  }

  if (result.data.length === 0) {
    return (
      <p className="text-muted-foreground text-xs leading-relaxed">
        {emptyState}
      </p>
    );
  }

  const selectedIds = new Set(selected);

  return (
    <div
      aria-label={label}
      className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border"
      role="group"
    >
      {result.data.map((item) => {
        const id = itemId(item);
        const meta = itemMeta?.(item);
        return (
          <label
            className={cn(
              "flex cursor-pointer items-center gap-2.5 bg-background px-3 py-2 text-sm transition-colors hover:bg-accent/40",
              disabled && "pointer-events-none opacity-50"
            )}
            key={id}
          >
            <Checkbox
              checked={selectedIds.has(id)}
              disabled={disabled}
              onCheckedChange={() => onToggle(id)}
            />
            <span className="min-w-0 flex-1 truncate text-foreground">
              {itemLabel(item)}
            </span>
            {meta && (
              <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[0.75rem] text-muted-foreground">
                {meta}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
};
