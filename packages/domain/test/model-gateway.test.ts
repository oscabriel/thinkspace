import { describe, expect, test } from "bun:test";

import {
  createGatewayModel,
  gatewayAuthHeaders,
  genericGatewayBaseUrl,
} from "../src/adapters/production/model-gateway";
import type { GatewayModelEnv } from "../src/adapters/production/model-gateway";
import { formatModelId } from "../src/ids";
import { secretAliasSchema } from "../src/primitives";
import {
  isRegistrableTier,
  providerAllowlist,
} from "../src/provider-allowlist";
import { workspaceId } from "../src/testing";

const fakeEnv: GatewayModelEnv = {
  AI_GATEWAY_TOKEN: "gw-token",
  AI_GATEWAY_URL: "https://gateway.example/v1/acct/gw",
};

describe("createGatewayModel — allowlist ⊆ factory invariant restated (E11.9 / ADR 0040)", () => {
  const ws = workspaceId("factory-ws");

  // The header path avoids the byokSecretAlias parse so this only exercises factory construction.
  const build = (modelsDevId: string, slug: string) =>
    createGatewayModel(formatModelId(modelsDevId, slug), {
      env: fakeEnv,
      providerAuth: { kind: "header", value: "sk-test" },
      workspaceId: ws,
    });

  test("EVERY registrable allowlist entry resolves to a factory (generic or first-party)", () => {
    const registrable = providerAllowlist.filter((entry) =>
      isRegistrableTier(entry.tier)
    );
    // The whole point of E11.9: the long tail is one code path, so this spans ~140 providers.
    expect(registrable.length).toBeGreaterThan(100);
    for (const entry of registrable) {
      const model = build(entry.modelsDevId, entry.defaultModelSlug);
      expect(model).toBeDefined();
    }
  });

  test("an unsupported-tier provider is rejected, never constructed as a latent 500", () => {
    const unsupported = providerAllowlist.find(
      (entry) => entry.tier === "unsupported"
    );
    expect(unsupported).toBeDefined();
    if (unsupported === undefined) {
      return;
    }
    expect(() =>
      build(unsupported.modelsDevId, unsupported.defaultModelSlug)
    ).toThrow(/not key-registrable/);
  });

  test("an un-allowlisted provider throws a clear not-allowlisted error", () => {
    expect(() => build("no-such-provider", "some-model")).toThrow(
      /not allowlisted/
    );
  });
});

describe("genericGatewayBaseUrl — native slug vs Custom Provider route (E11.9)", () => {
  const nativeEntry = providerAllowlist.find(
    (entry) => entry.routing === "native" && isRegistrableTier(entry.tier)
  );
  const customEntry = providerAllowlist.find(
    (entry) => entry.routing === "custom-provider"
  );

  test("a native-routed provider posts to the bare gateway slug segment", () => {
    expect(nativeEntry).toBeDefined();
    if (nativeEntry === undefined) {
      return;
    }
    expect(genericGatewayBaseUrl(fakeEnv, nativeEntry)).toBe(
      `${fakeEnv.AI_GATEWAY_URL}/${nativeEntry.gatewaySlug}`
    );
  });

  test("a non-native provider posts to the custom-<slug> route segment", () => {
    expect(customEntry).toBeDefined();
    if (customEntry === undefined) {
      return;
    }
    expect(genericGatewayBaseUrl(fakeEnv, customEntry)).toBe(
      `${fakeEnv.AI_GATEWAY_URL}/custom-${customEntry.gatewaySlug}`
    );
  });
});

describe("gatewayAuthHeaders — envelope header vs legacy alias (ADR 0040)", () => {
  const alias = secretAliasSchema.parse("ws-workspace-1-anthropic");

  test("an envelope header sends the raw key on x-api-key (anthropic, no bearer)", () => {
    const headers = gatewayAuthHeaders({
      bearer: false,
      headerName: "x-api-key",
      providerAuth: { kind: "header", value: "sk-anthropic-raw" },
    });
    expect(headers).toEqual({ "x-api-key": "sk-anthropic-raw" });
    // The envelope path sends NO alias header — the gateway forwards the present header verbatim.
    expect(headers["cf-aig-byok-alias"]).toBeUndefined();
  });

  test("an envelope header sends Bearer-prefixed Authorization (openai)", () => {
    const headers = gatewayAuthHeaders({
      bearer: true,
      headerName: "Authorization",
      providerAuth: { kind: "header", value: "sk-openai-raw" },
    });
    expect(headers).toEqual({ Authorization: "Bearer sk-openai-raw" });
  });

  test("a legacy alias blanks the real header and sets cf-aig-byok-alias", () => {
    const headers = gatewayAuthHeaders({
      bearer: false,
      headerName: "x-api-key",
      providerAuth: { alias, kind: "alias" },
    });
    expect(headers).toEqual({
      "cf-aig-byok-alias": alias,
      "x-api-key": "",
    });
  });

  test("the header fragment for an envelope key never carries an empty blanked header", () => {
    const headers = gatewayAuthHeaders({
      bearer: true,
      headerName: "Authorization",
      providerAuth: { kind: "header", value: "sk-openai-raw" },
    });
    expect(headers.Authorization).toBe("Bearer sk-openai-raw");
    expect(Object.keys(headers)).toEqual(["Authorization"]);
  });
});
