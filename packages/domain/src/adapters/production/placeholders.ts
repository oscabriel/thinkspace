import { createNotImplementedError } from "../../errors";
import { err } from "../../result";
import type { ArtifactStore } from "../../seams/artifact-store";
import type { CuratorAgent } from "../../seams/curator-agent";
import type { SkillStore } from "../../seams/skill-store";
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

export const createR2VirtualFsArtifactStorePlaceholder = (
  context: TenantContext
): ArtifactStore => ({
  context,
  get: async (_input) => notImplemented("R2VirtualFsArtifactStore.get"),
  put: async (_input) => notImplemented("R2VirtualFsArtifactStore.put"),
  search: async (_input) => notImplemented("R2VirtualFsArtifactStore.search"),
});

export const createR2MarkdownSkillStorePlaceholder = (
  context: TenantContext
): SkillStore => ({
  context,
  create: async (_input) => notImplemented("R2MarkdownSkillStore.create"),
  get: async (_input) => notImplemented("R2MarkdownSkillStore.get"),
  update: async (_input) => notImplemented("R2MarkdownSkillStore.update"),
});

export const createCuratorThinkAgentPlaceholder = (
  context: TenantContext
): CuratorAgent => ({
  context,
  send: async (_input) => notImplemented("CuratorThinkAgent.send"),
  startSession: async () => notImplemented("CuratorThinkAgent.startSession"),
});
