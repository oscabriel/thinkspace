/**
 * A thread's *root comment id* is the anchor the branch read (ADR 0025) needs to render the
 * whole thread — but the MVP read surface exposes no map from `threadId` → opening comment id
 * (the thread index carries no comment ids, and the ThreadAgent seam only serves
 * `loadBranch(rootCommentId)`). Recorded gap. The client learns the root only when it *mints*
 * it — at create-and-ask. This cache remembers those mappings so navigating from the feed to a
 * thread started in this browser opens its full history; a thread created elsewhere (another
 * device/session) falls back to the teaching empty state until a threadId→root read exists.
 */

const memory = new Map<string, string>();
const STORAGE_KEY = "thinkspace.threadRoots.v1";

const load = (): void => {
  if (memory.size > 0 || typeof localStorage === "undefined") {
    return;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      for (const [threadId, root] of Object.entries(
        JSON.parse(raw) as Record<string, string>
      )) {
        memory.set(threadId, root);
      }
    }
  } catch {
    // A corrupt/absent store is simply an empty cache.
  }
};

const persist = (): void => {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries(memory))
    );
  } catch {
    // Best-effort — a full/blocked store just loses the durable half of the cache.
  }
};

export const rememberThreadRoot = (
  threadId: string,
  rootCommentId: string
): void => {
  load();
  memory.set(threadId, rootCommentId);
  persist();
};

export const recallThreadRoot = (threadId: string): string | undefined => {
  load();
  return memory.get(threadId);
};
