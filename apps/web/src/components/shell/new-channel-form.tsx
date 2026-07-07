import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Label } from "@thinkspace/ui/components/label";
import { Textarea } from "@thinkspace/ui/components/textarea";
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
 * The channel-creation affordance (E7.5, replacing E7.3's default-shape stub). A channel is a
 * goal (ADR 0016) plus a shape authored at birth (ADR 0030 snapshot-at-creation): the member
 * writes the goal, picks a model from the live catalog, and writes the system prompt in one pass.
 * Both the channelId and shapeId are client-minted so a replayed PUT converges on the same
 * channel-plus-shape pair (ADR 0034). On success the sidebar graph is invalidated and we navigate
 * into the new channel; a domain error (no BYOK key, model gone) surfaces as teaching copy.
 */
export const NewChannelForm = ({
  workspaceId,
  onDone,
}: {
  readonly workspaceId: string;
  readonly onDone: () => void;
}) => {
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
      toast.error(createErrorMessage(kind));
    },
    onSuccess: (channel) => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.graph(workspaceId),
      });
      toast.success("Channel created");
      onDone();
      navigate({
        params: { channelId: channel.id, workspaceId },
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

  return (
    <div className="rounded-lg border border-sidebar-border bg-background/40 p-3">
      <ShapeForm
        errorMessage={errorMessage}
        extraDisabled={goal.trim().length === 0}
        header={
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs" htmlFor="new-channel-goal">
                Channel goal
              </Label>
              <Textarea
                autoFocus
                className="min-h-16 text-sm"
                id="new-channel-goal"
                onChange={(event) => setGoal(event.target.value)}
                placeholder="e.g. Keep our ADRs consistent and cross-referenced"
                value={goal}
              />
              <p className="text-muted-foreground text-xs">
                The goal is the channel — it gives the agent its purpose.
              </p>
            </div>

            <div className="flex items-center gap-1 text-xs">
              {(["shared", "private"] as const).map((kind) => (
                <button
                  className={
                    visibility === kind
                      ? "rounded-full bg-primary px-3 py-1 font-medium text-primary-foreground"
                      : "rounded-full px-3 py-1 text-muted-foreground hover:bg-sidebar-accent"
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
        }
        onCancel={onDone}
        onSubmit={(shape) => mutation.mutate(shape)}
        pending={mutation.isPending}
        pendingLabel="Creating…"
        submitLabel="Create channel"
        workspaceId={workspaceId}
      />
    </div>
  );
};
