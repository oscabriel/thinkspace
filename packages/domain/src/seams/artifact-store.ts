import type { Artifact, ArtifactMediaKind, ArtifactOrigin } from "../artifact";
import type {
  AuthzError,
  NotImplementedError,
  TenantGuardViolationError,
} from "../errors";
import type { ArtifactId, ChannelId, ThreadId } from "../ids";
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

export interface ArtifactBytes {
  readonly contentType: ContentType;
  readonly data: Uint8Array;
}

/**
 * Caller-supplied fields for a new artifact; workspaceId comes from the seam's TenantContext,
 * byteLength is computed from the bytes, and id/r2Key/createdAt are minted by the adapter.
 */
export interface ArtifactDraft {
  readonly contentType: ContentType;
  readonly homeChannelId: ChannelId;
  readonly mediaKind: ArtifactMediaKind;
  readonly name: ArtifactName;
  readonly origin: ArtifactOrigin;
}

export interface ArtifactWrite {
  readonly bytes: ArtifactBytes;
  readonly draft: ArtifactDraft;
}

export interface ArtifactRead {
  readonly artifactId: ArtifactId;
}

export interface ArtifactBlob {
  readonly artifact: Artifact;
  readonly bytes: ArtifactBytes;
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

/** R2 + virtual-FS seam for artifact blobs and lexical/metadata search indexes. */
export interface ArtifactStore {
  readonly context: TenantContext;
  readonly get: (
    input: ArtifactRead
  ) => AsyncResult<ArtifactBlob | null, ArtifactStoreError>;
  readonly put: (
    input: ArtifactWrite
  ) => AsyncResult<Artifact, ArtifactStoreError>;
  readonly search: (
    input: ArtifactSearch
  ) => AsyncResult<ArtifactSearchResult, ArtifactStoreError>;
}
