import { Button } from "@thinkspace/ui/components/button";
import { Textarea } from "@thinkspace/ui/components/textarea";
import { SendHorizontal } from "lucide-react";
import { useState } from "react";

/**
 * The message composer. The member types a prompt and sends it; ⌘/Ctrl+Enter submits. Sending
 * is disabled on an empty/whitespace body or while a submit is in flight. The parent owns the
 * gesture (create-and-ask, or dispatch) and the optimistic reconciliation — the composer only
 * collects text and reports it, then clears on a successful submit.
 */
export const ThreadComposer = ({
  disabled = false,
  onSubmit,
  pending = false,
  placeholder,
  submitLabel = "Send",
}: {
  readonly disabled?: boolean;
  readonly onSubmit: (body: string) => void;
  readonly pending?: boolean;
  readonly placeholder?: string;
  readonly submitLabel?: string;
}) => {
  const [body, setBody] = useState("");
  const trimmed = body.trim();
  const canSubmit = trimmed.length > 0 && !pending && !disabled;

  const submit = () => {
    if (!canSubmit) {
      return;
    }
    onSubmit(trimmed);
    setBody("");
  };

  return (
    <form
      className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/15"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Textarea
        className="min-h-16 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
        disabled={disabled}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder ?? "Message the channel agent…"}
        value={body}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-xs">
          <kbd className="font-sans">⌘</kbd>
          <span aria-hidden="true"> + </span>
          <kbd className="font-sans">Enter</kbd> to send
        </span>
        <Button disabled={!canSubmit} size="sm" type="submit">
          <SendHorizontal className="size-4" />
          {pending ? "Sending…" : submitLabel}
        </Button>
      </div>
    </form>
  );
};
