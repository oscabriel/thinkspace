import { createNotImplementedError } from "../../errors";
import { err } from "../../result";
import type { ArtifactStore } from "../../seams/artifact-store";
import type { CuratorAgent } from "../../seams/curator-agent";
import type { ModelRouter } from "../../seams/model-routing";
import type {
  ChannelHub,
  ChannelHubAddress,
  WorkspaceHub,
} from "../../seams/realtime-hubs";
import type { SkillStore } from "../../seams/skill-store";
import type {
  TenantContext,
  TenantDataAccess,
} from "../../seams/tenant-data-access";
import type { ThreadAgent, ThreadAgentAddress } from "../../seams/thread-agent";
import type {
  McpEgressPolicy,
  ToolResolver,
} from "../../seams/tool-resolution";

const notImplemented = async (seam: string) =>
  err(createNotImplementedError(seam));

export const createD1TenantDataAccessPlaceholder = (
  context: TenantContext
): TenantDataAccess => ({
  batch: async (_input) => notImplemented("D1TenantDataAccess.batch"),
  context,
  getArtifact: async (_input) =>
    notImplemented("D1TenantDataAccess.getArtifact"),
  getChannel: async (_input) => notImplemented("D1TenantDataAccess.getChannel"),
  getMcpHostApproval: async (_input) =>
    notImplemented("D1TenantDataAccess.getMcpHostApproval"),
  getMcpServer: async (_input) =>
    notImplemented("D1TenantDataAccess.getMcpServer"),
  getSchedule: async (_input) =>
    notImplemented("D1TenantDataAccess.getSchedule"),
  getShape: async (_input) => notImplemented("D1TenantDataAccess.getShape"),
  getSkill: async (_input) => notImplemented("D1TenantDataAccess.getSkill"),
  getWorkspaceGraph: async () =>
    notImplemented("D1TenantDataAccess.getWorkspaceGraph"),
  listArtifacts: async () => notImplemented("D1TenantDataAccess.listArtifacts"),
  listChannelFavorites: async (_input) =>
    notImplemented("D1TenantDataAccess.listChannelFavorites"),
  listChannelThreads: async (_input) =>
    notImplemented("D1TenantDataAccess.listChannelThreads"),
  listChannels: async (_input) =>
    notImplemented("D1TenantDataAccess.listChannels"),
  listMemberUnread: async (_input) =>
    notImplemented("D1TenantDataAccess.listMemberUnread"),
  listRecentThreads: async (_input) =>
    notImplemented("D1TenantDataAccess.listRecentThreads"),
  listSkills: async () => notImplemented("D1TenantDataAccess.listSkills"),
  listWorkspaceToolDisables: async () =>
    notImplemented("D1TenantDataAccess.listWorkspaceToolDisables"),
});

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

export const createAiGatewayByokModelRouterPlaceholder = (
  context: TenantContext
): ModelRouter => ({
  context,
  listAvailableModels: async () =>
    notImplemented("AiGatewayByokModelRouter.listAvailableModels"),
  resolve: async (_input) => notImplemented("AiGatewayByokModelRouter.resolve"),
});

export const createCatalogWorkspaceShapeToolResolverPlaceholder = (
  context: TenantContext
): ToolResolver => ({
  context,
  resolve: async (_input) =>
    notImplemented("CatalogWorkspaceShapeToolResolver.resolve"),
});

export const createWorkerMcpEgressPolicyPlaceholder = (
  context: TenantContext
): McpEgressPolicy => ({
  authorize: async (_input) =>
    notImplemented("WorkerMcpEgressPolicy.authorize"),
  context,
});

export const createDurableObjectWorkspaceHubPlaceholder = (
  context: TenantContext
): WorkspaceHub => ({
  context,
  getRoster: async () => notImplemented("DurableObjectWorkspaceHub.getRoster"),
  listChannels: async (_input) =>
    notImplemented("DurableObjectWorkspaceHub.listChannels"),
  publishActivity: async (_event) =>
    notImplemented("DurableObjectWorkspaceHub.publishActivity"),
});

export const createDurableObjectChannelHubPlaceholder = (input: {
  readonly address: ChannelHubAddress;
  readonly context: TenantContext;
}): ChannelHub => ({
  address: input.address,
  context: input.context,
  createThread: async (_request) =>
    notImplemented("DurableObjectChannelHub.createThread"),
  getPresence: async () =>
    notImplemented("DurableObjectChannelHub.getPresence"),
  publishEvent: async (_event) =>
    notImplemented("DurableObjectChannelHub.publishEvent"),
});

export const createCuratorThinkAgentPlaceholder = (
  context: TenantContext
): CuratorAgent => ({
  context,
  send: async (_input) => notImplemented("CuratorThinkAgent.send"),
  startSession: async () => notImplemented("CuratorThinkAgent.startSession"),
});
