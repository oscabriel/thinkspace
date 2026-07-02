import { describe, expect, test } from "bun:test";

import { createMemoryCuratorAgent } from "../src/adapters/memory";
import { curatorSessionIdSchema } from "../src/ids";
import {
  curatorPromptSchema,
  curatorReplySchema,
  goalSchema,
} from "../src/primitives";
import type { CuratorDraft } from "../src/seams/curator-agent";
import {
  makeShapeStructure,
  testMemberId,
  testTenantContext,
  testWorkspaceId,
  unwrapErr,
  unwrapOk,
} from "./fixtures";

const prompt = (value: string) => curatorPromptSchema.parse(value);
const reply = (value: string) => curatorReplySchema.parse(value);

describe("CuratorAgent — stateful per-member sessions (ADR 0021/0026)", () => {
  test("startSession opens a session for the calling member and the interview refines a goal-bearing draft turn by turn", async () => {
    const draft: CuratorDraft = {
      goal: goalSchema.parse("Ship the Q3 launch plan"),
      shape: makeShapeStructure(),
    };
    const curator = createMemoryCuratorAgent({
      context: testTenantContext,
      scriptedTurns: [
        {
          draft: null,
          prompt: prompt("I want a channel for launch planning"),
          reply: reply("What outcome should it accomplish?"),
        },
        {
          draft,
          prompt: prompt("It should produce the Q3 launch plan"),
          reply: reply("Here's a draft goal and shape."),
        },
      ],
    });

    const session = unwrapOk(await curator.startSession());
    expect(session.memberId).toBe(testMemberId);
    expect(session.workspaceId).toBe(testWorkspaceId);

    const firstTurn = unwrapOk(
      await curator.send({
        message: prompt("I want a channel for launch planning"),
        sessionId: session.id,
      })
    );
    expect(firstTurn.draft).toBeNull();

    const secondTurn = unwrapOk(
      await curator.send({
        message: prompt("It should produce the Q3 launch plan"),
        sessionId: session.id,
      })
    );
    expect(secondTurn.draft).toEqual(draft);
    expect(secondTurn.sessionId).toBe(session.id);
  });

  test("sending into an unknown session fails with curator_session_not_found", async () => {
    const curator = createMemoryCuratorAgent({ context: testTenantContext });
    const unknownSessionId = curatorSessionIdSchema.parse("session-404");

    const error = unwrapErr(
      await curator.send({
        message: prompt("hello"),
        sessionId: unknownSessionId,
      })
    );

    expect(error).toEqual({
      kind: "curator_session_not_found",
      sessionId: unknownSessionId,
      workspaceId: testWorkspaceId,
    });
  });
});
