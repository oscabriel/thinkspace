import type {
  D1Database,
  D1PreparedStatement,
} from "@cloudflare/workers-types";

import type { Channel } from "../../channel";
import type { ChannelDirectoryEntry } from "../../directory";
import { createNotImplementedError } from "../../errors";
import type { ShapeOwnershipViolationError } from "../../errors";
import type { ChannelId, WorkspaceId } from "../../ids";
import type { McpHostApproval, McpServer } from "../../mcp";
import { err, ok } from "../../result";
import type { Result } from "../../result";
import type {
  DataAccessContext,
  TenantContext,
  TenantDataAccess,
  TenantDataAccessError,
  TenantWriteCommand,
} from "../../seams/tenant-data-access";
import type { Shape } from "../../shape";
import type { Thread } from "../../thread";
import type { WorkspaceToolDisable } from "../../tool";
import type { Unread } from "../../unread";
import {
  hasSameId,
  isInTenant,
  parseJsonColumn,
  requireMemberContext,
  tenantGuardViolation,
} from "../helpers";
import type { TenantScoped } from "../helpers";

export interface D1TenantDataAccessConfig<
  Context extends DataAccessContext = TenantContext,
> {
  readonly context: Context;
  readonly db: D1Database;
}

interface ChannelRow {
  readonly created_at: number;
  readonly goal: string;
  readonly id: string;
  readonly lifecycle: string;
  readonly owner_member_id: string;
  readonly shape_id: string;
  readonly visibility: string;
  readonly workspace_id: string;
}

interface ThreadRow {
  readonly channel_id: string;
  readonly created_at: number;
  readonly created_by_member_id: string;
  readonly id: string;
  readonly last_activity_at: number;
  readonly lifecycle: string;
  readonly name: string;
  readonly root_comment_id: string | null;
  readonly workspace_id: string;
}

interface UnreadRow {
  readonly bumped_at: number;
  readonly member_id: string;
  readonly reasons: string;
  readonly thread_id: string;
  readonly workspace_id: string;
}

interface ShapeRow {
  readonly cloned_from: string | null;
  readonly created_at: number;
  readonly id: string;
  readonly structure: string;
  readonly updated_at: number;
  readonly workspace_id: string;
}

interface WorkspaceToolDisableRow {
  readonly disabled_at: number;
  readonly disabled_by_member_id: string;
  readonly tool_id: string;
  readonly workspace_id: string;
}

interface McpServerRow {
  readonly host: string;
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly workspace_id: string;
}

interface McpHostApprovalRow {
  readonly approved_at: number;
  readonly approved_by_owner_member_id: string;
  readonly host: string;
  readonly workspace_id: string;
}

const rowToChannel = (row: ChannelRow): Channel =>
  ({
    createdAt: new Date(row.created_at),
    goal: row.goal,
    id: row.id,
    lifecycle: parseJsonColumn(row.lifecycle),
    ownerMemberId: row.owner_member_id,
    shapeId: row.shape_id,
    visibility: parseJsonColumn(row.visibility),
    workspaceId: row.workspace_id,
  }) as Channel;

const rowToThread = (row: ThreadRow): Thread =>
  ({
    channelId: row.channel_id,
    createdAt: new Date(row.created_at),
    createdByMemberId: row.created_by_member_id,
    id: row.id,
    lastActivityAt: new Date(row.last_activity_at),
    lifecycle: parseJsonColumn(row.lifecycle),
    name: row.name,
    rootCommentId: row.root_comment_id,
    workspaceId: row.workspace_id,
  }) as Thread;

const rowToUnread = (row: UnreadRow): Unread =>
  ({
    bumpedAt: new Date(row.bumped_at),
    memberId: row.member_id,
    reasons: parseJsonColumn(row.reasons),
    threadId: row.thread_id,
    workspaceId: row.workspace_id,
  }) as Unread;

const rowToShape = (row: ShapeRow): Shape =>
  ({
    clonedFrom:
      row.cloned_from === null ? null : parseJsonColumn(row.cloned_from),
    createdAt: new Date(row.created_at),
    id: row.id,
    structure: parseJsonColumn(row.structure),
    updatedAt: new Date(row.updated_at),
    workspaceId: row.workspace_id,
  }) as Shape;

