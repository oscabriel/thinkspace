import { describe, expect, test } from "bun:test";

import { gatewayModelFactories } from "../src/adapters/production/model-gateway";
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
