import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { signUpWithWorkspace } from "./auth-fixtures";
import { keyWorkspaceForAnthropic } from "./channel-fixtures";

/** The curator's fixed first-party model id (provider allowlist default, ADR 0021). */
const curatorModelId = "anthropic/claude-sonnet-5";

const sessionsUrl = (workspaceId: string) =>
  `https://test.local/api/w/${workspaceId}/curator/sessions`;

const messagesUrl = (input: {
  readonly sessionId: string;
  readonly workspaceId: string;
}) =>
  `https://test.local/api/w/${input.workspaceId}/curator/sessions/${input.sessionId}/messages`;

describe("POST /api/w/:workspaceId/curator/sessions (+ /:sessionId/messages)", () => {
  /**
   * The E8.3 happy path end to end (ADR 0021/0026): keyed workspace, real per-member DO, a
   * genuine runTurn against the outbound mock — which, seeing the curator system prompt, serves a
   * well-formed `{reply, draft}` envelope. Start a session, then send into it and get an
   * envelope-shaped CuratorTurn back.
   */
  it("starts a session and answers a send with an envelope-shaped turn", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "curator-happy@example.com",
      slug: "curator-happy-space",
    });
    await keyWorkspaceForAnthropic(workspaceId);

    const started = await SELF.fetch(sessionsUrl(workspaceId), {
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    });
    expect(started.status).toBe(200);
    const session = await started.json<{
      id: string;
      memberId: string;
      startedAt: string;
      workspaceId: string;
    }>();
    expect(session).toMatchObject({ memberId, workspaceId });
    expect(session.id.length).toBeGreaterThan(0);

    const sent = await SELF.fetch(
      messagesUrl({ sessionId: session.id, workspaceId }),
      {
        body: JSON.stringify({ message: "A channel to plan our launch." }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );
    expect(sent.status).toBe(200);
    expect(await sent.json()).toEqual({
      draft: null,
      reply: "Tell me more about the channel you want to build.",
      sessionId: session.id,
    });
  });

  /** Sending into a session the member's curator DO never minted is a plain not-found — 404. */
  it("answers a send to an unknown session with 404 curator_session_not_found", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "curator-unknown-session@example.com",
      slug: "curator-unknown-session-space",
    });
    await keyWorkspaceForAnthropic(workspaceId);

    const response = await SELF.fetch(
      messagesUrl({ sessionId: "cur-session-never-minted", workspaceId }),
      {
        body: JSON.stringify({ message: "Hello?" }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { kind: "curator_session_not_found" },
    });
  });

  /** ADR 0021/0026 fail-fast gate: an unkeyed workspace is 409 byok_key_missing before any DO call. */
  it("answers a start for an unkeyed workspace with 409 byok_key_missing", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "curator-unkeyed@example.com",
      slug: "curator-unkeyed-space",
    });

    const response = await SELF.fetch(sessionsUrl(workspaceId), {
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        kind: "byok_key_missing",
        modelId: curatorModelId,
        provider: "anthropic",
        workspaceId,
      },
    });
  });

  /**
   * Invisibility-as-nonexistence (ADR 0035 §7): a member of one workspace probing another
   * workspace's curator surface is not a member there, so the tenant middleware answers 404 —
   * the probe learns nothing about the foreign workspace.
   */
  it("answers a cross-tenant curator probe with 404", async () => {
    const { cookie } = await signUpWithWorkspace({
      email: "curator-probe-holder@example.com",
      slug: "curator-probe-holder-space",
    });
    const foreign = await signUpWithWorkspace({
      email: "curator-probe-foreign@example.com",
      slug: "curator-probe-foreign-space",
    });
    await keyWorkspaceForAnthropic(foreign.workspaceId);

    const response = await SELF.fetch(sessionsUrl(foreign.workspaceId), {
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    });

    expect(response.status).toBe(404);
  });
});
