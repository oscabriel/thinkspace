import type { Comment } from "@/lib/api";
import { relativeTime } from "@/lib/format";

import { PostContent } from "./post-content";

const authorLabel = (author: Comment["author"]): string => {
  if (author.kind === "member") {
    // `||` (not `??`) so an empty display name — better-auth does not forbid one — falls back
    // instead of rendering blank, matching memberLabel's convention on the other surfaces.
    return author.displayName || "Member";
  }
  return author.facet.kind === "sub_agent"
    ? author.facet.name
    : "Channel agent";
};

export const CommentItem = ({
  comment,
  isRoot = false,
  nested = false,
  pending = false,
}: {
  readonly comment: Comment;
  readonly isRoot?: boolean;
  readonly nested?: boolean;
  readonly pending?: boolean;
}) => {
  const label = authorLabel(comment.author);

  return (
    <article
      className={
        isRoot
          ? "border-border border-b pb-8"
          : nested
            ? "ms-8 border-border border-s ps-4"
            : undefined
      }
    >
      <PostContent
        avatarLabel={label}
        header={
          <>
            <span className="font-medium text-foreground">{label}</span>
            <span aria-hidden="true">·</span>
            <span>
              {pending ? "sending…" : relativeTime(comment.createdAt)}
            </span>
          </>
        }
      >
        <p className="max-w-[70ch] whitespace-pre-wrap text-[0.9375rem] text-foreground leading-[1.6]">
          {comment.body}
        </p>
      </PostContent>
    </article>
  );
};
