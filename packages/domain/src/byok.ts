import type { WorkspaceId } from "./ids";
import type { ModelProvider } from "./model";
import type { SecretAlias } from "./primitives";
import { secretAliasSchema } from "./primitives";

/**
 * The BYOK Secrets Store alias for a workspace's provider key. Format FROZEN by the E1.1 spike
 * (BACKLOG "E1.1 spike findings" §1): `ws-<workspaceId>-<provider>`, lowercase & hyphen-delimited.
 * The `cf-aig-byok-alias` header carries exactly this `{alias}` component. Kept a standalone pure
 * function; a pending KeyStore-port decision may later relocate it into an adapter unchanged.
 */
export const byokSecretAlias = (
  workspaceId: WorkspaceId,
  provider: ModelProvider
): SecretAlias => secretAliasSchema.parse(`ws-${workspaceId}-${provider}`);
