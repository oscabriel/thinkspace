import { createNotImplementedError } from "../../errors";
import { err } from "../../result";
import type { CuratorAgent } from "../../seams/curator-agent";
import type { TenantContext } from "../../seams/tenant-data-access";
import type { ThreadAgent, ThreadAgentAddress } from "../../seams/thread-agent";

const notImplemented = async (seam: string) =>
  err(createNotImplementedError(seam));

export const createThinkThreadAgentPlaceholder = (
  address: ThreadAgentAddress
): ThreadAgent => ({
  address,
  appendComment: async (_input) =>
    notImplemented("ThinkThreadAgent.appendComment"),
  getRun: async (_input) => notImplemented("ThinkThreadAgent.getRun"),
  initialize: async (_input) => notImplemented("ThinkThreadAgent.initialize"),
  listRuns: async () => notImplemented("ThinkThreadAgent.listRuns"),
  loadBranch: async (_input) => notImplemented("ThinkThreadAgent.loadBranch"),
  resnapshot: async (_input) => notImplemented("ThinkThreadAgent.resnapshot"),
  run: async (_input) => notImplemented("ThinkThreadAgent.run"),
  schedule: async (_input) => notImplemented("ThinkThreadAgent.schedule"),
});

export const createCuratorThinkAgentPlaceholder = (
  context: TenantContext
): CuratorAgent => ({
  context,
  send: async (_input) => notImplemented("CuratorThinkAgent.send"),
  startSession: async () => notImplemented("CuratorThinkAgent.startSession"),
});
