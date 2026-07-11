import { z } from "zod";

import type { CatalogUnavailableError } from "../../errors";
import { modelSchema } from "../../model";
import type { Model } from "../../model";
import { providerAllowlist } from "../../provider-allowlist";
import type { ProviderAllowEntry } from "../../provider-allowlist";
import { err, ok } from "../../result";
import type { AsyncResult } from "../../result";

/**
 * Live model-catalog assembly (E1.4). Fetches the models.dev registry through the Workers edge
 * cache, filters it to the E1.2 provider allowlist, maps each surviving entry into the domain
 * {@link Model} shape, and memoizes the result per isolate with keep-last-good semantics.
 *
 * Design points of record (BACKLOG E1):
 *  - the fetch rides the worker's GLOBAL fetch so miniflare `outboundService` can intercept it
 *    (spike finding 5); it is injectable purely so unit tests can supply a fake;
 *  - a single malformed model is SKIPPED and logged, never fails the whole catalog;
 *  - a failed refresh with a prior good catalog serves the stale one (keep-last-good); only a
 *    cold miss with no last-good surfaces {@link CatalogUnavailableError}.
 */

export const MODELS_DEV_API_URL = "https://models.dev/api.json";

/** Edge cache TTL for the models.dev fetch, in seconds (ADR 0011 / E1 decisions). */
const CATALOG_EDGE_CACHE_TTL_SECONDS = 3600;

/** Per-isolate memo TTL: ~1h, matching the edge cache window. */
const DEFAULT_MEMO_TTL_MS = 60 * 60 * 1000;

const catalogUnavailable: CatalogUnavailableError = {
  kind: "catalog_unavailable",
};

/**
 * The global-fetch shape the catalog rides. Under `@cloudflare/workers-types`, `RequestInit`
 * carries the Cloudflare `cf` cache directives, so the edge-cache hint typechecks here.
 */
export type CatalogFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface ModelCatalog {
  /**
   * The current catalog. Serves a fresh (within-TTL) memo, refreshes an expired one, falls back
   * to the last good catalog if a refresh fails, and only errors on a cold miss with no memo.
   */
  readonly getModels: () => AsyncResult<
    readonly Model[],
    CatalogUnavailableError
  >;
}

export interface ModelCatalogConfig {
  /** Injected fetch for tests; defaults to the isolate's global fetch (the production path). */
  readonly fetch?: CatalogFetch;
  /** Clock injection for TTL tests; defaults to `Date.now`. */
  readonly now?: () => number;
  /** Memo TTL in milliseconds; defaults to ~1h. */
  readonly ttlMs?: number;
}

// --- models.dev boundary schema (loose: unknown keys are tolerated and stripped) ---------------

const modelsDevCostSchema = z.object({
  cache_read: z.number().nonnegative(),
  cache_write: z.number().nonnegative(),
  input: z.number().nonnegative(),
  output: z.number().nonnegative(),
});

const modelsDevLimitSchema = z.object({
  context: z.number().int().positive(),
  output: z.number().int().positive(),
});

const modelsDevModelSchema = z.object({
  attachment: z.boolean(),
  cost: modelsDevCostSchema,
  id: z.string().min(1),
  limit: modelsDevLimitSchema,
  name: z.string().min(1),
  reasoning: z.boolean(),
  release_date: z.iso.date(),
  structured_output: z.boolean(),
  tool_call: z.boolean(),
});
type ModelsDevModel = z.infer<typeof modelsDevModelSchema>;

/** Top level is a map of provider id → provider entry; we only descend into allowlisted ones. */
const catalogEnvelopeSchema = z.record(z.string(), z.unknown());
const providerEntrySchema = z.object({
  models: z.record(z.string(), z.unknown()),
});

// --- assembly (pure) ---------------------------------------------------------------------------

