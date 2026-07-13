import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  useParams,
} from "@tanstack/react-router";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@thinkspace/ui/components/empty";
import { Skeleton } from "@thinkspace/ui/components/skeleton";
import { Archive, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import {
  ApiRequestError,
  editChannelShape,
  type ShapeStructure,
} from "@/lib/api";
import { ShapeForm } from "@/components/shape/shape-form";
import {
  channelQuery,
  channelShapeQuery,
  workspaceKeys,
} from "@/lib/workspace-queries";

/** Maps an edit-failure kind to teaching copy; falls through to the raw kind otherwise. */
const editErrorMessage = (kind: string): string => {
  switch (kind) {
    case "insufficient_role": {
      return "Only the channel owner or a workspace admin can edit the shape.";
    }
    case "byok_key_missing": {
      return "That model's provider is not keyed for this workspace. Register a provider key in settings, then pick it here.";
    }
    case "model_not_in_catalog": {
      return "That model is no longer in the catalog — pick another.";
    }
    case "catalog_unavailable": {
      return "The model catalog is unavailable right now — try again in a moment.";
    }
    case "channel_read_only":
    case "channel_deleted": {
      return "This channel is archived or deleted — its shape can no longer be edited.";
    }
    default: {
      return `Could not save the shape: ${kind}`;
    }
  }
};

/**
 * The channel's Shape tab (E7.5): re-author an existing channel's shape (owner/admin only) via
 * PUT /channels/:channelId/shape. The current structure prefills from GET .../shape so the owner
 * edits from real values rather than blanking the config (ADR 0007). The server re-validates the
 * model against the BYOK gate + live catalog and resnapshots the channel's live threads (ADR 0007
 * explicit update, E5.2) — so existing threads pick up the new shape. A non-owner's PUT 403s and
 * a config conflict 409s; both surface as teaching copy. The channel header, meta, and tab bar
 * are owned by the parent layout route (`$channelId.tsx`); this tab renders only the form.
 */
const ShapeEditView = () => {
  const { channelId, workspaceId } = useParams({
    from: "/w/$workspaceId/channels/$channelId/shape",
  });
  const channel = useQuery(channelQuery(workspaceId, channelId));
  const shape = useQuery(channelShapeQuery(workspaceId, channelId));
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (structure: ShapeStructure) =>
      editChannelShape(workspaceId, channelId, structure),
    onError: (error) => {
      const kind =
        error instanceof ApiRequestError ? error.kind : "unknown_error";
      toast.error(editErrorMessage(kind));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.channel(workspaceId, channelId),
      });
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.channelShape(workspaceId, channelId),
      });
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.graph(workspaceId),
      });
      toast.success("Shape saved — existing threads pick up the new shape");

    },
  });

  if (channel.isPending || shape.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (channel.isError || !channel.data || shape.isError || !shape.data) {
    const kind =
      channel.error instanceof ApiRequestError
        ? channel.error.kind
        : shape.error instanceof ApiRequestError
          ? shape.error.kind
          : "unknown_resource";
    return (
      <div className="flex flex-col gap-4">
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TriangleAlert />
            </EmptyMedia>
            <EmptyTitle>Shape unavailable</EmptyTitle>
            <EmptyDescription>
              This channel does not exist or is not visible to you ({kind}).
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const archived = channel.data.lifecycle.state !== "active";
  const errorMessage =
    mutation.error instanceof ApiRequestError
      ? editErrorMessage(mutation.error.kind)
      : mutation.isError
        ? "Could not save the shape."
        : null;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm">
        Saving re-validates the model against your provider keys and updates
        every live thread in this channel.
      </p>

      {archived ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Archive />
            </EmptyMedia>
            <EmptyTitle>Channel is archived</EmptyTitle>
            <EmptyDescription>
              An archived or deleted channel&apos;s shape can no longer be
              edited. Restore the channel to change its agent.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ShapeForm
          errorMessage={errorMessage}
          initialArtifactSelection={shape.data.structure.artifactSelection}
          initialMcpServerSelection={shape.data.structure.mcpServerSelection}
          initialModelId={shape.data.structure.modelId}
          initialSkillSelection={shape.data.structure.skillSelection}
          initialSystemPrompt={shape.data.structure.systemPrompt}
          initialToolSelection={shape.data.structure.toolSelection}
          onCancel={() => undefined}
          onSubmit={(structure) => mutation.mutate(structure)}
          pending={mutation.isPending}
          pendingLabel="Saving…"
          submitLabel="Save shape"
          workspaceId={workspaceId}
        />
      )}
    </div>
  );
};

export const Route = createFileRoute(
  "/w/$workspaceId/channels/$channelId/shape"
)({
  component: ShapeEditView,
});
