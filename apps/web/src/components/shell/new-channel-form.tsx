import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@thinkspace/ui/components/button";
import { Label } from "@thinkspace/ui/components/label";
import { Textarea } from "@thinkspace/ui/components/textarea";
import { useState } from "react";
import { toast } from "sonner";

import { ApiRequestError, createChannel, type Visibility } from "@/lib/api";
import {
  defaultShapeStructure,
  workspaceKeys,
} from "@/lib/workspace-queries";

/**
 * The sidebar's minimal channel-creation affordance. A channel is a goal (ADR 0016) plus a
 * shape; the shape form + model picker is sibling #29, so this collects only the goal and
 * visibility and PUTs a default-shaped channel (workspace-queries.ts DEFAULT_MODEL_ID). Inline
 * progressive disclosure, not a modal (DESIGN §6). On success the sidebar graph is invalidated
 * and we navigate into the new channel; on a domain error (e.g. no BYOK key for the default
 * model) we surface the kind verbatim.
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
    mutationFn: () => {
      const channelId = crypto.randomUUID();
      const shapeId = crypto.randomUUID();
      const trimmed = goal.trim();
      return createChannel(workspaceId, {
        channelId,
        goal: trimmed,
        shape: defaultShapeStructure(trimmed),
        shapeId,
        visibility: { kind: visibility },
      });
    },
    onError: (error) => {
      const kind =
        error instanceof ApiRequestError ? error.kind : "unknown_error";
      toast.error(`Could not create channel: ${kind}`);
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

  const canSubmit = goal.trim().length > 0 && !mutation.isPending;

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-sidebar-border bg-background/40 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          mutation.mutate();
        }
      }}
    >
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
        <p className="text-xs text-muted-foreground">
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

      <div className="flex items-center justify-end gap-2">
        <Button
          onClick={onDone}
          size="sm"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
        <Button disabled={!canSubmit} size="sm" type="submit">
          {mutation.isPending ? "Creating…" : "Create"}
        </Button>
      </div>
    </form>
  );
};
