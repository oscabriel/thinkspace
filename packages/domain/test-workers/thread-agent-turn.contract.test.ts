import { MockLanguageModelV3 } from "ai/test";
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, test, vi } from "vitest";

import { createR2MarkdownSkillStore } from "../src/adapters/production/skill-store";
import type { ThreadAgentDurableObject } from "../src/adapters/production/thread-agent";
import { encodeThreadAgentAddress } from "../src/adapters/thread-agent-address";
import type { RunSettlement } from "../src/flows/run-completion";
import { skillMarkdownSchema, skillNameSchema } from "../src/primitives";
import { ok } from "../src/result";
import type { TenantContext } from "../src/seams/tenant-data-access";
import type { ThreadAgentAddress } from "../src/seams/thread-agent";
import {
  channelId,
  makeComment,
  makeDispatchTrigger,
  makeShapeSnapshot,
  makeShapeStructure,
  runId,
  testMemberId,
  testTenantContext,
  threadId,
  unwrapOk,
  workspaceId,
} from "../src/testing";
import { modelErroringMidStream, modelReplying } from "./mock-model";

const address = (suffix: string): ThreadAgentAddress => ({
  channelId: channelId(`turn-ch-${suffix}`),
  threadId: threadId(`turn-th-${suffix}`),
  workspaceId: workspaceId(`turn-ws-${suffix}`),
});

const agentAt = (addr: ThreadAgentAddress) =>
  env.THREAD_AGENT.get(
    env.THREAD_AGENT.idFromName(encodeThreadAgentAddress(addr))
  );

/**
 * Direct runInDurableObject calls bypass partyserver's start gating (production traffic
 * arrives via getAgentByName → setName → onStart, which builds Think's Session). Trigger
 * it the same way the paved path does.
 */
const startAgent = (
  stub: ReturnType<typeof agentAt>,
  addr: ThreadAgentAddress
) =>
  runInDurableObject(stub, (instance: Instance) =>
    instance.setName(encodeThreadAgentAddress(addr))
  );

type Instance = ThreadAgentDurableObject;

/** A hibernation wake re-runs onStart, and with it the settlement reconciliation sweep. */
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

