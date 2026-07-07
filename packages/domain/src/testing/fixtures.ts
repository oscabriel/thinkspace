import type { Channel } from "../channel";
import {
  channelIdSchema,
  commentIdSchema,
  gestureIdSchema,
  mcpServerIdSchema,
  memberIdSchema,
  modelIdSchema,
  runIdSchema,
  shapeIdSchema,
  skillIdSchema,
  threadIdSchema,
  toolIdSchema,
  workspaceIdSchema,
} from "../ids";
import type { McpServer } from "../mcp";
import {
  commentBodySchema,
  facetNameSchema,
  goalSchema,
  mcpHostSchema,
  mcpServerNameSchema,
  mcpServerUrlSchema,
  r2KeySchema,
  skillMarkdownSchema,
  skillNameSchema,
  systemPromptSchema,
  threadNameSchema,
  toolNameSchema,
  workspaceNameSchema,
} from "../primitives";
import type { Result } from "../result";
import type { QueuedRun, RunTrigger, SubAgentActivity } from "../run";
import type { SkillContent } from "../seams/skill-store";
import type { SystemContext, TenantContext } from "../seams/tenant-data-access";
import type { ThreadAgentAddress } from "../seams/thread-agent";
import type { Shape, ShapeSnapshot, ShapeStructure } from "../shape";
import type { Skill } from "../skill";
import type { Comment, Thread } from "../thread";
import type { CatalogTool, WorkspaceToolDisable } from "../tool";
import type { Unread } from "../unread";
import type { Workspace } from "../workspace";

export const testWorkspaceId = workspaceIdSchema.parse("workspace-1");
export const otherWorkspaceId = workspaceIdSchema.parse("workspace-2");
export const testChannelId = channelIdSchema.parse("channel-1");
export const testThreadId = threadIdSchema.parse("thread-1");
export const testMemberId = memberIdSchema.parse("member-1");

export const threadAgentAddress: ThreadAgentAddress = {
  channelId: testChannelId,
  threadId: testThreadId,
  workspaceId: testWorkspaceId,
};

export const testTenantContext: TenantContext = {
  memberId: testMemberId,
  role: "member",
  workspaceId: testWorkspaceId,
};

export const testSystemContext: SystemContext = {
  kind: "system",
  workspaceId: testWorkspaceId,
};

export const unwrapOk = <T, E>(result: Result<T, E>): T => {
  if (!result.ok) {
    throw new Error(
      `expected ok result, got error ${JSON.stringify(result.error)}`
    );
  }
  return result.value;
};

export const unwrapErr = <T, E>(result: Result<T, E>): E => {
  if (result.ok) {
    throw new Error(
      `expected err result, got ok ${JSON.stringify(result.value)}`
    );
  }
  return result.error;
};

export const commentId = (value: string) => commentIdSchema.parse(value);
export const runId = (value: string) => runIdSchema.parse(value);
export const toolId = (value: string) => toolIdSchema.parse(value);
export const skillId = (value: string) => skillIdSchema.parse(value);
export const mcpServerId = (value: string) => mcpServerIdSchema.parse(value);

export const makeShapeStructure = (input?: {
  readonly mcpServerSelection?: readonly string[];
  readonly modelId?: string;
  readonly skillSelection?: readonly string[];
  readonly systemPrompt?: string;
  readonly toolSelection?: readonly string[];
}): ShapeStructure => ({
  artifactSelection: [],
  mcpServerSelection: (input?.mcpServerSelection ?? []).map(mcpServerId),
  modelId: modelIdSchema.parse(input?.modelId ?? "test-provider/model-1"),
  skillSelection: (input?.skillSelection ?? []).map(skillId),
  systemPrompt: systemPromptSchema.parse(
    input?.systemPrompt ?? "You are the channel's agent."
  ),
  toolSelection: (input?.toolSelection ?? []).map(toolId),
});

export const makeShapeSnapshot = (input?: {
  readonly shapeId?: string;
  readonly structure?: ShapeStructure;
}): ShapeSnapshot => ({
  shapeId: shapeIdSchema.parse(input?.shapeId ?? "shape-1"),
  snapshottedAt: new Date("2026-07-01T08:00:00Z"),
  structure: input?.structure ?? makeShapeStructure(),
});

export const makeDispatchTrigger = (input: {
  readonly gestureId?: string;
  readonly targetCommentId: string;
}): RunTrigger => ({
  dispatch: {
    byMemberId: testMemberId,
    // Default derives from the target so distinct dispatches carry distinct gestures;
    // a caller passes an explicit gestureId to pin dedupe convergence (E5.3).
    gestureId: gestureIdSchema.parse(
      input.gestureId ?? `gesture-${input.targetCommentId}`
    ),
    targetCommentId: commentId(input.targetCommentId),
  },
  kind: "dispatch",
});

export const makeQueuedRun = (input: { readonly id: string }): QueuedRun => ({
  channelId: testChannelId,
  id: runId(input.id),
  lifecycle: "queued",
  queuedAt: new Date("2026-07-01T09:00:00Z"),
  threadId: testThreadId,
  trigger: makeDispatchTrigger({ targetCommentId: "comment-top" }),
  workspaceId: testWorkspaceId,
});

export const makeRunningSubAgentActivity = (input: {
  readonly name: string;
  readonly runId: string;
}): SubAgentActivity => ({
  name: facetNameSchema.parse(input.name),
  runId: runId(input.runId),
  status: { kind: "running", startedAt: new Date("2026-07-01T09:01:00Z") },
});

