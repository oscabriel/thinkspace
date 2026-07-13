import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { providerAllowlist } from '@thinkspace/domain/provider-allowlist';
import type { ProviderAllowEntry, ProviderTier } from '@thinkspace/domain/provider-allowlist';
import { Button } from "@thinkspace/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@thinkspace/ui/components/empty";
import { Input } from "@thinkspace/ui/components/input";
import { Label } from "@thinkspace/ui/components/label";
import { Skeleton } from "@thinkspace/ui/components/skeleton";
import {
  CheckCircle2,
  KeyRound,
  Search,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ApiRequestError, registerProviderKey, removeProviderKey } from '@/lib/api';
import type { ProviderKeyStatus } from '@/lib/api';
import { providersQuery, workspaceKeys } from "@/lib/workspace-queries";

/**
 * E7.2 / E11.9 provider-key settings (ADR 0011 key-first, ADR 0036 byok gate, ADR 0038/0040 tiered
 * any-provider allowlist). The provider list is the domain's `providerAllowlist` — now models.dev-
 * derived at ~159 entries across three honest tiers — so the surface widens with the allowlist. At
 * that scale the page is search-first and tier-grouped rather than one big card per provider: a
 * keyed provider is pulled to the top, registrable providers group under Verified / Best-effort,
 * and Unsupported providers render greyed with a one-line reason and NO key form (never a dead
 * form). The key-first invariant still teaches: until a key is registered no agent can run. The raw
 * key is write-only — sent once to POST /providers/:p/key, never read back, cleared on success.
 * Registration is owner/admin only; the 403 kind surfaces as a teaching toast, not a broken form.
 */

/** Key-input placeholder by auth kind — cosmetic only; the domain owns which providers exist. */
const keyPlaceholderFor = (entry: ProviderAllowEntry): string =>
  entry.authKind === "x-api-key" ? "sk-ant-…" : "sk-…";

interface TierMeta {
  readonly label: string;
  readonly hint?: string;
  /** Section-heading blurb. */
  readonly blurb: string;
}

const TIER_META: Readonly<Record<ProviderTier, TierMeta>> = {
  "best-effort": {
    blurb:
      "One code path for the models.dev long tail. The first run confirms the key and endpoint work.",
    hint: "first run confirms",
    label: "Best-effort",
  },
  unsupported: {
    blurb:
      "These providers authenticate in a way we can't register a key for (request signing, OAuth, or a local/per-resource endpoint).",
    label: "Unsupported",
  },
  verified: {
    blurb: "Smoke-tested end to end with a real key.",
    label: "Verified",
  },
};

