import { env } from "cloudflare:test";
import { describe, expect, test } from "vitest";

import { createProductionThreadAgentDirectory } from "../src/adapters/production/thread-agent";
import { scheduleSchema } from "../src/run";
import type { ThreadAgentAddress } from "../src/seams/thread-agent";
import {
  channelId,
  makeComment,
  makeDispatchTrigger,
  makeShapeSnapshot,
  threadId,
  unwrapErr,
  unwrapOk,
  workspaceId,
} from "../src/testing";

const directory = createProductionThreadAgentDirectory({
  namespace: env.THREAD_AGENT,
});

/** Distinct per test: DO storage persists across tests in this pool (no isolatedStorage). */
const address = (suffix: string): ThreadAgentAddress => ({
  channelId: channelId(`dir-ch-${suffix}`),
  threadId: threadId(`dir-th-${suffix}`),
  workspaceId: workspaceId(`dir-ws-${suffix}`),
});

describe("Production ThreadAgentDirectory — get(address) routes to the named DO (ADR 0033)", () => {
  test("an agent exists at every address: a fresh address fails closed as uninitialized, naming its own address", async () => {
    const fresh = address("fresh");

    const error = unwrapErr(
      await directory
        .get(fresh)
        .run(makeDispatchTrigger({ targetCommentId: "comment-top" }))
    );

    expect(error).toEqual({
      channelId: fresh.channelId,
      kind: "thread_agent_uninitialized",
      threadId: fresh.threadId,
      workspaceId: fresh.workspaceId,
    });
  });

  test("separate gets of the same address reach the same agent", async () => {
    const same = address("same");
    const opening = makeComment({
      id: "dir-comment-opening",
      threadId: same.threadId,
      workspaceId: same.workspaceId,
    });

    unwrapOk(
      await directory.get(same).initialize({
        openingComment: opening,
        shapeSnapshot: makeShapeSnapshot(),
      })
    );
    const receipt = unwrapOk(
      await directory
        .get(same)
        .run(makeDispatchTrigger({ targetCommentId: "dir-comment-opening" }))
    );

    const detail = unwrapOk(
      await directory.get(same).getRun({ runId: receipt.runId })
    );
    expect(detail?.run).toEqual(receipt.queuedRun);
  });

  test("seam schedule maps to the DO's scheduleRun (SDK reserves `schedule`)", async () => {
    const scheduled = address("sched");
    const schedule = scheduleSchema.parse({
      active: true,
      channelId: scheduled.channelId,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      createdByMemberId: "member-1",
      id: "dir-schedule-1",
      prompt: "Summarize the thread.",
      recurrence: "0 9 * * 1",
      threadId: scheduled.threadId,
      workspaceId: scheduled.workspaceId,
    });

    const stored = unwrapOk(
      await directory.get(scheduled).schedule({ schedule })
    );

    expect(stored).toEqual(schedule);
  });
});
