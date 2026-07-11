/**
 * E11.9 / ADR 0040 (second half): refresh the models.dev-derived provider allowlist.
 *
 * The allowlist is BUILD-TIME-GENERATED DATA checked into the repo, not a live models.dev
 * dependency at module scope. (The live catalog already consumes models.dev at the edge; the
 * ALLOWLIST is the static, tier-annotated derivation.) This script is the documented refresh
 * procedure: it fetches the models.dev registry, classifies every provider into a tier + auth
 * kind + routing, and writes `packages/domain/src/provider-allowlist.generated.ts`.
 *
 * Run:  bun run scripts/refresh-provider-allowlist.ts
 * Then: review the diff, run the domain gates, and commit the regenerated file.
 *
 * Classification (deterministic, keyed off the models.dev `npm` package + `api` base URL):
 *  - `@ai-sdk/amazon-bedrock`          → sigv4, UNSUPPORTED (request signing, no static header).
 *  - `@ai-sdk/google-vertex*`          → oauth,  UNSUPPORTED (service-account OAuth, no API key).
 *  - `@ai-sdk/azure`                   → x-api-key but UNSUPPORTED (per-resource base URL).
 *  - localhost `api`                   → local,  UNSUPPORTED (edge cannot reach it).
 *  - meta-gateway SDKs                 → bearer but UNSUPPORTED (register upstreams directly).
 *  - `@ai-sdk/anthropic`               → x-api-key, BEST-EFFORT.
 *  - everything else with a base URL   → bearer,    BEST-EFFORT via the generic openai-compatible
 *                                        factory (native gateway slug where documented, else a
 *                                        Custom Provider route parameterized by the models.dev
 *                                        base URL).
 *  - no base URL and no native slug    → UNSUPPORTED (no routable endpoint).
 *
 * `openai` and `anthropic` are NOT emitted here — they stay hand-authored first-party entries in
 * `provider-allowlist.ts` (openai is the sole Tier-A Verified provider, smoke-tested; anthropic is
 * Best-effort until a real key exists, ADR 0038 addendum). Their exact `defaultModelSlug`s
 * (`gpt-5.5`, `claude-sonnet-5`) are preserved there so the curator's earliest-keyed ordering
 * (ADR 0038 §2) is untouched.
 */

const MODELS_DEV_API_URL = "https://models.dev/api.json";

/** Providers handled as hand-authored first-party entries; never emitted into the generated file. */
const FIRST_PARTY_IDS = new Set(["openai", "anthropic"]);

/**
 * Documented Cloudflare AI Gateway native provider slugs (models.dev id → gateway path segment).
 * UNVERIFIED against a live gateway for the long tail (only openai/anthropic are smoke-tested), so
 * every native-routed provider here is Best-effort: a wrong slug settles as a visible first-run
 * failure (ADR 0028), which is exactly the Tier-B "first run confirms" contract. Kept small and
 * conservative — a provider absent here with no models.dev base URL is honestly Unsupported.
 */
const NATIVE_GATEWAY_SLUGS: Readonly<Record<string, string>> = {
  cerebras: "cerebras",
  cohere: "cohere",
  deepseek: "deepseek",
  google: "google-ai-studio",
  groq: "groq",
  huggingface: "huggingface",
  mistral: "mistral",
  perplexity: "perplexity-ai",
  replicate: "replicate",
  xai: "grok",
};

/** Meta-gateway/aggregator SDKs: routing a gateway through our gateway is out of scope. */
const META_GATEWAY_NPM = new Set([
  "@ai-sdk/gateway",
  "@ai-sdk/vercel",
  "ai-gateway-provider",
  "merge-gateway-ai-sdk-provider",
]);

interface ModelsDevProvider {
  readonly id: string;
  readonly name?: string;
  readonly npm?: string;
  readonly api?: string;
  readonly env?: readonly string[];
  readonly models?: Record<string, { readonly id?: string; readonly release_date?: string }>;
}

type Tier = "verified" | "best-effort" | "unsupported";
type AuthKind = "bearer" | "x-api-key" | "sigv4" | "oauth" | "local";
type Routing = "native" | "custom-provider";

interface GeneratedAllowEntry {
  readonly provider: string;
  readonly modelsDevId: string;
  readonly displayName: string;
  readonly gatewaySlug: string;
  readonly defaultModelSlug: string;
  readonly tier: Tier;
  readonly authKind: AuthKind;
  readonly routing: Routing;
  readonly upstreamBaseUrl?: string;
  readonly unsupportedReason?: string;
}

const isLocalUrl = (url: string | undefined): boolean =>
  url !== undefined && /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(url);

/** A usable upstream base URL: an absolute http(s) URL, not a `${VAR}` template (e.g. neon). */
const usableBaseUrl = (url: string | undefined): string | undefined =>
  url !== undefined && /^https?:\/\//.test(url) && !url.includes("${")
    ? url
    : undefined;

/** Sanitize a models.dev id into a stable Custom Provider route slug. */
const customProviderSlug = (id: string): string =>
  id.toLowerCase().replace(/[^a-z0-9-]/g, "-");

/** Pick the provider's default model: the newest by release_date, lexical-max id as tie-break. */
const pickDefaultModelSlug = (provider: ModelsDevProvider): string | null => {
  const slugs = Object.keys(provider.models ?? {});
  if (slugs.length === 0) {
    return null;
  }
  return slugs.toSorted((a, b) => {
    const da = provider.models?.[a]?.release_date ?? "";
    const db = provider.models?.[b]?.release_date ?? "";
    if (da !== db) {
      return da < db ? 1 : -1;
    }
    return a < b ? 1 : -1;
  })[0];
};

