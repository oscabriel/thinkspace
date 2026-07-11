import { Bubble, BubbleContent } from "@thinkspace/ui/components/bubble";
import {
  Message,
  MessageContent,
  MessageHeader,
} from "@thinkspace/ui/components/message";

import type { Comment } from "@/lib/api";
import { relativeTime } from "@/lib/format";

/**
 * One comment in the branch tree (ADR 0025). Member comments align end (the reader's own
 * side), the channel agent aligns start with an attributed header — "agents propose, people
 * decide" reads as a distinct, labeled voice, never mistaken for the member (DESIGN §5).
 * Nested comments indent by depth so the branch shape is legible. Bodies are plain text with
 * whitespace preserved; the MVP renders no markdown.
 */
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
  depth = 0,
  pending = false,
}: {
  readonly comment: Comment;
  readonly depth?: number;
  readonly pending?: boolean;
}) => {
  const isMember = comment.author.kind === "member";
  const align = isMember ? "end" : "start";

  return (
    <div style={{ paddingInlineStart: `${Math.min(depth, 6) * 1.25}rem` }}>
      <Message align={align}>
        <MessageContent>
          <MessageHeader>
            <span>{authorLabel(comment.author)}</span>
            <span aria-hidden="true" className="px-1.5">
              ·
            </span>
            <span>
              {pending ? "sending…" : relativeTime(comment.createdAt)}
            </span>
          </MessageHeader>
          <Bubble align={align} variant={isMember ? "default" : "muted"}>
            <BubbleContent className="whitespace-pre-wrap text-[0.9375rem] leading-[1.6]">
              {comment.body}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </div>
  );
};