const rowToWorkspaceToolDisable = (
  row: WorkspaceToolDisableRow
): WorkspaceToolDisable =>
  ({
    disabledAt: new Date(row.disabled_at),
    disabledByMemberId: row.disabled_by_member_id,
    toolId: row.tool_id,
    workspaceId: row.workspace_id,
  }) as WorkspaceToolDisable;

const toDirectoryEntry = (channel: Channel): ChannelDirectoryEntry => ({
  channelId: channel.id,
  goal: channel.goal,
  lifecycle: channel.lifecycle,
  ownerMemberId: channel.ownerMemberId,
  visibility: channel.visibility,
});

const rowToMcpServer = (row: McpServerRow): McpServer =>
  ({
    host: row.host,
    id: row.id,
    name: row.name,
    url: row.url,
    workspaceId: row.workspace_id,
  }) as McpServer;

const rowToMcpHostApproval = (row: McpHostApprovalRow): McpHostApproval =>
  ({
    approvedAt: new Date(row.approved_at),
    approvedByOwnerMemberId: row.approved_by_owner_member_id,
    host: row.host,
    workspaceId: row.workspace_id,
  }) as McpHostApproval;

const isVisibleToMember = (context: TenantContext, channel: Channel): boolean =>
  channel.visibility.kind === "shared" ||
  hasSameId(channel.ownerMemberId, context.memberId);

/** The tenant-scoped payload a write command must prove membership for; null = key-only delete. */
const commandScopedValue = (
  command: TenantWriteCommand
): TenantScoped | null => {
  switch (command.kind) {
    case "create_thread_index": {
      return command.thread;
    }
    case "put_channel": {
      return command.channel;
    }
    case "put_mcp_host_approval": {
      return command.hostApproval;
    }
    case "put_mcp_server": {
      return command.mcpServer;
    }
    case "put_shape": {
      return command.shape;
    }
    case "put_thread_index": {
      return command.thread;
    }
    case "put_unread": {
      return command.unread;
    }
    case "put_workspace_tool_disable": {
      return command.toolDisable;
    }
    default: {
      return null;
    }
  }
};

