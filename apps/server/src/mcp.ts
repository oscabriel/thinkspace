import {
  createD1TenantDataAccess,
  createProductionThreadAgentDirectory,
  createWorkerMcpEgressPolicy,
} from "@thinkspace/domain/adapters/production";
import { createMcpRegistrationFlow } from "@thinkspace/domain/flows/mcp-registration";
import type { McpServerId } from "@thinkspace/domain/ids";
import {
  channelIdSchema,
  mcpServerIdSchema,
  threadIdSchema,
} from "@thinkspace/domain/ids";
import type { McpServer } from "@thinkspace/domain/mcp";
import {
  mcpHostSchema,
  mcpServerNameSchema,
  mcpServerUrlSchema,
} from "@thinkspace/domain/primitives";
import type { TenantContext } from "@thinkspace/domain/seams/tenant-data-access";
import { env } from "@thinkspace/env/server";
import { Hono } from "hono";
import { z } from "zod";

import { domainErrorStatus } from "./error-translation";
import type { TenantVariables } from "./tenant-context";
import { WORKSPACE_MANAGER_ROLES } from "./tenant-context";

/**
 * E8.2: the HTTP surface for the workspace MCP registry (ADR 0002, wave-7 debt). Reads are
 * member-visible registry facts; the egress-allowlist gate is the domain flow's job (it runs
 * BEFORE any row is persisted — the SDK's hibernation-restore path reconnects straight from
 * persisted rows, so a disallowed host must never reach D1). Role gating is the edge's job:
 *
 *  - server register / delete: owner/admin (the shared WORKSPACE_MANAGER_ROLES gate, as E3.2 BYOK);
 *  - host approve / revoke: owner-ONLY. The `mcp_host_approval.approved_by_owner_member_id`
 *    column records the acting member, and ADR 0002 frames growing the allowlist as the
 *    deliberate, auditable OWNER action — admitting an admin there would record an admin id in
 *    an "owner" column. (Recorded as a decision in the E8.2 report for veto.)
 *
 * Revoke fan-out (ADR 0037 decision 4): server delete and host revoke sever live SDK connections
 * by enumerating the workspace's threads and calling ThreadAgentDirectory.removeMcpServer on each
 * DO. Idle DOs self-heal by per-turn pull; the durable registry write has already landed, so a
 * fan-out failure is logged-and-swallowed — it must never fail the revoke.
 */

const HOST_APPROVER_ROLES: ReadonlySet<TenantContext["role"]> = new Set([
  "owner",
]);

const serverPathSchema = z.object({ mcpServerId: mcpServerIdSchema });

const registerBodySchema = z.object({
  host: mcpHostSchema,
  name: mcpServerNameSchema,
  url: mcpServerUrlSchema,
});

const hostBodySchema = z.object({ host: mcpHostSchema });

/** Enumeration source for the revoke fan-out — the workspace's thread → DO addresses. */
interface ThreadRow {
  readonly channel_id: string;
  readonly id: string;
}

const buildTenantDataAccess = (context: TenantContext) =>
  createD1TenantDataAccess({ context, db: env.DB });

const buildFlow = (context: TenantContext) => {
  const tenantDataAccess = buildTenantDataAccess(context);
  return createMcpRegistrationFlow({
    mcpEgressPolicy: createWorkerMcpEgressPolicy({
      context,
      dataAccess: tenantDataAccess,
    }),
    tenantDataAccess,
  });
};

/**
 * Best-effort connection reconciliation across every live thread DO (ADR 0037 decision 4). The
 * registry write is already durable before this runs, so every failure is logged and skipped —
 * per-turn pull will drop the connection at the next turn regardless.
 */
const fanOutDisconnect = async (
  context: TenantContext,
  mcpServerIds: readonly McpServerId[]
): Promise<void> => {
  if (mcpServerIds.length === 0) {
    return;
  }

  const threads = await env.DB.prepare(
    "SELECT id, channel_id FROM thread WHERE workspace_id = ?1"
  )
    .bind(context.workspaceId)
    .all<ThreadRow>();

  const directory = createProductionThreadAgentDirectory({
    namespace: env.THREAD_AGENT,
  });

  for (const row of threads.results) {
    const agent = directory.get({
      channelId: channelIdSchema.parse(row.channel_id),
      threadId: threadIdSchema.parse(row.id),
      workspaceId: context.workspaceId,
    });
    for (const mcpServerId of mcpServerIds) {
      try {
        const dropped = await agent.removeMcpServer({ mcpServerId });
        if (!dropped.ok) {
          console.warn("mcp revoke fan-out: DO rejected disconnect", {
            error: dropped.error.kind,
            mcpServerId,
            threadId: row.id,
          });
        }
      } catch (cause) {
        console.warn("mcp revoke fan-out: DO call threw", {
          cause,
          mcpServerId,
          threadId: row.id,
        });
      }
    }
  }
};

