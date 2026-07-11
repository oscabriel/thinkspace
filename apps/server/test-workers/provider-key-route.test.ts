import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { signUpWithWorkspace } from "./auth-fixtures";
import { seedChannel } from "./channel-fixtures";

/** Mirrors CF_BYOK_WRITE_FAIL_KEY in the outbound mock: this raw key makes the mock store 500. */
const CF_BYOK_WRITE_FAIL_KEY = "cf-byok-write-should-fail";

const gestureId = "01980d13-93a2-7000-8000-000000000000";
/** A model the outbound mock's models.dev fixture serves and the allowlist admits. */
const cataloguedModelId = "anthropic/claude-test-sonnet";

const keyUrl = (workspaceId: string, provider = "anthropic") =>
  `https://test.local/api/w/${workspaceId}/providers/${provider}/key`;

const providersUrl = (workspaceId: string) =>
  `https://test.local/api/w/${workspaceId}/providers`;

const dispatchUrl = (input: {
  readonly channelId: string;
  readonly threadId: string;
  readonly workspaceId: string;
}) =>
  `https://test.local/api/w/${input.workspaceId}/channels/${input.channelId}/threads/${input.threadId}/dispatch`;

/** How many registry rows a workspace holds for a provider (0 or 1) — the byok-gate ground truth. */
const providerKeyRows = async (workspaceId: string, provider = "anthropic") => {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM workspace_provider_key WHERE workspace_id = ?1 AND provider = ?2"
  )
    .bind(workspaceId, provider)
    .first<{ n: number }>();
  return row?.n ?? 0;
};

/** Demote the resolved caller to a plain member so the owner/admin gate rejects them. */
const demoteToMember = (memberId: string) =>
  env.DB.prepare("UPDATE member SET role = 'member' WHERE id = ?1")
    .bind(memberId)
    .run();

const postKey = (workspaceId: string, cookie: string, key: string) =>
  SELF.fetch(keyUrl(workspaceId), {
    body: JSON.stringify({ key }),
    headers: { "content-type": "application/json", cookie },
    method: "POST",
  });

