import { describe, expect, test } from "bun:test";

import {
  decodeThreadAgentAddress,
  encodeThreadAgentAddress,
} from "../src/adapters/thread-agent-address";
import type { ThreadAgentAddress } from "../src/seams/thread-agent";
import { channelId, threadId, workspaceId } from "../src/testing";

const address = (ws: string, ch: string, th: string): ThreadAgentAddress => ({
  channelId: channelId(ch),
  threadId: threadId(th),
  workspaceId: workspaceId(ws),
});

describe("ThreadAgent address codec — DO name is the address (ADR 0033)", () => {
  test("an encoded address decodes back to the same address", () => {
    const original = address("workspace-1", "channel-1", "thread-1");

    const decoded = decodeThreadAgentAddress(
      encodeThreadAgentAddress(original)
    );

    expect(decoded).toEqual(original);
  });

  test("adversarial ids round-trip: slashes, percent escapes, unicode", () => {
    const adversarial = [
      address("ws/with/slashes", "ch-1", "th-1"),
      address("ws-1", "ch%2Fpre-encoded", "th-1"),
      address("ws-1", "ch-1", "th-日本語-🧵"),
      address("ws %", "/", "%2F"),
    ];

    for (const original of adversarial) {
      const decoded = decodeThreadAgentAddress(
        encodeThreadAgentAddress(original)
      );
      expect(decoded).toEqual(original);
    }
  });

  test("injectivity: addresses whose raw join would collide encode to distinct names", () => {
    const collisionPairs: readonly (readonly [
      ThreadAgentAddress,
      ThreadAgentAddress,
    ])[] = [
      // A raw "/"-join maps both sides of each pair to the same string.
      [address("a/b", "c", "d"), address("a", "b/c", "d")],
      [address("a", "b", "c/d"), address("a/b", "c", "d")],
      [address("a%2Fb", "c", "d"), address("a/b", "c", "d")],
    ];

    for (const [left, right] of collisionPairs) {
      expect(encodeThreadAgentAddress(left)).not.toBe(
        encodeThreadAgentAddress(right)
      );
    }
  });

  test("decode fails closed: anything that is not a canonical encoded address is null", () => {
    // A UUID-style name, wrong segment counts, empty ids, a malformed percent
    // escape, a decodable-but-non-canonical spelling (canonical is "ws%201/…"),
    // and the empty name.
    const notAddresses = [
      "0b0724bc-8e1c-4ee3-a24a-7c9a251d64ab",
      "ws-1/ch-1",
      "ws-1/ch-1/th-1/extra",
      "//",
      "ws-1//th-1",
      "%zz/ch-1/th-1",
      "ws 1/ch-1/th-1",
      "",
    ];

    for (const name of notAddresses) {
      expect(decodeThreadAgentAddress(name)).toBeNull();
    }
  });

  test("the wire format is pinned: {ws}/{ch}/{th}, encodeURIComponent per segment (DO names are permanent)", () => {
    expect(
      encodeThreadAgentAddress(address("workspace-1", "channel-1", "thread-1"))
    ).toBe("workspace-1/channel-1/thread-1");
    expect(encodeThreadAgentAddress(address("a/b", "c%d", "e f"))).toBe(
      "a%2Fb/c%25d/e%20f"
    );
  });
});