const TierBadge = ({ tier }: { readonly tier: ProviderTier }) => {
  const meta = TIER_META[tier];
  const tone =
    tier === "verified"
      ? "border-success/30 text-success"
      : tier === "best-effort"
        ? "border-border text-muted-foreground"
        : "border-border/60 text-muted-foreground/70";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[0.6875rem] leading-none ${tone}`}
    >
      {tier === "verified" && (
        <ShieldCheck aria-hidden="true" className="size-3" />
      )}
      {meta.label}
      {meta.hint !== undefined && (
        <span className="text-muted-foreground/60">· {meta.hint}</span>
      )}
    </span>
  );
};

const formatKeyedAt = (iso: string): string => {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? "recently"
    : parsed.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
};

interface RowActions {
  readonly expandedId: string | null;
  readonly isMutating: boolean;
  readonly onExpand: (id: string | null) => void;
  readonly onRegister: (entry: ProviderAllowEntry, key: string) => void;
  readonly onRemove: (entry: ProviderAllowEntry) => void;
}

const ProviderRow = ({
  entry,
  status,
  actions,
}: {
  readonly entry: ProviderAllowEntry;
  readonly status: ProviderKeyStatus | undefined;
  readonly actions: RowActions;
}) => {
  const [key, setKey] = useState("");
  const id = entry.provider;
  const isKeyed = status !== undefined;
  const isUnsupported = entry.tier === "unsupported";
  const isExpanded = actions.expandedId === id;
  const canSubmit = key.trim().length > 0 && !actions.isMutating;

  return (
    <li className="rounded-lg border border-border bg-background">
      <div className="flex items-center gap-3 px-3 py-2">
        <KeyRound
          aria-hidden="true"
          className={`size-4 ${isUnsupported ? "opacity-40" : "opacity-70"}`}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={`truncate font-medium text-sm ${isUnsupported ? "text-muted-foreground" : "text-foreground"}`}
          >
            {entry.displayName}
          </span>
          {isUnsupported && entry.unsupportedReason !== undefined && (
            <span className="truncate text-muted-foreground/70 text-xs">
              {entry.unsupportedReason}
            </span>
          )}
          {isKeyed && (
            <span className="flex items-center gap-1 text-success text-xs">
              <CheckCircle2 aria-hidden="true" className="size-3" />
              Key on file — registered {formatKeyedAt(status.createdAt)}
            </span>
          )}
        </div>
        <TierBadge tier={entry.tier} />
        {isKeyed ? (
          <Button
            disabled={actions.isMutating}
            onClick={() => actions.onRemove(entry)}
            size="sm"
            type="button"
            variant="outline"
          >
            Remove
          </Button>
        ) : isUnsupported ? null : (
          <Button
            onClick={() => actions.onExpand(isExpanded ? null : id)}
            size="sm"
            type="button"
            variant={isExpanded ? "outline" : "default"}
          >
            {isExpanded ? "Cancel" : "Register"}
          </Button>
        )}
      </div>
      {isExpanded && !isKeyed && !isUnsupported && (
        <form
          className="flex flex-col gap-2 border-border border-t px-3 py-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) {
              actions.onRegister(entry, key.trim());
              setKey("");
            }
          }}
        >
          <Label className="sr-only" htmlFor={`provider-key-${id}`}>
            {entry.displayName} API key
          </Label>
          <div className="flex items-center gap-2">
            <Input
              autoComplete="off"
              autoFocus
              id={`provider-key-${id}`}
              onChange={(event) => setKey(event.target.value)}
              placeholder={keyPlaceholderFor(entry)}
              spellCheck={false}
              type="password"
              value={key}
            />
            <Button disabled={!canSubmit} size="sm" type="submit">
              Save
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Stored encrypted; never logged or shown again. It is sent once and
            cleared the moment it is saved.
          </p>
        </form>
      )}
    </li>
  );
};

const TIER_ORDER: readonly ProviderTier[] = [
  "verified",
  "best-effort",
  "unsupported",
];

const ProvidersSettings = () => {
  const { workspaceId } = useParams({
    from: "/w/$workspaceId/settings/providers",
  });
  const providers = useQuery(providersQuery(workspaceId));
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: workspaceKeys.providers(workspaceId),
    });

  const register = useMutation({
    mutationFn: (input: {
      readonly entry: ProviderAllowEntry;
      readonly key: string;
    }) => registerProviderKey(workspaceId, input.entry.provider, input.key),
    onError: (error) => {
      const kind =
        error instanceof ApiRequestError ? error.kind : "unknown_error";
      toast.error(
        kind === "insufficient_role"
          ? "Only an owner or admin can register a provider key."
          : `Could not register key: ${kind}`
      );
    },
    onSuccess: (_data, input) => {
      setExpandedId(null);
      invalidate();
      toast.success(`${input.entry.displayName} key registered`);
    },
  });

  const remove = useMutation({
    mutationFn: (entry: ProviderAllowEntry) =>
      removeProviderKey(workspaceId, entry.provider),
    onError: (error) => {
      const kind =
        error instanceof ApiRequestError ? error.kind : "unknown_error";
      toast.error(
        kind === "insufficient_role"
          ? "Only an owner or admin can remove a provider key."
          : `Could not remove key: ${kind}`
      );
    },
    onSuccess: (_data, entry) => {
      invalidate();
      toast.success(`${entry.displayName} key removed`);
    },
  });

  const statusFor = (providerId: string): ProviderKeyStatus | undefined =>
    providers.data?.find((entry) => entry.provider === providerId);

  const query = search.trim().toLowerCase();
  const matches = (entry: ProviderAllowEntry): boolean =>
    query.length === 0 ||
    entry.displayName.toLowerCase().includes(query) ||
    entry.provider.toLowerCase().includes(query);

  const { keyed, byTier } = useMemo(() => {
    const keyedRows: ProviderAllowEntry[] = [];
    const tiers: Record<ProviderTier, ProviderAllowEntry[]> = {
      "best-effort": [],
      unsupported: [],
      verified: [],
    };
    for (const entry of providerAllowlist) {
      if (!matches(entry)) {
        continue;
      }
      if (statusFor(entry.provider) === undefined) {
        tiers[entry.tier].push(entry);
      } else {
        keyedRows.push(entry);
      }
    }
    return { byTier: tiers, keyed: keyedRows };
  }, [query, providers.data]);

  const actions: RowActions = {
    expandedId,
    isMutating: register.isPending || remove.isPending,
    onExpand: setExpandedId,
    onRegister: (entry, key) => register.mutate({ entry, key }),
    onRemove: (entry) => remove.mutate(entry),
  };

  const hasAnyKey = (providers.data?.length ?? 0) > 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-foreground text-xl tracking-tight">
          Provider keys
        </h1>
        <p className="text-muted-foreground text-sm">
          Bring your own key for any of {providerAllowlist.length} providers. A
          workspace is browsable without one, but no agent can run until a
          provider key is on file.
        </p>
      </header>

      {providers.isPending ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : providers.isError ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TriangleAlert />
            </EmptyMedia>
            <EmptyTitle>Could not load provider status</EmptyTitle>
            <EmptyDescription>
              This is usually transient — try again in a moment (
              {providers.error instanceof ApiRequestError
                ? providers.error.kind
                : "unknown_error"}
              ).
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {!hasAnyKey && (
            <p className="rounded-lg border border-border border-dashed bg-muted/40 px-4 py-3 text-muted-foreground text-sm">
              Register a key below to unlock agents. Only a workspace owner or
              admin can do this.
            </p>
          )}

          <div className="relative">
            <Search
              aria-hidden="true"
              className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground"
            />
            <Input
              aria-label="Search providers"
              className="pl-9"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search providers…"
              type="search"
              value={search}
            />
          </div>

          {keyed.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="font-medium text-foreground text-sm">Your keys</h2>
              <ul className="flex flex-col gap-2">
                {keyed.map((entry) => (
                  <ProviderRow
                    actions={actions}
                    entry={entry}
                    key={entry.provider}
                    status={statusFor(entry.provider)}
                  />
                ))}
              </ul>
            </section>
          )}

          {TIER_ORDER.map((tier) => {
            const rows = byTier[tier];
            if (rows.length === 0) {
              return null;
            }
            return (
              <section className="flex flex-col gap-2" key={tier}>
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="flex items-center gap-2 font-medium text-foreground text-sm">
                    {TIER_META[tier].label}
                    <span className="text-muted-foreground text-xs">
                      {rows.length}
                    </span>
                  </h2>
                </div>
                <p className="text-muted-foreground text-xs">
                  {TIER_META[tier].blurb}
                </p>
                <ul className="flex flex-col gap-2">
                  {rows.map((entry) => (
                    <ProviderRow
                      actions={actions}
                      entry={entry}
                      key={entry.provider}
                      status={undefined}
                    />
                  ))}
                </ul>
              </section>
            );
          })}

          {keyed.length === 0 &&
            TIER_ORDER.every((tier) => byTier[tier].length === 0) && (
              <p className="rounded-lg border border-border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
                No providers match “{search}”.
              </p>
            )}
        </>
      )}
    </div>
  );
};

export const Route = createFileRoute("/w/$workspaceId/settings/providers")({
  component: ProvidersSettings,
  ssr: false,
});
