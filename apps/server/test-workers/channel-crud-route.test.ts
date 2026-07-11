import { createProductionThreadAgentDirectory } from "@thinkspace/domain/adapters/production";
import {
  channelId as brandChannelId,
  makeComment,
  makeShapeSnapshot,
  threadId as brandThreadId,
  unwrapOk,
  workspaceId as brandWorkspaceId,
} from "@thinkspace/domain/testing";
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import {
  addWorkspaceMember,
  signUpUser,
  signUpWithWorkspace,
} from "./auth-fixtures";
import { keyWorkspaceForAnthropic } from "./channel-fixtures";

/** A model the outbound mock's models.dev fixture serves and the allowlist admits. */
const cataloguedModelId = "anthropic/claude-test-sonnet";

const shapeStructure = (input?: {
  readonly modelId?: string;
  readonly systemPrompt?: string;
}) => ({
  artifactSelection: [],
  mcpServerSelection: [],
  modelId: input?.modelId ?? cataloguedModelId,
  skillSelection: [],
  systemPrompt: input?.systemPrompt ?? "You are the channel's agent.",
  toolSelection: [],
});

const base = (workspaceId: string) =>
  `https://test.local/api/w/${workspaceId}/channels`;

const putJson = (url: string, body: unknown, cookie?: string) =>
  SELF.fetch(url, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      ...(cookie === undefined ? {} : { cookie }),
    },
    method: "PUT",
  });

const postJson = (url: string, cookie?: string) =>
  SELF.fetch(url, {
    headers: cookie === undefined ? {} : { cookie },
    method: "POST",
  });

const createChannel = (input: {
  readonly channelId: string;
  readonly cookie: string;
  readonly modelId?: string;
  readonly shapeId: string;
  readonly systemPrompt?: string;
  readonly visibility?: { readonly kind: "private" | "shared" };
  readonly workspaceId: string;
}) =>
  putJson(
    `${base(input.workspaceId)}/${input.channelId}`,
    {
      goal: `goal of ${input.channelId}`,
      shape: shapeStructure({
        modelId: input.modelId,
        systemPrompt: input.systemPrompt,
      }),
      shapeId: input.shapeId,
      ...(input.visibility === undefined
        ? {}
        : { visibility: input.visibility }),
    },
    input.cookie
  );

describe("PUT /api/w/:workspaceId/channels/:channelId — create channel + shape", () => {
  it("creates a channel born with its shape; creator is owner, shared by default (ADR 0019/0030)", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "cc-create@example.com",
      slug: "cc-create-space",
    });
    await keyWorkspaceForAnthropic(workspaceId);

    const response = await createChannel({
      channelId: "cc-ch-1",
      cookie,
      shapeId: "cc-shape-1",
      workspaceId,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      channel: {
        id: "cc-ch-1",
        lifecycle: { state: "active" },
        ownerMemberId: memberId,
        shapeId: "cc-shape-1",
        visibility: { kind: "shared" },
        workspaceId,
      },
      shape: { id: "cc-shape-1" },
    });
  });

  it("rejects creation whose shape names a model the workspace has not keyed with 409 byok_key_missing", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "cc-unkeyed@example.com",
      slug: "cc-unkeyed-space",
    });

    const response = await createChannel({
      channelId: "cc-uk-1",
      cookie,
      shapeId: "cc-uk-shape-1",
      workspaceId,
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { kind: "byok_key_missing", provider: "anthropic" },
    });
  });
});

describe("channel lifecycle — archive then delete (ADR 0018)", () => {
  it("archives an active channel, then hard-deletes the archived one", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "cc-lifecycle@example.com",
      slug: "cc-lifecycle-space",
    });
    await keyWorkspaceForAnthropic(workspaceId);
    await createChannel({
      channelId: "cc-lc-1",
      cookie,
      shapeId: "cc-lc-shape-1",
      workspaceId,
    });

    const archived = await postJson(
      `${base(workspaceId)}/cc-lc-1/archive`,
      cookie
    );
    expect(archived.status).toBe(200);
    expect(await archived.json()).toMatchObject({
      channel: { lifecycle: { state: "archived" } },
    });

    const deleted = await postJson(`${base(workspaceId)}/cc-lc-1/delete`, cookie);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      channel: { lifecycle: { state: "deleted" } },
    });
  });

  it("refuses to delete a still-active channel: archive-first, 409 channel_not_archived", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "cc-delete-active@example.com",
      slug: "cc-delete-active-space",
    });
    await keyWorkspaceForAnthropic(workspaceId);
    await createChannel({
      channelId: "cc-da-1",
      cookie,
      shapeId: "cc-da-shape-1",
      workspaceId,
    });

    const response = await postJson(`${base(workspaceId)}/cc-da-1/delete`, cookie);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { channelId: "cc-da-1", kind: "channel_not_archived" },
    });
  });
});