export const mcpHost = (value: string) => mcpHostSchema.parse(value);
export const memberId = (value: string) => memberIdSchema.parse(value);
export const channelId = (value: string) => channelIdSchema.parse(value);
export const threadId = (value: string) => threadIdSchema.parse(value);
export const workspaceId = (value: string) => workspaceIdSchema.parse(value);
export const shapeId = (value: string) => shapeIdSchema.parse(value);
export const gestureId = (value: string) => gestureIdSchema.parse(value);

export const testWorkspace: Workspace = {
  id: testWorkspaceId,
  name: workspaceNameSchema.parse("Test Workspace"),
};

export const makeChannel = (input: {
  readonly id: string;
  readonly lifecycle?: Channel["lifecycle"];
  readonly ownerMemberId?: Channel["ownerMemberId"];
  readonly shapeId?: string;
  readonly visibility?: Channel["visibility"];
  readonly workspaceId?: Channel["workspaceId"];
}): Channel => ({
  createdAt: new Date("2026-06-29T00:00:00Z"),
  goal: goalSchema.parse(`goal of ${input.id}`),
  id: channelId(input.id),
  lifecycle: input.lifecycle ?? { state: "active" },
  ownerMemberId: input.ownerMemberId ?? testMemberId,
  shapeId: shapeId(input.shapeId ?? `shape-of-${input.id}`),
  visibility: input.visibility ?? { kind: "shared" },
  workspaceId: input.workspaceId ?? testWorkspaceId,
});

export const makeThread = (input: {
  readonly channelId: string;
  readonly id: string;
  readonly lastActivityAt?: Date;
}): Thread => ({
  channelId: channelId(input.channelId),
  createdAt: new Date("2026-06-30T00:00:00Z"),
  createdByMemberId: testMemberId,
  id: threadId(input.id),
  lastActivityAt: input.lastActivityAt ?? new Date("2026-06-30T12:00:00Z"),
  lifecycle: { state: "active" },
  name: threadNameSchema.parse(`thread ${input.id}`),
  workspaceId: testWorkspaceId,
});

export const makeUnread = (input: {
  readonly memberId?: Unread["memberId"];
  readonly threadId: string;
}): Unread => ({
  bumpedAt: new Date("2026-06-30T13:00:00Z"),
  memberId: input.memberId ?? testMemberId,
  reasons: [
    {
      commentId: commentId("comment-run-output"),
      kind: "agent_output",
      runId: runId("run-1"),
    },
  ],
  threadId: threadId(input.threadId),
  workspaceId: testWorkspaceId,
});

export const makeShape = (input: {
  readonly clonedFrom?: Shape["clonedFrom"];
  readonly id: string;
}): Shape => ({
  clonedFrom: input.clonedFrom ?? null,
  createdAt: new Date("2026-06-29T00:00:00Z"),
  id: shapeId(input.id),
  structure: makeShapeStructure(),
  updatedAt: new Date("2026-06-29T00:00:00Z"),
  workspaceId: testWorkspaceId,
});

export const makeCatalogTool = (input: {
  readonly id: string;
}): CatalogTool => ({
  id: toolId(input.id),
  name: toolNameSchema.parse(`tool ${input.id}`),
  source: { kind: "first_party" },
});

export const makeWorkspaceToolDisable = (input: {
  readonly toolId: string;
  readonly workspaceId?: WorkspaceToolDisable["workspaceId"];
}): WorkspaceToolDisable => ({
  disabledAt: new Date("2026-06-30T00:00:00Z"),
  disabledByMemberId: testMemberId,
  toolId: toolId(input.toolId),
  workspaceId: input.workspaceId ?? testWorkspaceId,
});

export const makeSkill = (input: {
  readonly id: string;
  readonly workspaceId?: Skill["workspaceId"];
}): Skill => {
  const skillWorkspaceId = input.workspaceId ?? testWorkspaceId;
  return {
    createdAt: new Date("2026-06-30T00:00:00Z"),
    id: skillId(input.id),
    name: skillNameSchema.parse(`skill ${input.id}`),
    storage: {
      kind: "r2_markdown",
      r2Key: r2KeySchema.parse(`${skillWorkspaceId}/skills/${input.id}.md`),
    },
    updatedAt: new Date("2026-06-30T00:00:00Z"),
    workspaceId: skillWorkspaceId,
  };
};

export const makeSkillContent = (input: {
  readonly id: string;
  readonly markdown?: string;
  readonly workspaceId?: Skill["workspaceId"];
}): SkillContent => ({
  markdown: skillMarkdownSchema.parse(
    input.markdown ?? `# ${input.id}\n\nProcedural knowledge for ${input.id}.`
  ),
  skill: makeSkill({ id: input.id, workspaceId: input.workspaceId }),
});

export const makeMcpServer = (input: {
  readonly host: string;
  readonly id: string;
  readonly workspaceId?: McpServer["workspaceId"];
}): McpServer => ({
  host: mcpHost(input.host),
  id: mcpServerId(input.id),
  name: mcpServerNameSchema.parse(`server ${input.id}`),
  url: mcpServerUrlSchema.parse(`https://${input.host}/mcp`),
  workspaceId: input.workspaceId ?? testWorkspaceId,
});

export const makeComment = (input: {
  readonly id: string;
  readonly parentCommentId?: string;
  readonly threadId?: Comment["threadId"];
  readonly workspaceId?: Comment["workspaceId"];
}): Comment => ({
  author: { kind: "member", memberId: testMemberId },
  body: commentBodySchema.parse(`body of ${input.id}`),
  createdAt: new Date("2026-07-01T00:00:00Z"),
  id: commentIdSchema.parse(input.id),
  parent:
    input.parentCommentId === undefined
      ? { kind: "top_level" }
      : {
          kind: "nested",
          parentCommentId: commentIdSchema.parse(input.parentCommentId),
        },
  threadId: input.threadId ?? testThreadId,
  workspaceId: input.workspaceId ?? testWorkspaceId,
});
