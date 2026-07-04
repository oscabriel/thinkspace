import { describe, expect, test } from "bun:test";

import { commentBodySchema, threadNameSchema } from "../src/primitives";
import { deriveThreadName } from "../src/thread";

const body = (raw: string) => commentBodySchema.parse(raw);
const name = (raw: string) => threadNameSchema.parse(raw);

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