describe("channel + shape ACL (ADR 0019 owner + admins)", () => {
  /** Adds a plain member to the owner's workspace and returns their session cookie. */
  const seedOwnerAndMember = async (input: {
    readonly memberEmail: string;
    readonly ownerEmail: string;
    readonly slug: string;
  }) => {
    const owner = await signUpWithWorkspace({
      email: input.ownerEmail,
      slug: input.slug,
    });
    await keyWorkspaceForAnthropic(owner.workspaceId);
    const outsider = await signUpUser({ email: input.memberEmail });
    await addWorkspaceMember({
      role: "member",
      userId: outsider.userId,
      workspaceId: owner.workspaceId,
    });
    return { member: outsider, owner };
  };

  it("a plain member cannot edit another owner's shape — 403 insufficient_role", async () => {
    const { member, owner } = await seedOwnerAndMember({
      memberEmail: "cc-acl-member@example.com",
      ownerEmail: "cc-acl-owner@example.com",
      slug: "cc-acl-space",
    });
    await createChannel({
      channelId: "cc-acl-1",
      cookie: owner.cookie,
      shapeId: "cc-acl-shape-1",
      workspaceId: owner.workspaceId,
    });

    const response = await putJson(
      `${base(owner.workspaceId)}/cc-acl-1/shape`,
      { shape: shapeStructure({ systemPrompt: "Sneaky edit." }) },
      member.cookie
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: { kind: "insufficient_role" },
    });
  });

  it("a plain member cannot archive another owner's channel — 403 insufficient_role", async () => {
    const { member, owner } = await seedOwnerAndMember({
      memberEmail: "cc-arch-member@example.com",
      ownerEmail: "cc-arch-owner@example.com",
      slug: "cc-arch-space",
    });
    await createChannel({
      channelId: "cc-arch-1",
      cookie: owner.cookie,
      shapeId: "cc-arch-shape-1",
      workspaceId: owner.workspaceId,
    });

    const response = await postJson(
      `${base(owner.workspaceId)}/cc-arch-1/archive`,
      member.cookie
    );

    expect(response.status).toBe(403);
  });
});

describe("shape edit — model validation + resnapshot propagation (ADR 0007)", () => {
  it("refuses an edit to an uncatalogued model with 409 model_not_in_catalog", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "cc-edit-uncat@example.com",
      slug: "cc-edit-uncat-space",
    });
    await keyWorkspaceForAnthropic(workspaceId);
    await createChannel({
      channelId: "cc-eu-1",
      cookie,
      shapeId: "cc-eu-shape-1",
      workspaceId,
    });

    const response = await putJson(
      `${base(workspaceId)}/cc-eu-1/shape`,
      { shape: shapeStructure({ modelId: "anthropic/not-in-catalog" }) },
      cookie
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { kind: "model_not_in_catalog" },
    });
  });

  it("propagates an edited shape to the channel's live thread DO (resnapshot)", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "cc-resnap@example.com",
      slug: "cc-resnap-space",
    });
    await keyWorkspaceForAnthropic(workspaceId);
    await createChannel({
      channelId: "cc-rs-1",
      cookie,
      shapeId: "cc-rs-shape-1",
      systemPrompt: "Original prompt.",
      workspaceId,
    });

    // A thread initializes its DO with the shape snapshot at creation (ADR 0034).
    const created = await putJson(
      `${base(workspaceId)}/cc-rs-1/threads/cc-rs-th-1`,
      { openingBody: "Kick off", openingCommentId: "cc-rs-comment-1" },
      cookie
    );
    expect(created.status).toBe(200);

    // Owner edits the shape's system prompt.
    const edited = await putJson(
      `${base(workspaceId)}/cc-rs-1/shape`,
      { shape: shapeStructure({ systemPrompt: "Edited prompt." }) },
      cookie
    );
    expect(edited.status).toBe(200);

    // Read the DO's resident snapshot: initialize is first-write-wins, so it returns the
    // snapshot the resnapshot left resident rather than re-seeding it (ADR 0007/0034).
    const address = {
      channelId: brandChannelId("cc-rs-1"),
      threadId: brandThreadId("cc-rs-th-1"),
      workspaceId: brandWorkspaceId(workspaceId),
    };
    const directory = createProductionThreadAgentDirectory({
      namespace: env.THREAD_AGENT,
    });
    const resident = unwrapOk(
      await directory.get(address).initialize({
        openingComment: makeComment({
          id: "cc-rs-probe-comment",
          threadId: address.threadId,
          workspaceId: address.workspaceId,
        }),
        shapeSnapshot: makeShapeSnapshot({ shapeId: "cc-rs-shape-1" }),
      })
    );

    expect(resident.shapeSnapshot.structure.systemPrompt).toBe("Edited prompt.");
    expect(resident.shapeSnapshot.shapeId).toBe("cc-rs-shape-1");
  });
});