export const mcpRoutes = new Hono<{ Variables: TenantVariables }>()
  /** The workspace's registered servers — registry facts only, member-visible. */
  .get("/mcp/servers", async (c) => {
    const context = c.get("tenantContext");
    const servers = await buildTenantDataAccess(context).listMcpServers();
    if (!servers.ok) {
      return c.json({ error: servers.error }, domainErrorStatus(servers.error));
    }
    return c.json({ servers: servers.value }, 200);
  })
  /**
   * Register a server (owner/admin). The flow gates the host against the egress allowlist BEFORE
   * persisting; an unapproved host is `mcp_host_not_allowed` (403) and nothing lands in D1.
   */
  .post("/mcp/servers", async (c) => {
    const context = c.get("tenantContext");
    if (!WORKSPACE_MANAGER_ROLES.has(context.role)) {
      return c.json({ error: { kind: "insufficient_role" } }, 403);
    }

    const body = registerBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!body.success) {
      return c.json({ error: { kind: "malformed_request" } }, 400);
    }

    const mcpServer: McpServer = {
      host: body.data.host,
      id: mcpServerIdSchema.parse(`mcp-${crypto.randomUUID()}`),
      name: body.data.name,
      url: body.data.url,
      workspaceId: context.workspaceId,
    };

    const registered = await buildFlow(context).registerServer({ mcpServer });
    if (!registered.ok) {
      return c.json(
        { error: registered.error },
        domainErrorStatus(registered.error)
      );
    }

    return c.json({ server: mcpServer }, 200);
  })
  /**
   * Delete a server from the registry (owner/admin), then fan out a connection drop for that id.
   * The registry write is durable before the fan-out; fan-out failure never fails the delete.
   */
  .delete("/mcp/servers/:mcpServerId", async (c) => {
    const context = c.get("tenantContext");
    if (!WORKSPACE_MANAGER_ROLES.has(context.role)) {
      return c.json({ error: { kind: "insufficient_role" } }, 403);
    }

    const path = serverPathSchema.safeParse({
      mcpServerId: c.req.param("mcpServerId"),
    });
    if (!path.success) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    const deregistered = await buildFlow(context).deregisterServer({
      mcpServerId: path.data.mcpServerId,
    });
    if (!deregistered.ok) {
      return c.json(
        { error: deregistered.error },
        domainErrorStatus(deregistered.error)
      );
    }

    await fanOutDisconnect(context, [path.data.mcpServerId]);

    return c.json({ mcpServerId: path.data.mcpServerId }, 200);
  })
  /** Grow the egress allowlist (owner-only). The acting owner is recorded on the approval row. */
  .post("/mcp/hosts/approve", async (c) => {
    const context = c.get("tenantContext");
    if (!HOST_APPROVER_ROLES.has(context.role)) {
      return c.json({ error: { kind: "insufficient_role" } }, 403);
    }

    const body = hostBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: { kind: "malformed_request" } }, 400);
    }

    const approved = await buildFlow(context).approveHost({
      hostApproval: {
        approvedAt: new Date(),
        approvedByOwnerMemberId: context.memberId,
        host: body.data.host,
        workspaceId: context.workspaceId,
      },
    });
    if (!approved.ok) {
      return c.json(
        { error: approved.error },
        domainErrorStatus(approved.error)
      );
    }

    return c.json({ host: body.data.host }, 200);
  })
  /**
   * Shrink the egress allowlist (owner-only), then fan out a connection drop for every server on
   * the revoked host — those servers stay in the registry but stop clearing the gate on their
   * next resolution. The revoke write is durable before the fan-out.
   */
  .post("/mcp/hosts/revoke", async (c) => {
    const context = c.get("tenantContext");
    if (!HOST_APPROVER_ROLES.has(context.role)) {
      return c.json({ error: { kind: "insufficient_role" } }, 403);
    }

    const body = hostBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: { kind: "malformed_request" } }, 400);
    }

    const revoked = await buildFlow(context).revokeHost({
      host: body.data.host,
    });
    if (!revoked.ok) {
      return c.json({ error: revoked.error }, domainErrorStatus(revoked.error));
    }

    // Servers on the revoked host are still registered; sever their live connections now.
    const servers = await buildTenantDataAccess(context).listMcpServers();
    if (servers.ok) {
      await fanOutDisconnect(
        context,
        servers.value
          .filter((server) => server.host === body.data.host)
          .map((server) => server.id)
      );
    }

    return c.json({ host: body.data.host }, 200);
  });
