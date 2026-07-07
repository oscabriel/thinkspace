import { describe, expect, test } from "bun:test";

import {
  createMemoryArtifactState,
  createMemoryArtifactStore,
} from "../src/adapters/memory";
import { defineArtifactStoreContract } from "../src/testing";

defineArtifactStoreContract({
  api: { describe, expect, test },
  makeArtifactStore: () => {
    const state = createMemoryArtifactState();
    return {
      forContext: (context) => createMemoryArtifactStore({ context, state }),
    };
  },
});
