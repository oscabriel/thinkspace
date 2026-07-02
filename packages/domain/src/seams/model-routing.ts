import type {
  ByokKeyMissingError,
  NotImplementedError,
  TenantGuardViolationError,
} from "../errors";
import type { ModelId, WorkspaceId } from "../ids";
import type { Model } from "../model";
import type { SecretAlias } from "../primitives";
import type { AsyncResult } from "../result";
import type { TenantContext } from "./tenant-data-access";

export type ModelRoutingError =
  | ByokKeyMissingError
  | NotImplementedError
  | TenantGuardViolationError;

export interface AiGatewayMetadata {
  readonly modelId: ModelId;
  readonly workspaceId: WorkspaceId;
}

export interface ModelRoute {
  readonly gatewayMetadata: AiGatewayMetadata;
  readonly model: Model;
  readonly secretAlias: SecretAlias;
}

export interface ModelRouteRequest {
  readonly modelId: ModelId;
}

/** BYOK-only model routing seam. Raw provider keys never cross this interface. */
export interface ModelRouter {
  readonly context: TenantContext;
  /** Only models whose provider the workspace has keyed (ADR 0011). */
  readonly listAvailableModels: () => AsyncResult<
    readonly Model[],
    ModelRoutingError
  >;
  readonly resolve: (
    input: ModelRouteRequest
  ) => AsyncResult<ModelRoute, ModelRoutingError>;
}
