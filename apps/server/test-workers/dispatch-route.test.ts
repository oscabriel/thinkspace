import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { signUpWithWorkspace } from "./auth-fixtures";
import { keyWorkspaceForAnthropic, seedChannel } from "./channel-fixtures";

const gestureId = "01980d13-93a2-7000-8000-000000000000";

/** A model the outbound mock's models.dev fixture serves and the allowlist admits. */
const cataloguedModelId = "anthropic/claude-test-sonnet";

const dispatchUrl = (input: {
  readonly channelId: string;
  readonly threadId: string;
  readonly workspaceId: string;
}) =>
  `https://test.local/api/w/${input.workspaceId}/channels/${input.channelId}/threads/${input.threadId}/dispatch`;

describe("POST /api/w/:workspaceId/channels/:channelId/threads/:threadId/dispatch", () => {
  it("rejects a dispatch without a gestureId as 400 — required on the wire from day one (ADR 0035 §7)", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "no-gesture-id@example.com",
      slug: "no-gesture-id-space",
    });

    const response = await SELF.fetch(
      dispatchUrl({ channelId: "dg-ch-1", threadId: "dg-th-1", workspaceId }),
      {
        body: JSON.stringify({ targetCommentId: "dg-comment-1" }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );

    expect(response.status).toBe(400);
  });

  it("answers a dispatch at a channel the workspace does not hold with 404", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "dispatch-no-channel@example.com",
      slug: "dispatch-no-channel-space",
    });

    const response = await SELF.fetch(
      dispatchUrl({
        channelId: "dnc-ch-never-created",
        threadId: "dnc-th-1",
        workspaceId,
      }),
      {
        body: JSON.stringify({ gestureId, targetCommentId: "dnc-comment-1" }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );

    expect(response.status).toBe(404);
  });

  /**
   * The E1 read path end to end (ADR 0036): keyed workspace, catalogued model, real
   * ToolResolver + ModelRouter, DO turn against the mock gateway. The receipt is captured
   * at queue time, so its lifecycle is deterministically "queued" even though the turn
   * itself proceeds against the outbound mock.
   */
  it("dispatches end to end for a keyed workspace and returns the queued-run receipt", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "dispatch-happy@example.com",
      slug: "dispatch-happy-space",
    });
    await keyWorkspaceForAnthropic(workspaceId);
    await seedChannel({
      channelId: "ds-ch-1",
      memberId,
      modelId: cataloguedModelId,
      shapeId: "ds-shape-1",
      workspaceId,
    });
    const created = await SELF.fetch(
      `https://test.local/api/w/${workspaceId}/channels/ds-ch-1/threads/ds-th-1`,
      {
        body: JSON.stringify({
          openingBody: "Dispatch me",
          openingCommentId: "ds-comment-1",
        }),
        headers: { "content-type": "application/json", cookie },
        method: "PUT",
      }
    );
    expect(created.status).toBe(200);

    const response = await SELF.fetch(
      dispatchUrl({ channelId: "ds-ch-1", threadId: "ds-th-1", workspaceId }),
      {
        body: JSON.stringify({ gestureId, targetCommentId: "ds-comment-1" }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      queuedRun: {
        channelId: "ds-ch-1",
        lifecycle: "queued",
        threadId: "ds-th-1",
        trigger: {
          dispatch: { byMemberId: memberId, targetCommentId: "ds-comment-1" },
          kind: "dispatch",
        },
        workspaceId,
      },
      threadId: "ds-th-1",
    });
  });

  /**
   * Dispatch dedupe (E5.3 / ADR 0035 §7): the client-minted gestureId travels into the DO
   * run trigger and its unique ts_run column, so an at-least-once replay of the identical
   * POST converges on the first run's receipt instead of starting a second run.
   */
  it("returns the same run receipt when the identical dispatch is POSTed twice (gestureId dedupe)", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "dispatch-dedupe@example.com",
      slug: "dispatch-dedupe-space",
    });
    await keyWorkspaceForAnthropic(workspaceId);
    await seedChannel({
      channelId: "dd-ch-1",
      memberId,
      modelId: cataloguedModelId,
      shapeId: "dd-shape-1",
      workspaceId,
    });
    await SELF.fetch(
      `https://test.local/api/w/${workspaceId}/channels/dd-ch-1/threads/dd-th-1`,
      {
        body: JSON.stringify({
          openingBody: "Dispatch me twice",
          openingCommentId: "dd-comment-1",
        }),
        headers: { "content-type": "application/json", cookie },
        method: "PUT",
      }
    );

    const post = () =>
      SELF.fetch(
        dispatchUrl({ channelId: "dd-ch-1", threadId: "dd-th-1", workspaceId }),
        {
          body: JSON.stringify({ gestureId, targetCommentId: "dd-comment-1" }),
          headers: { "content-type": "application/json", cookie },
          method: "POST",
        }
      );

    const first = await post();
    const replay = await post();

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    const firstReceipt = await first.json<{ queuedRun: { id: string } }>();
    const replayReceipt = await replay.json<{ queuedRun: { id: string } }>();
    // The replay converged on the first run — same run id, no second run started.
    expect(replayReceipt.queuedRun.id).toBe(firstReceipt.queuedRun.id);
  });

  /** "Create and ask" rides the same real path: creation receipt plus the chained run. */
  it("chains a create-and-ask PUT into a real dispatch and returns creation + run", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "create-and-ask@example.com",
      slug: "create-and-ask-space",
    });
    await keyWorkspaceForAnthropic(workspaceId);
    await seedChannel({
      channelId: "ca-ch-1",
      memberId,
      modelId: cataloguedModelId,
      shapeId: "ca-shape-1",
      workspaceId,
    });

    const response = await SELF.fetch(
      `https://test.local/api/w/${workspaceId}/channels/ca-ch-1/threads/ca-th-1`,
      {
        body: JSON.stringify({
          ask: { gestureId },
          openingBody: "Create and ask",
          openingCommentId: "ca-comment-1",
        }),
        headers: { "content-type": "application/json", cookie },
        method: "PUT",
      }
    );

    expect(response.status).toBe(200);
    const receipt = await response.json<{
      run: Record<string, unknown>;
      thread: Record<string, unknown>;
    }>();
    expect(receipt.thread).toMatchObject({ id: "ca-th-1" });
    expect(receipt.run).toMatchObject({
      queuedRun: {
        channelId: "ca-ch-1",
        lifecycle: "queued",
        threadId: "ca-th-1",
        trigger: {
          dispatch: { byMemberId: memberId, targetCommentId: "ca-comment-1" },
          kind: "dispatch",
        },
      },
      threadId: "ca-th-1",
    });
  });

  /** ADR 0036 / ADR 0035 §7: an unkeyed provider fails the byok gate before any catalog access. */
  it("answers a dispatch for an unkeyed workspace with 409 byok_key_missing", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "dispatch-unkeyed@example.com",
      slug: "dispatch-unkeyed-space",
    });
    await seedChannel({
      channelId: "uk-ch-1",
      memberId,
      modelId: cataloguedModelId,
      shapeId: "uk-shape-1",
      workspaceId,
    });

    const response = await SELF.fetch(
      dispatchUrl({ channelId: "uk-ch-1", threadId: "uk-th-1", workspaceId }),
      {
        body: JSON.stringify({ gestureId, targetCommentId: "uk-comment-1" }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        kind: "byok_key_missing",
        modelId: cataloguedModelId,
        provider: "anthropic",
        workspaceId,
      },
    });
  });

  /** A keyed provider whose model the live catalog does not carry is 409 model_not_in_catalog. */
  it("answers a dispatch for a keyed but uncatalogued model with 409 model_not_in_catalog", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "dispatch-uncatalogued@example.com",
      slug: "dispatch-uncatalogued-space",
    });
    await keyWorkspaceForAnthropic(workspaceId);
    await seedChannel({
      channelId: "nc-ch-1",
      memberId,
      modelId: "anthropic/not-in-catalog",
      shapeId: "nc-shape-1",
      workspaceId,
    });

    const response = await SELF.fetch(
      dispatchUrl({ channelId: "nc-ch-1", threadId: "nc-th-1", workspaceId }),
      {
        body: JSON.stringify({ gestureId, targetCommentId: "nc-comment-1" }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        kind: "model_not_in_catalog",
        modelId: "anthropic/not-in-catalog",
        workspaceId,
      },
    });
  });

  /**
   * ADR 0028 run-state read wired to a real dispatched run: after the dispatch mints the run in the
   * thread DO, GET .../runs/:runId returns the DO-resident RunDetail — the same run id and trigger,
   * carrying whatever terminal/in-flight lifecycle the turn has reached against the mock gateway.
   * This is the read the thread surface consults to settle an errored run's card server-side.
   */
  it("serves the DO-resident run state for a dispatched run via the run-state read", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "run-read-dispatched@example.com",
      slug: "run-read-dispatched-space",
    });
    await keyWorkspaceForAnthropic(workspaceId);
    await seedChannel({
      channelId: "rd-ch-1",
      memberId,
      modelId: cataloguedModelId,
      shapeId: "rd-shape-1",
      workspaceId,
    });
    await SELF.fetch(
      `https://test.local/api/w/${workspaceId}/channels/rd-ch-1/threads/rd-th-1`,
      {
        body: JSON.stringify({
          openingBody: "Read my run",
          openingCommentId: "rd-comment-1",
        }),
        headers: { "content-type": "application/json", cookie },
        method: "PUT",
      }
    );

    const dispatched = await SELF.fetch(
      dispatchUrl({ channelId: "rd-ch-1", threadId: "rd-th-1", workspaceId }),
      {
        body: JSON.stringify({ gestureId, targetCommentId: "rd-comment-1" }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }
    );
    expect(dispatched.status).toBe(200);
    const { runId } = await dispatched.json<{ runId: string }>();

    const read = await SELF.fetch(
      `https://test.local/api/w/${workspaceId}/channels/rd-ch-1/threads/rd-th-1/runs/${runId}`,
      { headers: { cookie } }
    );
    expect(read.status).toBe(200);
    const detail = await read.json<{
      run: { id: string; lifecycle: string; trigger: { kind: string } };
      subAgentActivity: unknown[];
    }>();
    expect(detail.run.id).toBe(runId);
    expect(detail.run.trigger.kind).toBe("dispatch");
    expect(["complete", "failed", "queued", "running"]).toContain(
      detail.run.lifecycle
    );
    expect(detail.subAgentActivity).toEqual([]);
  });
});
