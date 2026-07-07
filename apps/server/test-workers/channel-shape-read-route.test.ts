import { createD1TenantDataAccess } from "@thinkspace/domain/adapters/production";
import {
  makeChannel,
  makeShape,
  makeShapeStructure,
  memberId as brandMemberId,
  unwrapOk,
  workspaceId as brandWorkspaceId,
} from "@thinkspace/domain/testing";
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { signUpWithWorkspace } from "./auth-fixtures";

/**
 * GET /api/w/:workspaceId/channels/:channelId/shape — the shape-edit form's prefill source
 * (E7.5). Returns the channel's live shape structure so an owner re-authors from real values;
 * the read fails closed on the same visibility guard as the channel read.
 */

const shapeUrl = (workspaceId: string, channelId: string) =>
  `https://test.local/api/w/${workspaceId}/channels/${channelId}/shape`;

const seedChannel = async (input: {
  readonly channelId: string;
  readonly memberId: string;
  readonly modelId?: string;
  readonly ownerMemberId?: string;
  readonly shapeId: string;
  readonly systemPrompt?: string;
  readonly visibility?: { readonly kind: "private" } | { readonly kind: "shared" };
  readonly workspaceId: string;
}) => {
  const workspaceId = brandWorkspaceId(input.workspaceId);
  const tenantDataAccess = createD1TenantDataAccess({
    context: {
      memberId: brandMemberId(input.memberId),
      role: "owner",
      workspaceId,
    },
    db: env.DB,
  });

  const shape = {
    ...makeShape({ id: input.shapeId }),
    structure: makeShapeStructure({
      modelId: input.modelId ?? "anthropic/claude-test-sonnet",
      systemPrompt: input.systemPrompt ?? "You are the channel's agent.",
    }),
    workspaceId,
  };
  const channel = {
    ...makeChannel({
      id: input.channelId,
      ownerMemberId: brandMemberId(input.ownerMemberId ?? input.memberId),
      shapeId: input.shapeId,
      visibility: input.visibility ?? { kind: "shared" },
    }),
    workspaceId,
  };

  unwrapOk(
    await tenantDataAccess.batch({
      commands: [
        { kind: "put_shape", shape },
        { channel, kind: "put_channel" },
      ],
      workspaceId,
    })
  );
};

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
      shapeId: "sr-ns-shape-1",
      workspaceId,
    });

    const response = await SELF.fetch(shapeUrl(workspaceId, "sr-ns-1"));
    expect(response.status).toBe(401);
  });
});
