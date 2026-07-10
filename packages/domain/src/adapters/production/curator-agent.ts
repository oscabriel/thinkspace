import { Think } from "@cloudflare/think";
import { getAgentByName } from "agents";
import type { AgentContext } from "agents";
import type { LanguageModel } from "ai";
import { z } from "zod";

import { formatModelId } from "../../ids";
import type { CuratorSessionId, ModelId } from "../../ids";
import { curatorSessionIdSchema, modelIdSchema } from "../../ids";
import {
  curatorReplySchema,
  failureReasonSchema,
  goalSchema,
} from "../../primitives";
import { providerAllowlist } from "../../provider-allowlist";
import { err, ok } from "../../result";
import type { AsyncResult } from "../../result";
import type {
  CuratorAgent,
  CuratorAgentError,
  CuratorSendRequest,
  CuratorSession,
  CuratorStartSessionRequest,
  CuratorTurn,
} from "../../seams/curator-agent";
import type { TenantContext } from "../../seams/tenant-data-access";
import { shapeStructureSchema } from "../../shape";
import { idKey, parseJsonColumn } from "../helpers";
import {
  type CuratorAddress,
  decodeCuratorAddress,
  encodeCuratorAddress,
} from "../curator-address";
import { createGatewayModel, type GatewayModelEnv } from "./model-gateway";

const defaultClock = (): Date => new Date();

const defaultSessionId = (): CuratorSessionId =>
  curatorSessionIdSchema.parse(`curator-session-${crypto.randomUUID()}`);

/**
 * ADR 0021 / ADR 0038 §2: the curator runs on the workspace's own BYOK key. Since ADR 0038 the
 * per-session model is the workspace's earliest-keyed provider default, resolved at the edge and
 * persisted in the DO; `getModel` self-constructs from that stored id. This allowlist-head default
 * is only the hibernation fallback for sessions minted before the upgrade (dev-only data) — no
 * live path composes it once every session carries a resolved id. getModel self-constructs the
 * gateway model from a ModelId exactly like ThreadAgent.getModel.
 */
export const defaultCuratorModelId = () => {
  const [entry] = providerAllowlist;
  if (entry === undefined) {
    throw new Error("defaultCuratorModelId: provider allowlist is empty");
  }
  return formatModelId(entry.modelsDevId, entry.defaultModelSlug);
};

/**
 * The curator's authoring contract with its model (ADR 0026): every turn returns a
 * conversational `reply` plus a form-shaped `draft` (goal + ShapeStructure) — or `draft: null`
 * until the interview has enough to propose one. Structured output is the honest way a
 * meta-agent "responsibly populates the shape" (ADR 0021) against the manual form's schema.
 */
export const curatorTurnEnvelopeSchema = z.object({
  draft: z
    .object({ goal: goalSchema, shape: shapeStructureSchema })
    .nullable(),
  reply: curatorReplySchema,
});
export type CuratorTurnEnvelope = z.infer<typeof curatorTurnEnvelopeSchema>;

/** The wire form the curator system prompt pins; the production DO and its test model agree on it. */
export const serializeCuratorEnvelope = (
  envelope: CuratorTurnEnvelope
): string => JSON.stringify(envelope);

/**
 * Parse a model turn's text back into the envelope, tolerant of a ```json fence the model may
 * wrap it in. Returns null on any structural failure — a curator that cannot produce the
 * form-shaped contract surfaces `curator_execution_failed`, never a malformed draft.
 */