const commandToStatement = (
  db: D1Database,
  context: DataAccessContext,
  command: TenantWriteCommand
): D1PreparedStatement | null => {
  switch (command.kind) {
    case "create_thread_index": {
      return db
        .prepare(
          `INSERT INTO thread (id, channel_id, created_at, created_by_member_id, last_activity_at, lifecycle, name, root_comment_id, workspace_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
           ON CONFLICT (id) DO NOTHING`
        )
        .bind(
          command.thread.id,
          command.thread.channelId,
          command.thread.createdAt.getTime(),
          command.thread.createdByMemberId,
          command.thread.lastActivityAt.getTime(),
          JSON.stringify(command.thread.lifecycle),
          command.thread.name,
          command.thread.rootCommentId,
          command.thread.workspaceId
        );
    }
    case "delete_unread": {
      return db
        .prepare(
          "DELETE FROM unread WHERE workspace_id = ?1 AND member_id = ?2 AND thread_id = ?3"
        )
        .bind(context.workspaceId, command.memberId, command.threadId);
    }
    case "delete_mcp_host_approval": {
      return db
        .prepare(
          "DELETE FROM mcp_host_approval WHERE workspace_id = ?1 AND host = ?2"
        )
        .bind(context.workspaceId, command.host);
    }
    case "delete_workspace_tool_disable": {
      return db
        .prepare(
          "DELETE FROM workspace_tool_disable WHERE workspace_id = ?1 AND tool_id = ?2"
        )
        .bind(context.workspaceId, command.toolId);
    }
    case "put_channel": {
      return db
        .prepare(
          `INSERT INTO channel (id, created_at, goal, lifecycle, owner_member_id, shape_id, visibility, workspace_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
           ON CONFLICT (id) DO UPDATE SET created_at = excluded.created_at, goal = excluded.goal,
             lifecycle = excluded.lifecycle, owner_member_id = excluded.owner_member_id,
             shape_id = excluded.shape_id, visibility = excluded.visibility, workspace_id = excluded.workspace_id`
        )
        .bind(
          command.channel.id,
          command.channel.createdAt.getTime(),
          command.channel.goal,
          JSON.stringify(command.channel.lifecycle),
          command.channel.ownerMemberId,
          command.channel.shapeId,
          JSON.stringify(command.channel.visibility),
          command.channel.workspaceId
        );
    }
    case "put_mcp_host_approval": {
      return db
        .prepare(
          `INSERT INTO mcp_host_approval (workspace_id, host, approved_at, approved_by_owner_member_id)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (workspace_id, host) DO UPDATE SET
             approved_at = excluded.approved_at,
             approved_by_owner_member_id = excluded.approved_by_owner_member_id`
        )
        .bind(
          command.hostApproval.workspaceId,
          command.hostApproval.host,
          command.hostApproval.approvedAt.getTime(),
          command.hostApproval.approvedByOwnerMemberId
        );
    }
    case "put_mcp_server": {
      return db
        .prepare(
          `INSERT INTO mcp_server (id, host, name, url, workspace_id)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT (id) DO UPDATE SET host = excluded.host, name = excluded.name,
             url = excluded.url, workspace_id = excluded.workspace_id`
        )
        .bind(
          command.mcpServer.id,
          command.mcpServer.host,
          command.mcpServer.name,
          command.mcpServer.url,
          command.mcpServer.workspaceId
        );
    }
    case "put_shape": {
      return db
        .prepare(
          `INSERT INTO shape (id, cloned_from, created_at, structure, updated_at, workspace_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT (id) DO UPDATE SET cloned_from = excluded.cloned_from, created_at = excluded.created_at,
             structure = excluded.structure, updated_at = excluded.updated_at, workspace_id = excluded.workspace_id`
        )
        .bind(
          command.shape.id,
          command.shape.clonedFrom === null
            ? null
            : JSON.stringify(command.shape.clonedFrom),
          command.shape.createdAt.getTime(),
          JSON.stringify(command.shape.structure),
          command.shape.updatedAt.getTime(),
          command.shape.workspaceId
        );
    }
    case "put_thread_index": {
      return db
        .prepare(
          `INSERT INTO thread (id, channel_id, created_at, created_by_member_id, last_activity_at, lifecycle, name, root_comment_id, workspace_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
           ON CONFLICT (id) DO UPDATE SET channel_id = excluded.channel_id, created_at = excluded.created_at,
             created_by_member_id = excluded.created_by_member_id, last_activity_at = excluded.last_activity_at,
             lifecycle = excluded.lifecycle, name = excluded.name, root_comment_id = excluded.root_comment_id,
             workspace_id = excluded.workspace_id`
        )
        .bind(
          command.thread.id,
          command.thread.channelId,
          command.thread.createdAt.getTime(),
          command.thread.createdByMemberId,
          command.thread.lastActivityAt.getTime(),
          JSON.stringify(command.thread.lifecycle),
          command.thread.name,
          command.thread.rootCommentId,
          command.thread.workspaceId
        );
    }
    case "put_unread": {
      return db
        .prepare(
          `INSERT INTO unread (workspace_id, member_id, thread_id, bumped_at, reasons)
           VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT (workspace_id, member_id, thread_id) DO UPDATE SET
             bumped_at = excluded.bumped_at, reasons = excluded.reasons`
        )
        .bind(
          command.unread.workspaceId,
          command.unread.memberId,
          command.unread.threadId,
          command.unread.bumpedAt.getTime(),
          JSON.stringify(command.unread.reasons)
        );
    }
    case "put_workspace_tool_disable": {
      return db
        .prepare(
          `INSERT INTO workspace_tool_disable (workspace_id, tool_id, disabled_at, disabled_by_member_id)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (workspace_id, tool_id) DO UPDATE SET
             disabled_at = excluded.disabled_at, disabled_by_member_id = excluded.disabled_by_member_id`
        )
        .bind(
          command.toolDisable.workspaceId,
          command.toolDisable.toolId,
          command.toolDisable.disabledAt.getTime(),
          command.toolDisable.disabledByMemberId
        );
    }
    default: {
      return null;
    }
  }
};

/**
 * ADR 0030: a Shape row is only ever written alongside / on behalf of its one channel.
 * Mirrors the memory adapter's replay over existing ownership plus in-batch claims.
 */
