import { generateText } from "ai";
import { env } from "cloudflare:test";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createGatewayModel } from "../src/adapters/production/model-gateway";
import { byokSecretAlias } from "../src/byok";
import { formatModelId } from "../src/ids";
import { modelProviderSchema } from "../src/model";
import { workspaceId } from "../src/testing";

/**
 * ADR 0038 §1 recipe assertion. The openai factory is built on @ai-sdk/openai (ai-v6 dist-tag);
 * unlike the anthropic recipe it needs NO trailing `/v1` — the SDK's default (Responses API)
 * model posts to `${baseURL}/responses` off a baseURL that the AI Gateway `/openai` segment
 * already terminates. We stub the isolate's global fetch (the SDK resolves `globalThis.fetch`
 * lazily via getOriginalFetch, so vi.stubGlobal is picked up) to observe the one outbound request
 * a `generateText` call constructs, then assert the gateway path segment and the three cf-aig-*
 * BYOK headers. The opaque outboundService mock can serve egress but can't echo request headers
 * back to the test, so a capturing fetch stub is the faithful way to pin the recipe.
 */
describe("openai AI Gateway recipe (ADR 0038 §1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("constructs a call to the /openai gateway segment with the cf-aig-* BYOK headers", async () => {
    const ws = workspaceId("recipe-ws-1");
    const model = createGatewayModel(formatModelId("openai", "gpt-5.5"), {
      env,
      workspaceId: ws,
    });

    let captured: Request | undefined;
    vi.stubGlobal(
      "fetch",
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        captured = new Request(input, init);
        // Fail the call fast — we only care about the request the SDK constructed.
        return Promise.resolve(new Response("stop", { status: 400 }));
      }
    );

    await generateText({ maxRetries: 0, model, prompt: "ping" }).catch(
      () => {}
    );

    expect(captured).toBeDefined();
    if (captured === undefined) {
      return;
    }

    const url = new URL(captured.url);
    // The `/openai` gateway segment, and NO stray `/openai/v1` (the anthropic-only quirk).
    expect(url.pathname).toBe("/v1/test-account/test-gateway/openai/responses");
    expect(url.pathname).not.toContain("/openai/v1");

    // Verified live 2026-07-10: the gateway forwards a present provider-auth header VERBATIM
    // (BYOK substitution suppressed → the provider sees the dummy), so the factory blanks the
    // SDK's bearer. Empty or absent both read as "no stray credential" here.
    expect(captured.headers.get("authorization") ?? "").not.toContain(
      "gateway-managed"
    );

    const openai = modelProviderSchema.parse("openai");
    expect(captured.headers.get("cf-aig-authorization")).toBe(
      `Bearer ${env.AI_GATEWAY_TOKEN}`
    );
    expect(captured.headers.get("cf-aig-byok-alias")).toBe(
      byokSecretAlias(ws, openai)
    );
    expect(captured.headers.get("cf-aig-metadata")).toBe(
      JSON.stringify({ workspace: ws })
    );
  });
});
