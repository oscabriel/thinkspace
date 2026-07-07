import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useParams } from "@tanstack/react-router";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@thinkspace/ui/components/empty";
import { Input } from "@thinkspace/ui/components/input";
import { Skeleton } from "@thinkspace/ui/components/skeleton";
import { FileText, Image as ImageIcon, Library, Package } from "lucide-react";
import { useMemo, useState } from "react";

import type { Artifact } from "@/lib/api";
import { formatBytes, relativeTime } from "@/lib/format";
import { artifactsQuery } from "@/lib/workspace-queries";

/**
 * The Library (E7.6, ADR 0024/0032): every artifact an agent has produced in the workspace,
 * projected over its head version (name, media, size, when it last changed, home channel) and
 * ordered by recency as the read surface returns it. Writes come from agent runs only — there
 * is no upload UI — so an honest empty library teaches what will fill it. The name filter is a
 * trivial client-side narrow over the already-loaded head list; server-side artifact search
 * (ADR 0024) is separate future work.
 */
const LibraryScreen = () => {
  const { workspaceId } = useParams({ from: "/w/$workspaceId" });
  const artifacts = useQuery(artifactsQuery(workspaceId));
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = artifacts.data ?? [];
    if (needle.length === 0) {
      return list;
    }
    return list.filter((artifact) =>
      artifact.name.toLowerCase().includes(needle)
    );
  }, [artifacts.data, query]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-foreground text-xl tracking-tight">
          Library
        </h1>
        <p className="text-muted-foreground text-sm">
          Every artifact your agents have produced, newest first.
        </p>
      </header>

      {artifacts.data && artifacts.data.length > 0 && (
        <Input
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by name…"
          value={query}
        />
      )}

      {artifacts.isPending ? (
        <LibrarySkeleton />
      ) : results.length > 0 ? (
        <div className="flex flex-col gap-2">
          {results.map((artifact) => (
            <ArtifactCard
              artifact={artifact}
              key={artifact.id}
              workspaceId={workspaceId}
            />
          ))}
        </div>
      ) : artifacts.data && artifacts.data.length > 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Package />
            </EmptyMedia>
            <EmptyTitle>No artifacts match</EmptyTitle>
            <EmptyDescription>
              No artifact name contains “{query.trim()}”. Clear the filter to see
              everything your agents have made.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Library />
            </EmptyMedia>
            <EmptyTitle>Your agents&apos; artifacts land here</EmptyTitle>
            <EmptyDescription>
              When an agent writes a document, dataset, or image during a run, it
              is versioned and filed here. Create a channel and dispatch a thread
              to give an agent something to build.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
};

const ArtifactCard = ({
  artifact,
  workspaceId,
}: {
  readonly artifact: Artifact;
  readonly workspaceId: string;
}) => {
  const GlyphIcon = artifact.contentType.startsWith("image/")
    ? ImageIcon
    : FileText;

  return (
    <Link
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/40"
      params={{ artifactId: artifact.id, workspaceId }}
      to="/w/$workspaceId/library/$artifactId"
    >
      <div className="flex items-start gap-2">
        <GlyphIcon
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
        <span className="truncate text-foreground text-sm leading-snug">
          {artifact.name}
        </span>
      </div>
      <div className="flex items-center gap-2 pl-6 text-muted-foreground text-xs">
        <span className="truncate">{artifact.contentType.split(";")[0]}</span>
        <span aria-hidden="true">·</span>
        <span>{formatBytes(artifact.byteLength)}</span>
        <span aria-hidden="true">·</span>
        <span>updated {relativeTime(artifact.updatedAt)}</span>
      </div>
    </Link>
  );
};

const LibrarySkeleton = () => (
  <div className="flex flex-col gap-2">
    {[0, 1, 2, 3].map((row) => (
      <Skeleton className="h-20 w-full rounded-xl" key={row} />
    ))}
  </div>
);

export const Route = createFileRoute("/w/$workspaceId/library/")({
  component: LibraryScreen,
});
