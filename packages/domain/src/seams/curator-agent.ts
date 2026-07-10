import type {
  AuthzError,
  ByokKeyMissingError,
  CuratorExecutionFailedError,
  CuratorSessionNotFoundError,
  CuratorUnaddressableError,
  NotImplementedError,
  TenantGuardViolationError,
} from "../errors";
import type { CuratorSessionId, MemberId, ModelId, WorkspaceId } from "../ids";
import type { CuratorPrompt, CuratorReply, Goal } from "../primitives";
import type { AsyncResult } from "../result";
import type { ShapeStructure } from "../shape";
import type { TenantContext } from "./tenant-data-access";

export type CuratorAgentError =
  | AuthzError
  | ByokKeyMissingError
  | CuratorExecutionFailedError
  | CuratorSessionNotFoundError
  | CuratorUnaddressableError
  | NotImplementedError
  | TenantGuardViolationError;

/** Form-shaped output (ADR 0021/0026): the goal is a first-class draft field alongside the shape. */
export interface CuratorDraft {
  readonly goal: Goal;
  readonly shape: ShapeStructure;
}

/** Sessions are per member (ADR 0026); concurrent authoring never shares a transcript. */
export interface CuratorSession {
  readonly id: CuratorSessionId;
  readonly memberId: MemberId;
  readonly startedAt: Date;
  readonly workspaceId: WorkspaceId;
}

export interface CuratorSendRequest {
  readonly message: CuratorPrompt;
  readonly sessionId: CuratorSessionId;
}

/**
 * ADR 0038 §2: the curator's model is resolved at the edge (the workspace's earliest-keyed
 * provider's default) and carried into the session so the DO persists it and self-constructs the
 * gateway model across hibernation (ADR 0036 §1) — nothing injected survives a wake.
 */
export interface CuratorStartSessionRequest {
  readonly modelId: ModelId;
}

/** draft is null until the interview has enough to propose one; it refines turn by turn. */
export interface CuratorTurn {
  readonly draft: CuratorDraft | null;
  readonly reply: CuratorReply;
  readonly sessionId: CuratorSessionId;
}

/**
 * Workspace-scoped first-party authoring agent seam (ADR 0021/0026). Stateful, per-member
 * interview sessions; the production adapter keys sessions on the workspace curator DO.
 */
export interface CuratorAgent {
  readonly context: TenantContext;
  readonly send: (
    input: CuratorSendRequest
  ) => AsyncResult<CuratorTurn, CuratorAgentError>;
  readonly startSession: (
    input: CuratorStartSessionRequest
  ) => AsyncResult<CuratorSession, CuratorAgentError>;
}
