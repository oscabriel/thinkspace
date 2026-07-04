/* eslint-disable max-classes-per-file -- one hub substrate: the shared recent-log base and the two hub DOs */
import { Agent, getAgentByName } from "agents";
import type { AgentContext } from "agents";

import { createNotImplementedError } from "../../errors";
import { err, ok } from "../../result";
import type { AsyncResult } from "../../result";
import type {
  ChannelHub,
  ChannelHubAddress,
  ChannelHubEvent,
  RealtimeHubError,
  WorkspaceActivityEvent,
  WorkspaceHub,
} from "../../seams/realtime-hubs";
import type { TenantContext } from "../../seams/tenant-data-access";
import { parseJsonColumn } from "../helpers";

/**
 * ADR 0033's addressing pattern applied to hubs (ADR 0010): the DO name is the
 * injectively-encoded tenant containment — workspace hub per workspace, channel hub per
 * workspace/channel pair, so a colliding channel id in another workspace is a different
 * DO by construction.
 */
export const encodeWorkspaceHubName = (context: TenantContext): string =>
  encodeURIComponent(context.workspaceId);

export const encodeChannelHubName = (
  context: TenantContext,
  address: ChannelHubAddress
): string =>
  [context.workspaceId, address.channelId].map(encodeURIComponent).join("/");

/**
 * Hub DOs are plain agents-SDK objects (no turn machinery): they fan events out to
 * connected clients and keep a bounded recent log so late joiners (and tests) can read
 * what was announced. Unpinned seam surface (roster, presence, listing, thread creation)
 * returns not_implemented — extend contract-first.
 */
abstract class RecentLogHub<Event> extends Agent<Cloudflare.Env> {
  private static readonly RECENT_LOG_LIMIT = 256;

  constructor(ctx: AgentContext, env: Cloudflare.Env) {
    super(ctx, env);
    this.ensureHubTable();
  }

  protected appendEvent(event: Event): void {
    this.insertEvent(event);
    this.pruneLog();
    this.broadcast(JSON.stringify(event));
  }

  private ensureHubTable(): readonly unknown[] {
    return this.sql`
      CREATE TABLE IF NOT EXISTS ts_hub_event (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        data TEXT NOT NULL
      )
    `;
  }

  private insertEvent(event: Event): readonly unknown[] {
    return this
      .sql`INSERT INTO ts_hub_event (data) VALUES (${JSON.stringify(event)})`;
  }

  private pruneLog(): readonly unknown[] {
    return this.sql`
      DELETE FROM ts_hub_event
      WHERE seq <= (SELECT MAX(seq) FROM ts_hub_event) - ${RecentLogHub.RECENT_LOG_LIMIT}
    `;
  }

  protected readRecentEvents(): readonly Event[] {
    const rows = this.sql<{ data: string }>`
      SELECT data FROM ts_hub_event ORDER BY seq ASC
    `;
    return rows.map((row) => parseJsonColumn<Event>(row.data));
  }
}

export class WorkspaceHubDurableObject extends RecentLogHub<WorkspaceActivityEvent> {
  async publishActivity(
    event: WorkspaceActivityEvent
  ): AsyncResult<undefined, RealtimeHubError> {
    this.appendEvent(event);
    return ok();
  }

  async listRecentActivity(): Promise<readonly WorkspaceActivityEvent[]> {
    return this.readRecentEvents();
  }
}

export class ChannelHubDurableObject extends RecentLogHub<ChannelHubEvent> {
  async publishEvent(
    event: ChannelHubEvent
  ): AsyncResult<undefined, RealtimeHubError> {
    this.appendEvent(event);
    return ok();
  }

  async listRecentEvents(): Promise<readonly ChannelHubEvent[]> {
    return this.readRecentEvents();
  }
}

export interface ProductionWorkspaceHubConfig {
  readonly context: TenantContext;
  readonly namespace: DurableObjectNamespace<WorkspaceHubDurableObject>;
}

export const createProductionWorkspaceHub = (
  config: ProductionWorkspaceHubConfig
): WorkspaceHub => {
  let stubPromise: ReturnType<
    typeof getAgentByName<Cloudflare.Env, WorkspaceHubDurableObject>
  > | null = null;
  const stub = () =>
    (stubPromise ??= getAgentByName(
      config.namespace,
      encodeWorkspaceHubName(config.context)
    ));

  return {
    context: config.context,
    getRoster: async () =>
      err(createNotImplementedError("ProductionWorkspaceHub.getRoster")),
    listChannels: async () =>
      err(createNotImplementedError("ProductionWorkspaceHub.listChannels")),
    publishActivity: async (event) => {
      const hub = await stub();
      return hub.publishActivity(event);
    },
  };
};

export interface ProductionChannelHubConfig {
  readonly address: ChannelHubAddress;
  readonly context: TenantContext;
  readonly namespace: DurableObjectNamespace<ChannelHubDurableObject>;
}

export const createProductionChannelHub = (
  config: ProductionChannelHubConfig
): ChannelHub => {
  let stubPromise: ReturnType<
    typeof getAgentByName<Cloudflare.Env, ChannelHubDurableObject>
  > | null = null;
  const stub = () =>
    (stubPromise ??= getAgentByName(
      config.namespace,
      encodeChannelHubName(config.context, config.address)
    ));

  return {
    address: config.address,
    context: config.context,
    getPresence: async () =>
      err(createNotImplementedError("ProductionChannelHub.getPresence")),
    publishEvent: async (event) => {
      const hub = await stub();
      return hub.publishEvent(event);
    },
  };
};
