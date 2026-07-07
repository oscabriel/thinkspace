import { describe, expect, test } from "bun:test";

import {
  type CuratorAddress,
  decodeCuratorAddress,
  encodeCuratorAddress,
} from "../src/adapters/curator-address";
import { memberId, workspaceId } from "../src/testing";

const address = (ws: string, mb: string): CuratorAddress => ({
  memberId: memberId(mb),
  workspaceId: workspaceId(ws),
});

describe("Curator address codec — DO name is the workspace/member address (ADR 0026/0033)", () => {
  test("an encoded address decodes back to the same address", () => {
    const original = address("workspace-1", "member-1");

    const decoded = decodeCuratorAddress(encodeCuratorAddress(original));

    expect(decoded).toEqual(original);
  });

  test("adversarial ids round-trip: slashes, percent escapes, unicode", () => {
    const adversarial = [
      address("ws/with/slashes", "member-1"),
      address("ws-1", "member%2Fpre-encoded"),
      address("ws-1", "member-日本語-🧑"),
      address("ws %", "%2F"),
    ];

    for (const original of adversarial) {
      const decoded = decodeCuratorAddress(encodeCuratorAddress(original));
      expect(decoded).toEqual(original);
    }
  });

  test("injectivity: addresses whose raw join would collide encode to distinct names", () => {
    const collisionPairs: readonly (readonly [
      CuratorAddress,
      CuratorAddress,
    ])[] = [
      // A raw "/"-join maps both sides of each pair to the same string.
      [address("a/b", "c"), address("a", "b/c")],
      [address("a%2Fb", "c"), address("a/b", "c")],
    ];

    for (const [left, right] of collisionPairs) {
      expect(encodeCuratorAddress(left)).not.toBe(encodeCuratorAddress(right));
    }
  });

  test("decode fails closed: anything that is not a canonical encoded address is null", () => {
    const notAddresses = [
      "0b0724bc-8e1c-4ee3-a24a-7c9a251d64ab",
      "ws-1",
      "ws-1/member-1/extra",
      "/",
      "ws-1/",
      "%zz/member-1",
      "ws 1/member-1",
      "",
    ];

    for (const name of notAddresses) {
      expect(decodeCuratorAddress(name)).toBeNull();
    }
  });

  test("the wire format is pinned: {ws}/{member}, encodeURIComponent per segment (DO names are permanent)", () => {
    expect(encodeCuratorAddress(address("workspace-1", "member-1"))).toBe(
      "workspace-1/member-1"
    );
    expect(encodeCuratorAddress(address("a/b", "c d"))).toBe("a%2Fb/c%20d");
  });
});
