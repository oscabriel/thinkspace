import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { signUpWithWorkspace } from "./auth-fixtures";

/**
 * GET /api/w/:workspaceId/models — the model picker's data source (E7.5). The route lists the
 * live catalog ∩ the workspace's keyed providers (ADR 0011 / 0036), exactly what the
 * ModelRouter's `listAvailableModels` computes. The shared outbound mock serves the models.dev
 * fixture: two allowlisted anthropic models (haiku + sonnet; a third malformed entry is skipped)
 * and an openai model — allowlisted since ADR 0038 §1 — that the BYOK key gate drops for these
 * anthropic-only-keyed workspaces.
 */

const modelsUrl = (workspaceId: string) =>
  `https://test.local/api/w/${workspaceId}/models`;

const keyUrl = (workspaceId: string, provider = "anthropic") =>
  `https://test.local/api/w/${workspaceId}/providers/${provider}/key`;

const postKey = (workspaceId: string, cookie: string, key: string) =>
  SELF.fetch(keyUrl(workspaceId), {
    body: JSON.stringify({ key }),
    headers: { "content-type": "application/json", cookie },
    method: "POST",
  });

describe("GET /api/w/:workspaceId/models", () => {
  it("lists the catalog ∩ keyed providers once a provider key is registered", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "models-keyed@example.com",
      slug: "models-keyed-space",
    });

    const registered = await postKey(workspaceId, cookie, "sk-live-models");
    expect(registered.status).toBe(200);

    const response = await SELF.fetch(modelsUrl(workspaceId), {
      headers: { cookie },
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      models: readonly {
        capabilities: Record<string, boolean>;
        cost: Record<string, number>;
        displayName: string;
        id: string;
        limits: { context: number; output: number };
        provider: string;
        releaseDate: string;
      }[];
    };

    // Both allowlisted anthropic models; the malformed fixture entry is skipped, openai is dropped.
    const ids = body.models.map((model) => model.id).sort();
    expect(ids).toEqual([
      "anthropic/claude-test-haiku",
      "anthropic/claude-test-sonnet",
    ]);

    const sonnet = body.models.find(
      (model) => model.id === "anthropic/claude-test-sonnet"
    );
    expect(sonnet).toMatchObject({
      capabilities: {
        attachment: true,
        reasoning: true,
        structuredOutput: true,
        toolCall: true,
      },
      cost: { cacheRead: 0.1, cacheWrite: 1, input: 1, output: 5 },
      displayName: "Claude Test Sonnet",
      limits: { context: 200_000, output: 8192 },
      provider: "anthropic",
      releaseDate: "2026-01-01",
    });
  });

  it("returns an empty list when no provider key is registered", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "models-unkeyed@example.com",
      slug: "models-unkeyed-space",
    });

    const response = await SELF.fetch(modelsUrl(workspaceId), {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: [] });
  });

  it("rejects a read without a session as 401", async () => {
    const { workspaceId } = await signUpWithWorkspace({
      email: "models-no-session@example.com",
      slug: "models-no-session-space",
    });

    const response = await SELF.fetch(modelsUrl(workspaceId));
    expect(response.status).toBe(401);
  });
});
