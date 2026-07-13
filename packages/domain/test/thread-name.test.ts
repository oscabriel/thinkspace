import { describe, expect, test } from "bun:test";

import { commentBodySchema, threadNameSchema } from "../src/primitives";
import { deriveOpeningExcerpt, deriveThreadName } from "../src/thread";

const body = (raw: string) => commentBodySchema.parse(raw);
const name = (raw: string) => threadNameSchema.parse(raw);

describe("deriveOpeningExcerpt — pinned pure derivation (ADR 0041)", () => {
  test("preserves bodies at or below 280 characters", () => {
    expect(deriveOpeningExcerpt(body("x".repeat(280)))).toBe("x".repeat(280));
  });

  test("truncates long bodies at a late word boundary with an ellipsis", () => {
    const prefix = `${"x".repeat(250)} boundary `;
    expect(deriveOpeningExcerpt(body(`${prefix}${"y".repeat(100)}`))).toBe(
      `${"x".repeat(250)} boundary…`
    );
  });
});

describe("deriveThreadName — pinned pure derivation (ADR 0034 §5)", () => {
  test("names the thread after the body's first non-empty line", () => {
    expect(
      deriveThreadName(body("fix the login bug\n\nHere's the stack trace:"))
    ).toBe(name("fix the login bug"));
  });

  test("skips leading blank lines and collapses internal whitespace runs", () => {
    expect(deriveThreadName(body("\n  \n  fix   the\tlogin bug  \nrest"))).toBe(
      name("fix the login bug")
    );
  });

  test("hard-truncates to 80 characters", () => {
    expect(deriveThreadName(body("x".repeat(200)))).toBe(name("x".repeat(80)));
  });

  test("whitespace-only body falls back to the literal name", () => {
    expect(deriveThreadName(body("  \n \t \n"))).toBe(name("New thread"));
  });
});
