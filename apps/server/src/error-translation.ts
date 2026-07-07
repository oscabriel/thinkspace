import type { DomainError } from "@thinkspace/domain/errors";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * ADR 0035 §7: the one shared domain-error → HTTP status translation.
 * channel_not_visible is 404, not 403 — invisibility-as-nonexistence: a status
 * that confirmed the channel exists would leak it to a non-member.
 */
export const domainErrorStatus = (error: DomainError): ContentfulStatusCode => {
  switch (error.kind) {
    case "channel_not_visible":
    case "tenant_guard_violation": {
      /**
       * ADR 0035 §7: invisibility-as-nonexistence outranks the original "rest → 500"
       * row. A cross-tenant channel-id probe trips the domain tenant guard
       * (`tenant_guard_violation`); surfacing it as 500 would distinguish a
       * foreign-but-real channel from an invisible 404 and confirm its existence to a
       * non-holder. Both collapse to 404 so a probe learns nothing. The domain guard
       * still throws — only this edge translation changes.
       */
      return 404;
    }
    case "unauthenticated": {
      return 401;
    }
    case "channel_not_archived": {
      /**
       * ADR 0018 archive-first: hard-deleting a still-active channel is a lifecycle
       * conflict with the channel's current state, not an auth failure — 409, matching
       * the model-config conflicts below.
       */
      return 409;
    }
    case "byok_key_missing":
    case "model_not_in_catalog": {
      /**
       * ADR 0035 §7: a workspace asked for a model it cannot use — either no BYOK
       * key is registered for the provider, or the model is absent from the live
       * catalog. Both are conflicts with the workspace's current configuration, not
       * server faults, so 409 rather than 4xx-auth or 5xx.
       */
      return 409;
    }
    case "catalog_unavailable": {
      /** The upstream model catalog could not be assembled — transient, retryable. */
      return 503;
    }
    case "channel_deleted":
    case "channel_read_only":
    case "insufficient_role":
    case "mcp_host_not_allowed":
    case "not_workspace_member": {
      return 403;
    }
    default: {
      return 500;
    }
  }
};
