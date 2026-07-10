import { createNotImplementedError } from "../../errors";
import type { CuratorSessionId } from "../../ids";
import { curatorSessionIdSchema } from "../../ids";
import type { CuratorPrompt, CuratorReply } from "../../primitives";
import { err, ok } from "../../result";
import type {
  CuratorAgent,
  CuratorDraft,
  CuratorSession,
} from "../../seams/curator-agent";
import type { TenantContext } from "../../seams/tenant-data-access";
import { hasSameId, idKey } from "./helpers";

export interface MemoryCuratorScriptedTurn {
  readonly draft: CuratorDraft | null;
  readonly prompt: CuratorPrompt;
  readonly reply: CuratorReply;
}

export interface MemoryCuratorAgentConfig {
  readonly clock?: () => Date;
  readonly context: TenantContext;
  readonly defaultReply?: CuratorReply;
  readonly nextSessionId?: () => CuratorSessionId;
  readonly scriptedTurns?: readonly MemoryCuratorScriptedTurn[];
}

export const createMemoryCuratorAgent = (
  config: MemoryCuratorAgentConfig
): CuratorAgent => {
  const clock = config.clock ?? (() => new Date());
  let sessionCounter = 0;
  const nextSessionId =
    config.nextSessionId ??
    (() => {
      sessionCounter += 1;
      return curatorSessionIdSchema.parse(
        `memory-curator-session-${sessionCounter}`
      );
    });
  const sessions = new Map<string, CuratorSession>();

  return {
    context: config.context,
    send: async (input) => {
      const session = sessions.get(idKey(input.sessionId));
      if (session === undefined) {
        return err({
          kind: "curator_session_not_found" as const,
          sessionId: input.sessionId,
          workspaceId: config.context.workspaceId,
        });
      }

      const scripted = (config.scriptedTurns ?? []).find((turn) =>
        hasSameId(turn.prompt, input.message)
      );

      if (scripted !== undefined) {
        return ok({
          draft: scripted.draft,
          reply: scripted.reply,
          sessionId: session.id,
        });
      }

      return config.defaultReply === undefined
        ? err(createNotImplementedError("MemoryCuratorAgent.send"))
        : ok({
            draft: null,
            reply: config.defaultReply,
            sessionId: session.id,
          });
    },
    // ADR 0038 §2: the resolved modelId is a DO-persistence concern (getModel self-construction);
    // the in-memory adapter has no model layer, so it accepts and ignores it — the seam signature
    // is what the contract suite pins here.
    startSession: async (_input) => {
      const session: CuratorSession = {
        id: nextSessionId(),
        memberId: config.context.memberId,
        startedAt: clock(),
        workspaceId: config.context.workspaceId,
      };

      sessions.set(idKey(session.id), session);
      return ok(session);
    },
  };
};
