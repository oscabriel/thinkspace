import type {
  ByokKeyMissingError,
  ByokKeyUndecryptableError,
  TenantGuardViolationError,
} from "../errors";
import type { ModelId } from "../ids";
import type { ModelProvider } from "../model";
import type { SecretAlias } from "../primitives";
import type { AsyncResult } from "../result";
import type { DataAccessContext } from "./tenant-data-access";

/**
 * ADR 0040: the BYOK key-storage port. Two adapters implement it — `EnvelopeD1KeyStore` (the
 * production default: AES-256-GCM ciphertext in D1, decrypted at the edge/DO, sent as the real
 * provider-auth header the AI Gateway forwards verbatim) and `SecretsStoreKeyStore` (the legacy
 * adapter: today's Cloudflare Secrets Store write path, resolved by the `cf-aig-byok-alias`
 * header the gateway substitutes). The port supersedes ADR 0011's key-storage half and dissolves
 * ADR 0036's 100-secret Secrets Store scale blocker.
 *
 * Redaction discipline (invariant): the raw key crosses `writeKey` exactly once and is returned by
 * `resolveProviderAuth` only as a transient `header` value; it never lands in a log, a thrown
 * error, a response body, or a D1 plaintext column.
 */

/**
 * The turn-time resolution of a workspace's provider auth. `alias` is the legacy Secrets Store
 * path — the gateway substitutes the stored secret by name; `header` carries the decrypted raw
 * key the gateway forwards verbatim (BYOK substitution suppressed, ADR 0038 addendum §2). The
 * envelope adapter yields `header` once a key is re-registered and falls back to `alias` for a
 * row that predates the migration (no ciphertext yet), so existing Secrets Store keys keep working.
 */
export interface ProviderAuthAlias {
  readonly alias: SecretAlias;
  readonly kind: "alias";
}
export interface ProviderAuthHeader {
  readonly kind: "header";
  /** The decrypted raw provider key — redaction-sensitive; lives only transiently in the caller. */
  readonly value: string;
}
export type ResolvedProviderAuth = ProviderAuthAlias | ProviderAuthHeader;

/**
 * A write/delete failure, structurally identical to the legacy `ByokRegistrationError` so the edge
 * write route maps it unchanged: `message` is composed only from the underlying dependency (a
 * Cloudflare error envelope, a `network error`, or a redaction-safe storage message), never the
 * request body or key.
 */
export interface KeyStoreWriteError {
  readonly kind: "byok_registration_failed";
  readonly message: string;
  readonly operation: "delete" | "write";
  readonly status: number;
}

/** Turn-time resolution failures — every one fails the run closed, exactly like today's byok gate. */
export type KeyResolveError =
  | ByokKeyMissingError
  | ByokKeyUndecryptableError
  | TenantGuardViolationError;

export interface ProviderAuthRequest {
  readonly modelId: ModelId;
}

/**
 * Context-bound like `ModelRouter`/`ProviderKeyRegistry`: every operation is scoped to
 * `context.workspaceId`. `writeKey`/`deleteKey` run at the edge under a `TenantContext`; the DO
 * resolves under a `SystemContext` on the turn hot path (ADR 0036 §1 self-construction).
 */
export interface KeyStore {
  readonly context: DataAccessContext;
  readonly deleteKey: (
    provider: ModelProvider
  ) => AsyncResult<undefined, KeyStoreWriteError>;
  readonly resolveProviderAuth: (
    input: ProviderAuthRequest
  ) => AsyncResult<ResolvedProviderAuth, KeyResolveError>;
  readonly writeKey: (
    provider: ModelProvider,
    rawKey: string
  ) => AsyncResult<undefined, KeyStoreWriteError>;
}
