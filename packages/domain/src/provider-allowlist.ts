import type { ModelProvider } from "./model";
import { modelProviderSchema } from "./model";

/**
 * One allowlisted provider. `modelsDevId` keys into the models.dev catalog, `gatewaySlug` is the
 * AI Gateway path segment, `provider` is the internal brand, `defaultModelSlug` is the fallback
 * model slug (composed with `modelsDevId` into a ModelId). ADR 0038 §1 widened this beyond E1.2's
 * anthropic-only v1: every mechanism keyed off this list (catalog assembly, factory map, BYOK
 * alias, curator provider selection) is provider-generic, so joining a provider is additive here.
 */
export interface ProviderAllowEntry {
  readonly defaultModelSlug: string;
  readonly gatewaySlug: string;
  readonly modelsDevId: string;
  readonly provider: ModelProvider;
}

export const providerAllowlist: readonly ProviderAllowEntry[] = [
  {
    defaultModelSlug: "claude-sonnet-5",
    gatewaySlug: "anthropic",
    modelsDevId: "anthropic",
    provider: modelProviderSchema.parse("anthropic"),
  },
  {
    // models.dev verified 2026-07-09 (ADR 0038 §1).
    defaultModelSlug: "gpt-5.5",
    gatewaySlug: "openai",
    modelsDevId: "openai",
    provider: modelProviderSchema.parse("openai"),
  },
];
