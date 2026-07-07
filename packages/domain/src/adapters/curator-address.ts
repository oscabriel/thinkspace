import { memberIdSchema, workspaceIdSchema } from "../ids";
import type { MemberId, WorkspaceId } from "../ids";

/**
 * ADR 0026 §"DO-per-member" (sdk-signature-verification.md §1): the curator is one Think DO
 * per member+workspace, so the address it verifies against is the workspace/member pair.
 * `CuratorSessionId` maps to session state *inside* that DO, never to the DO name.
 */
export interface CuratorAddress {
  readonly memberId: MemberId;
  readonly workspaceId: WorkspaceId;
}

/**
 * ADR 0033's addressing pattern with curator segments: the DO name IS the address. Per-segment
 * encodeURIComponent makes the "/"-join injective (an encoded segment can never contain "/")
 * and the name URL-safe. Both a forged and a colliding member id in another workspace resolve
 * to a different DO by construction.
 */
export const encodeCuratorAddress = (address: CuratorAddress): string =>
  [address.workspaceId, address.memberId].map(encodeURIComponent).join("/");

/**
 * Returns null for anything that is not the canonical encoding of an address — wrong segment
 * count, malformed escapes, empty ids, or a non-canonical spelling (fail-closed: a forged or
 * bad-route DO name must never decode into an identity).
 */
export const decodeCuratorAddress = (name: string): CuratorAddress | null => {
  const segments = name.split("/");
  if (segments.length !== 2) {
    return null;
  }

  let decoded: readonly string[];
  try {
    decoded = segments.map(decodeURIComponent);
  } catch {
    return null;
  }

  const [workspaceId, memberId] = decoded;
  if (!workspaceId || !memberId) {
    return null;
  }

  const address: CuratorAddress = {
    memberId: memberIdSchema.parse(memberId),
    workspaceId: workspaceIdSchema.parse(workspaceId),
  };

  return encodeCuratorAddress(address) === name ? address : null;
};
