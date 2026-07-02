export const adapterSlots = {
  artifactStore: {
    production: "R2VirtualFsArtifactStore",
    test: "MemoryArtifactStore",
  },
  channelHub: {
    production: "DurableObjectChannelHub",
    test: "MemoryChannelHub",
  },
  curatorAgent: {
    production: "CuratorThinkAgent",
    test: "MemoryCuratorAgent",
  },
  mcpEgressPolicy: {
    production: "WorkerMcpEgressPolicy",
    test: "MemoryMcpEgressPolicy",
  },
  modelRouter: {
    production: "AiGatewayByokModelRouter",
    test: "MemoryModelRouter",
  },
  skillStore: {
    production: "R2MarkdownSkillStore",
    test: "MemorySkillStore",
  },
  tenantDataAccess: {
    production: "D1TenantDataAccess",
    test: "MemoryTenantDataAccess",
  },
  threadAgent: {
    production: "ThinkThreadAgent",
    test: "MemoryThreadAgent",
  },
  toolResolver: {
    production: "CatalogWorkspaceShapeToolResolver",
    test: "MemoryToolResolver",
  },
  workspaceHub: {
    production: "DurableObjectWorkspaceHub",
    test: "MemoryWorkspaceHub",
  },
} as const;

export type AdapterSlots = typeof adapterSlots;