const validateShapeOwnership = (
  context: DataAccessContext,
  commands: readonly TenantWriteCommand[],
  existingOwners: ReadonlyMap<string, ChannelId>
): ShapeOwnershipViolationError | null => {
  const owningChannelByShapeId = new Map(existingOwners);

  for (const command of commands) {
    if (command.kind !== "put_channel") {
      continue;
    }

    const owningChannelId = owningChannelByShapeId.get(command.channel.shapeId);
    if (
      owningChannelId !== undefined &&
      !hasSameId(owningChannelId, command.channel.id)
    ) {
      return {
        kind: "shape_ownership_violation",
        shapeId: command.channel.shapeId,
        violation: { kind: "shape_already_owned", owningChannelId },
        workspaceId: context.workspaceId,
      };
    }

    owningChannelByShapeId.set(command.channel.shapeId, command.channel.id);
  }

  for (const command of commands) {
    if (command.kind !== "put_shape") {
      continue;
    }

    if (!owningChannelByShapeId.has(command.shape.id)) {
      return {
        kind: "shape_ownership_violation",
        shapeId: command.shape.id,
        violation: { kind: "unowned_shape_write" },
        workspaceId: context.workspaceId,
      };
    }
  }

  return null;
};

const notImplemented = async (seam: string) =>
  err(createNotImplementedError(seam));

/** Fail-closed read: a row visible by key but outside the tenant is a guard violation, not a miss. */
const guardedRow = <Row extends { readonly workspace_id: string }, Value>(
  context: DataAccessContext,
  row: Row | null,
  revive: (row: Row) => Value
): Result<Value | null, TenantDataAccessError> => {
  if (row === null) {
    return ok(null);
  }

  return hasSameId(row.workspace_id, context.workspaceId)
    ? ok(revive(row))
    : err(tenantGuardViolation(context, row.workspace_id as WorkspaceId));
};

/** ADR 0009: single shared D1, every read/write tenant-guarded by the resident context. */
export const createD1TenantDataAccess = <
  Context extends DataAccessContext = TenantContext,
