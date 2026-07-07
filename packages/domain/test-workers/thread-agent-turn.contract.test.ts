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
import { modelReplying } from "./mock-model";

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
