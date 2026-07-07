import {
  createD1TenantDataAccess,
  createProductionThreadAgentDirectory,
} from "@thinkspace/domain/adapters/production";
import { channelVisibilityGate } from "@thinkspace/domain/flows/channel-gate";
import {
  channelIdSchema,
  commentIdSchema,
  threadIdSchema,
} from "@thinkspace/domain/ids";
import type { TenantContext } from "@thinkspace/domain/seams/tenant-data-access";
import { env } from "@thinkspace/env/server";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import { domainErrorStatus } from "./error-translation";
import type { TenantVariables } from "./tenant-context";

const buildTenantDataAccess = (context: TenantContext) =>
  createD1TenantDataAccess({ context, db: env.DB });

const channelPathSchema = z.object({ channelId: channelIdSchema });

const branchPathSchema = z.object({
  channelId: channelIdSchema,
  rootCommentId: commentIdSchema,
  threadId: threadIdSchema,
});

/** ADR 0027: paginated home feed — a coerced recency cursor and a bounded page size. */
const homeFeedQuerySchema = z.object({
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

const DEFAULT_HOME_FEED_LIMIT = 50;

/**
 * ADR 0035 §4: read visibility fails closed at the domain layer, so the edge re-runs the
 * same channelVisibilityGate pin the write flows use before exposing a channel's threads or
 * branches. A private channel a non-owner cannot see collapses to 404 (channel_not_visible),
 * indistinguishable from a channel that does not exist. A missing/foreign channel is 404 too.
 */
type ChannelGuardResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly body: unknown;
      readonly status: ContentfulStatusCode;
    };

const guardVisibleChannel = async (
  context: TenantContext,
  channelId: (typeof channelPathSchema)["_output"]["channelId"]
): Promise<ChannelGuardResult> => {
  const channel = await buildTenantDataAccess(context).getChannel({
    channelId,
  });
  if (!channel.ok) {
    return {
      body: { error: channel.error },
      ok: false,
      status: domainErrorStatus(channel.error),
    };
  }
  if (channel.value === null) {
    return {
      body: { error: { kind: "unknown_resource" } },
      ok: false,
      status: 404,
    };
  }

  const denied = channelVisibilityGate(context, channel.value);
  if (denied !== null) {
    return {
      body: { error: denied },
      ok: false,
      status: domainErrorStatus(denied),
    };
  }

  return { ok: true };
};

/**
 * ADR 0035 §7 / ADR 0027: the read surface. Handlers do exactly the gesture-route discipline
 * in reverse — resolve context (middleware), brand-parse path ids, compose the read with
 * production adapters, translate. Member-visibility pins live in the domain; the edge only
 * applies them. Reads never mutate, so there is no idempotence story here.
 */
export const readRoutes = new Hono<{ Variables: TenantVariables }>()
  .get("/graph", async (c) => {
    const context = c.get("tenantContext");
    const graph = await buildTenantDataAccess(context).getWorkspaceGraph();
    if (!graph.ok) {
      return c.json({ error: graph.error }, domainErrorStatus(graph.error));
    }
    return c.json(graph.value, 200);
  })
  .get("/home", async (c) => {
    const context = c.get("tenantContext");

    const query = homeFeedQuerySchema.safeParse({
      before: c.req.query("before"),
      limit: c.req.query("limit"),
    });
    if (!query.success) {
      return c.json({ error: { kind: "malformed_query" } }, 400);
    }

    const feed = await buildTenantDataAccess(context).listRecentThreads({
      before: query.data.before ?? null,
      limit: query.data.limit ?? DEFAULT_HOME_FEED_LIMIT,
    });
    if (!feed.ok) {
      return c.json({ error: feed.error }, domainErrorStatus(feed.error));
    }
    return c.json(feed.value, 200);
  })
  .get("/members", async (c) => {
    /**
     * E8.6: the workspace roster — memberId + display name (ADR 0008), the label source the
     * directory/home surfaces join against to name owners and authors. Member-visible; the
     * tenant middleware already fails closed for a non-member (404) and a missing session
     * (401), so the handler adds no further guard beyond the domain-tenant scope.
     */
    const context = c.get("tenantContext");
    const roster = await buildTenantDataAccess(context).listMembers();
    if (!roster.ok) {
      return c.json({ error: roster.error }, domainErrorStatus(roster.error));
    }
    return c.json(roster.value, 200);
  })
  .get("/unread", async (c) => {
    const context = c.get("tenantContext");
    const unread = await buildTenantDataAccess(context).listMemberUnread({
      memberId: context.memberId,
    });
    if (!unread.ok) {
      return c.json({ error: unread.error }, domainErrorStatus(unread.error));
    }
    return c.json({ unread: unread.value }, 200);
  })
  .get("/channels/:channelId", async (c) => {
    const context = c.get("tenantContext");

    const path = channelPathSchema.safeParse({
      channelId: c.req.param("channelId"),
    });
    if (!path.success) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    const channel = await buildTenantDataAccess(context).getChannel({
      channelId: path.data.channelId,
    });
    if (!channel.ok) {
      return c.json({ error: channel.error }, domainErrorStatus(channel.error));
    }
    if (channel.value === null) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    const denied = channelVisibilityGate(context, channel.value);
    if (denied !== null) {
      return c.json({ error: denied }, domainErrorStatus(denied));
    }

    return c.json(channel.value, 200);
  })
  .get("/channels/:channelId/shape", async (c) => {
    /**
     * The shape-edit form's prefill source (E7.5): the current shape structure so an owner
     * re-authors from the live values rather than blanking the channel's config (ADR 0007
     * config-as-data). Same fail-closed visibility guard as the channel read — an invisible
     * channel's shape is 404, and a missing shape (structurally impossible for a live channel,
     * ADR 0030 strict 1:1) is unknown_resource too.
     */
    const context = c.get("tenantContext");

    const path = channelPathSchema.safeParse({
      channelId: c.req.param("channelId"),
    });
    if (!path.success) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    const dataAccess = buildTenantDataAccess(context);
    const channel = await dataAccess.getChannel({
      channelId: path.data.channelId,
    });
    if (!channel.ok) {
      return c.json({ error: channel.error }, domainErrorStatus(channel.error));
    }
    if (channel.value === null) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    const denied = channelVisibilityGate(context, channel.value);
    if (denied !== null) {
      return c.json({ error: denied }, domainErrorStatus(denied));
    }

    const shape = await dataAccess.getShape({ shapeId: channel.value.shapeId });
    if (!shape.ok) {
      return c.json({ error: shape.error }, domainErrorStatus(shape.error));
    }
    if (shape.value === null) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    return c.json(shape.value, 200);
  })
  .get("/channels/:channelId/threads", async (c) => {
    const context = c.get("tenantContext");

    const path = channelPathSchema.safeParse({
      channelId: c.req.param("channelId"),
    });
    if (!path.success) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    const guard = await guardVisibleChannel(context, path.data.channelId);
    if (!guard.ok) {
      return c.json(guard.body, guard.status);
    }

    const index = await buildTenantDataAccess(context).listChannelThreads({
      channelId: path.data.channelId,
    });
    if (!index.ok) {
      return c.json({ error: index.error }, domainErrorStatus(index.error));
    }
    return c.json(index.value, 200);
  })
  .get(
    "/channels/:channelId/threads/:threadId/branches/:rootCommentId",
    async (c) => {
      const context = c.get("tenantContext");

      const path = branchPathSchema.safeParse({
        channelId: c.req.param("channelId"),
        rootCommentId: c.req.param("rootCommentId"),
        threadId: c.req.param("threadId"),
      });
      if (!path.success) {
        return c.json({ error: { kind: "unknown_resource" } }, 404);
      }

      const guard = await guardVisibleChannel(context, path.data.channelId);
      if (!guard.ok) {
        return c.json(guard.body, guard.status);
      }

      const branch = await createProductionThreadAgentDirectory({
        namespace: env.THREAD_AGENT,
      })
        .get({
          channelId: path.data.channelId,
          threadId: path.data.threadId,
          workspaceId: context.workspaceId,
        })
        .loadBranch({ rootCommentId: path.data.rootCommentId });
      if (!branch.ok) {
        return c.json({ error: branch.error }, domainErrorStatus(branch.error));
      }
      return c.json(branch.value, 200);
    }
  );
