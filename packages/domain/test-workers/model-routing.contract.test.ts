import { env } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { createD1ModelRouter } from "../src/adapters/production/model-routing";
import { err, ok } from "../src/result";
import { defineModelRoutingContract } from "../src/testing";

/** vitest-pool-workers no longer isolates storage per test; each test starts from empty tables. */
beforeEach(async () => {
  await env.DB.batch(
    [
      "channel",
      "shape",
      "thread",
      "unread",
      "workspace",
      "workspace_provider_key",
      "workspace_tool_disable",
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`))
  );
});

defineModelRoutingContract({
  api: { describe, expect, test },
  makeModelRouter: async (seed) => {
    await Promise.all(
      (seed.keyedProviders ?? []).map((provider) =>
        env.DB.prepare(
          "INSERT INTO workspace_provider_key (workspace_id, provider, created_at) VALUES (?1, ?2, ?3)"
        )
          .bind(seed.context.workspaceId, provider, Date.now())
          .run()
      )
    );

    return createD1ModelRouter({
      catalog: {
        getModels: async () =>
          seed.catalogUnavailable === true
            ? err({ kind: "catalog_unavailable" })
            : ok(seed.catalogModels ?? []),
      },
      context: seed.context,
      db: env.DB,
    });
  },
});
