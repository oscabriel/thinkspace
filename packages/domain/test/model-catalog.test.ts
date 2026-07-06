import { describe, expect, spyOn, test } from "bun:test";

import {
  assembleCatalog,
  createModelCatalog,
  MODELS_DEV_API_URL,
} from "../src/adapters/production/model-catalog";
import type { CatalogFetch } from "../src/adapters/production/model-catalog";

// A well-formed models.dev model entry (anthropic-shaped).
const goodModel = (id: string, name: string) => ({
  attachment: true,
  cost: { cache_read: 0.5, cache_write: 6.25, input: 5, output: 25 },
  id,
  limit: { context: 200_000, output: 64_000 },
  name,
  reasoning: true,
  release_date: "2025-11-24",
  structured_output: true,
  tool_call: true,
});

// A malformed entry: missing `cost` — must be skipped, not fail the catalog.
const malformedModel = (id: string) => ({
  attachment: true,
  id,
  limit: { context: 200_000, output: 64_000 },
  name: "Broken Model",
  reasoning: true,
  release_date: "2025-11-24",
  structured_output: true,
  tool_call: true,
});

const payload = (overrides?: {
  readonly anthropic?: Record<string, unknown>;
  readonly extraProviders?: Record<string, unknown>;
}) => ({
  anthropic: {
    id: "anthropic",
    models: overrides?.anthropic ?? {
      "claude-opus-4-5": goodModel("claude-opus-4-5", "Claude Opus 4.5"),
      "claude-sonnet-4-5": goodModel("claude-sonnet-4-5", "Claude Sonnet 4.5"),
    },
    name: "Anthropic",
  },
  ...overrides?.extraProviders,
});

const jsonResponse = (body: unknown) => Response.json(body, { status: 200 });

// A counting fetch fake that always returns the same good payload.
const countingFetch = (body: unknown) => {
  let calls = 0;
  const inits: (RequestInit | undefined)[] = [];
  const fetchImpl: CatalogFetch = (input, init) => {
    calls += 1;
    inits.push(init);
    expect(input).toBe(MODELS_DEV_API_URL);
    return Promise.resolve(jsonResponse(body));
  };
  return {
    get calls() {
      return calls;
    },
    fetchImpl,
    get inits() {
      return inits;
    },
  };
};

describe("assembleCatalog — allowlist filtering + skip-don't-fail", () => {
  test("keeps only allowlisted providers and maps to composite ModelIds", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {
      // silence expected provider-absent / skip warnings
    });
    const models = assembleCatalog(
      payload({
        extraProviders: {
          openai: {
            id: "openai",
            models: { "gpt-5": goodModel("gpt-5", "GPT-5") },
            name: "OpenAI",
          },
        },
      })
    );
    warn.mockRestore();

    expect(models).toHaveLength(2);
    expect(models.every((m) => String(m.provider) === "anthropic")).toBe(true);
    expect(models.map((m) => String(m.id)).toSorted()).toEqual([
      "anthropic/claude-opus-4-5",
      "anthropic/claude-sonnet-4-5",
    ]);
    // No openai model leaked through.
    expect(models.some((m) => String(m.id).startsWith("openai/"))).toBe(false);
  });

  test("maps models.dev fields into the domain Model shape", () => {
    const [model] = assembleCatalog(
      payload({
        anthropic: {
          "claude-opus-4-5": goodModel("claude-opus-4-5", "Claude Opus 4.5"),
        },
      })
    );
    expect(model).toBeDefined();
    if (model === undefined) {
      return;
    }
    expect(model.displayName).toBe("Claude Opus 4.5");
    expect(model.cost).toEqual({
      cacheRead: 0.5,
      cacheWrite: 6.25,
      input: 5,
      output: 25,
    });
    expect(model.limits).toEqual({ context: 200_000, output: 64_000 });
    expect(model.capabilities).toEqual({
      attachment: true,
      reasoning: true,
      structuredOutput: true,
      toolCall: true,
    });
    expect(model.releaseDate).toBe("2025-11-24");
  });

  test("skips a malformed model and logs it, keeping the good ones", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {
      // capture
    });
    const models = assembleCatalog(
      payload({
        anthropic: {
          "claude-broken": malformedModel("claude-broken"),
          "claude-opus-4-5": goodModel("claude-opus-4-5", "Claude Opus 4.5"),
        },
      })
    );

    expect(models).toHaveLength(1);
    expect(String(models[0]?.id)).toBe("anthropic/claude-opus-4-5");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("an unparseable payload yields an empty catalog, never throws", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {
      // capture
    });
    expect(assembleCatalog("not a provider map")).toEqual([]);
    expect(assembleCatalog(null)).toEqual([]);
    warn.mockRestore();
  });
});

