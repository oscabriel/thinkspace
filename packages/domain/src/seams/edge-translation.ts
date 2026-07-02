import type { DomainError } from "../errors";

export type EdgeKind =
  | "durable_object_rpc"
  | "http"
  | "mcp_egress"
  | "model_gateway"
  | "scheduler";

export interface EdgeErrorTranslation<TranslatedError> {
  readonly domainError: DomainError;
  readonly edge: EdgeKind;
  readonly translatedError: TranslatedError;
}

/** Edge adapters translate typed domain failures into transport-specific errors at the edge only. */
export interface EdgeErrorTranslator<TranslatedError> {
  readonly translate: (
    error: DomainError
  ) => EdgeErrorTranslation<TranslatedError>;
}
