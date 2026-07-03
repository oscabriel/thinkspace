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
      "shape",
      "thread",
      "unread",
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
