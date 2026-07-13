import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@thinkspace/ui/components/empty";
import { Skeleton } from "@thinkspace/ui/components/skeleton";
import {
  FileText,
  Image as ImageIcon,
  Package,
  TriangleAlert,
} from "lucide-react";

import { formatBytes, relativeTime } from "@/lib/format";
import { channelArtifactsQuery } from "@/lib/workspace-queries";

const ChannelArtifacts = () => {
  const { channelId, workspaceId } = Route.useParams();
  const artifacts = useQuery(channelArtifactsQuery(workspaceId, channelId));
  if (artifacts.isPending)
    {return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton className="h-20 w-full rounded-xl" key={i} />
        ))}
      </div>
    );}
  if (artifacts.isError)
    {return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlert />
          </EmptyMedia>
          <EmptyTitle>Artifacts unavailable</EmptyTitle>
          <EmptyDescription>Try again in a moment.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );}
  if (artifacts.data.length === 0)
    {return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Package />
          </EmptyMedia>
          <EmptyTitle>No artifacts yet</EmptyTitle>
          <EmptyDescription>
            Artifacts your agent produces in this channel land here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );}
  return (
    <div className="flex flex-col gap-2">
      {artifacts.data.map((artifact) => {
        const Glyph = artifact.contentType.startsWith("image/")
          ? ImageIcon
          : FileText;
        return (
          <Link
            className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/40"
            key={artifact.id}
            params={{ artifactId: artifact.id, workspaceId }}
            to="/w/$workspaceId/library/$artifactId"
          >
            <div className="flex items-start gap-2">
              <Glyph
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
              <span className="truncate text-foreground text-sm leading-snug">
                {artifact.name}
              </span>
            </div>
            <div className="flex items-center gap-2 pl-6 text-muted-foreground text-xs">
              <span className="truncate">
                {artifact.contentType.split(";")[0]}
              </span>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(artifact.byteLength)}</span>
              <span aria-hidden="true">·</span>
              <span>updated {relativeTime(artifact.updatedAt)}</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
};

export const Route = createFileRoute(
  "/w/$workspaceId/channels/$channelId/artifacts"
)({ component: ChannelArtifacts });
