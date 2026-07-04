import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, test } from "vitest";

import type { ThreadAgentDurableObject } from "../src/adapters/production/thread-agent";
import { encodeThreadAgentAddress } from "../src/adapters/thread-agent-address";
import {
  makeDispatchTrigger,
  threadAgentAddress,
  unwrapErr,
} from "../src/testing";

/**
 * ADR 0033: the DO name IS the address. These are production-substrate facts the
 * memory adapter cannot express (it cannot construct an unaddressable agent), so
 * they live in the workers binder, not the shared contract.
 */
const callRun = (name: string) => {
  const stub = env.THREAD_AGENT.get(env.THREAD_AGENT.idFromName(name));
  return runInDurableObject(stub, (instance) =>
    (instance as ThreadAgentDurableObject).run(
      makeDispatchTrigger({ targetCommentId: "comment-top" })
    )
  );
};

describe("ThreadAgent DO addressing — name-derived identity (ADR 0033)", () => {
  test("a DO addressed by an encoded address derives its own address with no seed", async () => {
    const error = unwrapErr(
      await callRun(encodeThreadAgentAddress(threadAgentAddress))
    );

    expect(error).toEqual({
      channelId: threadAgentAddress.channelId,
      kind: "thread_agent_uninitialized",
      threadId: threadAgentAddress.threadId,
      workspaceId: threadAgentAddress.workspaceId,
    });
  });

  test("a garbage-named DO fails closed with thread_agent_unaddressable and executes nothing", async () => {
    const error = unwrapErr(await callRun("not-an-address"));

    expect(error).toEqual({
      doName: "not-an-address",
      kind: "thread_agent_unaddressable",
    });
  });
});
