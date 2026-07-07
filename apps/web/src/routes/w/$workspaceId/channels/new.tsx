import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  createFileRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { Label } from "@thinkspace/ui/components/label";
import { Textarea } from "@thinkspace/ui/components/textarea";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  ApiRequestError,
  createChannel,
  type ShapeStructure,
  type Visibility,
} from "@/lib/api";
import { ShapeForm } from "@/components/shape/shape-form";
import { workspaceKeys } from "@/lib/workspace-queries";

/** Maps a create-failure kind to teaching copy; falls through to the raw kind for anything else. */
const createErrorMessage = (kind: string): string => {
  switch (kind) {
    case "byok_key_missing": {
      return "That model's provider is not keyed for this workspace. Register a provider key in settings, then pick it here.";
    }
    case "model_not_in_catalog": {
      return "That model is no longer in the catalog — pick another.";
    }
    case "catalog_unavailable": {
      return "The model catalog is unavailable right now — try again in a moment.";
    }
    default: {
      return `Could not create channel: ${kind}`;
    }
  }
};

/**
 * The channel-creation surface (E8.5, promoted out of the sidebar rail). A channel is a goal
 * (ADR 0016) plus a shape authored at birth (ADR 0030 snapshot-at-creation): the member writes
 * the goal, picks visibility, chooses a model from the live catalog, and writes the system prompt
 * in one full-width pass — the same ShapeForm the rail once crammed into ~230px, now given a
 * max-width reading column to breathe. Both the channelId and shapeId are client-minted so a
 * replayed PUT converges on the same channel-plus-shape pair (ADR 0034). On success the sidebar
 * graph is invalidated and we navigate into the new channel; a domain error (no BYOK key, model
 * gone) surfaces as teaching copy, with byok_key_missing pointing at the provider-key settings.
 */
const NewChannelView = () => {
  const { workspaceId } = useParams({
    from: "/w/$workspaceId/channels/new",
  });
  const [goal, setGoal] = useState("");
  const [visibility, setVisibility] = useState<Visibility["kind"]>("shared");
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: (shape: ShapeStructure) =>
      createChannel(workspaceId, {
        channelId: crypto.randomUUID(),
        goal: goal.trim(),
        shape,
        shapeId: crypto.randomUUID(),
        visibility: { kind: visibility },
      }),
    onError: (error) => {
      const kind =
        error instanceof ApiRequestError ? error.kind : "unknown_error";
      // Key-first teaching (ADR 0011): an unkeyed workspace gets a pointer to the provider-key
      // settings, not a dead end on copy alone.
      if (kind === "byok_key_missing") {
        toast.error(createErrorMessage(kind), {
          action: {
            label: "Register a key",
            onClick: () =>
              navigate({
                params: { workspaceId },
                to: "/w/$workspaceId/settings/providers",
              }),
          },
        });
        return;
      }
      toast.error(createErrorMessage(kind));
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.graph(workspaceId),
      });
      toast.success("Channel created");
      navigate({
        params: { channelId: created.channel.id, workspaceId },
        to: "/w/$workspaceId/channels/$channelId",
      });
    },
  });

  const errorMessage =
    mutation.error instanceof ApiRequestError
      ? createErrorMessage(mutation.error.kind)
      : mutation.isError
        ? "Could not create channel."
        : null;

  const backLink = (
    <Link
      className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
      params={{ workspaceId }}
      to="/w/$workspaceId"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      Back to workspace
    </Link>
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
      {backLink}

      <header className="flex flex-col gap-2 border-border border-b pb-5">
        <h1 className="font-semibold text-foreground text-xl leading-snug tracking-tight">
          New channel
        </h1>
        <p className="text-muted-foreground text-sm">
          A channel is a goal plus the shape of the agent that pursues it. Both
          are authored here, once, at birth.
        </p>
      </header>

      <ShapeForm
        errorMessage={errorMessage}
        extraDisabled={goal.trim().length === 0}
        header={
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label className="text-sm" htmlFor="new-channel-goal">
                Channel goal
              </Label>
              <p className="text-muted-foreground text-xs">
                The goal is the channel — it gives the agent its purpose.
              </p>
              <Textarea
                autoFocus
                className="min-h-20 text-sm"
                id="new-channel-goal"
                onChange={(event) => setGoal(event.target.value)}
                placeholder="e.g. Keep our ADRs consistent and cross-referenced"
                value={goal}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label className="text-sm">Visibility</Label>
              <p className="text-muted-foreground text-xs">
                Shared channels are visible to the whole workspace; private
                channels stay with their members.
              </p>
              <div className="flex items-center gap-1 text-sm">
                {(["shared", "private"] as const).map((kind) => (
                  <button
                    className={
                      visibility === kind
                        ? "rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground transition-colors"
                        : "rounded-full px-3 py-1 text-muted-foreground transition-colors hover:bg-muted"
                    }
                    key={kind}
                    onClick={() => setVisibility(kind)}
                    type="button"
                  >
                    {kind === "shared" ? "Shared" : "Private"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        }
        onCancel={() =>
          navigate({ params: { workspaceId }, to: "/w/$workspaceId" })
        }
        onSubmit={(shape) => mutation.mutate(shape)}
        pending={mutation.isPending}
        pendingLabel="Creating…"
        submitLabel="Create channel"
        workspaceId={workspaceId}
      />
    </div>
  );
};

export const Route = createFileRoute("/w/$workspaceId/channels/new")({
  component: NewChannelView,
  ssr: false,
});
