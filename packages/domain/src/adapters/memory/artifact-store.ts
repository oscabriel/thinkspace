import type { Artifact } from "../../artifact";
import { artifactIdSchema } from "../../ids";
import type { ThreadId } from "../../ids";
import { r2KeySchema } from "../../primitives";
import { err, ok } from "../../result";
import type { ArtifactBlob, ArtifactStore } from "../../seams/artifact-store";
import type { TenantContext } from "../../seams/tenant-data-access";
import type { ArtifactAccessScope } from "../../seams/tool-resolution";
import { hasSameId, idKey, isInTenant, tenantGuardViolation } from "./helpers";

export interface MemoryArtifactStoreConfig {
  readonly blobs?: readonly ArtifactBlob[];
  readonly clock?: () => Date;
  readonly context: TenantContext;
  readonly nextArtifactId?: () => Artifact["id"];
}

const defaultArtifactId = (): Artifact["id"] =>
  artifactIdSchema.parse(`memory-artifact-${Date.now()}-${Math.random()}`);

const scopeIds = (scope: ArtifactAccessScope): Set<string> =>
  new Set(
    [...scope.artifactIds, ...scope.homeChannelArtifactIds].map((artifactId) =>
      idKey(artifactId)
    )
  );

const isInScope = (artifact: Artifact, scope: ArtifactAccessScope): boolean =>
  scopeIds(scope).has(idKey(artifact.id));

const metadataThreadMatches = (
  artifact: Artifact,
  requestedThreadId: ThreadId | null
): boolean => {
  if (requestedThreadId === null) {
    return true;
  }

  return (
    artifact.origin.threadId !== null &&
    hasSameId(artifact.origin.threadId, requestedThreadId)
  );
};

export const createMemoryArtifactStore = (
  config: MemoryArtifactStoreConfig
): ArtifactStore => {
  const clock = config.clock ?? (() => new Date());
  const nextArtifactId = config.nextArtifactId ?? defaultArtifactId;
  const blobs = new Map(
    (config.blobs ?? []).map((blob) => [idKey(blob.artifact.id), blob])
  );

  return {
    context: config.context,
    get: async (input) => {
      const blob = blobs.get(idKey(input.artifactId));
      if (blob === undefined) {
        return ok(null);
      }

      return isInTenant(config.context, blob.artifact)
        ? ok(blob)
        : err(tenantGuardViolation(config.context, blob.artifact.workspaceId));
    },
    put: async (input) => {
      const artifactId = nextArtifactId();
      const artifact: Artifact = {
        byteLength: input.bytes.data.byteLength,
        contentType: input.draft.contentType,
        createdAt: clock(),
        homeChannelId: input.draft.homeChannelId,
        id: artifactId,
        mediaKind: input.draft.mediaKind,
        name: input.draft.name,
        origin: input.draft.origin,
        r2Key: r2KeySchema.parse(
          `${config.context.workspaceId}/artifacts/${artifactId}`
        ),
        workspaceId: config.context.workspaceId,
      };

      blobs.set(idKey(artifactId), { artifact, bytes: input.bytes });

      return ok(artifact);
    },
    search: async (input) => {
      const artifacts = [...blobs.values()]
        .map((blob) => blob.artifact)
        .filter((artifact) => isInTenant(config.context, artifact))
        .filter((artifact) => isInScope(artifact, input.scope))
        .filter((artifact) => {
          if (input.kind === "lexical") {
            return artifact.mediaKind.kind === "text_extractable";
          }

          return (
            hasSameId(artifact.homeChannelId, input.channelId) &&
            artifact.mediaKind.kind === input.mediaKind.kind &&
            metadataThreadMatches(artifact, input.threadId)
          );
        });

      return ok({ artifacts });
    },
  };
};
