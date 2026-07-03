import { curatorSessionIdSchema } from "../../ids";
import {
  curatorPromptSchema,
  curatorReplySchema,
  goalSchema,
} from "../../primitives";
import type { CuratorPrompt, CuratorReply } from "../../primitives";
import type { CuratorAgent, CuratorDraft } from "../../seams/curator-agent";
import type { TenantContext } from "../../seams/tenant-data-access";
import type { ContractTestApi } from "../contract-api";
import {
  makeShapeStructure,
  testMemberId,
  testTenantContext,
  testWorkspaceId,
  unwrapErr,
  unwrapOk,
} from "../fixtures";

/**
 * One deterministic interview turn the adapter under test must reproduce: the memory
 * adapter scripts it directly; a production harness stubs the model layer with it.
 */
export interface CuratorScriptedTurn {
  readonly draft: CuratorDraft | null;
  readonly prompt: CuratorPrompt;
  readonly reply: CuratorReply;
}

export interface CuratorAgentSeed {
  readonly context: TenantContext;
  readonly scriptedTurns?: readonly CuratorScriptedTurn[];
}

export type CuratorAgentFactory = (
  seed: CuratorAgentSeed
) => Promise<CuratorAgent> | CuratorAgent;

const prompt = (value: string) => curatorPromptSchema.parse(value);
const reply = (value: string) => curatorReplySchema.parse(value);

/** Pins the CuratorAgent seam semantics on whichever adapter the factory builds. */
export const defineCuratorAgentContract = (input: {
  readonly api: ContractTestApi;
  readonly makeCuratorAgent: CuratorAgentFactory;
}): void => {
  const { describe, expect, test } = input.api;
  const { makeCuratorAgent } = input;

  describe("CuratorAgent — stateful per-member sessions (ADR 0021/0026)", () => {
    test("startSession opens a session for the calling member and the interview refines a goal-bearing draft turn by turn", async () => {
      const draft: CuratorDraft = {
        goal: goalSchema.parse("Ship the Q3 launch plan"),
        shape: makeShapeStructure(),
      };
      const curator = await makeCuratorAgent({
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
      const curator = await makeCuratorAgent({ context: testTenantContext });
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
};
