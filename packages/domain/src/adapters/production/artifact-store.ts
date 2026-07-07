import type {
  D1Database,
  D1PreparedStatement,
  R2Bucket,
} from "@cloudflare/workers-types";

import type {
  Artifact,
  ArtifactMediaKind,
  ArtifactOrigin,
  ArtifactVersion,
} from "../../artifact";
import { artifactIdSchema, artifactVersionIdSchema } from "../../ids";
import type { ThreadId } from "../../ids";
import { r2KeySchema } from "../../primitives";
import { err, ok } from "../../result";
import { ARTIFACT_VERSION_CAP } from "../../seams/artifact-store";
import type { ArtifactBytes, ArtifactStore } from "../../seams/artifact-store";
import type { TenantContext } from "../../seams/tenant-data-access";
import type { ArtifactAccessScope } from "../../seams/tool-resolution";
import {
  hasSameId,
  idKey,
  isInTenant,
  parseJsonColumn,
  tenantGuardViolation,
} from "../helpers";

export interface R2VirtualFsArtifactStoreConfig {
  readonly bucket: R2Bucket;
  readonly clock?: () => Date;
  readonly context: TenantContext;
  readonly db: D1Database;
  readonly nextArtifactId?: () => Artifact["id"];
  readonly nextVersionId?: () => ArtifactVersion["id"];
}

interface ArtifactRow {
  readonly created_at: number;
  readonly head_version_id: string;
  readonly home_channel_id: string;
  readonly id: string;
  readonly name: string;
  readonly updated_at: number;
  readonly workspace_id: string;
}

interface ArtifactVersionRow {
  readonly artifact_id: string;
  readonly byte_length: number;
  readonly content_type: string;
  readonly created_at: number;
  readonly id: string;
  readonly media_kind: string;
  readonly origin: string;
  readonly r2_key: string;
  readonly seq: number;
  readonly workspace_id: string;
}

/** A head projection needs the artifact identity row joined to its head version row. */
interface ArtifactHeadRow extends ArtifactRow {
  readonly head_byte_length: number;
  readonly head_content_type: string;
  readonly head_media_kind: string;
  readonly head_origin: string;
  readonly head_r2_key: string;
}

const HEAD_JOIN = `SELECT a.created_at, a.head_version_id, a.home_channel_id, a.id, a.name, a.updated_at, a.workspace_id,
  v.byte_length AS head_byte_length, v.content_type AS head_content_type, v.media_kind AS head_media_kind,
  v.origin AS head_origin, v.r2_key AS head_r2_key
  FROM artifact a JOIN artifact_version v ON v.id = a.head_version_id`;

const rowToArtifact = (row: ArtifactHeadRow): Artifact => ({
  byteLength: row.head_byte_length,
  contentType: row.head_content_type as Artifact["contentType"],
  createdAt: new Date(row.created_at),
  headVersionId: artifactVersionIdSchema.parse(row.head_version_id),
  homeChannelId: row.home_channel_id as Artifact["homeChannelId"],
  id: artifactIdSchema.parse(row.id),
  mediaKind: parseJsonColumn<ArtifactMediaKind>(row.head_media_kind),
  name: row.name as Artifact["name"],
  origin: parseJsonColumn<ArtifactOrigin>(row.head_origin),
  r2Key: r2KeySchema.parse(row.head_r2_key),
  updatedAt: new Date(row.updated_at),
  workspaceId: row.workspace_id as Artifact["workspaceId"],
});

const rowToVersion = (row: ArtifactVersionRow): ArtifactVersion => ({
  artifactId: artifactIdSchema.parse(row.artifact_id),
  byteLength: row.byte_length,
  contentType: row.content_type as ArtifactVersion["contentType"],
  createdAt: new Date(row.created_at),
  id: artifactVersionIdSchema.parse(row.id),
  mediaKind: parseJsonColumn<ArtifactMediaKind>(row.media_kind),
  origin: parseJsonColumn<ArtifactOrigin>(row.origin),
  r2Key: r2KeySchema.parse(row.r2_key),
  workspaceId: row.workspace_id as ArtifactVersion["workspaceId"],
});

const scopeIds = (scope: ArtifactAccessScope): Set<string> =>
  new Set(
    [...scope.artifactIds, ...scope.homeChannelArtifactIds].map((artifactId) =>
      idKey(artifactId)
    )
  );

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

