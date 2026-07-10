import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, test } from "vitest";

import type { CuratorAgentDurableObject } from "../src/adapters/production/curator-agent";
import { serializeCuratorEnvelope } from "../src/adapters/production/curator-agent";
import { curatorReplySchema } from "../src/primitives";
import type { CuratorAgent } from "../src/seams/curator-agent";
import type { CuratorScriptedTurn } from "../src/testing";
import { defineCuratorAgentContract } from "../src/testing";

/**
 * The mock gateway model for the production binder (mirrors mock-model.ts): instead of streaming
 * free text, it streams the curator's structured `{reply, draft}` envelope — the wire contract
 * getSystemPrompt pins — selected by matching the turn's last user message against the scripted
 * prompt. This lets the real DO run a genuine `runTurn` and materialize the draft end to end.
 */
const streamingText = (text: string) => ({
  stream: simulateReadableStream({
    chunks: [
      { type: "stream-start" as const, warnings: [] },
      { id: "text-1", type: "text-start" as const },
      { delta: text, id: "text-1", type: "text-delta" as const },
      { id: "text-1", type: "text-end" as const },
      {
        finishReason: "stop" as const,
        type: "finish" as const,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      },
    ],
  }),
});

const fallbackReply = curatorReplySchema.parse("Tell me more about the channel.");

const curatorModelFromScript = (scriptedTurns: readonly CuratorScriptedTurn[]) =>
  new MockLanguageModelV3({
    doStream: async (options) => {
      let userText = "";
      for (let index = options.prompt.length - 1; index >= 0; index -= 1) {
        const message = options.prompt[index];
        if (message?.role === "user") {
          userText = message.content
            .map((part) => (part.type === "text" ? part.text : ""))
            .join("");
          break;
        }
      }

      const turn = scriptedTurns.find(
        (candidate) => candidate.prompt === userText
      );
      const envelope = serializeCuratorEnvelope(
        turn === undefined
          ? { draft: null, reply: fallbackReply }
          : { draft: turn.draft, reply: turn.reply }
      );
      return streamingText(envelope);
    },
  });

/**
 * Each factory call gets its own DO instance (random-uuid name) so tests never share a
 * transcript, with the real workspace/member address injected via applyTestSeed (ADR 0033:
 * the seed's explicit address is the test override, so a random DO name never has to decode).
 * The paved-path start lifecycle (setName → onStart builds Think's Session) is mirrored before
 * any `send` runs a turn, exactly like the ThreadAgent workers binder.
 */
defineCuratorAgentContract({
  api: { describe, expect, test },
  makeCuratorAgent: async (seed) => {
    const name = crypto.randomUUID();
    const stub = env.CURATOR_AGENT.get(env.CURATOR_AGENT.idFromName(name));
    const inAgent = <Value>(
      body: (instance: CuratorAgentDurableObject) => Promise<Value> | Value
    ): Promise<Value> =>
      runInDurableObject(stub, (instance) =>
        body(instance as CuratorAgentDurableObject)
      );

    await inAgent((instance) => {
      instance.applyTestSeed({
        address: {
          memberId: seed.context.memberId,
          workspaceId: seed.context.workspaceId,
        },
        testModel: curatorModelFromScript(seed.scriptedTurns ?? []),
      });
    });
    await inAgent((instance) => instance.setName(name));

    const agent: CuratorAgent = {
      context: seed.context,
      send: (input) => inAgent((instance) => instance.send(input)),
      startSession: (input) =>
        inAgent((instance) => instance.startSession(input)),
    };
    return agent;
  },
});
