import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { Button } from "@thinkspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@thinkspace/ui/components/card";
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
import { providerAllowlist } from "@thinkspace/domain/provider-allowlist";
import { CheckCircle2, KeyRound, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  ApiRequestError,
  type ProviderKeyStatus,
  registerProviderKey,
  removeProviderKey,
} from "@/lib/api";
import { providersQuery, workspaceKeys } from "@/lib/workspace-queries";

/**
 * E7.2 provider-key settings (ADR 0011 key-first, ADR 0036 byok gate, ADR 0038 multi-provider).
 * One card per allowlisted provider — the list of providers is the domain's `providerAllowlist`,
 * not a local constant, so the surface widens with the allowlist (ADR 0038 consequence). The page
 * teaches the key-first invariant: until a key is registered the workspace is browsable but no
 * agent can run. The raw key is write-only — it is sent once to POST /providers/:p/key, never read
 * back (GET /providers returns registry facts only), and the input is cleared the moment a submit
 * succeeds. Registration is owner/admin only; a member sees the 403 kind surfaced as a teaching
 * message rather than a dead form.
 */

/**
 * Presentation-only chrome per provider id — the display label and a provider-appropriate key
 * placeholder. Purely how a provider looks; the domain owns *which* providers exist. Any
 * allowlisted provider absent here falls back to a capitalized id + generic placeholder, so the
 * surface never breaks when the allowlist grows ahead of this map.
 */
const PROVIDER_PRESENTATION: Readonly<
  Record<string, { readonly label: string; readonly keyPlaceholder: string }>
> = {
  anthropic: { label: "Anthropic", keyPlaceholder: "sk-ant-…" },
  openai: { label: "OpenAI", keyPlaceholder: "sk-…" },
};

const presentationFor = (
  providerId: string
): { readonly label: string; readonly keyPlaceholder: string } =>
  PROVIDER_PRESENTATION[providerId] ?? {
    label: providerId.charAt(0).toUpperCase() + providerId.slice(1),
    keyPlaceholder: "sk-…",
  };

const PROVIDER_ROWS: readonly {
  readonly id: string;
  readonly label: string;
  readonly keyPlaceholder: string;
}[] = providerAllowlist.map((entry) => ({
  id: entry.provider,
  ...presentationFor(entry.provider),
}));

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

const ProviderKeyCard = ({
  provider,
  status,
  workspaceId,
}: {
  readonly provider: {
    readonly id: string;
    readonly label: string;
    readonly keyPlaceholder: string;
  };
  readonly status: ProviderKeyStatus | undefined;
  readonly workspaceId: string;
}) => {
  const [key, setKey] = useState("");
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: workspaceKeys.providers(workspaceId),
    });

  const register = useMutation({
    mutationFn: () => registerProviderKey(workspaceId, provider.id, key.trim()),
    onError: (error) => {
      const kind =
        error instanceof ApiRequestError ? error.kind : "unknown_error";
      toast.error(
        kind === "insufficient_role"
          ? "Only an owner or admin can register a provider key."
          : `Could not register key: ${kind}`
      );
    },
    onSuccess: () => {
      // The raw key must not linger in component state — clear it the instant it lands.
      setKey("");
      invalidate();
      toast.success(`${provider.label} key registered`);
    },
  });

  const remove = useMutation({
    mutationFn: () => removeProviderKey(workspaceId, provider.id),
    onError: (error) => {
      const kind =
        error instanceof ApiRequestError ? error.kind : "unknown_error";
      toast.error(
        kind === "insufficient_role"
          ? "Only an owner or admin can remove a provider key."
          : `Could not remove key: ${kind}`
      );
    },
    onSuccess: () => {
      invalidate();
      toast.success(`${provider.label} key removed`);
    },
  });

  const isKeyed = status !== undefined;
  const canSubmit = key.trim().length > 0 && !register.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound aria-hidden="true" className="size-4 opacity-80" />
          {provider.label}
        </CardTitle>
        <CardDescription>
          {isKeyed
            ? `Registered ${formatKeyedAt(status.createdAt)}. Agents in this workspace can run on ${provider.label} models.`
            : `No key yet. Agents cannot run on ${provider.label} models until a key is registered.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isKeyed ? (
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
              Key on file — the raw key is never displayed.
            </span>
            <Button
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              size="sm"
              type="button"
              variant="outline"
            >
              {remove.isPending ? "Removing…" : "Remove key"}
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (canSubmit) {
                register.mutate();
              }
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`provider-key-${provider.id}`}>
                {provider.label} API key
              </Label>
              <Input
                autoComplete="off"
                id={`provider-key-${provider.id}`}
                onChange={(event) => setKey(event.target.value)}
                placeholder={provider.keyPlaceholder}
                spellCheck={false}
                type="password"
                value={key}
              />
              <p className="text-xs text-muted-foreground">
                Stored encrypted in Cloudflare Secrets Store. It is never logged
                or shown again.
              </p>
            </div>
            <div className="flex justify-end">
              <Button disabled={!canSubmit} size="sm" type="submit">
                {register.isPending ? "Registering…" : "Register key"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
};

const ProvidersSettings = () => {
  const { workspaceId } = useParams({
    from: "/w/$workspaceId/settings/providers",
  });
  const providers = useQuery(providersQuery(workspaceId));

  const statusFor = (providerId: string): ProviderKeyStatus | undefined =>
    providers.data?.find((entry) => entry.provider === providerId);

  const hasAnyKey = (providers.data?.length ?? 0) > 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-foreground text-xl tracking-tight">
          Provider keys
        </h1>
        <p className="text-muted-foreground text-sm">
          Bring your own key. A workspace is browsable without one, but no agent
          can run until a provider key is on file — this is where you register
          it.
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
            <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              Register a key below to unlock agents. Only a workspace owner or
              admin can do this.
            </p>
          )}
          <div className="flex flex-col gap-4">
            {PROVIDER_ROWS.map((provider) => (
              <ProviderKeyCard
                key={provider.id}
                provider={provider}
                status={statusFor(provider.id)}
                workspaceId={workspaceId}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export const Route = createFileRoute("/w/$workspaceId/settings/providers")({
  component: ProvidersSettings,
  ssr: false,
});
