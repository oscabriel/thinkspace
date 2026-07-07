import { Button } from "@thinkspace/ui/components/button";
import { Label } from "@thinkspace/ui/components/label";
import { Textarea } from "@thinkspace/ui/components/textarea";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import type { ShapeStructure } from "@/lib/api";
import { ModelPicker } from "@/components/shape/model-picker";

/**
 * The shape authoring body (E7.5) — config-as-data (ADR 0007) rendered as a form. It is the
 * single surface behind both channel creation (a shape is authored at birth, ADR 0030) and shape
 * edit; the parent owns the mutation and, for creation, the goal/visibility controls it passes in
 * `header`. The form owns exactly the shape's two authored fields v1 ships: the model (via the
 * live picker) and the system prompt. Tool / skill / MCP / artifact selections are part of the
 * wire shape but have no authoring UI yet (scope guard) — they submit as empty arrays and render
 * as an explicit read-only "coming soon" section so the omission is honest, not hidden.
 */
export const ShapeForm = ({
  workspaceId,
  header,
  initialModelId,
  initialSystemPrompt,
  submitLabel,
  pendingLabel,
  pending,
  errorMessage,
  extraDisabled,
  onSubmit,
  onCancel,
}: {
  readonly workspaceId: string;
  /** Parent-owned controls above the shape (create: goal + visibility; edit: goal readonly). */
  readonly header?: ReactNode;
  readonly initialModelId?: string | null;
  readonly initialSystemPrompt?: string;
  readonly submitLabel: string;
  readonly pendingLabel: string;
  readonly pending: boolean;
  readonly errorMessage?: string | null;
  /** Parent-side reasons submit is blocked (e.g. an empty goal on the create form). */
  readonly extraDisabled?: boolean;
  readonly onSubmit: (structure: ShapeStructure) => void;
  readonly onCancel?: () => void;
}) => {
  const [modelId, setModelId] = useState<string | null>(
    initialModelId ?? null
  );
  const [systemPrompt, setSystemPrompt] = useState(initialSystemPrompt ?? "");

  const canSubmit =
    modelId !== null &&
    systemPrompt.trim().length > 0 &&
    !pending &&
    !extraDisabled;

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSubmit || modelId === null) {
          return;
        }
        onSubmit({
          artifactSelection: [],
          mcpServerSelection: [],
          modelId,
          skillSelection: [],
          systemPrompt: systemPrompt.trim(),
          toolSelection: [],
        });
      }}
    >
      {header}

      <div className="flex flex-col gap-2">
        <Label className="text-sm">Model</Label>
        <p className="text-muted-foreground text-xs">
          The model the channel&apos;s agent runs on. Only models whose provider
          you have keyed appear here.
        </p>
        <ModelPicker
          disabled={pending}
          onChange={setModelId}
          value={modelId}
          workspaceId={workspaceId}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-sm" htmlFor="shape-system-prompt">
          System prompt
        </Label>
        <p className="text-muted-foreground text-xs">
          The standing instructions the agent carries into every thread in this
          channel.
        </p>
        <Textarea
          className="min-h-28 text-sm"
          disabled={pending}
          id="shape-system-prompt"
          onChange={(event) => setSystemPrompt(event.target.value)}
          placeholder="e.g. You keep our ADRs internally consistent. When asked, cross-reference decisions and flag conflicts."
          value={systemPrompt}
        />
      </div>

      <ComingSoonSection />

      {errorMessage && (
        <p className="text-destructive text-sm" role="alert">
          {errorMessage}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <Button onClick={onCancel} type="button" variant="ghost">
            Cancel
          </Button>
        )}
        <Button disabled={!canSubmit} type="submit">
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
};

/**
 * Tools, skills, MCP servers, and cross-channel artifacts are part of a shape (ADR 0007) but
 * have no picker yet. Rendered read-only so the member sees what the shape will grow to hold —
 * teaching the surface rather than hiding it — without implying it is authorable today.
 */
const ComingSoonSection = () => (
  <div className="flex flex-col gap-2 rounded-xl border border-border border-dashed bg-muted/30 p-3">
    <div className="flex items-center gap-2 text-muted-foreground text-xs">
      <Lock aria-hidden="true" className="size-3.5" />
      <span className="font-medium">Coming soon</span>
    </div>
    <p className="text-muted-foreground text-xs leading-relaxed">
      Tools, skills, MCP servers, and shared artifacts will be selectable here.
      For now every channel starts with none — the model and system prompt define
      the agent.
    </p>
  </div>
);
