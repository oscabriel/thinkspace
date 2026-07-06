import { describe, expect, test } from "bun:test";

import { gatewayModelFactories } from "../src/adapters/production/model-gateway";
import { providerAllowlist } from "../src/provider-allowlist";

describe("gatewayModelFactories — provider allowlist coverage (E1.7)", () => {
  test("every allowlisted provider has an AI Gateway factory", () => {
    const factoryProviders = new Set(Object.keys(gatewayModelFactories));

    for (const entry of providerAllowlist) {
      expect(factoryProviders.has(entry.provider)).toBe(true);
    }
  });
});
