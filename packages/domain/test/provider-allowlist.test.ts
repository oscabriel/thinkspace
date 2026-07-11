import { describe, expect, test } from "bun:test";

import {
  findAllowEntry,
  isRegistrableTier,
  providerAllowlist,
  registrableAllowlist,
} from "../src/provider-allowlist";

/**
 * E11.9 / ADR 0040 (second half): the models.dev-derived, tier-annotated allowlist contract. These
 * pin the tier/authKind invariants the write route, factory dispatch, and UI all depend on.
 */
describe("providerAllowlist — tiered models.dev derivation (E11.9)", () => {
  test("the long tail is real: >100 entries across the three tiers", () => {
    expect(providerAllowlist.length).toBeGreaterThan(100);
  });

  test("anthropic heads the list (curator allowlist-head fallback, ADR 0038 §2 preserved)", () => {
    expect(String(providerAllowlist[0]?.provider)).toBe("anthropic");
  });

  test("openai stays Tier-A verified with its exact default slug", () => {
    const openai = findAllowEntry("openai");
    expect(openai?.tier).toBe("verified");
    expect(openai?.defaultModelSlug).toBe("gpt-5.5");
    expect(openai?.authKind).toBe("bearer");
    expect(openai?.routing).toBe("native");
  });

  test("anthropic stays Tier-B best-effort until a real key exists (ADR 0038 addendum)", () => {
    const anthropic = findAllowEntry("anthropic");
    expect(anthropic?.tier).toBe("best-effort");
    expect(anthropic?.defaultModelSlug).toBe("claude-sonnet-5");
    expect(anthropic?.authKind).toBe("x-api-key");
  });

  test("every registrable entry is bearer/x-api-key with no unsupported reason", () => {
    for (const entry of registrableAllowlist) {
      expect(["bearer", "x-api-key"]).toContain(entry.authKind);
      expect(entry.unsupportedReason).toBeUndefined();
      expect(isRegistrableTier(entry.tier)).toBe(true);
    }
  });

  test("every unsupported entry carries a human-readable reason and is not registrable", () => {
    const unsupported = providerAllowlist.filter(
      (entry) => entry.tier === "unsupported"
    );
    expect(unsupported.length).toBeGreaterThan(0);
    for (const entry of unsupported) {
      expect(entry.unsupportedReason).toBeDefined();
      expect((entry.unsupportedReason ?? "").length).toBeGreaterThan(0);
      expect(isRegistrableTier(entry.tier)).toBe(false);
    }
  });

  test("sigv4/oauth/local auth kinds are always unsupported (never key-registrable)", () => {
    for (const entry of providerAllowlist) {
      if (["sigv4", "oauth", "local"].includes(entry.authKind)) {
        expect(entry.tier).toBe("unsupported");
      }
    }
  });

  test("a custom-provider entry carries an upstream base URL; native entries route by slug", () => {
    for (const entry of registrableAllowlist) {
      if (entry.routing === "custom-provider") {
        expect(entry.upstreamBaseUrl).toBeDefined();
        expect(entry.upstreamBaseUrl).toMatch(/^https?:\/\//);
      } else {
        expect(entry.gatewaySlug.length).toBeGreaterThan(0);
      }
    }
  });

  test("registrableAllowlist is exactly the non-unsupported subset", () => {
    expect(registrableAllowlist.length).toBe(
      providerAllowlist.filter((entry) => entry.tier !== "unsupported").length
    );
  });
});
