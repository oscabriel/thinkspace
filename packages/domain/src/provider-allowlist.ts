import type { ModelProvider } from "./model";
import { modelProviderSchema } from "./model";
import { generatedProviderAllowlist } from "./provider-allowlist.generated";

/**
 * E11.9 / ADR 0040 (second half): the models.dev-derived, tier-annotated provider allowlist.
 *
 * ADR 0038 §1 widened E1.2's anthropic-only v1 to a hand-curated two-provider list; E11.9 retires
 * the hand-curated framing entirely. The long tail (models.dev is a 159-provider registry, ~124 of
 * them one uniform `@ai-sdk/openai-compatible` code path) is BUILD-TIME-GENERATED DATA
 * (`provider-allowlist.generated.ts`, refreshed by `scripts/refresh-provider-allowlist.ts`) — NOT a
 * live models.dev dependency at module scope. `openai`/`anthropic` stay hand-authored first-party
 * entries here so their tiers and exact `defaultModelSlug`s (the curator's earliest-keyed ordering,
 * ADR 0038 §2) are preserved verbatim.
 *
 * Three honest tiers (no key-buying): `verified` (a code-verified factory smoke-tested with a real
 * key — openai only), `best-effort` (the generic openai-compatible path; "first run confirms" — a
 * bad key or base URL settles as a visible `run_failure` via ADR 0028), `unsupported`
 * (sigv4/oauth/local/per-resource providers — greyed with a one-line reason, never a dead form).
 * Only `bearer`/`x-api-key` auth kinds are key-registrable; the rest are `unsupported` by
 * construction and carry an `unsupportedReason`.
 */

export type ProviderTier = "best-effort" | "unsupported" | "verified";
export type ProviderAuthKind =
  | "bearer"
  | "local"
  | "oauth"
  | "sigv4"
  | "x-api-key";
/**
 * How `gatewaySlug` is interpreted. `native` → the AI Gateway routes the provider directly under
 * that path segment (openai/anthropic and the documented native slugs). `custom-provider` → the
 * provider rides the generic openai-compatible factory through an AI Gateway Custom Provider route
 * whose upstream `base_url` is `upstreamBaseUrl` (models.dev's `api`), provisioned lazily at key
 * registration (ADR 0040 §7 — the CF write is currently a documented, UNVERIFIED seam).
 */
export type ProviderRouting = "custom-provider" | "native";

/** The plain-string shape the generated data file carries (provider un-branded for a data literal). */
export interface GeneratedAllowEntry {
  readonly authKind: ProviderAuthKind;
  readonly defaultModelSlug: string;
  readonly displayName: string;
  readonly gatewaySlug: string;
  readonly modelsDevId: string;
  readonly provider: string;
  readonly routing: ProviderRouting;
  readonly tier: ProviderTier;
  /** Present iff `tier === "unsupported"` — a human-readable reason for the greyed UI row. */
  readonly unsupportedReason?: string;
  /** Present iff `routing === "custom-provider"` — the models.dev upstream base URL. */
  readonly upstreamBaseUrl?: string;
}

/**
 * One allowlisted provider. `modelsDevId` keys into the models.dev catalog, `gatewaySlug` is the AI
 * Gateway path segment (a native slug or a Custom Provider route slug per `routing`), `provider` is
 * the internal brand, `defaultModelSlug` is the fallback model slug composed with `modelsDevId` into
 * a ModelId. Every mechanism keyed off this list (catalog assembly, factory dispatch, BYOK alias,
 * curator provider selection) stays provider-generic, so joining a provider is additive here.
 */
export interface ProviderAllowEntry {
  readonly authKind: ProviderAuthKind;
  readonly defaultModelSlug: string;
  readonly displayName: string;
  readonly gatewaySlug: string;
  readonly modelsDevId: string;
  readonly provider: ModelProvider;
  readonly routing: ProviderRouting;
  readonly tier: ProviderTier;
  readonly unsupportedReason?: string;
  readonly upstreamBaseUrl?: string;
}

/**
 * Hand-authored first-party entries. Anthropic heads the list so the curator's allowlist-head
 * fallback (ADR 0021 / `resolveCuratorModelId`) is unchanged for every existing anthropic-only
 * workspace. openai is the sole Tier-A `verified` provider (its gateway recipe is smoke-tested with
 * a real key, ADR 0038 addendum); anthropic stays `best-effort` until a real anthropic key exists.
 * Both route natively; their `defaultModelSlug`s are preserved verbatim.
 */
const firstPartyEntries: readonly ProviderAllowEntry[] = [
  {
    authKind: "x-api-key",
    defaultModelSlug: "claude-sonnet-5",
    displayName: "Anthropic",
    gatewaySlug: "anthropic",
    modelsDevId: "anthropic",
    provider: modelProviderSchema.parse("anthropic"),
    routing: "native",
    tier: "best-effort",
  },
  {
    authKind: "bearer",
    defaultModelSlug: "gpt-5.5",
    displayName: "OpenAI",
    gatewaySlug: "openai",
    modelsDevId: "openai",
    provider: modelProviderSchema.parse("openai"),
    routing: "native",
    tier: "verified",
  },
];

const brand = (entry: GeneratedAllowEntry): ProviderAllowEntry => ({
  ...entry,
  provider: modelProviderSchema.parse(entry.provider),
});

/**
 * The full allowlist: hand-authored first-party heads + the models.dev-derived generated tail. The
 * head order (anthropic, openai) is load-bearing for the curator's allowlist-head fallback.
 */
export const providerAllowlist: readonly ProviderAllowEntry[] = [
  ...firstPartyEntries,
  ...generatedProviderAllowlist.map(brand),
];

/** A tier is key-registrable iff it is not `unsupported` (bearer/x-api-key resolvable to a route). */
export const isRegistrableTier = (tier: ProviderTier): boolean =>
  tier !== "unsupported";

/** Find an allowlist entry by internal provider brand (or its models.dev id / gateway slug). */
export const findAllowEntry = (
  providerId: string
): ProviderAllowEntry | undefined =>
  providerAllowlist.find(
    (entry) =>
      entry.provider === providerId ||
      entry.gatewaySlug === providerId ||
      entry.modelsDevId === providerId
  );

/** The subset a workspace may register a key for (Tier A/B). Drives the write-route acceptance gate. */
export const registrableAllowlist: readonly ProviderAllowEntry[] =
  providerAllowlist.filter((entry) => isRegistrableTier(entry.tier));
