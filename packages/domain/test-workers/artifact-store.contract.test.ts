import { env } from "cloudflare:test";
import { beforeEach, describe, expect, test } from "vitest";

import { createR2VirtualFsArtifactStore } from "../src/adapters/production/artifact-store";
import { defineArtifactStoreContract } from "../src/testing";

/** vitest-pool-workers shares D1 + R2 across tests in a file; start each from empty storage. */
beforeEach(async () => {
  await env.DB.batch(
    ["artifact", "artifact_version"].map((table) =>
      env.DB.prepare(`DELETE FROM ${table}`)
    )
  );
  const objects = await env.ARTIFACTS.list();
  await Promise.all(
    objects.objects.map((object) => env.ARTIFACTS.delete(object.key))
  );
});

defineArtifactStoreContract({
  api: { describe, expect, test },
  makeArtifactStore: () => ({
    forContext: (context) =>
      createR2VirtualFsArtifactStore({
        bucket: env.ARTIFACTS,
        context,
        db: env.DB,
      }),
  }),
});
