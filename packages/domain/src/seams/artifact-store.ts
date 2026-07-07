import type {
  Artifact,
  ArtifactMediaKind,
  ArtifactOrigin,
  ArtifactVersion,
} from "../artifact";
import type {
  AuthzError,
  NotImplementedError,
  TenantGuardViolationError,
} from "../errors";
import type {
  ArtifactId,
  ArtifactVersionId,
  ChannelId,
  ThreadId,
} from "../ids";
import type {
  ArtifactName,
  ArtifactSearchQuery,
  ContentType,
} from "../primitives";
import type { AsyncResult } from "../result";
import type { TenantContext } from "./tenant-data-access";
import type { ArtifactAccessScope } from "./tool-resolution";

export type ArtifactStoreError =
  | AuthzError
  | NotImplementedError
  | TenantGuardViolationError;

/**
 * ADR 0032 baked decision 2: at most this many versions are retained per artifact. Writing
 * past the cap trims the oldest version — its D1 row and its R2 bytes both go.
 */
export const ARTIFACT_VERSION_CAP = 100;

export interface ArtifactBytes {
  readonly contentType: ContentType;
  readonly data: Uint8Array;
}

/**
 * Caller-supplied identity fields for a new artifact; workspaceId comes from the seam's
 * TenantContext, and id/head pointer/createdAt/updatedAt are minted by the adapter.
 */
export interface ArtifactDraft {
  readonly homeChannelId: ChannelId;
  readonly name: ArtifactName;
}

/**
 * Caller-supplied per-version metadata (ADR 0032): provenance and bytes-shape move to the
 * version, so byteLength is computed from the bytes and id/r2Key/createdAt are minted.
 */
export interface ArtifactVersionDraft {
  readonly contentType: ContentType;
  readonly mediaKind: ArtifactMediaKind;
  readonly origin: ArtifactOrigin;
}

/** Creates a new artifact identity with its first version. */
export interface ArtifactCreate {
  readonly bytes: ArtifactBytes;
  readonly draft: ArtifactDraft;
  readonly version: ArtifactVersionDraft;
}

/** Appends a version to an existing artifact and advances its head (ADR 0032). */
export interface ArtifactAppend {
  readonly artifactId: ArtifactId;
  readonly bytes: ArtifactBytes;
  readonly version: ArtifactVersionDraft;
}

/** Reads head by default; a pinned versionId reads that specific version's bytes. */
export interface ArtifactRead {
  readonly artifactId: ArtifactId;
  readonly versionId?: ArtifactVersionId;
}

export interface ArtifactVersionList {
  readonly artifactId: ArtifactId;
}

export interface ArtifactBlob {
  readonly artifact: Artifact;
  readonly bytes: ArtifactBytes;
  readonly version: ArtifactVersion;
}

export type ArtifactSearch =
  | {
      readonly kind: "lexical";
      readonly query: ArtifactSearchQuery;
      readonly scope: ArtifactAccessScope;
    }
  | {
      readonly channelId: ChannelId;
      readonly kind: "metadata";
      readonly mediaKind: ArtifactMediaKind;
      readonly scope: ArtifactAccessScope;
      readonly threadId: ThreadId | null;
    };

export interface ArtifactSearchResult {
  readonly artifacts: readonly Artifact[];
}

/**
 * R2 + D1 seam for versioned artifacts (ADR 0032): a stable identity over an append-only
 * sequence of immutable versions with a head pointer. Blobs live in R2 keyed by version;
 * head metadata and the version index live in D1. Search/list see the head only.
 */
export interface ArtifactStore {
  readonly context: TenantContext;
  /** Mints an artifact identity plus its first version; returns the head projection. */
  readonly create: (
    input: ArtifactCreate
  ) => AsyncResult<Artifact, ArtifactStoreError>;
  /** Appends a version and advances head; null for an unknown/out-of-tenant artifactId. */
  readonly append: (
    input: ArtifactAppend
  ) => AsyncResult<Artifact | null, ArtifactStoreError>;
  /** Head projection metadata without bytes; null for an unknown/out-of-tenant artifactId. */
  readonly head: (
    input: ArtifactVersionList
  ) => AsyncResult<Artifact | null, ArtifactStoreError>;
  /** Head bytes by default, or a pinned version's bytes; null when absent. */
  readonly get: (
    input: ArtifactRead
  ) => AsyncResult<ArtifactBlob | null, ArtifactStoreError>;
  /** Version history newest-first (head is first); null for an unknown artifactId. */
  readonly listVersions: (
    input: ArtifactVersionList
  ) => AsyncResult<readonly ArtifactVersion[] | null, ArtifactStoreError>;
  /** Every tenant artifact projected over its head version. */
  readonly list: () => AsyncResult<ArtifactSearchResult, ArtifactStoreError>;
  readonly search: (
    input: ArtifactSearch
  ) => AsyncResult<ArtifactSearchResult, ArtifactStoreError>;
}
