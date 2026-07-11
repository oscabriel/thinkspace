import { createD1TenantDataAccess } from "@thinkspace/domain/adapters/production";
import {
  makeChannel,
  makeShape,
  makeShapeStructure,
  makeThread,
  makeUnread,
  memberId as brandMemberId,
  unwrapOk,
  workspaceId as brandWorkspaceId,
} from "@thinkspace/domain/testing";
import { env } from "cloudflare:test";

export interface SeedThread {
  readonly id: string;
  readonly lastActivityAt: Date;
}

/**
 * Seeds a channel and its live shape — plus optional threads and unread rows — through the real
 * D1 write path (ADR 0034). `modelId`/`systemPrompt` fall through to makeShapeStructure's defaults
 * (a plain `test-provider/model-1` shape); a keyed-model test passes a catalogued `modelId`. The
 * caller's memberId owns the channel unless `ownerMemberId` names someone else, and channels are
 * shared unless `visibility` says otherwise. Returns the tenant data access for follow-up reads.
 */
export const seedChannel = async (input: {
  readonly channelId: string;
  readonly memberId: string;
  readonly modelId?: string;
  readonly ownerMemberId?: string;
  readonly shapeId: string;
  readonly systemPrompt?: string;
  readonly threads?: readonly SeedThread[];
  readonly unreadThreadIds?: readonly string[];
  readonly visibility?: { readonly kind: "private" } | { readonly kind: "shared" };
  readonly workspaceId: string;
}) => {
  const workspaceId = brandWorkspaceId(input.workspaceId);
  const tenantDataAccess = createD1TenantDataAccess({
    context: {
      memberId: brandMemberId(input.memberId),
      role: "owner",
      workspaceId,
    },
    db: env.DB,
  });

  const shape = {
    ...makeShape({ id: input.shapeId }),
    structure: makeShapeStructure({
      modelId: input.modelId,
      systemPrompt: input.systemPrompt,
    }),
    workspaceId,
  };
  const channel = {
    ...makeChannel({
      id: input.channelId,
      ownerMemberId: brandMemberId(input.ownerMemberId ?? input.memberId),
      shapeId: input.shapeId,
      visibility: input.visibility ?? { kind: "shared" },
    }),
    workspaceId,
  };

  unwrapOk(
    await tenantDataAccess.batch({
      commands: [
        { kind: "put_shape", shape },
        { channel, kind: "put_channel" },
        ...(input.threads ?? []).map(
          (thread) =>
            ({
              kind: "put_thread_index",
              thread: {
                ...makeThread({
                  channelId: input.channelId,
                  id: thread.id,
                  lastActivityAt: thread.lastActivityAt,
                }),
                workspaceId,
              },
            }) as const
        ),
        ...(input.unreadThreadIds ?? []).map(
          (threadId) =>
            ({
              kind: "put_unread",
              unread: {
                ...makeUnread({ threadId }),
                memberId: brandMemberId(input.memberId),
                workspaceId,
              },
            }) as const
        ),
      ],
      workspaceId,
    })
  );

  return tenantDataAccess;
};

/** ADR 0036: registering a provider key is what makes a workspace's models routable. */
export const keyWorkspaceForAnthropic = (workspaceId: string) =>
  env.DB.prepare(
    "INSERT INTO workspace_provider_key (workspace_id, provider, created_at) VALUES (?1, ?2, ?3)"
  )
    .bind(workspaceId, "anthropic", Date.now())
    .run();
