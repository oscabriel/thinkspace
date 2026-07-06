import { describe, expect, test } from "bun:test";

import { modelSchema } from "../src/model";

const validModel = {
  capabilities: {
    attachment: true,
    reasoning: true,
    structuredOutput: true,
    toolCall: true,
  },
  cost: { cacheRead: 0.2, cacheWrite: 2.5, input: 2, output: 10 },
  displayName: "Claude Sonnet 5",
  id: "anthropic/claude-sonnet-5",
  limits: { context: 1_000_000, output: 128_000 },
  provider: "anthropic",
  releaseDate: "2026-06-29",
};

describe("modelSchema — reshaped Model (E1.2, tier deleted)", () => {
  test("parses a well-formed model", () => {
    const parsed = modelSchema.parse(validModel);
    expect(String(parsed.id)).toBe("anthropic/claude-sonnet-5");
    expect(parsed.cost.cacheRead).toBe(0.2);
    expect(parsed.limits.context).toBe(1_000_000);
    expect(parsed.capabilities.toolCall).toBe(true);
    expect(parsed.releaseDate).toBe("2026-06-29");
  });

  test("no longer carries a tier field", () => {
    const parsed = modelSchema.parse({ ...validModel, tier: "default" });
    expect("tier" in parsed).toBe(false);
  });

  test("rejects a non-composite model id", () => {
    expect(() =>
      modelSchema.parse({ ...validModel, id: "claude-sonnet-5" })
    ).toThrow();
  });

  test("rejects a negative cost", () => {
    expect(() =>
      modelSchema.parse({
        ...validModel,
        cost: { ...validModel.cost, input: -1 },
      })
    ).toThrow();
  });

  test("rejects a malformed releaseDate", () => {
    expect(() =>
      modelSchema.parse({ ...validModel, releaseDate: "June 29 2026" })
    ).toThrow();
  });
});