describe("POST/DELETE /api/w/:workspaceId/providers/:provider/key", () => {
  it("registers then revokes a provider key (secret round-trips; registry row follows)", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "byok-happy@example.com",
      slug: "byok-happy-space",
    });

    const registered = await postKey(workspaceId, cookie, "sk-live-abc123");
    expect(registered.status).toBe(200);
    expect(await registered.json()).toEqual({ provider: "anthropic" });
    expect(await providerKeyRows(workspaceId)).toBe(1);

    const revoked = await SELF.fetch(keyUrl(workspaceId), {
      headers: { cookie },
      method: "DELETE",
    });
    expect(revoked.status).toBe(200);
    expect(await providerKeyRows(workspaceId)).toBe(0);
  });

  it("rejects a member with 403 and writes no registry row", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "byok-member@example.com",
      slug: "byok-member-space",
    });
    await demoteToMember(memberId);

    const response = await postKey(workspaceId, cookie, "sk-live-forbidden");

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { kind: "insufficient_role" },
    });
    expect(await providerKeyRows(workspaceId)).toBe(0);
  });

  it("answers 404 for a provider outside the allowlist", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "byok-unknown@example.com",
      slug: "byok-unknown-space",
    });

    // E11.9 widened the allowlist to the models.dev registry; use an id genuinely outside it.
    const response = await SELF.fetch(
      keyUrl(workspaceId, "definitely-not-a-real-provider"),
      {
        body: JSON.stringify({ key: "sk-live-nope" }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { kind: "unknown_resource" },
    });
    expect(
      await providerKeyRows(workspaceId, "definitely-not-a-real-provider")
    ).toBe(0);
  });

  it("rejects a Tier-C unsupported provider with a typed 422, storing nothing", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "byok-unsupported@example.com",
      slug: "byok-unsupported-space",
    });

    // amazon-bedrock is allowlisted but Tier-C (sigv4) — a real provider that can't take a key.
    const response = await SELF.fetch(keyUrl(workspaceId, "amazon-bedrock"), {
      body: JSON.stringify({ key: "sk-live-bedrock" }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { kind: string } };
    expect(body.error.kind).toBe("provider_unsupported");
    expect(await providerKeyRows(workspaceId, "amazon-bedrock")).toBe(0);
  });

  it("registers a key for a best-effort generic (custom-provider) provider", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "byok-generic@example.com",
      slug: "byok-generic-space",
    });

    // 302ai — a models.dev-derived openai-compatible provider on the generic path (Tier B). The
    // key seals into the registry regardless of Custom Provider provisioning (best-effort).
    const response = await SELF.fetch(keyUrl(workspaceId, "302ai"), {
      body: JSON.stringify({ key: "sk-live-302ai" }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ provider: "302ai" });
    expect(await providerKeyRows(workspaceId, "302ai")).toBe(1);
  });

  it("maps a Secrets Store write failure to 502 and writes no registry row", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "byok-cf-fail@example.com",
      slug: "byok-cf-fail-space",
    });

    const response = await postKey(workspaceId, cookie, CF_BYOK_WRITE_FAIL_KEY);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: { kind: "byok_registration_failed", operation: "write" },
    });
    // Secret first, then row: a failed secret write leaves the registry untouched.
    expect(await providerKeyRows(workspaceId)).toBe(0);
  });

  /**
   * End-to-end key-gating pin (ADR 0036): the same dispatch that is `byok_key_missing` for an
   * unkeyed workspace flips to a resolved, queued run once the real POST route registers the
   * provider key — the route, not a hand-seeded registry row, is what opens the byok gate.
   */
  it("flips a dispatch from byok_key_missing to a queued run after the key route registers", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "byok-gate-flip@example.com",
      slug: "byok-gate-flip-space",
    });
    await seedChannel({
      channelId: "gf-ch-1",
      memberId,
      modelId: cataloguedModelId,
      shapeId: "gf-shape-1",
      workspaceId,
    });
    await SELF.fetch(
      `https://test.local/api/w/${workspaceId}/channels/gf-ch-1/threads/gf-th-1`,
      {
        body: JSON.stringify({
          openingBody: "Gate flip",
          openingCommentId: "gf-comment-1",
        }),
        headers: { "content-type": "application/json", cookie },
        method: "PUT",
      }
    );

    const dispatch = () =>
      SELF.fetch(
        dispatchUrl({ channelId: "gf-ch-1", threadId: "gf-th-1", workspaceId }),
        {
          body: JSON.stringify({ gestureId, targetCommentId: "gf-comment-1" }),
          headers: { "content-type": "application/json", cookie },
          method: "POST",
        }
      );

    const beforeKey = await dispatch();
    expect(beforeKey.status).toBe(409);
    expect(await beforeKey.json()).toMatchObject({
      error: { kind: "byok_key_missing", provider: "anthropic" },
    });

    const registered = await postKey(workspaceId, cookie, "sk-live-gateflip");
    expect(registered.status).toBe(200);

    const afterKey = await dispatch();
    expect(afterKey.status).toBe(200);
    expect(await afterKey.json()).toMatchObject({
      queuedRun: { lifecycle: "queued", threadId: "gf-th-1" },
    });
  });
});

describe("GET /api/w/:workspaceId/providers", () => {
  it("lists the workspace's registered providers with an ISO createdAt (never key material)", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "byok-read@example.com",
      slug: "byok-read-space",
    });

    const empty = await SELF.fetch(providersUrl(workspaceId), {
      headers: { cookie },
    });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ providers: [] });

    const registered = await postKey(workspaceId, cookie, "sk-live-read-1");
    expect(registered.status).toBe(200);

    const keyed = await SELF.fetch(providersUrl(workspaceId), {
      headers: { cookie },
    });
    expect(keyed.status).toBe(200);
    const body = (await keyed.json()) as {
      providers: readonly { createdAt: string; provider: string }[];
    };
    expect(body.providers).toHaveLength(1);
    expect(body.providers[0]?.provider).toBe("anthropic");
    expect(Number.isNaN(Date.parse(body.providers[0]?.createdAt ?? ""))).toBe(
      false
    );
    // The read carries registry facts only — never the raw key.
    expect(JSON.stringify(body)).not.toContain("sk-live-read-1");
  });

  it("rejects a read without a session as 401", async () => {
    const { workspaceId } = await signUpWithWorkspace({
      email: "byok-read-noauth@example.com",
      slug: "byok-read-noauth-space",
    });

    const response = await SELF.fetch(providersUrl(workspaceId));
    expect(response.status).toBe(401);
  });
});
