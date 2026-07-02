import type {
  AuthzError,
  NotImplementedError,
  TenantGuardViolationError,
} from "../errors";
import type { SkillId } from "../ids";
import type { SkillMarkdown, SkillName } from "../primitives";
import type { AsyncResult } from "../result";
import type { Skill } from "../skill";
import type { TenantContext } from "./tenant-data-access";

export type SkillStoreError =
  | AuthzError
  | NotImplementedError
  | TenantGuardViolationError;

export interface SkillContent {
  readonly markdown: SkillMarkdown;
  readonly skill: Skill;
}

/**
 * Caller-supplied fields for a new skill; workspaceId comes from the seam's TenantContext,
 * and id, storage.r2Key, createdAt, and updatedAt are minted by the adapter.
 */
export interface SkillDraft {
  readonly name: SkillName;
}

/** R2-backed markdown skill seam. Skill records live in D1; markdown content remains live. */
export interface SkillStore {
  readonly context: TenantContext;
  readonly create: (input: {
    readonly draft: SkillDraft;
    readonly markdown: SkillMarkdown;
  }) => AsyncResult<SkillContent, SkillStoreError>;
  readonly get: (input: {
    readonly skillId: SkillId;
  }) => AsyncResult<SkillContent | null, SkillStoreError>;
  /** Markdown edits re-index the skill (ADR 0005). Returns null for an unknown skillId. */
  readonly update: (input: {
    readonly markdown: SkillMarkdown;
    readonly skillId: SkillId;
  }) => AsyncResult<SkillContent | null, SkillStoreError>;
}
