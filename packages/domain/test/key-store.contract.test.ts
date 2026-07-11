import { describe, expect, test } from "bun:test";

import { createMemoryKeyStore } from "../src/adapters/memory";
import { defineKeyStoreContract } from "../src/testing";

defineKeyStoreContract({
  api: { describe, expect, test },
  makeKeyStore: ({ context, foreignMasterKey, masterKey }) => {
    // Shared backing storage so the foreign-master-key store sees the same sealed bytes.
    const storage = new Map<string, string | null>();
    return {
      foreignMasterKeyStore: createMemoryKeyStore({
        context,
        masterKey: foreignMasterKey,
        storage,
      }),
      store: createMemoryKeyStore({ context, masterKey, storage }),
    };
  },
});
