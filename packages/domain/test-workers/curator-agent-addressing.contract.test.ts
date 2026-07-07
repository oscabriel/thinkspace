import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, test } from "vitest";

import { encodeCuratorAddress } from "../src/adapters/curator-address";
import type { CuratorAgentDurableObject } from "../src/adapters/production/curator-agent";
import { curatorSessionIdSchema } from "../src/ids";
import { curatorPromptSchema } from "../src/primitives";
import { memberId, unwrapErr, unwrapOk, workspaceId } from "../src/testing";

/**
 * ADR 0033 addressing applied to the curator (ADR 0026 DO-per-member): the DO name IS the
 * workspace/member address. These are production-substrate facts the memory adapter cannot
 * express (it cannot construct an unaddressable agent), so they live in the workers binder.
 */
const address = {
  memberId: memberId("member-addr"),
  workspaceId: workspaceId("ws-addr"),
};

describe("Curator DO addressing — name-derived identity (ADR 0026/0033)", () => {
  test("a DO addressed by an encoded address derives its own address with no seed", async () => {
    const stub = env.CURATOR_AGENT.get(
      env.CURATOR_AGENT.idFromName(encodeCuratorAddress(address))
    );

    const session = unwrapOk(
      await runInDurableObject(stub, (instance) =>
        (instance as CuratorAgentDurableObject).startSession()
      )
    );

    expect(session.memberId).toBe(address.memberId);
    expect(session.workspaceId).toBe(address.workspaceId);
  });

  test("a garbage-named DO fails closed with curator_unaddressable and executes nothing", async () => {
    const doName = "not-a-curator-address";
    const stub = env.CURATOR_AGENT.get(env.CURATOR_AGENT.idFromName(doName));

    const startError = unwrapErr(
      await runInDurableObject(stub, (instance) =>
        (instance as CuratorAgentDurableObject).startSession()
      )
    );
    expect(startError).toEqual({ doName, kind: "curator_unaddressable" });

    const sendError = unwrapErr(
      await runInDurableObject(stub, (instance) =>
        (instance as CuratorAgentDurableObject).send({
          message: curatorPromptSchema.parse("hello"),
          sessionId: curatorSessionIdSchema.parse("session-x"),
        })
      )
    );
    expect(sendError).toEqual({ doName, kind: "curator_unaddressable" });
  });
});