describe("ThreadAgent turn layer — RunId is the submissionId (ADR 0033)", () => {
  test("a dispatched run executes a model turn to completion: reply appended, run complete, settle invoked", async () => {
    const addr = address("complete");
    const stub = agentAt(addr);
    const target = makeComment({
      id: "turn-comment-top",
      threadId: addr.threadId,
      workspaceId: addr.workspaceId,
    });
    const settlements: RunSettlement[] = [];

    await runInDurableObject(stub, (instance: Instance) => {
      instance.applyTestSeed({
        address: addr,
        comments: [target],
        nextRunId: () => runId("turn-run-1"),
        shapeSnapshot: makeShapeSnapshot(),
        testModel: modelReplying("Hello from the agent."),
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
    expect(receipt.runId).toBe(runId("turn-run-1"));

    const settled = await waitForTerminalRun(stub, receipt.runId);
    expect(settled.lifecycle).toBe("complete");
    if (settled.lifecycle !== "complete") {
      throw new Error("unreachable");
    }

    const branch = unwrapOk(
      await runInDurableObject(stub, (instance: Instance) =>
        instance.loadBranch({ rootCommentId: target.id })
      )
    );
    const reply = branch.subtree.find(
      (comment) => comment.id === settled.outputCommentId
    );
    expect(reply).toBeDefined();
    expect(reply?.body).toBe("Hello from the agent.");
    expect(reply?.author).toEqual({
      channelId: addr.channelId,
      facet: { kind: "channel_agent" },
      kind: "agent",
    });
    expect(reply?.parent).toEqual({
      kind: "nested",
      parentCommentId: target.id,
    });

    expect(settlements).toHaveLength(1);
    const [settlement] = settlements;
    expect(settlement?.kind).toBe("complete");
    if (settlement?.kind !== "complete") {
      throw new Error("unreachable");
    }
    expect(settlement.run.id).toBe(receipt.runId);
    expect(settlement.outputComment.id).toBe(settled.outputCommentId);
    expect(settlement.participants).toContain(testMemberId);
  });

  test("the run row and the Think submission share one id", async () => {
    const addr = address("identity");
    const stub = agentAt(addr);
    const target = makeComment({
      id: "turn-comment-identity",
      threadId: addr.threadId,
      workspaceId: addr.workspaceId,
    });

    await runInDurableObject(stub, (instance: Instance) => {
      instance.applyTestSeed({
        address: addr,
        comments: [target],
        nextRunId: () => runId("turn-run-identity"),
        shapeSnapshot: makeShapeSnapshot(),
        testModel: modelReplying("Reply."),
      });
      instance.completionFlow = { settle: async () => ok() };
    });
    await startAgent(stub, addr);

    const receipt = unwrapOk(
      await runInDurableObject(stub, (instance: Instance) =>
        instance.run(makeDispatchTrigger({ targetCommentId: target.id }))
      )
    );
    await waitForTerminalRun(stub, receipt.runId);

    const inspection = await runInDurableObject(stub, (instance: Instance) =>
      instance.inspectSubmission(receipt.runId)
    );
    expect(inspection?.submissionId).toBe(receipt.runId);
    expect(inspection?.status).toBe("completed");
  });

  test("a failing model turn settles the run as failed (no output comment, failure announced)", async () => {
    const addr = address("failure");
    const stub = agentAt(addr);
    const target = makeComment({
      id: "turn-comment-failure",
      threadId: addr.threadId,
      workspaceId: addr.workspaceId,
    });
    const settlements: RunSettlement[] = [];

    await runInDurableObject(stub, (instance: Instance) => {
      instance.applyTestSeed({
        address: addr,
        comments: [target],
        nextRunId: () => runId("turn-run-failure"),
        shapeSnapshot: makeShapeSnapshot(),
        testModel: new MockLanguageModelV3({
          doStream: async () => {
            throw new Error("model exploded");
          },
        }),
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
    expect(settled.lifecycle).toBe("failed");
    if (settled.lifecycle !== "failed") {
      throw new Error("unreachable");
    }
    expect(settled.failure.failureReason).toContain("model exploded");

    const branch = unwrapOk(
      await runInDurableObject(stub, (instance: Instance) =>
        instance.loadBranch({ rootCommentId: target.id })
      )
    );
    expect(branch.subtree.map((comment) => comment.id)).toEqual([target.id]);

    expect(settlements).toEqual([{ kind: "failed", run: settled }]);
  });

  /**
   * E10.1 (ADR 0028 / ADR 0038 addendum): the live regression. A stream that opens cleanly
   * (gateway 200) and then errors mid-flight must settle the run FAILED server-side — no output
   * comment, the failure recorded, and the SAME settlement fan-out a completion runs (the failed
   * settlement, which publishes `run_lifecycle_changed`). Before this the run stranded and the
   * client card showed "Running" until its stale timeout.
   */
  test("a stream that errors after headers settles the run as failed and fires the settlement event", async () => {
    const addr = address("instream-error");
    const stub = agentAt(addr);
    const target = makeComment({
      id: "turn-comment-instream",
      threadId: addr.threadId,
      workspaceId: addr.workspaceId,
    });
    const settlements: RunSettlement[] = [];

    await runInDurableObject(stub, (instance: Instance) => {
      instance.applyTestSeed({
        address: addr,
        comments: [target],
        nextRunId: () => runId("turn-run-instream"),
        shapeSnapshot: makeShapeSnapshot(),
        testModel: modelErroringMidStream(
          "provider stream failed after headers"
        ),
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
    expect(settled.lifecycle).toBe("failed");
    if (settled.lifecycle !== "failed") {
      throw new Error("unreachable");
    }
    // The in-stream error is preserved as the failure reason, and no output comment was minted.
    expect(settled.failure.failureReason).toContain("provider stream failed");
    const branch = unwrapOk(
      await runInDurableObject(stub, (instance: Instance) =>
        instance.loadBranch({ rootCommentId: target.id })
      )
    );
    expect(branch.subtree.map((comment) => comment.id)).toEqual([target.id]);

    // The failed settlement fired exactly once — the same fan-out path a completion takes.
    expect(settlements).toEqual([{ kind: "failed", run: settled }]);

    // The server-authoritative read returns the settled failed state (ADR 0028).
    const detail = unwrapOk(
      await runInDurableObject(stub, (instance: Instance) =>
        instance.getRun({ runId: receipt.runId })
      )
    );
    expect(detail?.run.lifecycle).toBe("failed");
  });

  /**
   * E10.1 hibernation shape (ADR 0017/0028/0035 §2): the run failed by an in-stream error is
   * durable — a wake (fresh isolate after eviction) re-runs onStart and its reconciliation sweep,
   * and the settled-failed run survives: it is not re-settled (its `ts_run_settled` mark stands)
   * and reads back failed.
   */
  test("an in-stream-errored run's failed state survives a hibernation wake", async () => {
    const addr = address("instream-hibernate");
    const stub = agentAt(addr);
    const target = makeComment({
      id: "turn-comment-hibernate",
      threadId: addr.threadId,
      workspaceId: addr.workspaceId,
    });
    const settlements: RunSettlement[] = [];

    await runInDurableObject(stub, (instance: Instance) => {
      instance.applyTestSeed({
        address: addr,
        comments: [target],
        nextRunId: () => runId("turn-run-hibernate"),
        shapeSnapshot: makeShapeSnapshot(),
        testModel: modelErroringMidStream(
          "provider stream failed after headers"
        ),
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
    expect(settled.lifecycle).toBe("failed");
    expect(settlements).toHaveLength(1);

    // A wake re-runs the sweep; the already-settled failed run is left alone (idempotent).
    await wake(stub);
    expect(settlements).toHaveLength(1);

    const detail = unwrapOk(
      await runInDurableObject(stub, (instance: Instance) =>
        instance.getRun({ runId: receipt.runId })
      )
    );
    expect(detail?.run.lifecycle).toBe("failed");
  });
});

describe("ThreadAgent turn layer — skills feed the effective prompt (ADR 0005/0029)", () => {
  test("a skill selected by the resident shape surfaces in the effective system prompt", async () => {
    const addr = address("skills");
    const stub = agentAt(addr);
    const skillContext: TenantContext = {
      ...testTenantContext,
      workspaceId: addr.workspaceId,
    };
    const markdown = skillMarkdownSchema.parse(
      "# Deploy runbook\n\nAlways drain connections before rollout."
    );

    // Author a live skill (R2 body + adapter-owned D1 index) in the turn's workspace.
    const skillStore = createR2MarkdownSkillStore({
      bucket: env.SKILLS,
      context: skillContext,
      db: env.DB,
    });
    const created = unwrapOk(
      await skillStore.create({
        draft: { name: skillNameSchema.parse("Deploy runbook") },
        markdown,
      })
    );

    const target = makeComment({
      id: "turn-comment-skills",
      threadId: addr.threadId,
      workspaceId: addr.workspaceId,
    });

    await runInDurableObject(stub, (instance: Instance) => {
      instance.applyTestSeed({
        address: addr,
        comments: [target],
        nextRunId: () => runId("turn-run-skills"),
        shapeSnapshot: makeShapeSnapshot({
          structure: makeShapeStructure({
            skillSelection: [created.skill.id],
          }),
        }),
        testModel: modelReplying("Acknowledged."),
      });
      instance.completionFlow = { settle: async () => ok() };
    });
    await startAgent(stub, addr);

    await runInDurableObject(stub, (instance: Instance) =>
      instance.run(makeDispatchTrigger({ targetCommentId: target.id }))
    );

    // run() reloads the selection's live markdown before the turn assembles its prompt.
    const prompt = await runInDurableObject(stub, (instance: Instance) =>
      instance.getSystemPrompt()
    );
    expect(prompt.includes(markdown)).toBe(true);
    expect(prompt.includes("# Skills")).toBe(true);
  });
});