const toModel = (
  entry: ProviderAllowEntry,
  raw: ModelsDevModel
): Model | null => {
  const mapped = {
    capabilities: {
      attachment: raw.attachment,
      reasoning: raw.reasoning,
      structuredOutput: raw.structured_output,
      toolCall: raw.tool_call,
    },
    cost: {
      cacheRead: raw.cost.cache_read,
      cacheWrite: raw.cost.cache_write,
      input: raw.cost.input,
      output: raw.cost.output,
    },
    displayName: raw.name,
    id: `${entry.provider}/${raw.id}`,
    limits: { context: raw.limit.context, output: raw.limit.output },
    provider: entry.provider,
    releaseDate: raw.release_date,
  };

  const parsed = modelSchema.safeParse(mapped);
  if (!parsed.success) {
    console.warn(
      `[model-catalog] dropping ${mapped.id}: failed domain Model validation`,
      parsed.error.issues
    );
    return null;
  }
  return parsed.data;
};

/**
 * Prettify an allowlist slug into a display name for a synthesized default entry, e.g.
 * `claude-sonnet-5` → "Claude Sonnet 5", `gpt-5.5` → "Gpt 5.5". Title-cases each hyphen segment;
 * good enough for a picker label when models.dev carries no `name` for the model.
 */
const displayNameFromSlug = (slug: string): string =>
  slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

/**
 * Synthesize the minimal {@link Model} for an allowlist entry's `defaultModelSlug` (ADR 0038
 * amendment). Used only when models.dev omits the default: models.dev-only metadata is absent, so
 * every non-id field is a neutral stub the shape's `min`/`positive` constraints still accept —
 * capabilities all `false`, cost all `0`, limits `1/1` (positive-int floor), and an epoch sentinel
 * release date. Returns `null` (skip + log) if even the stub fails domain validation.
 */
const synthesizeDefaultModel = (entry: ProviderAllowEntry): Model | null => {
  const mapped = {
    capabilities: {
      attachment: false,
      reasoning: false,
      structuredOutput: false,
      toolCall: false,
    },
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    displayName: displayNameFromSlug(entry.defaultModelSlug),
    id: `${entry.provider}/${entry.defaultModelSlug}`,
    limits: { context: 1, output: 1 },
    provider: entry.provider,
    releaseDate: "1970-01-01",
  };

  const parsed = modelSchema.safeParse(mapped);
  if (!parsed.success) {
    console.warn(
      `[model-catalog] dropping synthesized default ${mapped.id}: failed domain Model validation`,
      parsed.error.issues
    );
    return null;
  }
  return parsed.data;
};

/**
 * Filter the raw models.dev payload through the provider allowlist and map survivors into
 * {@link Model}. Total by construction: any per-model or per-provider defect is skipped + logged.
 *
 * ADR 0038 amendment (2026-07-10): models.dev is a moving target — it dropped `gpt-5.5` the day the
 * 5.6 family shipped — so the raw intersection can offer NO model an allowlisted provider can
 * actually run. Every allowlist entry's `defaultModelSlug` is therefore UNIONED into the catalog:
 * when models.dev already lists it the models.dev entry wins (dedupe by id); when it does not, a
 * minimal entry is synthesized. This runs before the D1 router's per-workspace keyed intersection,
 * so an unkeyed provider's default never surfaces — the union only guarantees every *keyed*
 * provider always offers at least its default.
 */
