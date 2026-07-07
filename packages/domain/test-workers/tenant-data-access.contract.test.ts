import { env } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { createD1TenantDataAccess } from "../src/adapters/production/tenant-data-access";
import { defineTenantDataAccessContract } from "../src/testing";
import type { TenantDataAccessSeed } from "../src/testing";

/** vitest-pool-workers no longer isolates storage per test; each test starts from empty tables. */
beforeEach(async () => {
  await env.DB.batch(
    [
      "channel",
      "mcp_host_approval",
      "mcp_server",
      "member",
      "shape",
      "thread",
      "unread",
      "organization",
      "user",
      "workspace",
      "workspace_tool_disable",
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`))
  );
});

/**
 * Seeds the workspace row directly (no TenantWriteCommand covers it), then routes every
 * domain object through the adapter's own batch so seeding exercises the same write path
 * production uses.
 */
const seedTenantState = async (
  data: ReturnType<typeof createD1TenantDataAccess>,
  seed: TenantDataAccessSeed
): Promise<void> => {
  await env.DB.prepare(
    "INSERT INTO workspace (id, name) VALUES (?1, ?2) ON CONFLICT (id) DO NOTHING"
  )
    .bind(seed.workspace.id, seed.workspace.name)
    .run();

  /**
   * E8.6 roster seed: listMembers joins better-auth's member → user (ADR 0008), so the
   * contract's members must exist as real rows in both, under their organization (= the
   * workspaceId). Seeded directly — no TenantWriteCommand crosses into the auth tables.
   */
  for (const member of seed.members ?? []) {
    await env.DB.batch([
      env.DB
        .prepare(
          "INSERT INTO organization (id, name, slug) VALUES (?1, ?2, ?3) ON CONFLICT (id) DO NOTHING"
        )
        .bind(member.workspaceId, member.workspaceId, member.workspaceId),
      env.DB
        .prepare(
          "INSERT INTO user (id, email, name) VALUES (?1, ?2, ?3) ON CONFLICT (id) DO NOTHING"
        )
        .bind(member.userId, `${member.userId}@example.test`, member.displayName),
      env.DB
        .prepare(
          "INSERT INTO member (id, organization_id, user_id) VALUES (?1, ?2, ?3) ON CONFLICT (id) DO NOTHING"
        )
        .bind(member.memberId, member.workspaceId, member.userId),
    ]);
  }

  const commands = [
    ...(seed.shapes ?? []).map(
      (shape) => ({ kind: "put_shape", shape }) as const
    ),
    ...(seed.channels ?? []).map(
      (channel) => ({ channel, kind: "put_channel" }) as const
    ),
    ...(seed.threads ?? []).map(
      (thread) => ({ kind: "put_thread_index", thread }) as const
    ),
    ...(seed.unread ?? []).map(
      (unread) => ({ kind: "put_unread", unread }) as const
    ),
  ];

  if (commands.length === 0) {
    return;
  }

  const [first, ...rest] = commands;
  if (first === undefined) {
    return;
  }

  const seeded = await data.batch({
    commands: [first, ...rest],
    workspaceId: seed.context.workspaceId,
  });
  if (!seeded.ok) {
    throw new Error(`seed batch failed: ${JSON.stringify(seeded.error)}`);
  }
};

defineTenantDataAccessContract({
  api: { describe, expect, test },
  makeTenantDataAccess: async (seed) => {
    const data = createD1TenantDataAccess({
      context: seed.context,
      db: env.DB,
    });
    await seedTenantState(data, seed);
    return data;
  },
});
