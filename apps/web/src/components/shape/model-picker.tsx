import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@thinkspace/ui/components/empty";
import { Skeleton } from "@thinkspace/ui/components/skeleton";
import { cn } from "@thinkspace/ui/lib/utils";
import { Brain, Check, KeyRound, Sparkles, Wrench } from "lucide-react";

import { ApiRequestError, type Model } from "@/lib/api";
import { modelsQuery } from "@/lib/workspace-queries";

/**
 * The model picker (E7.5) — the teaching surface for what a provider key unlocks (ADR 0011
 * key-first). It lists the live catalog ∩ the workspace's keyed providers (GET /models); each
 * row presents the name, model-id chip (mono means code, DESIGN §3), per-Mtok cost, context
 * ceiling, and capability chips so the tradeoff a member is choosing is legible on its face
 * (DESIGN §2 data presentation). An empty list is not an error — it means no provider key is
 * registered, so the picker becomes a pointer to register one rather than a broken control.
 * Selection is the one cobalt affordance here (The Quiet Chrome Rule): the chosen row carries a
 * cobalt ring + tint, everything else stays neutral.
 */
export const ModelPicker = ({
  workspaceId,
  value,
  onChange,
  disabled,
}: {
  readonly workspaceId: string;
  readonly value: string | null;
  readonly onChange: (modelId: string) => void;
  readonly disabled?: boolean;
}) => {
  const models = useQuery(modelsQuery(workspaceId));

  if (models.isPending) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((row) => (
          <Skeleton className="h-16 w-full rounded-xl" key={row} />
        ))}
      </div>
    );
  }

  if (models.isError) {
    const kind =
      models.error instanceof ApiRequestError
        ? models.error.kind
        : "unknown_error";
    const unavailable = kind === "catalog_unavailable";
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>
            {unavailable ? "Model catalog unavailable" : "Could not load models"}
          </EmptyTitle>
          <EmptyDescription>
            {unavailable
              ? "The model catalog could not be reached just now — this is transient, try again in a moment."
              : `The model list could not be loaded (${kind}).`}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (models.data.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <KeyRound />
          </EmptyMedia>
          <EmptyTitle>No models available yet</EmptyTitle>
          <EmptyDescription>
            A channel can only use a model whose provider you have keyed.{" "}
            <Link
              className="font-medium text-primary underline-offset-4 hover:underline"
              params={{ workspaceId }}
              to="/w/$workspaceId/settings/providers"
            >
              Register a provider key
            </Link>{" "}
            to unlock the catalog — then this picker fills with the models that
            key opens.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div
      className="flex flex-col gap-2"
      role="radiogroup"
      aria-label="Model"
    >
      {models.data.map((model) => (
        <ModelRow
          disabled={disabled}
          key={model.id}
          model={model}
          onSelect={() => onChange(model.id)}
          selected={model.id === value}
        />
      ))}
    </div>
  );
};

/** Formats a per-1M-token price; models.dev cost is already USD per 1M tokens. */
const formatPrice = (perMtok: number): string =>
  perMtok === 0 ? "free" : `$${perMtok}`;

const formatContext = (tokens: number): string =>
  tokens >= 1000 ? `${Math.round(tokens / 1000)}K ctx` : `${tokens} ctx`;

const ModelRow = ({
  model,
  selected,
  onSelect,
  disabled,
}: {
  readonly model: Model;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
}) => (
  <button
    aria-checked={selected}
    className={cn(
      "flex w-full flex-col gap-2 rounded-xl border p-3 text-left transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      selected
        ? "border-primary bg-primary/5 ring-1 ring-primary"
        : "border-border bg-background hover:bg-accent/40",
      disabled && "pointer-events-none opacity-50"
    )}
    disabled={disabled}
    onClick={onSelect}
    role="radio"
    type="button"
  >
    <div className="flex items-start justify-between gap-2">
      <div className="flex flex-col gap-1">
        <span className="font-medium text-foreground text-sm leading-tight">
          {model.displayName}
        </span>
        <span className="w-fit rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[0.75rem] text-muted-foreground">
          {model.id}
        </span>
      </div>
      {selected && (
        <span
          aria-hidden="true"
          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          <Check className="size-3.5" />
        </span>
      )}
    </div>

    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
      <span>
        {formatPrice(model.cost.input)} in · {formatPrice(model.cost.output)} out
        <span className="text-muted-foreground/70"> /Mtok</span>
      </span>
      <span aria-hidden="true">·</span>
      <span>{formatContext(model.limits.context)}</span>
    </div>

    <div className="flex flex-wrap items-center gap-1.5">
      {model.capabilities.toolCall && (
        <CapabilityChip icon={Wrench} label="Tools" />
      )}
      {model.capabilities.reasoning && (
        <CapabilityChip icon={Brain} label="Reasoning" />
      )}
      {model.capabilities.attachment && (
        <CapabilityChip icon={Sparkles} label="Vision" />
      )}
      {model.capabilities.structuredOutput && (
        <CapabilityChip icon={Sparkles} label="Structured" />
      )}
    </div>
  </button>
);

const CapabilityChip = ({
  icon: Icon,
  label,
}: {
  readonly icon: typeof Wrench;
  readonly label: string;
}) => (
  <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground">
    <Icon aria-hidden="true" className="size-3" />
    {label}
  </span>
);
