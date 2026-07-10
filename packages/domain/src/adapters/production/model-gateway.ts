import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

import { byokSecretAlias } from "../../byok";
import { parseModelId } from "../../ids";
import type { ModelId, WorkspaceId } from "../../ids";
import { providerAllowlist } from "../../provider-allowlist";

export interface GatewayModelEnv {
  readonly AI_GATEWAY_TOKEN: string;
  readonly AI_GATEWAY_URL: string;
}

export interface GatewayModelFactoryOptions {
  readonly env: GatewayModelEnv;
  readonly workspaceId: WorkspaceId;
}

export type GatewayModelFactory = (
  modelSlug: string,
  opts: GatewayModelFactoryOptions
) => LanguageModel;

/** ADR 0035 / E1.7 spike finding 3: self-construct AI SDK models through AI Gateway BYOK. */
export const gatewayModelFactories = {
  anthropic: (modelSlug, { env, workspaceId }) => {
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
        "cf-aig-byok-alias": byokSecretAlias(workspaceId, provider),
        "cf-aig-metadata": JSON.stringify({ workspace: workspaceId }),
        // ADR 0036 §9's recorded contingency, proven live 2026-07-10 on the openai path: the
        // gateway forwards a present provider-auth header VERBATIM instead of substituting the
        // BYOK secret, so the SDK's dummy key reaches the provider as the credential. The SDK
        // spreads these headers after its own, and the gateway treats an empty value as absent —
        // substitution then kicks in.
        "x-api-key": "",
      },
    })(modelSlug);
  },
  openai: (modelSlug, { env, workspaceId }) => {
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
        // Verified live 2026-07-10 (ADR 0036 §9 contingency): with `Authorization: Bearer
        // gateway-managed` present the gateway forwarded the dummy to OpenAI (401
        // invalid_api_key); blanked, the gateway treats it as absent and substitutes the BYOK
        // secret (200). The SDK spreads these headers after its own, so the blank wins.
        Authorization: "",
        "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}`,
        "cf-aig-byok-alias": byokSecretAlias(workspaceId, provider),
        "cf-aig-metadata": JSON.stringify({ workspace: workspaceId }),
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
