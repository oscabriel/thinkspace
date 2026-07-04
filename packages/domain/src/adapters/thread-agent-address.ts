import { channelIdSchema, threadIdSchema, workspaceIdSchema } from "../ids";
import type { ThreadAgentAddress } from "../seams/thread-agent";

/**
 * ADR 0033: the DO name IS the address. Per-segment encodeURIComponent makes the
 * "/"-join injective (an encoded segment can never contain "/") and the name URL-safe.
 * Both directories (memory and production) key agents through this codec.
 */
export const encodeThreadAgentAddress = (address: ThreadAgentAddress): string =>
  [address.workspaceId, address.channelId, address.threadId]
    .map(encodeURIComponent)
    .join("/");

/**
 * Returns null for anything that is not the canonical encoding of an address —
 * wrong segment count, malformed escapes, empty ids, or a non-canonical spelling
 * (fail-closed: a forged or bad-route DO name must never decode into an identity).
 */
export const decodeThreadAgentAddress = (
  name: string
): ThreadAgentAddress | null => {
  const segments = name.split("/");
  if (segments.length !== 3) {
    return null;
  }

  let decoded: readonly string[];
  try {
    decoded = segments.map(decodeURIComponent);
  } catch {
    return null;
  }

  const [workspaceId, channelId, threadId] = decoded;
  if (!workspaceId || !channelId || !threadId) {
    return null;
  }

  const address: ThreadAgentAddress = {
    channelId: channelIdSchema.parse(channelId),
    threadId: threadIdSchema.parse(threadId),
    workspaceId: workspaceIdSchema.parse(workspaceId),
  };

  return encodeThreadAgentAddress(address) === name ? address : null;
};
