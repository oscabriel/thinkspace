import { createR2VirtualFsArtifactStore } from "@thinkspace/domain/adapters/production";
import {
  channelIdSchema,
  memberIdSchema,
  workspaceIdSchema,
} from "@thinkspace/domain/ids";
import {
  artifactNameSchema,
  contentTypeSchema,
} from "@thinkspace/domain/primitives";
import type { TenantContext } from "@thinkspace/domain/seams/tenant-data-access";
import { roleSchema } from "@thinkspace/domain/workspace";
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { signUpWithWorkspace } from "./auth-fixtures";

const encoder = new TextEncoder();

const contextFor = (input: {
  readonly memberId: string;
  readonly workspaceId: string;
}): TenantContext => ({
  memberId: memberIdSchema.parse(input.memberId),
  role: roleSchema.parse("owner"),
  workspaceId: workspaceIdSchema.parse(input.workspaceId),
});

/** Seeds an artifact with two versions straight through the production store (runs, not the browser, write). */
const seedArtifact = async (
  context: TenantContext,
  homeChannelId = "channel-1"
) => {
  const store = createR2VirtualFsArtifactStore({
    bucket: env.ARTIFACTS,
    context,
    db: env.DB,
  });
  const version = () => ({
    contentType: contentTypeSchema.parse("text/markdown"),
    mediaKind: { kind: "text_extractable" as const },
    origin: {
      kind: "member_upload" as const,
      threadId: null,
      uploadedByMemberId: context.memberId,
    },
  });
  const created = await store.create({
    bytes: {
      contentType: contentTypeSchema.parse("text/markdown"),
      data: encoder.encode("# v1"),
    },
    draft: {
      homeChannelId: channelIdSchema.parse(homeChannelId),
      name: artifactNameSchema.parse("Launch Plan"),
    },
    version: version(),
  });
  if (!created.ok) {
    throw new Error(`seed create failed: ${JSON.stringify(created.error)}`);
  }
  const appended = await store.append({
    artifactId: created.value.id,
    bytes: {
      contentType: contentTypeSchema.parse("text/markdown"),
      data: encoder.encode("# v2 body"),
    },
    version: version(),
  });
  if (!appended.ok || appended.value === null) {
    throw new Error("seed append failed");
  }
  return {
    artifactId: created.value.id,
    headVersionId: appended.value.headVersionId,
  };
};

const base = (workspaceId: string) =>
  `https://test.local/api/w/${workspaceId}/artifacts`;

describe("GET /api/w/:workspaceId/artifacts", () => {
  it("scopes channel artifact lists by home channel and returns an empty list", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "channel-artifacts@example.com",
      slug: "channel-artifacts-space",
    });
    const context = contextFor({ memberId, workspaceId });
    const first = await seedArtifact(context, "channel-1");
    await seedArtifact(context, "channel-2");

    const matching = await SELF.fetch(
      `https://test.local/api/w/${workspaceId}/channels/channel-1/artifacts`,
      { headers: { cookie } }
    );
    expect(matching.status).toBe(200);
    expect(await matching.json()).toEqual({
      artifacts: [expect.objectContaining({ id: first.artifactId })],
    });

    const empty = await SELF.fetch(
      `https://test.local/api/w/${workspaceId}/channels/channel-3/artifacts`,
      { headers: { cookie } }
    );
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ artifacts: [] });
  });

  it("lists head metadata, artifact detail + versions, and version content for a member", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "artifacts-happy@example.com",
      slug: "artifacts-happy-space",
    });
    const { artifactId, headVersionId } = await seedArtifact(
      contextFor({ memberId, workspaceId })
    );

    const listed = await SELF.fetch(base(workspaceId), { headers: { cookie } });
    expect(listed.status).toBe(200);
    const listBody = await listed.json<{ artifacts: { id: string }[] }>();
    expect(listBody.artifacts.length).toBe(1);
    expect(listBody.artifacts[0]?.id).toBe(artifactId);

    const detail = await SELF.fetch(`${base(workspaceId)}/${artifactId}`, {
      headers: { cookie },
    });
    expect(detail.status).toBe(200);
    const detailBody = await detail.json<{
      artifact: { headVersionId: string };
      versions: unknown[];
    }>();
    expect(detailBody.versions.length).toBe(2);
    expect(detailBody.artifact.headVersionId).toBe(headVersionId);

    const content = await SELF.fetch(
      `${base(workspaceId)}/${artifactId}/versions/${headVersionId}/content`,
      { headers: { cookie } }
    );
    expect(content.status).toBe(200);
    expect(await content.text()).toBe("# v2 body");
  });

  it("rejects an unauthenticated artifact list as 401", async () => {
    const { workspaceId } = await signUpWithWorkspace({
      email: "artifacts-anon@example.com",
      slug: "artifacts-anon-space",
    });

    const response = await SELF.fetch(base(workspaceId));

    expect(response.status).toBe(401);
  });

  it("hides a foreign workspace's artifact behind a 404 (tenant guard)", async () => {
    const owner = await signUpWithWorkspace({
      email: "artifacts-owner@example.com",
      slug: "artifacts-owner-space",
    });
    const { artifactId } = await seedArtifact(
      contextFor({ memberId: owner.memberId, workspaceId: owner.workspaceId })
    );

    const intruder = await signUpWithWorkspace({
      email: "artifacts-intruder@example.com",
      slug: "artifacts-intruder-space",
    });

    const probe = await SELF.fetch(
      `${base(intruder.workspaceId)}/${artifactId}`,
      { headers: { cookie: intruder.cookie } }
    );
    expect(probe.status).toBe(404);
  });
});
