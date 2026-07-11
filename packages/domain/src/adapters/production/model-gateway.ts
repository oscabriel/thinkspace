import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

import { byokSecretAlias } from "../../byok";
import { parseModelId } from "../../ids";
import type { ModelId, WorkspaceId } from "../../ids";
import type { ModelProvider } from "../../model";
import { providerAllowlist } from "../../provider-allowlist";
import type { ResolvedProviderAuth } from "../../seams/key-store";

export interface GatewayModelEnv {
  readonly AI_GATEWAY_TOKEN: string;
  readonly AI_GATEWAY_URL: string;
}

export interface GatewayModelFactoryOptions {
  readonly env: GatewayModelEnv;
  /**
   * ADR 0040: the KeyStore-resolved provider auth for this turn. Absent → today's behavior (derive
   * the `cf-aig-byok-alias` and blank the real header, so the gateway substitutes the Secrets Store
   * secret). `kind: "header"` → the decrypted raw key is sent as the real provider-auth header the
   * gateway forwards verbatim (ADR 0038 addendum §2). The raw key lives only in this transient opt.
   */
  readonly providerAuth?: ResolvedProviderAuth;
  readonly workspaceId: WorkspaceId;
}

export type GatewayModelFactory = (
  modelSlug: string,
  opts: GatewayModelFactoryOptions
) => LanguageModel;

/**
 * ADR 0040: the provider-auth header fragment. `header` sends the raw key on the provider's real
 * auth header (anthropic `x-api-key: <k>`, openai `Authorization: Bearer <k>`) — a present header
 * the gateway forwards verbatim. `alias` blanks the real header (an empty header reads as absent,
 * so the gateway substitutes) and sets `cf-aig-byok-alias`. Pure and exported for direct testing.
 */
export const gatewayAuthHeaders = (input: {
  readonly bearer: boolean;
  readonly headerName: "Authorization" | "x-api-key";
  readonly providerAuth: ResolvedProviderAuth;
}): Record<string, string> => {
  const { bearer, headerName, providerAuth } = input;
  if (providerAuth.kind === "header") {
    return {
      [headerName]: bearer
        ? `Bearer ${providerAuth.value}`
        : providerAuth.value,
    };
  }
  return { "cf-aig-byok-alias": providerAuth.alias, [headerName]: "" };
};

/** Effective auth for a factory: the injected KeyStore resolution, or the legacy derived alias. */
const effectiveProviderAuth = (
  workspaceId: WorkspaceId,
  provider: ModelProvider,
  providerAuth: ResolvedProviderAuth | undefined
): ResolvedProviderAuth =>
  providerAuth ?? {
    alias: byokSecretAlias(workspaceId, provider),
    kind: "alias",
  };

/** ADR 0035 / E1.7 spike finding 3: self-construct AI SDK models through AI Gateway BYOK. */
export const gatewayModelFactories = {
  anthropic: (modelSlug, { env, providerAuth, workspaceId }) => {
    const provider = providerAllowlist.find(
      (entry) => entry.provider === "anthropic"
    )?.provider;
    if (provider === undefined) {
      throw new Error(
        "gatewayModelFactories.anthropic: provider not allowlisted"
      );
    }

    return createAnthropic({
      apiKey: "gateway-managed",
      baseURL: `${env.AI_GATEWAY_URL}/anthropic/v1`,
      headers: {
        "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}`,
        "cf-aig-metadata": JSON.stringify({ workspace: workspaceId }),
        // ADR 0036 §9 / ADR 0038 addendum §2 / ADR 0040: the gateway forwards a present
        // provider-auth header VERBATIM (envelope adapter → the decrypted `x-api-key`) and treats
        // an empty one as absent, substituting the Secrets Store secret named by the alias (legacy
        // adapter). The SDK spreads these headers after its own, so the injected value wins.
        ...gatewayAuthHeaders({
          bearer: false,
          headerName: "x-api-key",
          providerAuth: effectiveProviderAuth(
            workspaceId,
            provider,
            providerAuth
          ),
        }),
      },
    })(modelSlug);
  },
  openai: (modelSlug, { env, providerAuth, workspaceId }) => {
    const provider = providerAllowlist.find(
      (entry) => entry.provider === "openai"
    )?.provider;
    if (provider === undefined) {
      throw new Error("gatewayModelFactories.openai: provider not allowlisted");
    }

    // ADR 0038 §1 spike (@ai-sdk/openai@3.0.83, the ai-v6 dist-tag): unlike anthropic — whose
    // SDK builds `${baseURL}/messages` off `https://api.anthropic.com/v1`, forcing the recipe's
    // trailing `/anthropic/v1` — the OpenAI SDK builds `${baseURL}/responses` (the default model
    // callable is the Responses API) off `https://api.openai.com/v1`. The AI Gateway's `/openai`
    // segment already stands in for that `/v1`, so the baseURL is `/openai` with NO trailing
    // `/v1`. `apiKey` is a dummy: loadApiKey only needs a non-empty value (BYOK is gateway-managed
    // via the cf-aig-* headers, same as anthropic).
    return createOpenAI({
      apiKey: "gateway-managed",
      baseURL: `${env.AI_GATEWAY_URL}/openai`,
      headers: {
        // Verified live 2026-07-10 (ADR 0036 §9 / ADR 0038 addendum §2 / ADR 0040): the gateway
        // forwards a present `Authorization` VERBATIM (envelope adapter → `Bearer <decrypted key>`)
        // and treats an empty one as absent, substituting the BYOK secret (legacy adapter). The
        // SDK spreads these headers after its own, so the injected value wins.
        "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}`,
        "cf-aig-metadata": JSON.stringify({ workspace: workspaceId }),
        ...gatewayAuthHeaders({
          bearer: true,
          headerName: "Authorization",
          providerAuth: effectiveProviderAuth(
            workspaceId,
            provider,
            providerAuth
          ),
        }),
      },
    })(modelSlug);
  },
} satisfies Record<string, GatewayModelFactory>;

export const createGatewayModel = (
  modelId: ModelId,
  opts: GatewayModelFactoryOptions
): LanguageModel => {
  const { modelSlug, providerId } = parseModelId(modelId);
  const entry = providerAllowlist.find(
    (candidate) =>
      candidate.provider === providerId ||
      candidate.gatewaySlug === providerId ||
      candidate.modelsDevId === providerId
  );

  if (entry === undefined) {
    throw new Error(
      `createGatewayModel: provider '${providerId}' is not allowlisted`
    );
  }

  const factory = gatewayModelFactories[
    entry.provider as keyof typeof gatewayModelFactories
  ] as GatewayModelFactory | undefined;
  if (factory === undefined) {
    throw new Error(
      `createGatewayModel: no AI Gateway model factory for provider '${entry.provider}'`
    );
  }

  return factory(modelSlug, opts);
};
