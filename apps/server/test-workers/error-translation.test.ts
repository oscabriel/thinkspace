import type { DomainError } from "@thinkspace/domain/errors";
import { describe, expect, it } from "vitest";

import { domainErrorStatus } from "../src/error-translation";

// domainErrorStatus switches on `kind` alone; the branded payload fields are
// irrelevant to translation, so these pins name only the discriminant.
const errorOfKind = (kind: DomainError["kind"]): DomainError =>
  ({ kind }) as DomainError;

describe("domainErrorStatus", () => {
  it("maps channel_not_visible to 404 (invisibility-as-nonexistence)", () => {
    expect(domainErrorStatus(errorOfKind("channel_not_visible"))).toBe(404);
  });

  // E5.4 / ADR 0035 §7 amendment (baked decision 1): a cross-tenant channel-id
  // probe trips the domain tenant guard. It must read as 404, not the "rest → 500"
  // default — a 500-vs-404 oracle would confirm a foreign-but-real channel to a
  // non-holder. Invisibility-as-nonexistence outranks the original row.
  it("maps tenant_guard_violation to 404, not 500 (cross-tenant probe cannot be distinguished)", () => {
    expect(domainErrorStatus(errorOfKind("tenant_guard_violation"))).toBe(404);
  });
});
