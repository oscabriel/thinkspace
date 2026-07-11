import { describe, expect, test } from "bun:test";

import { formatModelId, modelIdSchema, parseModelId } from "../src/ids";

describe("modelIdSchema — composite <providerId>/<modelSlug> (E1.2)", () => {
  test("accepts a composite provider/slug id", () => {
    expect(String(modelIdSchema.parse("anthropic/claude-sonnet-5"))).toBe(
      "anthropic/claude-sonnet-5"
    );
  });

  test("rejects a bare slug with no provider segment", () => {
    expect(() => modelIdSchema.parse("claude-sonnet-5")).toThrow();
  });

  test("rejects an empty provider or slug segment", () => {
    expect(() => modelIdSchema.parse("/claude-sonnet-5")).toThrow();
    expect(() => modelIdSchema.parse("anthropic/")).toThrow();
  });

  test("accepts a model slug carrying slashes (E11.9 aggregator `org/model` ids)", () => {
    // openrouter/togetherai/… publish `org/model` ids; the provider is the FIRST segment and the
    // slug is everything after, so the composite has more than one slash by design.
    expect(String(modelIdSchema.parse("openrouter/anthropic/claude-sonnet-5"))).toBe(
      "openrouter/anthropic/claude-sonnet-5"
    );
    expect(
      parseModelId(modelIdSchema.parse("openrouter/anthropic/claude-sonnet-5"))
    ).toEqual({
      modelSlug: "anthropic/claude-sonnet-5",
      providerId: "openrouter",
    });
  });

  test("formatModelId composes a valid composite id", () => {
    expect(String(formatModelId("anthropic", "claude-sonnet-5"))).toBe(
      "anthropic/claude-sonnet-5"
    );
  });

  test("parseModelId splits a composite id back into its parts", () => {
    expect(
      parseModelId(modelIdSchema.parse("anthropic/claude-sonnet-5"))
    ).toEqual({
      modelSlug: "claude-sonnet-5",
      providerId: "anthropic",
    });
  });
});
