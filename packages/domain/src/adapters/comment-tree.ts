import type { Comment } from "../thread";
import { hasSameId, idKey } from "./helpers";

/** ADR 0025: the ancestor path of the branch root, oldest first. */
export const ancestorComments = (
  comments: ReadonlyMap<string, Comment>,
  rootCommentId: Comment["id"]
): readonly Comment[] => {
  const root = comments.get(idKey(rootCommentId));
  if (root === undefined) {
    return [];
  }

  const ancestors: Comment[] = [];
  let current = root;
  while (current.parent.kind === "nested") {
    const parent = comments.get(idKey(current.parent.parentCommentId));
    if (parent === undefined) {
      break;
    }

    ancestors.unshift(parent);
    current = parent;
  }

  return ancestors;
};

/** ADR 0025: the subtree rooted at the branch root, root first. */
export const branchComments = (
  comments: ReadonlyMap<string, Comment>,
  rootCommentId: Comment["id"]
): readonly Comment[] => {
  const root = comments.get(idKey(rootCommentId));
  if (root === undefined) {
    return [];
  }

  const collected: Comment[] = [];
  const visit = (comment: Comment): void => {
    collected.push(comment);

    for (const candidate of comments.values()) {
      if (
        candidate.parent.kind === "nested" &&
        hasSameId(candidate.parent.parentCommentId, comment.id)
      ) {
        visit(candidate);
      }
    }
  };

  visit(root);
  return collected;
};
