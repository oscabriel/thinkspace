import { generateText } from "ai";
import { env } from "cloudflare:test";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createGatewayModel } from "../src/adapters/production/model-gateway";
import { formatModelId } from "../src/ids";
import { findAllowEntry } from "../src/provider-allowlist";
import { workspaceId } from "../src/testing";

/**
 * E11.9 / ADR 0040 (second half): the single generic openai-compatible factory. Two DISTINCT
 * OpenAI-compatible providers are constructed via ONE code path (`createGenericGatewayModel`) and we
 * observe the outbound request the SDK builds: the AI Gateway Custom Provider route segment, the
 * chat-completions surface (`.chat()`, not `.responses()`), the three cf-aig-* headers, and — the
 * E11.8 mechanism this rides — the decrypted provider key on the VERBATIM auth header (never a
 * blanked credential when a header-kind auth is injected). We stub the isolate global fetch (the SDK
 * resolves `globalThis.fetch` lazily) to capture the one request a `generateText` call constructs.
 */
describe("generic openai-compatible gateway factory (E11.9)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const ws = workspaceId("generic-ws-1");

  const captureRequest = async (modelsDevId: string, slug: string) => {
    const entry = findAllowEntry(modelsDevId);
    expect(entry).toBeDefined();
    if (entry === undefined) {
      throw new Error("entry undefined");
    }
    const model = createGatewayModel(formatModelId(modelsDevId, slug), {
      env,
      providerAuth: { kind: "header", value: `raw-${modelsDevId}-key` },
      workspaceId: ws,
    });

    let captured: Request | undefined;
    vi.stubGlobal(
      "fetch",
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        captured = new Request(input, init);
        return Promise.resolve(new Response("stop", { status: 400 }));
      }
    );
    await generateText({ maxRetries: 0, model, prompt: "ping" }).catch(
      () => {}
    );
    vi.unstubAllGlobals();
    expect(captured).toBeDefined();
    if (captured === undefined) {
      throw new Error("no request captured");
    }
    return { captured, entry };
  };

  test("provider A: routes through /custom-<slug> and injects the verbatim bearer key", async () => {
    // 302ai — a plain @ai-sdk/openai-compatible provider, custom-provider routing, bearer auth.
    const { captured, entry } = await captureRequest("302ai", "some-model");
    expect(entry.routing).toBe("custom-provider");

    const url = new URL(captured.url);
    // The Custom Provider route segment + the chat-completions surface (NOT /responses).
    expect(url.pathname).toContain(`/custom-${entry.gatewaySlug}`);
    expect(url.pathname).toContain("/chat/completions");
    expect(url.pathname).not.toContain("/responses");

    // The three cf-aig-* headers, plus the decrypted key forwarded VERBATIM (E11.8 mechanism).
    expect(captured.headers.get("cf-aig-authorization")).toBe(
      `Bearer ${env.AI_GATEWAY_TOKEN}`
    );
    expect(captured.headers.get("cf-aig-metadata")).toBe(
      JSON.stringify({ workspace: ws })
    );
    expect(captured.headers.get("authorization")).toBe("Bearer raw-302ai-key");
    // A header-kind auth never blanks the credential and never carries an alias.
    expect(captured.headers.get("cf-aig-byok-alias")).toBeNull();
  });

  test("provider B: a second distinct provider rides the SAME code path (native slug)", async () => {
    // groq — a documented native-slug provider: bare `/groq` segment, still the generic
    // chat-completions surface and the same verbatim-header injection as the compat path.
    const { captured, entry } = await captureRequest("groq", "some-model");
    expect(entry.routing).toBe("native");

    const url = new URL(captured.url);
    expect(url.pathname).toContain(`/${entry.gatewaySlug}`);
    expect(url.pathname).not.toContain("/compat/");
    expect(url.pathname).toContain("/chat/completions");
    expect(captured.headers.get("authorization")).toBe("Bearer raw-groq-key");
  });
});
