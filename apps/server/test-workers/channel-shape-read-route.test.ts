import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { signUpWithWorkspace } from "./auth-fixtures";
import { seedChannel } from "./channel-fixtures";

/**
 * GET /api/w/:workspaceId/channels/:channelId/shape — the shape-edit form's prefill source
 * (E7.5). Returns the channel's live shape structure so an owner re-authors from real values;
 * the read fails closed on the same visibility guard as the channel read.
 */

const shapeUrl = (workspaceId: string, channelId: string) =>
  `https://test.local/api/w/${workspaceId}/channels/${channelId}/shape`;

describe("GET /api/w/:workspaceId/channels/:channelId/shape", () => {
  it("returns the channel's live shape structure", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "shape-read@example.com",
      slug: "shape-read-space",
    });
    await seedChannel({
      channelId: "sr-ch-1",
      memberId,
      modelId: "anthropic/claude-test-sonnet",
      shapeId: "sr-shape-1",
      systemPrompt: "Keep the ADRs consistent.",
      workspaceId,
    });

    const response = await SELF.fetch(shapeUrl(workspaceId, "sr-ch-1"), {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      structure: {
        artifactSelection: readonly string[];
        mcpServerSelection: readonly string[];
        modelId: string;
        skillSelection: readonly string[];
        systemPrompt: string;
        toolSelection: readonly string[];
      };
    };
    expect(body.id).toBe("sr-shape-1");
    expect(body.structure).toMatchObject({
      modelId: "anthropic/claude-test-sonnet",
      systemPrompt: "Keep the ADRs consistent.",
    });
  });

  it("collapses an invisible private channel's shape to 404", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "shape-read-private@example.com",
      slug: "shape-read-private-space",
    });
    await seedChannel({
      channelId: "sr-priv-1",
      memberId,
      modelId: "anthropic/claude-test-sonnet",
      ownerMemberId: "someone-else",
      shapeId: "sr-priv-shape-1",
      visibility: { kind: "private" },
      workspaceId,
    });

    const response = await SELF.fetch(shapeUrl(workspaceId, "sr-priv-1"), {
      headers: { cookie },
    });
    expect(response.status).toBe(404);
  });

  it("rejects a read without a session as 401", async () => {
    const { memberId, workspaceId } = await signUpWithWorkspace({
      email: "shape-read-no-session@example.com",
      slug: "shape-read-no-session-space",
    });
    await seedChannel({
      channelId: "sr-ns-1",
      memberId,
      modelId: "anthropic/claude-test-sonnet",
      shapeId: "sr-ns-shape-1",
      workspaceId,
    });

    const response = await SELF.fetch(shapeUrl(workspaceId, "sr-ns-1"));
    expect(response.status).toBe(401);
  });
});
