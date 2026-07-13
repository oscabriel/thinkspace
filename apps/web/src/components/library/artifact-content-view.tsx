import { useQuery } from "@tanstack/react-query";
import { buttonVariants } from "@thinkspace/ui/components/button";
import { Skeleton } from "@thinkspace/ui/components/skeleton";
import { Download, FileWarning } from "lucide-react";
import { useEffect, useState } from "react";

import { ApiRequestError } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { artifactContentQuery } from "@/lib/workspace-queries";

/**
 * ADR 0031 trust boundary: artifact content is UNTRUSTED agent output. This viewer never
 * interprets it as markup — text/markdown renders as plain text in a <pre> (no
 * dangerouslySetInnerHTML, no markdown-to-HTML), images render through an <img> whose bytes
 * come from a same-origin object URL (the server already stamps `Content-Security-Policy:
 * sandbox` + `nosniff`, and an <img> context cannot execute scripts even for SVG), and
 * everything else is a download link only. The sandbox HTML viewer Worker is separate future
 * work; v1 deliberately renders no HTML. Media coverage is keyed off `contentType`:
 *   image/*                         → inline image
 *   text/* + common textual app/*   → plain-text <pre>
 *   anything else (binary/unknown)  → download-only
 */
type Rendering = "image" | "text" | "download";

const TEXTUAL_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "application/javascript",
  "application/json",
  "application/ld+json",
  "application/toml",
  "application/x-ndjson",
  "application/xml",
  "application/yaml",
]);

const baseMediaType = (contentType: string): string =>
  contentType.split(";")[0]?.trim().toLowerCase() ?? "";

const classify = (contentType: string): Rendering => {
  const base = baseMediaType(contentType);
  if (base.startsWith("image/")) {
    return "image";
  }
  if (base.startsWith("text/") || TEXTUAL_MEDIA_TYPES.has(base)) {
    return "text";
  }
  return "download";
};

/** Holds the object URL for a blob and revokes it when the blob changes or the view unmounts. */
const useObjectUrl = (blob: Blob | undefined): string | null => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
};

/** Reads a text blob into a string for plain-text rendering. */
const useBlobText = (
  blob: Blob | undefined,
  enabled: boolean
): string | null => {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!(blob && enabled)) {
      setText(null);
      return;
    }
    let cancelled = false;
    blob.text().then((value) => {
      if (!cancelled) {
        setText(value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [blob, enabled]);
  return text;
};

export const ArtifactContentView = ({
  artifactId,
  byteLength,
  contentType,
  name,
  versionId,
  workspaceId,
}: {
  readonly artifactId: string;
  readonly byteLength: number;
  readonly contentType: string;
  readonly name: string;
  readonly versionId: string;
  readonly workspaceId: string;
}) => {
  const rendering = classify(contentType);
  const content = useQuery(
    artifactContentQuery(workspaceId, artifactId, versionId)
  );
  const objectUrl = useObjectUrl(content.data);
  const text = useBlobText(content.data, rendering === "text");

  if (content.isPending) {
    return <Skeleton className="h-48 w-full rounded-xl" />;
  }

  if (content.isError || !content.data) {
    const kind =
      content.error instanceof ApiRequestError
        ? content.error.kind
        : "unknown_error";
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-muted-foreground text-sm">
        <FileWarning aria-hidden="true" className="size-4 shrink-0" />
        <span>This version&apos;s content could not be loaded ({kind}).</span>
      </div>
    );
  }

  if (rendering === "image" && objectUrl) {
    return (
      <div className="flex flex-col gap-2">
        <div className="overflow-auto rounded-xl border border-border bg-card p-3">
          <img
            alt={name}
            className="mx-auto max-h-[70vh] max-w-full object-contain"
            src={objectUrl}
          />
        </div>
        <DownloadRow name={name} url={objectUrl} />
      </div>
    );
  }

  if (rendering === "text") {
    return (
      <div className="flex flex-col gap-2">
        <div className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-card">
          <pre className="whitespace-pre-wrap break-words p-4 text-foreground text-sm leading-relaxed">
            {text ?? ""}
          </pre>
        </div>
        {objectUrl && <DownloadRow name={name} url={objectUrl} />}
      </div>
    );
  }

  // Binary / unknown: download only — the browser never interprets these bytes.
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-6">
      <p className="text-muted-foreground text-sm">
        This artifact is{" "}
        <span className="text-foreground">{baseMediaType(contentType)}</span> (
        {formatBytes(byteLength)}). It is not previewed inline — download it to
        open in the right application.
      </p>
      {objectUrl && <DownloadRow name={name} url={objectUrl} />}
    </div>
  );
};

const DownloadRow = ({
  name,
  url,
}: {
  readonly name: string;
  readonly url: string;
}) => (
  <a
    className={buttonVariants({ size: "sm", variant: "outline" })}
    download={name}
    href={url}
  >
    <Download aria-hidden="true" className="size-4" />
    Download
  </a>
);
