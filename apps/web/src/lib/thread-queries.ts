import { queryOptions } from "@tanstack/react-query";

import { fetchBranch } from "./api";

/**
 * Thread-surface query keys (E7.4). The branch read (ADR 0025) is the thread's rendered state,
 * anchored at a root comment id. The channel hub pushes deltas that carry ids, not state, so
 * the surface reconciles by *invalidating* this query on every relevant event — the socket is
 * a nudge, the branch read is the truth. When the socket is down the query still converges on
 * its own poll (`refetchInterval`), so a run's output lands within a few seconds regardless.
 */
const BRANCH_POLL_MS = 5000;

export const threadKeys = {
  branch: (workspaceId: string, threadId: string, rootCommentId: string) =>
    [
      "workspace",
      workspaceId,
      "thread",
      threadId,
      "branch",
      rootCommentId,
    ] as const,
};

export const branchQuery = (
  workspaceId: string,
  input: {
    readonly channelId: string;
    readonly rootCommentId: string;
    readonly threadId: string;
  }
) =>
  queryOptions({
    queryFn: () => fetchBranch(workspaceId, input),
    queryKey: threadKeys.branch(
      workspaceId,
      input.threadId,
      input.rootCommentId
    ),
    refetchInterval: BRANCH_POLL_MS,
  });
