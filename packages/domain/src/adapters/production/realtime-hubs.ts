/* eslint-disable max-classes-per-file -- one hub substrate: the shared recent-log base and the two hub DOs */
import { Agent, getAgentByName } from "agents";
import type { AgentContext, Connection, ConnectionContext } from "agents";
import type { JWTVerifyGetKey } from "jose";

import { createNotImplementedError } from "../../errors";
import { channelIdSchema, workspaceIdSchema } from "../../ids";
import type { ChannelId, WorkspaceId } from "../../ids";
import { err, ok } from "../../result";
import type { AsyncResult } from "../../result";
import type {
  ChannelHub,
  ChannelHubAddress,
  ChannelHubEvent,
  RealtimeHubError,
  WorkspaceActivityEvent,
  WorkspaceHub,
  WorkspaceScope,
} from "../../seams/realtime-hubs";
import { parseJsonColumn } from "../helpers";
import {
  createHubJwks,
  HUB_UPGRADE_REJECT_CODE,
  readHubConnectToken,
  verifyHubConnectToken,
} from "./hub-auth";
import type { HubAuthEnv, HubConnectClaims } from "./hub-auth";

/**
 * ADR 0033's addressing pattern applied to hubs (ADR 0010): the DO name is the
 * injectively-encoded tenant containment — workspace hub per workspace, channel hub per
 * workspace/channel pair, so a colliding channel id in another workspace is a different
 * DO by construction.
 */
export const encodeWorkspaceHubName = (context: WorkspaceScope): string =>
  encodeURIComponent(context.workspaceId);

export const encodeChannelHubName = (
  context: WorkspaceScope,
  address: ChannelHubAddress
): string =>
  [context.workspaceId, address.channelId].map(encodeURIComponent).join("/");

/**
 * The inverse of the encoders (E4.2): the hub decodes its own name back into the tenant
 * address it verifies the connect token's claims against. Fail-closed like the thread-agent
 * codec (ADR 0033) — anything that is not the canonical encoding of a real address returns
 * null, so a forged or misrouted DO name can never match a claim.
 */
export const decodeWorkspaceHubName = (name: string): WorkspaceId | null => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    return null;
  }
  const parsed = workspaceIdSchema.safeParse(decoded);
  if (!parsed.success) {
    return null;
  }
  return encodeWorkspaceHubName({ workspaceId: parsed.data }) === name
    ? parsed.data
    : null;
};

export const decodeChannelHubName = (
  name: string
): {
  readonly channelId: ChannelId;
  readonly workspaceId: WorkspaceId;
} | null => {
  const segments = name.split("/");
  if (segments.length !== 2) {
    return null;
  }

  let decoded: readonly string[];
  try {
    decoded = segments.map(decodeURIComponent);
  } catch {
    return null;
  }

  const [workspaceId, channelId] = decoded;
  const parsedWorkspaceId = workspaceIdSchema.safeParse(workspaceId);
  const parsedChannelId = channelIdSchema.safeParse(channelId);
  if (!(parsedWorkspaceId.success && parsedChannelId.success)) {
    return null;
  }

  const address = {
    channelId: parsedChannelId.data,
    workspaceId: parsedWorkspaceId.data,
  };
  return encodeChannelHubName(
    { workspaceId: address.workspaceId },
    { channelId: address.channelId }
  ) === name
    ? address
    : null;
};

/**
 * Hub DOs are plain agents-SDK objects (no turn machinery): they fan events out to
 * connected clients and keep a bounded recent log so late joiners (and tests) can read
 * what was announced. Unpinned seam surface (roster, presence, listing, thread creation)
 * returns not_implemented — extend contract-first.
 */
abstract class RecentLogHub<Event> extends Agent<Cloudflare.Env> {
  private static readonly RECENT_LOG_LIMIT = 256;

  /**
   * The hub's DO name is its tenant address (workspace / workspace+channel ids) — never send
   * it to clients on connect. Hubs speak only their own event JSON over the wire, not the
   * agents-SDK identity/state protocol.
   */
  static options = { sendIdentityOnConnect: false };

