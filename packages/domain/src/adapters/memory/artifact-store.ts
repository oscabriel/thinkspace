import type { Artifact, ArtifactVersion } from "../../artifact";
import { artifactIdSchema, artifactVersionIdSchema } from "../../ids";
import type { ArtifactId, ThreadId } from "../../ids";
import { r2KeySchema } from "../../primitives";
import { err, ok } from "../../result";
import { ARTIFACT_VERSION_CAP } from "../../seams/artifact-store";
import type { ArtifactBytes, ArtifactStore } from "../../seams/artifact-store";
import type { TenantContext } from "../../seams/tenant-data-access";
import type { ArtifactAccessScope } from "../../seams/tool-resolution";
import { hasSameId, idKey, isInTenant, tenantGuardViolation } from "./helpers";

/** Append-order bytes-metadata plus the bytes themselves for one stored version. */
interface StoredVersion {
  readonly bytes: ArtifactBytes;
  readonly version: ArtifactVersion;
}

/** Identity fields plus the append-only, newest-last version sequence. */
interface StoredArtifact {
  readonly createdAt: Date;
  readonly homeChannelId: Artifact["homeChannelId"];
  readonly id: ArtifactId;
  readonly name: Artifact["name"];
  readonly versions: StoredVersion[];
  readonly workspaceId: Artifact["workspaceId"];
}

/** Shared backing so multiple tenant contexts can address the same artifacts (tenant guard). */
export type MemoryArtifactState = Map<string, StoredArtifact>;

export const createMemoryArtifactState = (): MemoryArtifactState => new Map();

export interface MemoryArtifactStoreConfig {
  readonly clock?: () => Date;
  readonly context: TenantContext;
  readonly nextArtifactId?: () => Artifact["id"];
  readonly nextVersionId?: () => ArtifactVersion["id"];
  readonly state?: MemoryArtifactState;
}

let sequence = 0;
const nextSequence = (): number => {
  sequence += 1;
  return sequence;
};

const defaultArtifactId = (): Artifact["id"] =>
  artifactIdSchema.parse(`memory-artifact-${nextSequence()}`);

const defaultVersionId = (): ArtifactVersion["id"] =>
  artifactVersionIdSchema.parse(`memory-version-${nextSequence()}`);

const headVersion = (stored: StoredArtifact): StoredVersion => {
  const head = stored.versions.at(-1);
  if (head === undefined) {
    throw new Error("artifact invariant violated: no head version");
  }
  return head;
};

/** Projects the stored artifact over its head version (ADR 0032 head projection). */
const toArtifact = (stored: StoredArtifact): Artifact => {
  const head = headVersion(stored).version;
  return {
    byteLength: head.byteLength,
    contentType: head.contentType,
    createdAt: stored.createdAt,
    headVersionId: head.id,
    homeChannelId: stored.homeChannelId,
    id: stored.id,
    mediaKind: head.mediaKind,
    name: stored.name,
    origin: head.origin,
    r2Key: head.r2Key,
    updatedAt: head.createdAt,
    workspaceId: stored.workspaceId,
  };
};

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
  const nextVersionId = config.nextVersionId ?? defaultVersionId;
  const artifacts = config.state ?? createMemoryArtifactState();

  const tenantArtifacts = (): StoredArtifact[] =>
    [...artifacts.values()].filter((stored) =>
      isInTenant(config.context, stored)
    );

  return {
    append: async (input) => {
      const stored = artifacts.get(idKey(input.artifactId));
      if (stored === undefined) {
        return ok(null);
      }
      if (!isInTenant(config.context, stored)) {
        return err(tenantGuardViolation(config.context, stored.workspaceId));
      }

      const versionId = nextVersionId();
      const version: ArtifactVersion = {
        artifactId: stored.id,
        byteLength: input.bytes.data.byteLength,
        contentType: input.version.contentType,
        createdAt: clock(),
        id: versionId,
        mediaKind: input.version.mediaKind,
        origin: input.version.origin,
        r2Key: r2KeySchema.parse(
          `${config.context.workspaceId}/artifacts/${stored.id}/${versionId}`
        ),
        workspaceId: config.context.workspaceId,
      };
      stored.versions.push({ bytes: input.bytes, version });

      // ADR 0032 trim: drop the oldest version's row + bytes once past the cap.
      while (stored.versions.length > ARTIFACT_VERSION_CAP) {
        stored.versions.shift();
      }

      return ok(toArtifact(stored));
    },
    context: config.context,
    create: async (input) => {
      const artifactId = nextArtifactId();
      const versionId = nextVersionId();
      const createdAt = clock();
      const version: ArtifactVersion = {
        artifactId,
        byteLength: input.bytes.data.byteLength,
        contentType: input.version.contentType,
        createdAt,
        id: versionId,
        mediaKind: input.version.mediaKind,
        origin: input.version.origin,
        r2Key: r2KeySchema.parse(
          `${config.context.workspaceId}/artifacts/${artifactId}/${versionId}`
        ),
        workspaceId: config.context.workspaceId,
      };
      const stored: StoredArtifact = {
        createdAt,
        homeChannelId: input.draft.homeChannelId,
        id: artifactId,
        name: input.draft.name,
        versions: [{ bytes: input.bytes, version }],
        workspaceId: config.context.workspaceId,
      };
      artifacts.set(idKey(artifactId), stored);

      return ok(toArtifact(stored));
    },
    get: async (input) => {
      const stored = artifacts.get(idKey(input.artifactId));
      if (stored === undefined) {
        return ok(null);
      }
      if (!isInTenant(config.context, stored)) {
        return err(tenantGuardViolation(config.context, stored.workspaceId));
      }

      const selected =
        input.versionId === undefined
          ? headVersion(stored)
          : stored.versions.find((entry) =>
              hasSameId(entry.version.id, input.versionId ?? "")
            );
      if (selected === undefined) {
        return ok(null);
      }

      return ok({
        artifact: toArtifact(stored),
        bytes: selected.bytes,
        version: selected.version,
      });
    },
    head: async (input) => {
      const stored = artifacts.get(idKey(input.artifactId));
      if (stored === undefined) {
        return ok(null);
      }
      if (!isInTenant(config.context, stored)) {
        return err(tenantGuardViolation(config.context, stored.workspaceId));
      }
      return ok(toArtifact(stored));
    },
    list: async () => ok({ artifacts: tenantArtifacts().map(toArtifact) }),
    listVersions: async (input) => {
      const stored = artifacts.get(idKey(input.artifactId));
      if (stored === undefined) {
        return ok(null);
      }
      if (!isInTenant(config.context, stored)) {
        return err(tenantGuardViolation(config.context, stored.workspaceId));
      }

      return ok(stored.versions.toReversed().map((entry) => entry.version));
    },
    search: async (input) => {
      const results = tenantArtifacts()
        .map(toArtifact)
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

      return ok({ artifacts: results });
    },
  };
};