const defaultArtifactId = (): Artifact["id"] =>
  artifactIdSchema.parse(`artifact-${crypto.randomUUID()}`);

const defaultVersionId = (): ArtifactVersion["id"] =>
  artifactVersionIdSchema.parse(`version-${crypto.randomUUID()}`);

const insertVersionStatement = (
  db: D1Database,
  version: ArtifactVersion,
  seq: number
): D1PreparedStatement =>
  db
    .prepare(
      `INSERT INTO artifact_version (id, artifact_id, byte_length, content_type, created_at, media_kind, origin, r2_key, seq, workspace_id)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
    )
    .bind(
      version.id,
      version.artifactId,
      version.byteLength,
      version.contentType,
      version.createdAt.getTime(),
      JSON.stringify(version.mediaKind),
      JSON.stringify(version.origin),
      version.r2Key,
      seq,
      version.workspaceId
    );

/** ADR 0032: R2 blobs keyed by version behind a D1 identity + append-only version index. */
export const createR2VirtualFsArtifactStore = (
  config: R2VirtualFsArtifactStoreConfig
): ArtifactStore => {
  const { bucket, context, db } = config;
  const clock = config.clock ?? (() => new Date());
  const nextArtifactId = config.nextArtifactId ?? defaultArtifactId;
  const nextVersionId = config.nextVersionId ?? defaultVersionId;

  const loadArtifactRow = (artifactId: string): Promise<ArtifactRow | null> =>
    db
      .prepare("SELECT * FROM artifact WHERE id = ?1")
      .bind(artifactId)
      .first<ArtifactRow>();

  const loadHead = async (artifactId: string): Promise<Artifact | null> => {
    const row = await db
      .prepare(`${HEAD_JOIN} WHERE a.id = ?1`)
      .bind(artifactId)
      .first<ArtifactHeadRow>();
    return row === null ? null : rowToArtifact(row);
  };

  const makeVersion = (
    artifactId: Artifact["id"],
    input: {
      readonly bytes: ArtifactBytes;
      readonly version: {
        readonly contentType: ArtifactVersion["contentType"];
        readonly mediaKind: ArtifactMediaKind;
        readonly origin: ArtifactOrigin;
      };
    }
  ): ArtifactVersion => {
    const versionId = nextVersionId();
    return {
      artifactId,
      byteLength: input.bytes.data.byteLength,
      contentType: input.version.contentType,
      createdAt: clock(),
      id: versionId,
      mediaKind: input.version.mediaKind,
      origin: input.version.origin,
      r2Key: r2KeySchema.parse(
        `${context.workspaceId}/artifacts/${artifactId}/${versionId}`
      ),
      workspaceId: context.workspaceId,
    };
  };

  const trimOldVersions = async (artifactId: string): Promise<void> => {
    const rows = await db
      .prepare(
        "SELECT id, r2_key FROM artifact_version WHERE artifact_id = ?1 ORDER BY seq ASC"
      )
      .bind(artifactId)
      .all<Pick<ArtifactVersionRow, "id" | "r2_key">>();
    const overflow = rows.results.length - ARTIFACT_VERSION_CAP;
    if (overflow <= 0) {
      return;
    }
    const doomed = rows.results.slice(0, overflow);
    await Promise.all(doomed.map((row) => bucket.delete(row.r2_key)));
    await db.batch(
      doomed.map((row) =>
        db.prepare("DELETE FROM artifact_version WHERE id = ?1").bind(row.id)
      )
    );
  };

  return {
    append: async (input) => {
      const row = await loadArtifactRow(input.artifactId);
      if (row === null) {
        return ok(null);
      }
      if (
        !isInTenant(context, {
          workspaceId: row.workspace_id as Artifact["workspaceId"],
        })
      ) {
        return err(
          tenantGuardViolation(
            context,
            row.workspace_id as Artifact["workspaceId"]
          )
        );
      }

      const version = makeVersion(input.artifactId, input);
      const maxSeq = await db
        .prepare(
          "SELECT MAX(seq) AS max_seq FROM artifact_version WHERE artifact_id = ?1"
        )
        .bind(input.artifactId)
        .first<{ max_seq: number | null }>();
      const seq = (maxSeq?.max_seq ?? -1) + 1;

      await bucket.put(version.r2Key, input.bytes.data);
      await db.batch([
        insertVersionStatement(db, version, seq),
        db
          .prepare(
            "UPDATE artifact SET head_version_id = ?1, updated_at = ?2 WHERE id = ?3"
          )
          .bind(version.id, version.createdAt.getTime(), input.artifactId),
      ]);
      await trimOldVersions(input.artifactId);

      return ok(await loadHead(input.artifactId));
    },
    context,
    create: async (input) => {
      const artifactId = nextArtifactId();
      const version = makeVersion(artifactId, input);

      await bucket.put(version.r2Key, input.bytes.data);
      await db.batch([
        db
          .prepare(
            `INSERT INTO artifact (id, created_at, head_version_id, home_channel_id, name, updated_at, workspace_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
          )
          .bind(
            artifactId,
            version.createdAt.getTime(),
            version.id,
            input.draft.homeChannelId,
            input.draft.name,
            version.createdAt.getTime(),
            context.workspaceId
          ),
        insertVersionStatement(db, version, 0),
      ]);

      const head = await loadHead(artifactId);
      if (head === null) {
        throw new Error(
          "artifact invariant violated: head missing after create"
        );
      }
      return ok(head);
    },
    get: async (input) => {
      const row = await loadArtifactRow(input.artifactId);
      if (row === null) {
        return ok(null);
      }
      if (
        !isInTenant(context, {
          workspaceId: row.workspace_id as Artifact["workspaceId"],
        })
      ) {
        return err(
          tenantGuardViolation(
            context,
            row.workspace_id as Artifact["workspaceId"]
          )
        );
      }

      const versionId = input.versionId ?? row.head_version_id;
      const versionRow = await db
        .prepare(
          "SELECT * FROM artifact_version WHERE id = ?1 AND artifact_id = ?2"
        )
        .bind(versionId, input.artifactId)
        .first<ArtifactVersionRow>();
      if (versionRow === null) {
        return ok(null);
      }

      const object = await bucket.get(versionRow.r2_key);
      if (object === null) {
        return ok(null);
      }

      const head = await loadHead(input.artifactId);
      if (head === null) {
        return ok(null);
      }
      const version = rowToVersion(versionRow);
      return ok({
        artifact: head,
        bytes: {
          contentType: version.contentType,
          data: new Uint8Array(await object.arrayBuffer()),
        },
        version,
      });
    },
    head: async (input) => {
      const row = await loadArtifactRow(input.artifactId);
      if (row === null) {
        return ok(null);
      }
      if (
        !isInTenant(context, {
          workspaceId: row.workspace_id as Artifact["workspaceId"],
        })
      ) {
        return err(
          tenantGuardViolation(
            context,
            row.workspace_id as Artifact["workspaceId"]
          )
        );
      }
      return ok(await loadHead(input.artifactId));
    },
    list: async () => {
      const rows = await db
        .prepare(
          `${HEAD_JOIN} WHERE a.workspace_id = ?1 ORDER BY a.updated_at DESC`
        )
        .bind(context.workspaceId)
        .all<ArtifactHeadRow>();
      return ok({ artifacts: rows.results.map(rowToArtifact) });
    },
    listVersions: async (input) => {
      const row = await loadArtifactRow(input.artifactId);
      if (row === null) {
        return ok(null);
      }
      if (
        !isInTenant(context, {
          workspaceId: row.workspace_id as Artifact["workspaceId"],
        })
      ) {
        return err(
          tenantGuardViolation(
            context,
            row.workspace_id as Artifact["workspaceId"]
          )
        );
      }

      const rows = await db
        .prepare(
          "SELECT * FROM artifact_version WHERE artifact_id = ?1 ORDER BY seq DESC"
        )
        .bind(input.artifactId)
        .all<ArtifactVersionRow>();
      return ok(rows.results.map(rowToVersion));
    },
    search: async (input) => {
      const rows = await db
        .prepare(`${HEAD_JOIN} WHERE a.workspace_id = ?1`)
        .bind(context.workspaceId)
        .all<ArtifactHeadRow>();
      const inScope = scopeIds(input.scope);
      const artifacts = rows.results
        .map(rowToArtifact)
        .filter((artifact) => inScope.has(idKey(artifact.id)))
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
