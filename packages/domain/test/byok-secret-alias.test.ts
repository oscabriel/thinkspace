import { describe, expect, test } from "bun:test";

import { byokSecretAlias } from "../src/byok";
import { workspaceIdSchema } from "../src/ids";
import { modelProviderSchema } from "../src/model";

describe("byokSecretAlias — frozen ws-<workspaceId>-<provider> format (E1.1 §1)", () => {
  test("composes the hyphen-delimited alias", () => {
    expect(
      String(
        byokSecretAlias(
          workspaceIdSchema.parse("workspace-1"),
          modelProviderSchema.parse("anthropic")
        )
      )
    ).toBe("ws-workspace-1-anthropic");
  });

  test("is a pure function of its two inputs", () => {
    const workspaceId = workspaceIdSchema.parse("acme");
    const provider = modelProviderSchema.parse("anthropic");
    expect(byokSecretAlias(workspaceId, provider)).toBe(
      byokSecretAlias(workspaceId, provider)
    );
  });
});