>(
  config: D1TenantDataAccessConfig<Context>
): TenantDataAccess<Context> => {
  const { context, db } = config;

  const listTenantChannels = async (): Promise<readonly Channel[]> => {
    const rows = await db
      .prepare("SELECT * FROM channel WHERE workspace_id = ?1")
      .bind(context.workspaceId)
      .all<ChannelRow>();
    return rows.results.map(rowToChannel);
  };

  return {
    batch: async (input) => {
      if (!hasSameId(input.workspaceId, context.workspaceId)) {
        return err(tenantGuardViolation(context, input.workspaceId));
      }

      for (const command of input.commands) {
        const scopedValue = commandScopedValue(command);
        if (scopedValue !== null && !isInTenant(context, scopedValue)) {
          return err(tenantGuardViolation(context, scopedValue.workspaceId));
        }
      }

      const ownerRows = await db
        .prepare("SELECT id, shape_id FROM channel WHERE workspace_id = ?1")
        .bind(context.workspaceId)
        .all<Pick<ChannelRow, "id" | "shape_id">>();
      const existingOwners = new Map(
        ownerRows.results.map((row) => [row.shape_id, row.id as ChannelId])
      );
      const ownershipViolation = validateShapeOwnership(
        context,
        input.commands,
        existingOwners
      );
      if (ownershipViolation !== null) {
        return err(ownershipViolation);
      }

      const statements: D1PreparedStatement[] = [];
      for (const command of input.commands) {
        const statement = commandToStatement(db, context, command);
        if (statement === null) {
          return err(
            createNotImplementedError(
              `D1TenantDataAccess.batch.${command.kind}`
            )
          );
        }
        statements.push(statement);
      }

      await db.batch(statements);

      return ok({
        commandCount: input.commands.length,
        workspaceId: context.workspaceId,
      });
    },
    context,
    getArtifact: async (_input) =>
      notImplemented("D1TenantDataAccess.getArtifact"),
    getChannel: async (input) => {
      const row = await db
        .prepare("SELECT * FROM channel WHERE id = ?1")
        .bind(input.channelId)
        .first<ChannelRow>();
      return guardedRow(context, row, rowToChannel);
    },
    getMcpHostApproval: async (input) => {
      const row = await db
        .prepare(
          "SELECT * FROM mcp_host_approval WHERE workspace_id = ?1 AND host = ?2"
        )
        .bind(context.workspaceId, input.host)
        .first<McpHostApprovalRow>();
      return guardedRow(context, row, rowToMcpHostApproval);
    },
    getMcpServer: async (input) => {
      const row = await db
        .prepare("SELECT * FROM mcp_server WHERE id = ?1")
        .bind(input.mcpServerId)
        .first<McpServerRow>();
      return guardedRow(context, row, rowToMcpServer);
    },
    getSchedule: async (_input) =>
      notImplemented("D1TenantDataAccess.getSchedule"),
    getShape: async (input) => {
      const row = await db
        .prepare("SELECT * FROM shape WHERE id = ?1")
        .bind(input.shapeId)
        .first<ShapeRow>();
      return guardedRow(context, row, rowToShape);
    },
    getSkill: async (_input) => notImplemented("D1TenantDataAccess.getSkill"),
    getWorkspaceGraph: async () => {
      const member = requireMemberContext(context);
      if (!member.ok) {
        return member;
      }

      const channels = (await listTenantChannels())
        .filter((channel) => channel.lifecycle.state !== "deleted")
        .filter((channel) => isVisibleToMember(member.value, channel))
        .map(toDirectoryEntry);

      return ok({ channels, workspaceId: context.workspaceId });
    },
    listArtifacts: async () =>
      notImplemented("D1TenantDataAccess.listArtifacts"),
    listChannelFavorites: async (_input) =>
      notImplemented("D1TenantDataAccess.listChannelFavorites"),
    listChannelThreads: async (input) => {
      const rows = await db
        .prepare(
          "SELECT * FROM thread WHERE workspace_id = ?1 AND channel_id = ?2 ORDER BY last_activity_at DESC"
        )
        .bind(context.workspaceId, input.channelId)
        .all<ThreadRow>();
      return ok({
        channelId: input.channelId,
        threads: rows.results.map(rowToThread),
        workspaceId: context.workspaceId,
      });
    },
    listChannels: async (_input) => {
      const member = requireMemberContext(context);
      if (!member.ok) {
        return member;
      }

      return notImplemented("D1TenantDataAccess.listChannels");
    },
    listMcpHostApprovals: async () => {
      const rows = await db
        .prepare("SELECT * FROM mcp_host_approval WHERE workspace_id = ?1")
        .bind(context.workspaceId)
        .all<McpHostApprovalRow>();
      return ok(rows.results.map(rowToMcpHostApproval));
    },
    listMcpServers: async () => {
      const rows = await db
        .prepare("SELECT * FROM mcp_server WHERE workspace_id = ?1")
        .bind(context.workspaceId)
        .all<McpServerRow>();
      return ok(rows.results.map(rowToMcpServer));
    },
    listMemberUnread: async (input) => {
      const rows = await db
        .prepare(
          "SELECT * FROM unread WHERE workspace_id = ?1 AND member_id = ?2"
        )
        .bind(context.workspaceId, input.memberId)
        .all<UnreadRow>();
      return ok(rows.results.map(rowToUnread));
    },
    listRecentThreads: async (input) => {
      const member = requireMemberContext(context);
      if (!member.ok) {
        return member;
      }

      const tenantChannels = await listTenantChannels();
      const visibleChannelIds = new Set(
        tenantChannels
          .filter((channel) => channel.lifecycle.state !== "deleted")
          .filter((channel) => isVisibleToMember(member.value, channel))
          .map((channel) => channel.id as string)
      );

      const rows =
        input.before === null
          ? await db
              .prepare(
                "SELECT * FROM thread WHERE workspace_id = ?1 ORDER BY last_activity_at DESC"
              )
              .bind(context.workspaceId)
              .all<ThreadRow>()
          : await db
              .prepare(
                "SELECT * FROM thread WHERE workspace_id = ?1 AND last_activity_at < ?2 ORDER BY last_activity_at DESC"
              )
              .bind(context.workspaceId, input.before.getTime())
              .all<ThreadRow>();

      const threads = rows.results
        .map(rowToThread)
        .filter((thread) => visibleChannelIds.has(thread.channelId))
        .slice(0, input.limit);

      return ok({ threads, workspaceId: context.workspaceId });
    },
    listSkills: async () => notImplemented("D1TenantDataAccess.listSkills"),
    listWorkspaceToolDisables: async () => {
      const rows = await db
        .prepare("SELECT * FROM workspace_tool_disable WHERE workspace_id = ?1")
        .bind(context.workspaceId)
        .all<WorkspaceToolDisableRow>();
      return ok(rows.results.map(rowToWorkspaceToolDisable));
    },
  };
};