describe("createModelCatalog — edge-cache fetch + per-isolate memo", () => {
  test("passes the Cloudflare edge-cache directives on the fetch", async () => {
    const fetcher = countingFetch(payload());
    const catalog = createModelCatalog({ fetch: fetcher.fetchImpl });
    await catalog.getModels();

    const [init] = fetcher.inits;
    expect((init as { cf?: { cacheTtl?: number } }).cf?.cacheTtl).toBe(3600);
    expect(
      (init as { cf?: { cacheEverything?: boolean } }).cf?.cacheEverything
    ).toBe(true);
  });

  test("memoizes within the TTL and refetches after it expires", async () => {
    const fetcher = countingFetch(payload());
    let clock = 1000;
    const catalog = createModelCatalog({
      fetch: fetcher.fetchImpl,
      now: () => clock,
      ttlMs: 60 * 60 * 1000,
    });

    const first = await catalog.getModels();
    const second = await catalog.getModels();
    expect(first.ok && second.ok).toBe(true);
    // memo hit, no second fetch
    expect(fetcher.calls).toBe(1);

    // advance past TTL
    clock += 60 * 60 * 1000 + 1;
    await catalog.getModels();
    // memo expired → refetch
    expect(fetcher.calls).toBe(2);
  });
});

describe("createModelCatalog — keep-last-good + catalog_unavailable", () => {
  test("cold miss with no last-good surfaces catalog_unavailable", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {
      // silence
    });
    const catalog = createModelCatalog({
      fetch: () => Promise.reject(new Error("network down")),
    });
    const result = await catalog.getModels();
    warn.mockRestore();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("catalog_unavailable");
    }
  });

  test("cold miss on a non-200 response surfaces catalog_unavailable", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {
      // silence
    });
    const catalog = createModelCatalog({
      fetch: () => Promise.resolve(new Response("boom", { status: 503 })),
    });
    const result = await catalog.getModels();
    warn.mockRestore();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("catalog_unavailable");
    }
  });

  test("serves the last-good catalog when a refresh fails (keep-last-good)", async () => {
    let clock = 1000;
    let shouldFail = false;
    let calls = 0;
    const fetchImpl: CatalogFetch = () => {
      calls += 1;
      if (shouldFail) {
        return Promise.reject(new Error("transient"));
      }
      return Promise.resolve(jsonResponse(payload()));
    };
    const warn = spyOn(console, "warn").mockImplementation(() => {
      // silence keep-last-good warning
    });
    const catalog = createModelCatalog({
      fetch: fetchImpl,
      now: () => clock,
      ttlMs: 60 * 60 * 1000,
    });

    const good = await catalog.getModels();
    expect(good.ok).toBe(true);
    const goodIds = good.ok ? good.value.map((m) => String(m.id)) : [];

    // Expire the memo and make the refresh fail.
    clock += 60 * 60 * 1000 + 1;
    shouldFail = true;
    const stale = await catalog.getModels();
    warn.mockRestore();

    // stale served, not an error
    expect(stale.ok).toBe(true);
    // it did attempt a refresh
    expect(calls).toBe(2);
    if (stale.ok) {
      expect(stale.value.map((m) => String(m.id))).toEqual(goodIds);
    }
  });
});