export const assembleCatalog = (raw: unknown): readonly Model[] => {
  const envelope = catalogEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    // A garbage-but-200 payload is not fatal: the allowlist defaults are still unioned below, so a
    // keyed provider keeps its default even when models.dev is unusable.
    console.warn(
      "[model-catalog] models.dev payload is not a provider map; serving allowlist defaults only"
    );
  }

  const providerMap = envelope.success ? envelope.data : {};
  const models: Model[] = [];
  for (const entry of providerAllowlist) {
    const providerRaw = providerEntrySchema.safeParse(
      providerMap[entry.modelsDevId]
    );
    if (!providerRaw.success) {
      console.warn(
        `[model-catalog] provider '${entry.modelsDevId}' absent or malformed in models.dev; skipping`
      );
      continue;
    }

    for (const [slug, modelRaw] of Object.entries(providerRaw.data.models)) {
      const parsed = modelsDevModelSchema.safeParse(modelRaw);
      if (!parsed.success) {
        console.warn(
          `[model-catalog] skipping ${entry.modelsDevId}/${slug}: failed boundary schema`,
          parsed.error.issues
        );
        continue;
      }
      const model = toModel(entry, parsed.data);
      if (model !== null) {
        models.push(model);
      }
    }
  }

  // Union each allowlist entry's default, deduping when models.dev already listed it.
  const present = new Set(models.map((model) => String(model.id)));
  for (const entry of providerAllowlist) {
    const defaultId = `${entry.provider}/${entry.defaultModelSlug}`;
    if (present.has(defaultId)) {
      continue;
    }
    const synthesized = synthesizeDefaultModel(entry);
    if (synthesized !== null) {
      models.push(synthesized);
      present.add(defaultId);
    }
  }

  return models;
};

// --- fetch + memo ------------------------------------------------------------------------------

const fetchAndAssemble = async (
  fetchImpl: CatalogFetch
): AsyncResult<readonly Model[], CatalogUnavailableError> => {
  try {
    const response = await fetchImpl(MODELS_DEV_API_URL, {
      cf: { cacheEverything: true, cacheTtl: CATALOG_EDGE_CACHE_TTL_SECONDS },
    });
    if (!response.ok) {
      console.warn(
        `[model-catalog] models.dev fetch returned ${response.status}`
      );
      return err(catalogUnavailable);
    }
    const raw: unknown = await response.json();
    return ok(assembleCatalog(raw));
  } catch (error) {
    console.warn("[model-catalog] models.dev fetch/parse failed", error);
    return err(catalogUnavailable);
  }
};

interface MemoEntry {
  readonly fetchedAt: number;
  readonly models: readonly Model[];
}

/**
 * Build a per-isolate memoized catalog. Production constructs one module singleton
 * ({@link modelCatalog}); tests construct throwaway instances with an injected fetch + clock.
 */
export const createModelCatalog = (
  config: ModelCatalogConfig = {}
): ModelCatalog => {
  const fetchImpl = config.fetch ?? (globalThis.fetch as CatalogFetch);
  const now = config.now ?? Date.now;
  const ttlMs = config.ttlMs ?? DEFAULT_MEMO_TTL_MS;

  let cached: MemoEntry | undefined;
  let inflight:
    | AsyncResult<readonly Model[], CatalogUnavailableError>
    | undefined;

  const refresh = async (): AsyncResult<
    readonly Model[],
    CatalogUnavailableError
  > => {
    const result = await fetchAndAssemble(fetchImpl);
    if (result.ok) {
      cached = { fetchedAt: now(), models: result.value };
      return result;
    }
    // keep-last-good: a failed refresh with a prior good catalog serves the stale one.
    if (cached !== undefined) {
      console.warn(
        "[model-catalog] refresh failed; serving last-good catalog (keep-last-good)"
      );
      return ok(cached.models);
    }
    return result;
  };

  // Dedupe concurrent refreshes within the isolate onto one in-flight fetch.
  const runRefresh = async (): AsyncResult<
    readonly Model[],
    CatalogUnavailableError
  > => {
    try {
      return await refresh();
    } finally {
      inflight = undefined;
    }
  };

  return {
    getModels: () => {
      if (cached !== undefined && now() - cached.fetchedAt < ttlMs) {
        return Promise.resolve(ok(cached.models));
      }
      inflight ??= runRefresh();
      return inflight;
    },
  };
};

/** Production per-isolate singleton: constructed lazily-fetching, memoized for the isolate. */
export const modelCatalog: ModelCatalog = createModelCatalog();
