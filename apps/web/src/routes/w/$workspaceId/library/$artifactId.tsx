import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useParams } from "@tanstack/react-router";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@thinkspace/ui/components/empty";
import { Skeleton } from "@thinkspace/ui/components/skeleton";
import { cn } from "@thinkspace/ui/lib/utils";
import { ArrowLeft, Hash, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { ArtifactContentView } from "@/components/library/artifact-content-view";
import { ApiRequestError } from "@/lib/api";
import type { ArtifactVersion } from "@/lib/api";
import { absoluteTime, formatBytes } from "@/lib/format";
import { artifactQuery } from "@/lib/workspace-queries";

/**
 * Artifact detail (E7.6): the head metadata plus the append-only version history newest-first
 * with the head marked (ADR 0032). Selecting a version renders that version's bytes through the
 * trust-boundary viewer (ADR 0031) — content is never interpreted as markup. There is no diff
 * or compare view in v1 (ADR 0032 keeps it out) and no sandbox HTML viewer (ADR 0031's viewer
 * Worker is separate future work).
 */
const ARTIFACT_VERSION_CAP = 100;

const ArtifactDetailScreen = () => {
  const { artifactId, workspaceId } = useParams({
    from: "/w/$workspaceId/library/$artifactId",
  });
  const detail = useQuery(artifactQuery(workspaceId, artifactId));
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    null
  );

  if (detail.isPending) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-8">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (detail.isError || !detail.data) {
    const kind =
      detail.error instanceof ApiRequestError
        ? detail.error.kind
        : "unknown_resource";
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-8">
        <BackLink workspaceId={workspaceId} />
        <Empty className="mt-4 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <TriangleAlert />
            </EmptyMedia>
            <EmptyTitle>Artifact unavailable</EmptyTitle>
            <EmptyDescription>
              This artifact does not exist or is not visible to you ({kind}).
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const { artifact, versions } = detail.data;
  const activeVersion =
    versions.find((version) => version.id === selectedVersionId) ??
    versions.find((version) => version.id === artifact.headVersionId) ??
    versions[0];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
      <div className="flex flex-col gap-3">
        <BackLink workspaceId={workspaceId} />
        <header className="flex flex-col gap-3 border-border border-b pb-5">
          <h1 className="break-words font-semibold text-foreground text-xl leading-snug tracking-tight">
            {artifact.name}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
            <span className="truncate">
              {artifact.contentType.split(";")[0]}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatBytes(artifact.byteLength)}</span>
            <span aria-hidden="true">·</span>
            <span>updated {absoluteTime(artifact.updatedAt)}</span>
          </div>
          <Link
            className="flex w-fit items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground"
            params={{ channelId: artifact.homeChannelId, workspaceId }}
            to="/w/$workspaceId/channels/$channelId"
          >
            <Hash aria-hidden="true" className="size-3.5" />
            home channel
          </Link>
        </header>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium text-foreground text-sm">Content</h2>
        {activeVersion ? (
          <ArtifactContentView
            artifactId={artifact.id}
            byteLength={activeVersion.byteLength}
            contentType={activeVersion.contentType}
            key={activeVersion.id}
            name={artifact.name}
            versionId={activeVersion.id}
            workspaceId={workspaceId}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            This artifact has no versions.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium text-foreground text-sm">Version history</h2>
        <div className="flex flex-col gap-1.5">
          {versions.map((version) => (
            <VersionRow
              active={version.id === activeVersion?.id}
              isHead={version.id === artifact.headVersionId}
              key={version.id}
              onSelect={() => setSelectedVersionId(version.id)}
              version={version}
            />
          ))}
        </div>
        {versions.length >= ARTIFACT_VERSION_CAP && (
          <p className="text-muted-foreground text-xs">
            Only the most recent {ARTIFACT_VERSION_CAP} versions are retained.
          </p>
        )}
      </section>
    </div>
  );
};

const VersionRow = ({
  active,
  isHead,
  onSelect,
  version,
}: {
  readonly active: boolean;
  readonly isHead: boolean;
  readonly onSelect: () => void;
  readonly version: ArtifactVersion;
}) => (
  <button
    className={cn(
      "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
      active
        ? "border-primary/40 bg-primary/5"
        : "border-border bg-card hover:bg-muted/40"
    )}
    onClick={onSelect}
    type="button"
  >
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="flex items-center gap-2 text-foreground text-sm">
        {absoluteTime(version.createdAt)}
        {isHead && (
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 font-medium text-[0.6875rem] text-primary">
            Head
          </span>
        )}
      </span>
      <span className="truncate text-muted-foreground text-xs">
        {version.contentType.split(";")[0]} · {formatBytes(version.byteLength)}
      </span>
    </div>
    {active && (
      <span className="shrink-0 text-muted-foreground text-xs">viewing</span>
    )}
  </button>
);

const BackLink = ({ workspaceId }: { readonly workspaceId: string }) => (
  <Link
    className="flex w-fit items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
    params={{ workspaceId }}
    to="/w/$workspaceId/library"
  >
    <ArrowLeft aria-hidden="true" className="size-4" />
    Library
  </Link>
);

export const Route = createFileRoute("/w/$workspaceId/library/$artifactId")({
  component: ArtifactDetailScreen,
});
