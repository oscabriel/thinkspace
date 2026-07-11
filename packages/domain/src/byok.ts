import type { WorkspaceId } from "./ids";
import type { ModelProvider } from "./model";
import type { SecretAlias } from "./primitives";
import { secretAliasSchema } from "./primitives";

/**
 * The BYOK Secrets Store alias for a workspace's provider key. Format FROZEN by the E1.1 spike
 * (BACKLOG "E1.1 spike findings" §1): `ws-<workspaceId>-<provider>`, lowercase & hyphen-delimited.
 * The `cf-aig-byok-alias` header carries exactly this `{alias}` component. Kept a standalone pure
 * function; ADR 0040's KeyStore port made it the legacy `SecretsStoreKeyStore` adapter's concern
 * (the envelope default sends the decrypted key on the real auth header instead of this alias),
 * but the function stays here unchanged — both the legacy adapter and the alias fallback use it.
 */
export const byokSecretAlias = (
  workspaceId: WorkspaceId,
  provider: ModelProvider
): SecretAlias => secretAliasSchema.parse(`ws-${workspaceId}-${provider}`);