  /** Cached JWK set (E4.2): fetched once per hub instance, refetched only on an unknown kid. */
  private hubJwks: JWTVerifyGetKey | undefined;

  constructor(ctx: AgentContext, env: Cloudflare.Env) {
    super(ctx, env);
    this.ensureHubTable();
  }

  /**
   * The WS upgrade authorization gate (baked decision 5). The socket is already accepted by
   * the time partyserver hands it here, so rejection is a 4401 close — the client sees the
   * code, never a delivered event. A pass is silent: the recent-log broadcast then reaches it
   * like any other connection.
   */
  override async onConnect(
    connection: Connection,
    ctx: ConnectionContext
  ): Promise<void> {
    const decision = await this.authorizeUpgrade(ctx.request);
    if (!decision.ok) {
      // The internal reason stays server-side: a flat close tells a probe nothing about
      // which check tripped (missing vs invalid vs expired vs wrong-address token).
      connection.close(HUB_UPGRADE_REJECT_CODE, "unauthorized");
    }
  }

  private async authorizeUpgrade(
    request: Request
  ): Promise<{ ok: false; reason: string } | { ok: true }> {
    const token = readHubConnectToken(request);
    if (token === null) {
      return { ok: false, reason: "missing_token" };
    }

    this.hubJwks ??= createHubJwks(this.env as unknown as HubAuthEnv);
    const verified = await verifyHubConnectToken(token, this.hubJwks);
    if (!verified.ok) {
      return verified;
    }

    if (!this.claimsMatchAddress(verified.claims)) {
      return { ok: false, reason: "address_mismatch" };
    }
    return { ok: true };
  }

  /**
   * Does the verified token authorize a connection to *this* hub? Each hub decodes its own
   * name (ADR 0033) and matches the claim against it — workspace for the workspace hub,
   * workspace + channel for the channel hub.
   */
  protected abstract claimsMatchAddress(claims: HubConnectClaims): boolean;

  /** `this.name` throws for DOs addressed by unique id (partyserver getter over ctx.id.name). */
  protected readDoName(): string | null {
    try {
      return this.name;
    } catch {
      return null;
    }
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
  protected claimsMatchAddress(claims: HubConnectClaims): boolean {
    const workspaceId = decodeWorkspaceHubName(this.readDoName() ?? "");
    return workspaceId !== null && workspaceId === claims.workspaceId;
  }

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
  /**
   * Channel-visibility check reduces to the tenant boundary here: the token carries no
   * per-channel grant (its claims are workspace + role + member), and ADR 0033's injective
   * addressing already makes a same-named channel in another workspace a *different* DO. So a
   * connection is authorized iff the token's workspace owns this channel hub. Private-channel /
   * owner ACL (ADR 0019) is a directory read, not an upgrade-time claim — out of E4.2 scope.
   */
  protected claimsMatchAddress(claims: HubConnectClaims): boolean {
    const address = decodeChannelHubName(this.readDoName() ?? "");
    return address !== null && address.workspaceId === claims.workspaceId;
  }

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
  readonly context: WorkspaceScope;
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
  readonly context: WorkspaceScope;
  readonly namespace: DurableObjectNamespace<ChannelHubDurableObject>;
}

/**
 * E7.4: the DO stub for a channel hub, addressed by the same injective name the publish path
 * uses (`encodeChannelHubName`). The HTTP edge proxies a browser WS upgrade through this stub's
 * `fetch` (baked decision 5); the DO verifies the connect JWT itself, so the edge only needs
 * to route to the correctly-addressed hub. Kept beside `createProductionChannelHub` so the
 * agents-SDK addressing (getAgentByName + name storage) lives in one place.
 */
export const getChannelHubStub = (
  config: ProductionChannelHubConfig
): ReturnType<typeof getAgentByName<Cloudflare.Env, ChannelHubDurableObject>> =>
  getAgentByName(
    config.namespace,
    encodeChannelHubName(config.context, config.address)
  );

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
