import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, test, vi } from "vitest";

import type { ThreadAgentDurableObject } from "../src/adapters/production/thread-agent";
import { encodeThreadAgentAddress } from "../src/adapters/thread-agent-address";
import { createNotImplementedError } from "../src/errors";
import type { RunSettlement } from "../src/flows/run-completion";
import { err, ok } from "../src/result";
import type { ThreadAgentAddress } from "../src/seams/thread-agent";
import {
  channelId,
  makeComment,
  makeDispatchTrigger,
  makeShapeSnapshot,
  runId,
  threadId,
  unwrapOk,
  workspaceId,
} from "../src/testing";
import { modelReplying } from "./mock-model";

const address = (suffix: string): ThreadAgentAddress => ({
  channelId: channelId(`wake-ch-${suffix}`),
  threadId: threadId(`wake-th-${suffix}`),
  workspaceId: workspaceId(`wake-ws-${suffix}`),
});

const agentAt = (addr: ThreadAgentAddress) =>
  env.THREAD_AGENT.get(
    env.THREAD_AGENT.idFromName(encodeThreadAgentAddress(addr))
  );

type Instance = ThreadAgentDurableObject;

/** Mirror the paved-path start lifecycle (getAgentByName → setName → onStart). */
const startAgent = (
  stub: ReturnType<typeof agentAt>,
  addr: ThreadAgentAddress
) =>
  runInDurableObject(stub, (instance: Instance) =>
    instance.setName(encodeThreadAgentAddress(addr))
  );

/** A hibernation wake re-runs onStart, and with it the reconciliation sweep. */
const wake = (stub: ReturnType<typeof agentAt>) =>
  runInDurableObject(stub, (instance: Instance) => instance.onStart());

const waitForTerminalRun = (
  stub: ReturnType<typeof agentAt>,
  id: ReturnType<typeof runId>
) =>
  vi.waitFor(
    async () => {
      const detail = unwrapOk(
        await runInDurableObject(stub, (instance: Instance) =>
          instance.getRun({ runId: id })
        )
      );
      if (
        detail === null ||
        (detail.run.lifecycle !== "complete" &&
          detail.run.lifecycle !== "failed")
      ) {
        throw new Error("run has not reached a terminal lifecycle yet");
      }
      return detail.run;
    },
    { interval: 50, timeout: 5000 }
  );

/**
 * E2.1 (ADR 0017/0035): on wake the DO scans ts_run for terminal-but-unsettled runs and
 * replays settlement through the (self-constructed) completion flow. The fail-soft
 * console.error path in settle() defines exactly what is recovered; the mark-settled
 * bookkeeping makes an already-settled run a no-op so the fan-out is idempotent.
 */
describe("wake-path reconciliation sweep (E2.1)", () => {
  test("a run whose settlement was lost is replayed on the next wake", async () => {
    const addr = address("replay");
    const stub = agentAt(addr);
    const target = makeComment({
      id: "wake-comment-replay",
      threadId: addr.threadId,
      workspaceId: addr.workspaceId,
    });
    const settlements: RunSettlement[] = [];
    // The completion flow fails exactly once — the lost fan-out the sweep recovers.
    let failNext = true;

    await runInDurableObject(stub, (instance: Instance) => {
      instance.applyTestSeed({
        address: addr,
        comments: [target],
        nextRunId: () => runId("wake-run-replay"),
        shapeSnapshot: makeShapeSnapshot(),
        testModel: modelReplying("Recovered on wake."),
      });
      instance.completionFlow = {
        settle: async (settlement) => {
          settlements.push(settlement);
          if (failNext) {
            failNext = false;
            return err(createNotImplementedError("test.lostSettlement"));
          }
          return ok();
        },
      };
    });
    await startAgent(stub, addr);

    const receipt = unwrapOk(
      await runInDurableObject(stub, (instance: Instance) =>
        instance.run(makeDispatchTrigger({ targetCommentId: target.id }))
      )
    );

    // The run reaches a terminal lifecycle even though its settlement was dropped.
    const settled = await waitForTerminalRun(stub, receipt.runId);
    expect(settled.lifecycle).toBe("complete");
    expect(settlements).toHaveLength(1);

    // Next wake finds the terminal-but-unsettled run and replays settlement.
    await wake(stub);

    expect(settlements).toHaveLength(2);
    const [, replayed] = settlements;
    expect(replayed?.kind).toBe("complete");
    expect(replayed?.run.id).toBe(receipt.runId);

    // A subsequent wake does not settle again — the row is now marked settled.
    await wake(stub);
    expect(settlements).toHaveLength(2);
  });

  test("an already-settled run is not double-settled on wake (idempotent fan-out)", async () => {
    const addr = address("idempotent");
    const stub = agentAt(addr);
    const target = makeComment({
      id: "wake-comment-idempotent",
      threadId: addr.threadId,
      workspaceId: addr.workspaceId,
    });
    const settlements: RunSettlement[] = [];

    await runInDurableObject(stub, (instance: Instance) => {
      instance.applyTestSeed({
        address: addr,
        comments: [target],
        nextRunId: () => runId("wake-run-idempotent"),
        shapeSnapshot: makeShapeSnapshot(),
        testModel: modelReplying("Settled first time."),
      });
      instance.completionFlow = {
        settle: async (settlement) => {
          settlements.push(settlement);
          return ok();
        },
      };
    });
    await startAgent(stub, addr);

    const receipt = unwrapOk(
      await runInDurableObject(stub, (instance: Instance) =>
        instance.run(makeDispatchTrigger({ targetCommentId: target.id }))
      )
    );

    const settled = await waitForTerminalRun(stub, receipt.runId);
    expect(settled.lifecycle).toBe("complete");
    expect(settlements).toHaveLength(1);

    // The run settled during the turn; wake must not re-settle it.
    await wake(stub);
    expect(settlements).toHaveLength(1);
  });
});
