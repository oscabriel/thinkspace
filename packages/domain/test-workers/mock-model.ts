import { MockLanguageModelV3, simulateReadableStream } from "ai/test";

/** A model whose one turn streams the given text and stops. */
export const modelReplying = (text: string) =>
  new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { id: "text-1", type: "text-start" },
          { delta: text, id: "text-1", type: "text-delta" },
          { id: "text-1", type: "text-end" },
          {
            finishReason: "stop",
            type: "finish",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          },
        ],
      }),
    }),
  });

/**
 * A model whose stream opens cleanly (headers OK, `doStream` resolves) and then errors
 * mid-flight — the ADR 0038 live shape: the gateway logs 200, the provider then fails in-stream
 * (0/0 tokens). No `finish` part is ever emitted; the turn must settle FAILED, never complete.
 */
export const modelErroringMidStream = (reason: string) =>
  new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          { id: "text-1", type: "text-start" },
          { delta: "partial…", id: "text-1", type: "text-delta" },
          { error: reason, type: "error" },
        ],
      }),
    }),
  });