const classify = (
  provider: ModelsDevProvider,
  defaultModelSlug: string
): GeneratedAllowEntry => {
  const base = {
    authKind: "bearer" as AuthKind,
    defaultModelSlug,
    displayName: provider.name ?? provider.id,
    gatewaySlug: customProviderSlug(provider.id),
    modelsDevId: provider.id,
    provider: provider.id,
    routing: "custom-provider" as Routing,
    tier: "best-effort" as Tier,
  } satisfies GeneratedAllowEntry;

  const npm = provider.npm ?? "";
  const unsupported = (authKind: AuthKind, reason: string): GeneratedAllowEntry => ({
    ...base,
    authKind,
    tier: "unsupported",
    unsupportedReason: reason,
  });

  if (npm === "@ai-sdk/amazon-bedrock") {
    return unsupported(
      "sigv4",
      "AWS SigV4 request signing — not a static API-key header the gateway can forward."
    );
  }
  if (npm.startsWith("@ai-sdk/google-vertex")) {
    return unsupported(
      "oauth",
      "Google Cloud service-account OAuth — no static API key to store."
    );
  }
  if (npm === "@ai-sdk/azure") {
    return unsupported(
      "x-api-key",
      "Per-resource Azure endpoint — the base URL is deployment-specific, not uniformly routable."
    );
  }
  if (isLocalUrl(provider.api)) {
    return unsupported(
      "local",
      "Local/self-hosted endpoint — not reachable from the Cloudflare edge."
    );
  }
  if (META_GATEWAY_NPM.has(npm)) {
    return unsupported(
      "bearer",
      "Meta-gateway/aggregator — register its upstream providers directly."
    );
  }

  const authKind: AuthKind = npm === "@ai-sdk/anthropic" ? "x-api-key" : "bearer";

  const nativeSlug = NATIVE_GATEWAY_SLUGS[provider.id];
  if (nativeSlug !== undefined) {
    return {
      ...base,
      authKind,
      gatewaySlug: nativeSlug,
      routing: "native",
      tier: "best-effort",
    };
  }
  const baseUrl = usableBaseUrl(provider.api);
  if (baseUrl !== undefined) {
    return {
      ...base,
      authKind,
      routing: "custom-provider",
      tier: "best-effort",
      upstreamBaseUrl: baseUrl,
    };
  }
  return unsupported(
    authKind,
    "No usable base URL published by models.dev and no native AI Gateway route — cannot construct an endpoint."
  );
};

const serializeEntry = (e: GeneratedAllowEntry): string => {
  const q = (s: string) => JSON.stringify(s);
  const lines = [
    `    authKind: ${q(e.authKind)},`,
    `    defaultModelSlug: ${q(e.defaultModelSlug)},`,
    `    displayName: ${q(e.displayName)},`,
    `    gatewaySlug: ${q(e.gatewaySlug)},`,
    `    modelsDevId: ${q(e.modelsDevId)},`,
    `    provider: ${q(e.provider)},`,
    `    routing: ${q(e.routing)},`,
    `    tier: ${q(e.tier)},`,
  ];
  if (e.unsupportedReason !== undefined) {
    lines.push(`    unsupportedReason: ${q(e.unsupportedReason)},`);
  }
  if (e.upstreamBaseUrl !== undefined) {
    lines.push(`    upstreamBaseUrl: ${q(e.upstreamBaseUrl)},`);
  }
  return `  {\n${lines.join("\n")}\n  },`;
};

const main = async () => {
  const response = await fetch(MODELS_DEV_API_URL);
  if (!response.ok) {
    throw new Error(`models.dev fetch failed: HTTP ${response.status}`);
  }
  const raw = (await response.json()) as Record<string, ModelsDevProvider>;

  const entries: GeneratedAllowEntry[] = [];
  for (const id of Object.keys(raw).toSorted()) {
    if (FIRST_PARTY_IDS.has(id)) {
      continue;
    }
    const provider = raw[id];
    const defaultModelSlug = pickDefaultModelSlug(provider);
    if (defaultModelSlug === null) {
      // A provider with no models offers nothing to run; skip it (never emit a keyless default).
      continue;
    }
    entries.push(classify(provider, defaultModelSlug));
  }

  const counts = entries.reduce<Record<Tier, number>>(
    (acc, e) => ({ ...acc, [e.tier]: (acc[e.tier] ?? 0) + 1 }),
    { "best-effort": 0, unsupported: 0, verified: 0 }
  );

  const header = `// AUTO-GENERATED by scripts/refresh-provider-allowlist.ts — DO NOT EDIT BY HAND.
// Source: ${MODELS_DEV_API_URL} (refreshed ${new Date().toISOString().slice(0, 10)}).
// ${entries.length} providers: ${counts["best-effort"]} best-effort, ${counts.unsupported} unsupported.
// openai/anthropic are hand-authored first-party entries in provider-allowlist.ts (not here).
// Regenerate with: bun run scripts/refresh-provider-allowlist.ts

import type { GeneratedAllowEntry } from "./provider-allowlist";

export const generatedProviderAllowlist: readonly GeneratedAllowEntry[] = [
`;
  const body = entries.map(serializeEntry).join("\n");
  const file = `${header}${body}\n];\n`;

  const outPath = new URL(
    "../packages/domain/src/provider-allowlist.generated.ts",
    import.meta.url
  );
  await Bun.write(outPath, file);
  process.stdout.write(
    `wrote ${entries.length} entries (${counts["best-effort"]} best-effort, ${counts.unsupported} unsupported) to ${outPath.pathname}\n`
  );
};

await main();