export const parseCuratorEnvelope = (
  text: string
): CuratorTurnEnvelope | null => {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/u, "")
    .replace(/\s*```$/u, "")
    .trim();

  let raw: unknown;
  try {
    raw = JSON.parse(unfenced);
  } catch {
    return null;
  }

  const parsed = curatorTurnEnvelopeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

const CURATOR_SYSTEM_PROMPT = `You are Thinkspace's channel-authoring curator. Interview the \
member to sharpen the goal of the channel they want and responsibly populate its shape \
(system prompt, model, tools, skills, MCP servers, artifacts). The manual form is the source \
of truth, so you produce a form-shaped configuration — never a parallel representation.

Respond to every message with a single JSON object and nothing else:
{"reply": string, "draft": {"goal": string, "shape": ShapeStructure} | null}
Set "draft" to null until the interview has enough to propose one; refine it turn by turn.`;

/** Test override injected by the workers contract binder; production state arrives via seam calls. */
export interface CuratorAgentSeed {
  readonly address?: CuratorAddress;
  readonly clock?: () => Date;
  readonly nextSessionId?: () => CuratorSessionId;
  readonly testModel?: LanguageModel;
}

/**
 * The production CuratorAgent: a Think Durable Object, one instance per member+workspace
 * (ADR 0026 / sdk-signature-verification.md §1). Its DO name IS its workspace/member address
 * (ADR 0033 addressing), so a forged or misrouted name executes nothing. `startSession`/`send`
 * map onto the DO's own conversation state; `send` runs a synchronous `runTurn` (the model
 * construction is shared with ThreadAgent via createGatewayModel) and materializes the
 * structured envelope into a goal-bearing draft.
 */
export class CuratorAgentDurableObject extends Think<Cloudflare.Env> {
  private address: CuratorAddress | null = null;
  private clock: () => Date = defaultClock;
  private mintSessionId: () => CuratorSessionId = defaultSessionId;
  private testModel: LanguageModel | null = null;

  constructor(ctx: AgentContext, env: Cloudflare.Env) {
    super(ctx, env);
    this.ensureSeamTables();
  }

  override getModel(): LanguageModel {
    if (this.testModel !== null) {
      return this.testModel;
    }

    const address = this.deriveAddress();
    if (address === null) {
      throw new Error(
        "CuratorAgentDurableObject.getModel: curator DO is unaddressable"
      );
    }

    // ADR 0038 §2 / ADR 0036 §1: self-construct from the id the edge resolved and startSession
    // persisted — nothing injected survives a wake. A DO minted before the upgrade has no stored
    // id, so fall back to the allowlist-head default (dev-only data).
    return createGatewayModel(this.readCuratorModel() ?? defaultCuratorModelId(), {
      env: this.env as GatewayModelEnv,
      workspaceId: address.workspaceId,
    });
  }

  // eslint-disable-next-line class-methods-use-this -- fixed first-party meta-prompt (ADR 0021)
  override getSystemPrompt(): string {
    return CURATOR_SYSTEM_PROMPT;
  }

  /**
   * ADR 0033: the DO name IS the address — routing-derived and tamper-proof. Decoded lazily
   * (never in the constructor: the contract binder addresses by random-uuid names for the
   * unaddressable pin, and applyTestSeed's explicit address is the test override) and memoized.
   */
  private deriveAddress(): CuratorAddress | null {
    this.address ??= decodeCuratorAddress(this.readDoName() ?? "");
    return this.address;
  }

  /** `this.name` throws for DOs addressed by unique id (partyserver getter over ctx.id.name). */
  private readDoName(): string | null {
    try {
      return this.name;
    } catch {
      return null;
    }
  }

  /** Fail closed: an undecodable name is a bad route or a forged caller — execute nothing. */
  private unaddressable(): CuratorAgentError {
    return {
      doName: this.readDoName() ?? "",
      kind: "curator_unaddressable",
    };
  }

  private ensureSeamTables(): readonly unknown[] {
    this
      .sql`CREATE TABLE IF NOT EXISTS ts_curator_session (id TEXT PRIMARY KEY, data TEXT NOT NULL)`;
    // ADR 0038 §2: a single-row store for the DO's resolved curator model id. Per-DO rather than
    // per-session — getModel has no session in scope, and earliest-keyed resolution is
    // deterministic per workspace, so every session the member's DO mints shares one id (last
    // write wins). A sibling table (not an ALTER) so an existing dev DO's session table is left
    // untouched; getModel falls back to the allowlist default until the first post-upgrade session.
    return this
      .sql`CREATE TABLE IF NOT EXISTS ts_curator_model (id INTEGER PRIMARY KEY, model_id TEXT NOT NULL)`;
  }

  /** Test capability (contract-suite seed); production state arrives via startSession/send. */
  applyTestSeed(seed: CuratorAgentSeed): void {
    if (seed.address !== undefined) {
      this.address = seed.address;
    }
    if (seed.clock !== undefined) {
      this.clock = seed.clock;
    }
    if (seed.nextSessionId !== undefined) {
      this.mintSessionId = seed.nextSessionId;
    }
    if (seed.testModel !== undefined) {
      this.testModel = seed.testModel;
    }
  }

  async startSession(
    input: CuratorStartSessionRequest
  ): AsyncResult<CuratorSession, CuratorAgentError> {
    const address = this.deriveAddress();
    if (address === null) {
      return err(this.unaddressable());
    }

    const session: CuratorSession = {
      id: this.mintSessionId(),
      memberId: address.memberId,
      startedAt: this.clock(),
      workspaceId: address.workspaceId,
    };
    this.putSession(session);
    // ADR 0038 §2: persist the edge-resolved model so getModel self-constructs it after a wake.
    this.putCuratorModel(input.modelId);
    return ok(session);
  }

  async send(
    input: CuratorSendRequest
  ): AsyncResult<CuratorTurn, CuratorAgentError> {
    const address = this.deriveAddress();
    if (address === null) {
      return err(this.unaddressable());
    }

    // Session-first (ADR 0026): sending into an unknown session fails before any model turn —
    // per-member isolation means another member's DO never holds this session id.
    const session = this.readSession(input.sessionId);
    if (session === null) {
      return err({
        kind: "curator_session_not_found",
        sessionId: input.sessionId,
        workspaceId: address.workspaceId,
      });
    }

    try {
      const result = await this.runTurn({ input: idKey(input.message) });
      const text = this.replyText(result.message ?? null);
      const envelope = text === null ? null : parseCuratorEnvelope(text);
      if (envelope === null) {
        return err(
          this.executionFailed(
            address,
            "curator turn produced no structured draft envelope"
          )
        );
      }

      return ok({
        draft: envelope.draft,
        reply: envelope.reply,
        sessionId: session.id,
      });
    } catch (error) {
      return err(
        this.executionFailed(
          address,
          error instanceof Error && error.message.length > 0
            ? error.message
            : "curator turn was rejected"
        )
      );
    }
  }

  private executionFailed(
    address: CuratorAddress,
    reason: string
  ): CuratorAgentError {
    return {
      failureReason: failureReasonSchema.parse(reason),
      kind: "curator_execution_failed",
      workspaceId: address.workspaceId,
    };
  }

  /** The assistant reply text: the returned turn message, else the last assistant on the transcript. */
  private replyText(message: { parts: readonly unknown[] } | null): string | null {
    const fromResult = message === null ? null : partsText(message.parts);
    if (fromResult !== null) {
      return fromResult;
    }
    for (const candidate of this.messages.toReversed()) {
      if (candidate.role !== "assistant") {
        continue;
      }
      const text = partsText(candidate.parts);
      if (text !== null) {
        return text;
      }
    }
    return null;
  }

  private readSession(id: CuratorSessionId): CuratorSession | null {
    const rows = this.sql<{ data: string }>`
      SELECT data FROM ts_curator_session WHERE id = ${idKey(id)}
    `;
    const [row] = rows;
    if (row === undefined) {
      return null;
    }
    const stored = parseJsonColumn<CuratorSession>(row.data);
    return { ...stored, startedAt: new Date(stored.startedAt) };
  }

  private putSession(session: CuratorSession): readonly unknown[] {
    return this.sql`
      INSERT INTO ts_curator_session (id, data)
      VALUES (${idKey(session.id)}, ${JSON.stringify(session)})
      ON CONFLICT (id) DO UPDATE SET data = excluded.data
    `;
  }

  /** ADR 0038 §2: the DO-scoped resolved curator model id survives hibernation (single row). */
  private readCuratorModel(): ModelId | null {
    const rows = this.sql<{ model_id: string }>`
      SELECT model_id FROM ts_curator_model WHERE id = 1
    `;
    const [row] = rows;
    return row === undefined ? null : modelIdSchema.parse(row.model_id);
  }

  private putCuratorModel(modelId: ModelId): readonly unknown[] {
    return this.sql`
      INSERT INTO ts_curator_model (id, model_id)
      VALUES (1, ${idKey(modelId)})
      ON CONFLICT (id) DO UPDATE SET model_id = excluded.model_id
    `;
  }
}

/** Join the text parts of a UIMessage/SessionMessage-shaped value; null if it carries no text. */
const partsText = (parts: readonly unknown[]): string | null => {
  const text = parts
    .map((part) =>
      typeof part === "object" &&
      part !== null &&
      "type" in part &&
      (part as { type: unknown }).type === "text" &&
      "text" in part &&
      typeof (part as { text: unknown }).text === "string"
        ? (part as { text: string }).text
        : ""
    )
    .join("");
  return text.length > 0 ? text : null;
};

/**
 * Compile-time proof the DO satisfies the seam. `context` is carried by the caller-side
 * wrapper (the directory pattern), not by the DO, which derives its address from its name.
 */
type SeamMethods = Omit<CuratorAgent, "context">;
type AssertSeam<T extends SeamMethods> = T;
export type CuratorAgentDurableObjectSatisfiesSeam =
  AssertSeam<CuratorAgentDurableObject>;

export interface ProductionCuratorAgentConfig {
  readonly context: TenantContext;
  readonly namespace: DurableObjectNamespace<CuratorAgentDurableObject>;
}

/**
 * ADR 0033: a pure thin adapter over the DO namespace — no storage, no failure modes, no
 * creation step; the first get materializes the member's curator DO. The wrapper caches its
 * stub promise so getAgentByName's setName round-trip is paid once, and addresses the DO by
 * the injective encoding of the caller's workspace/member context.
 */
export const createProductionCuratorAgent = (
  config: ProductionCuratorAgentConfig
): CuratorAgent => {
  let stubPromise: ReturnType<
    typeof getAgentByName<Cloudflare.Env, CuratorAgentDurableObject>
  > | null = null;
  const stub = () =>
    (stubPromise ??= getAgentByName(
      config.namespace,
      encodeCuratorAddress({
        memberId: config.context.memberId,
        workspaceId: config.context.workspaceId,
      })
    ));

  return {
    context: config.context,
    send: async (input) => {
      const agent = await stub();
      return agent.send(input);
    },
    startSession: async (input) => {
      const agent = await stub();
      return agent.startSession(input);
    },
  };
};
