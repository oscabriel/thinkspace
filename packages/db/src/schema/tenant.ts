import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const workspace = sqliteTable("workspace", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const channel = sqliteTable(
  "channel",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    goal: text("goal").notNull(),
    id: text("id").primaryKey(),
    lifecycle: text("lifecycle").notNull(),
    ownerMemberId: text("owner_member_id").notNull(),
    shapeId: text("shape_id").notNull(),
    visibility: text("visibility").notNull(),
    workspaceId: text("workspace_id").notNull(),
  },
  (table) => [
    index("channel_workspaceId_idx").on(table.workspaceId),
    uniqueIndex("channel_shapeId_unique").on(table.shapeId),
  ]
);

export const thread = sqliteTable(
  "thread",
  {
    channelId: text("channel_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    createdByMemberId: text("created_by_member_id").notNull(),
    id: text("id").primaryKey(),
    lastActivityAt: integer("last_activity_at", {
      mode: "timestamp_ms",
    }).notNull(),
    lifecycle: text("lifecycle").notNull(),
    name: text("name").notNull(),
    // E8.4: the thread's opening comment id — the branch anchor a threadId-only surface
    // needs. Nullable for dev rows that predate the column (no backfill; ADR 0025).
    rootCommentId: text("root_comment_id"),
    workspaceId: text("workspace_id").notNull(),
  },
  (table) => [
    index("thread_channelId_idx").on(table.channelId),
    index("thread_workspaceId_lastActivityAt_idx").on(
      table.workspaceId,
      table.lastActivityAt
    ),
  ]
);

export const unread = sqliteTable(
  "unread",
  {
    bumpedAt: integer("bumped_at", { mode: "timestamp_ms" }).notNull(),
    memberId: text("member_id").notNull(),
    reasons: text("reasons").notNull(),
    threadId: text("thread_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.memberId, table.threadId],
    }),
  ]
);

export const shape = sqliteTable(
  "shape",
  {
    clonedFrom: text("cloned_from"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    id: text("id").primaryKey(),
    structure: text("structure").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    workspaceId: text("workspace_id").notNull(),
  },
  (table) => [index("shape_workspaceId_idx").on(table.workspaceId)]
);

export const skill = sqliteTable(
  "skill",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    r2Key: text("r2_key").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    workspaceId: text("workspace_id").notNull(),
  },
  (table) => [index("skill_workspaceId_idx").on(table.workspaceId)]
);

export const workspaceProviderKey = sqliteTable(
  "workspace_provider_key",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    // ADR 0040: AES-256-GCM sealed provider key (`v1:<iv>:<ct>`) for the EnvelopeD1KeyStore.
    // Nullable and additive: rows registered under the legacy Secrets Store adapter carry null
    // until re-registered, so the migration is backward-compatible with existing keyed workspaces.
    keyCiphertext: text("key_ciphertext"),
    provider: text("provider").notNull(),
    workspaceId: text("workspace_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.provider] })]
);

export const artifact = sqliteTable(
  "artifact",
  {
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    headVersionId: text("head_version_id").notNull(),
    homeChannelId: text("home_channel_id").notNull(),
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    workspaceId: text("workspace_id").notNull(),
  },
  (table) => [index("artifact_workspaceId_idx").on(table.workspaceId)]
);

export const artifactVersion = sqliteTable(
  "artifact_version",
  {
    artifactId: text("artifact_id").notNull(),
    byteLength: integer("byte_length").notNull(),
    contentType: text("content_type").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    id: text("id").primaryKey(),
    mediaKind: text("media_kind").notNull(),
    origin: text("origin").notNull(),
    r2Key: text("r2_key").notNull(),
    seq: integer("seq").notNull(),
    workspaceId: text("workspace_id").notNull(),
  },
  (table) => [
    index("artifact_version_artifactId_seq_idx").on(
      table.artifactId,
      table.seq
    ),
  ]
);

export const mcpServer = sqliteTable(
  "mcp_server",
  {
    host: text("host").notNull(),
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    workspaceId: text("workspace_id").notNull(),
  },
  (table) => [index("mcp_server_workspaceId_idx").on(table.workspaceId)]
);

export const mcpHostApproval = sqliteTable(
  "mcp_host_approval",
  {
    approvedAt: integer("approved_at", { mode: "timestamp_ms" }).notNull(),
    approvedByOwnerMemberId: text("approved_by_owner_member_id").notNull(),
    host: text("host").notNull(),
    workspaceId: text("workspace_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.host] })]
);

export const workspaceToolDisable = sqliteTable(
  "workspace_tool_disable",
  {
    disabledAt: integer("disabled_at", { mode: "timestamp_ms" }).notNull(),
    disabledByMemberId: text("disabled_by_member_id").notNull(),
    toolId: text("tool_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.toolId] })]
);
