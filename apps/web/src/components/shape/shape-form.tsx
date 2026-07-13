import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button } from "@thinkspace/ui/components/button";
import { Label } from "@thinkspace/ui/components/label";
import { Textarea } from "@thinkspace/ui/components/textarea";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { ModelPicker } from "@/components/shape/model-picker";
import { ShapeSelectionSection } from "@/components/shape/shape-selection";
import type { ShapeStructure } from "@/lib/api";
import {
  artifactsQuery,
  mcpServersQuery,
  skillsQuery,
} from "@/lib/workspace-queries";

/**
 * The shape authoring body (E7.5) — config-as-data (ADR 0007) rendered as a form. It is the
 * single surface behind both channel creation (a shape is authored at birth, ADR 0030) and shape
 * edit; the parent owns the mutation and, for creation, the goal/visibility controls it passes in
 * `header`. The form authors every field the wire shape carries: the model (via the live picker),
 * the system prompt, and the skill / MCP-server / artifact selections (E10.5, over the pools that
 * already exist end-to-end since E8.2 — the ThreadAgent resolves the frozen selection per turn,
 * ADR 0037). Built-in tools (`toolSelection`) have no selectable catalog yet — the v1 first-party
 * catalog is frozen empty (ADR 0004 baked decision 7), so that axis stays an honest disabled note
 * and any existing value passes through untouched rather than being blanked on edit.
 */
export const ShapeForm = ({
  workspaceId,
  header,
  initialModelId,
  initialSystemPrompt,
  initialSkillSelection,
  initialMcpServerSelection,
  initialArtifactSelection,
  initialToolSelection,
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
  readonly initialSkillSelection?: readonly string[];
  readonly initialMcpServerSelection?: readonly string[];
  readonly initialArtifactSelection?: readonly string[];
  /** The shape's built-in-tool ids — no UI (empty catalog); passed through on submit unchanged. */
  readonly initialToolSelection?: readonly string[];
  readonly submitLabel: string;
  readonly pendingLabel: string;
  readonly pending: boolean;
  readonly errorMessage?: string | null;
  /** Parent-side reasons submit is blocked (e.g. an empty goal on the create form). */
  readonly extraDisabled?: boolean;
  readonly onSubmit: (structure: ShapeStructure) => void;
  readonly onCancel?: () => void;
}) => {
  const [modelId, setModelId] = useState<string | null>(initialModelId ?? null);
  const [systemPrompt, setSystemPrompt] = useState(initialSystemPrompt ?? "");
  const [skillSelection, setSkillSelection] = useState<readonly string[]>(
    initialSkillSelection ?? []
  );
  const [mcpServerSelection, setMcpServerSelection] = useState<
    readonly string[]
  >(initialMcpServerSelection ?? []);
  const [artifactSelection, setArtifactSelection] = useState<readonly string[]>(
    initialArtifactSelection ?? []
  );

  const skills = useQuery(skillsQuery(workspaceId));
  const mcpServers = useQuery(mcpServersQuery(workspaceId));
  const artifacts = useQuery(artifactsQuery(workspaceId));

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
          artifactSelection,
          mcpServerSelection,
          modelId,
          skillSelection,
          systemPrompt: systemPrompt.trim(),
          // No picker for built-in tools yet (empty catalog); preserve any existing value.
          toolSelection: initialToolSelection ?? [],
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

      <ShapeSelectionSection
        description="Markdown playbooks the agent can load per turn. Selected skills freeze into every thread's shape."
        disabled={pending}
        emptyState={
          <>
            No skills authored in this workspace yet — author one under{" "}
            <Link
              className="font-medium text-primary underline-offset-4 hover:underline"
              params={{ workspaceId }}
              to="/w/$workspaceId/settings/skills"
            >
              Skills
            </Link>
            .
          </>
        }
        itemId={(skill) => skill.id}
        itemLabel={(skill) => skill.name}
        label="Skills"
        onToggle={toggleId(setSkillSelection)}
        result={skills}
        selected={skillSelection}
      />

      <ShapeSelectionSection
        description="Registered MCP servers whose tools the agent may call. Only servers on an approved host connect at run time."
        disabled={pending}
        emptyState={
          <>
            No MCP servers registered in this workspace yet — register them
            under{" "}
            <Link
              className="font-medium text-primary underline-offset-4 hover:underline"
              params={{ workspaceId }}
              to="/w/$workspaceId/settings/mcp"
            >
              MCP servers
            </Link>{" "}
            before they can be selected here.
          </>
        }
        itemId={(server) => server.id}
        itemLabel={(server) => server.name}
        itemMeta={(server) => server.host}
        label="MCP servers"
        onToggle={toggleId(setMcpServerSelection)}
        result={mcpServers}
        selected={mcpServerSelection}
      />

      <ShapeSelectionSection
        description="Cross-channel artifacts the agent may read. The home channel's own artifacts are always in scope."
        disabled={pending}
        emptyState={
          <>
            No artifacts in this workspace yet — agent runs write them to the{" "}
            <Link
              className="font-medium text-primary underline-offset-4 hover:underline"
              params={{ workspaceId }}
              to="/w/$workspaceId/library"
            >
              Library
            </Link>
            .
          </>
        }
        itemId={(artifact) => artifact.id}
        itemLabel={(artifact) => artifact.name}
        label="Artifacts"
        onToggle={toggleId(setArtifactSelection)}
        result={artifacts}
        selected={artifactSelection}
      />

      <BuiltInToolsNote />

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

/** Add/remove an id in a selection array — the multi-select toggle shared by every section. */
const toggleId =
  (setter: React.Dispatch<React.SetStateAction<readonly string[]>>) =>
  (id: string) =>
    setter((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]
    );

/**
 * Built-in (first-party) tools are part of a shape (ADR 0007) but have no selectable catalog:
 * the v1 first-party catalog is frozen empty (ADR 0004 baked decision 7 — v1 tools are the ones
 * MCP servers provide, selected via the MCP section above). Rendered read-only so the axis is
 * honest — present, not hidden — without implying it is authorable today.
 */
const BuiltInToolsNote = () => (
  <div className="flex flex-col gap-2">
    <Label className="text-sm text-muted-foreground">Built-in tools</Label>
    <p className="flex items-start gap-1.5 text-muted-foreground text-xs leading-relaxed">
      <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>
        The channel agent&apos;s tools come from the MCP servers you select
        above. A first-party tool catalog is not part of v1.
      </span>
    </p>
  </div>
);
