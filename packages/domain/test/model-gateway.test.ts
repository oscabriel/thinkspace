import { describe, expect, test } from "bun:test";

import {
  gatewayAuthHeaders,
  gatewayModelFactories,
} from "../src/adapters/production/model-gateway";
import { secretAliasSchema } from "../src/primitives";
import { providerAllowlist } from "../src/provider-allowlist";

describe("gatewayModelFactories — provider allowlist coverage (E1.7 / ADR 0038)", () => {
  test("every allowlisted provider has an AI Gateway factory", () => {
    const factoryProviders = new Set(Object.keys(gatewayModelFactories));

    for (const entry of providerAllowlist) {
      expect(factoryProviders.has(entry.provider)).toBe(true);
    }
  });

  test("the allowlist ⊆ factory-map invariant now spans both providers", () => {
    const allowlisted = providerAllowlist
      .map((entry) => String(entry.provider))
      .toSorted();
    expect(allowlisted).toEqual(["anthropic", "openai"]);
    for (const provider of allowlisted) {
      expect(
        Object.prototype.hasOwnProperty.call(gatewayModelFactories, provider)
      ).toBe(true);
    }
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
