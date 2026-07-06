import type { ModelProvider } from "./model";
import { modelProviderSchema } from "./model";

/**
 * One allowlisted provider. `modelsDevId` keys into the models.dev catalog, `gatewaySlug` is the
 * AI Gateway path segment, `provider` is the internal brand, `defaultModelSlug` is the fallback
 * model slug (composed with `modelsDevId` into a ModelId). v1 = anthropic only (E1.2).
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
];
