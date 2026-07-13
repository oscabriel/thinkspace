import {
  createD1TenantDataAccess,
  createProductionThreadAgentDirectory,
} from "@thinkspace/domain/adapters/production";
import { channelVisibilityGate } from "@thinkspace/domain/flows/channel-gate";
import {
  channelIdSchema,
  commentIdSchema,
  runIdSchema,
  threadIdSchema,
} from "@thinkspace/domain/ids";
import type { MemberId } from "@thinkspace/domain/ids";
import type { DisplayName } from "@thinkspace/domain/primitives";
import type { TenantContext } from "@thinkspace/domain/seams/tenant-data-access";
import type { BranchSnapshot } from "@thinkspace/domain/seams/thread-agent";
import type { Comment } from "@thinkspace/domain/thread";
import { env } from "@thinkspace/env/server";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import { domainErrorStatus } from "./error-translation";
import type { TenantVariables } from "./tenant-context";

const buildTenantDataAccess = (context: TenantContext) =>
  createD1TenantDataAccess({ context, db: env.DB });

const channelPathSchema = z.object({ channelId: channelIdSchema });

/**
 * E10.6: the thread surface labels member comments by display name, not the literal "Member".
 * The comment tree is DO-resident and name-free, so the edge joins the workspace roster (ADR
 * 0008 display names, the same read the directory/home surfaces label authors from) onto each
 * member-authored comment as a read-through — nothing is mirrored into the DO. An author with no
 * live roster row (a removed/deleted member) carries no name and degrades to the client's
 * "Member" fallback, never an error. Agent-authored comments are untouched (authorKind labels).
 */
type NamedComment = Comment & {
  readonly author: { readonly displayName?: DisplayName };
};

interface NamedBranchSnapshot {
  readonly ancestors: readonly NamedComment[];
  readonly branch: BranchSnapshot["branch"];
  readonly subtree: readonly NamedComment[];
}

const nameComment = (
  comment: Comment,
  displayNames: ReadonlyMap<MemberId, DisplayName>
): NamedComment =>
  comment.author.kind === "member"
    ? {
        ...comment,
        author: {
          ...comment.author,
          displayName: displayNames.get(comment.author.memberId),
        },
      }
    : comment;

const withAuthorNames = (
  snapshot: BranchSnapshot,
  displayNames: ReadonlyMap<MemberId, DisplayName>
): NamedBranchSnapshot => ({
  ancestors: snapshot.ancestors.map((comment) =>
    nameComment(comment, displayNames)
  ),
  branch: snapshot.branch,
  subtree: snapshot.subtree.map((comment) =>
    nameComment(comment, displayNames)
  ),
});

const branchPathSchema = z.object({
  channelId: channelIdSchema,
  rootCommentId: commentIdSchema,
  threadId: threadIdSchema,
});

const runPathSchema = z.object({
  channelId: channelIdSchema,
  runId: runIdSchema,
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
    // selfMemberId is edge-resident session identity (who is asking), so it rides the
    // response here rather than widening the domain roster read — the client needs it to
    // author optimistic comments as itself instead of a sentinel id.
    return c.json({ ...roster.value, selfMemberId: context.memberId }, 200);
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

      // Read-through the roster to label member authors; a roster read failure is the same
      // domain error surface as any other read here.
      const roster = await buildTenantDataAccess(context).listMembers();
      if (!roster.ok) {
        return c.json({ error: roster.error }, domainErrorStatus(roster.error));
      }
      const displayNames = new Map(
        roster.value.members.map((profile) => [
          profile.memberId,
          profile.displayName,
        ])
      );
      return c.json(withAuthorNames(branch.value, displayNames), 200);
    }
  )
  .get("/channels/:channelId/threads/:threadId/runs/:runId", async (c) => {
    /**
     * ADR 0028: the server-authoritative run-state read. Run state is DO-resident and read
     * through the ThreadAgent seam's `getRun(runId) → RunDetail | null` — there is no D1 run
     * index — so the edge composes the same DO stub the branch read uses and translates null
     * to 404. This is what lets the thread surface settle an errored run's card the instant its
     * `run_lifecycle_changed` delta arrives (that event carries only an id, not state) rather
     * than waiting out the client's stale timeout. Same fail-closed visibility guard as the
     * branch read: an invisible channel's runs are 404, and an unknown run id is 404 too.
     */
    const context = c.get("tenantContext");

    const path = runPathSchema.safeParse({
      channelId: c.req.param("channelId"),
      runId: c.req.param("runId"),
      threadId: c.req.param("threadId"),
    });
    if (!path.success) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    const guard = await guardVisibleChannel(context, path.data.channelId);
    if (!guard.ok) {
      return c.json(guard.body, guard.status);
    }

    const detail = await createProductionThreadAgentDirectory({
      namespace: env.THREAD_AGENT,
    })
      .get({
        channelId: path.data.channelId,
        threadId: path.data.threadId,
        workspaceId: context.workspaceId,
      })
      .getRun({ runId: path.data.runId });
    if (!detail.ok) {
      return c.json({ error: detail.error }, domainErrorStatus(detail.error));
    }
    if (detail.value === null) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }
    return c.json(detail.value, 200);
  });
