import type { DomainError } from "@thinkspace/domain/errors";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * ADR 0035 §7: the one shared domain-error → HTTP status translation.
 * channel_not_visible is 404, not 403 — invisibility-as-nonexistence: a status
 * that confirmed the channel exists would leak it to a non-member.
 */
export const domainErrorStatus = (error: DomainError): ContentfulStatusCode => {
  switch (error.kind) {
    case "channel_not_visible": {
      return 404;
    }
    case "unauthenticated": {
      return 401;
    }
    case "channel_deleted":
    case "channel_read_only":
    case "insufficient_role":
    case "not_workspace_member": {
      return 403;
    }
    default: {
      return 500;
    }
  }
};
