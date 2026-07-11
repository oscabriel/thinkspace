import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { Button } from "@thinkspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@thinkspace/ui/components/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@thinkspace/ui/components/empty";
import { Input } from "@thinkspace/ui/components/input";
import { Label } from "@thinkspace/ui/components/label";
import { Skeleton } from "@thinkspace/ui/components/skeleton";
import { Textarea } from "@thinkspace/ui/components/textarea";
import { Plus, ScrollText, TriangleAlert, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { ApiRequestError, createSkill, updateSkill } from "@/lib/api";
import type { SkillContent, WorkspaceSkill } from "@/lib/api";
import {
  skillQuery,
  skillsQuery,
  workspaceKeys,
} from "@/lib/workspace-queries";

/**
 * E11.2 skills settings — the web author surface for the R2-markdown skill registry that was
 * API-only through E8.2 (apps/server/src/skills.ts, ADR 0029). Copies the E7.2 providers pattern
 * (flat route, ssr:false, no client role gate): reads are member-visible, writes are owner/admin
 * only and a member's write surfaces the 403 `insufficient_role` as a teaching toast rather than a
 * dead form. There is deliberately NO delete — a channel's frozen shape may still reference a skill
 * (the SkillStore seam has no delete), so the surface teaches that constraint inline instead of
 * hiding it. Markdown is authored in a plain Textarea (no preview renderer in v1; ratified).
 */

const formatUpdatedAt = (iso: string): string => {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? "recently"
    : parsed.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
};

/**
 * A client-only default name for an imported `.md`: the file's own frontmatter `name` when the
 * document opens with a `--- … ---` block that carries one, else the filename with its markdown
 * extension stripped. No server round-trip — the import reuses POST /skills.
 */
const parseFrontmatterName = (markdown: string): string | null => {
  const block = markdown.match(/^---\n(?<body>[\s\S]*?)\n---/u);
  if (!block?.groups) {
    return null;
  }
  const nameLine = block.groups.body
    .split("\n")
    .find((line) => /^name:\s*/u.test(line));
  if (!nameLine) {
    return null;
  }
  const value = nameLine
    .replace(/^name:\s*/u, "")
    .trim()
    .replaceAll(/^["']|["']$/gu, "");
  return value.length > 0 ? value : null;
};

const defaultNameFromFile = (fileName: string): string =>
  fileName.replace(/\.(?<ext>md|markdown)$/iu, "");

/** Loading/error/insufficient-role toast, shared by the create and edit mutations. */
const errorToast = (
  error: unknown,
  memberMessage: string,
  fallback: string
) => {
  const kind = error instanceof ApiRequestError ? error.kind : "unknown_error";
  toast.error(
    kind === "insufficient_role" ? memberMessage : `${fallback}: ${kind}`
  );
};

type View =
  | { readonly kind: "list" }
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly skill: WorkspaceSkill };

const SkillList = ({
  skills,
  onCreate,
  onEdit,
}: {
  readonly skills: readonly WorkspaceSkill[];
  readonly onCreate: () => void;
  readonly onEdit: (skill: WorkspaceSkill) => void;
}) => (
  <div className="flex flex-col gap-4">
    <div className="flex justify-end">
      <Button onClick={onCreate} size="sm" type="button">
        <Plus aria-hidden="true" className="size-4" />
        New skill
      </Button>
    </div>

    {skills.length === 0 ? (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ScrollText />
          </EmptyMedia>
          <EmptyTitle>No skills yet</EmptyTitle>
          <EmptyDescription>
            Author a markdown playbook an agent can pull in — a house style, a
            review checklist, a domain primer.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    ) : (
      <div className="flex flex-col gap-4">
        {skills.map((skill) => (
          <Card key={skill.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ScrollText aria-hidden="true" className="size-4 opacity-80" />
                {skill.name}
              </CardTitle>
              <CardDescription>
                Updated {formatUpdatedAt(skill.updatedAt)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex justify-end">
                <Button
                  onClick={() => onEdit(skill)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Edit
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )}
  </div>
);

const SkillCreateForm = ({
  workspaceId,
  onDone,
}: {
  readonly workspaceId: string;
  readonly onDone: () => void;
}) => {
  const [name, setName] = useState("");
  const [markdown, setMarkdown] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: () =>
      createSkill(workspaceId, {
        markdown: markdown.trim(),
        name: name.trim(),
      }),
    onError: (error) =>
      errorToast(
        error,
        "Only an owner or admin can create a skill.",
        "Could not create skill"
      ),
    onSuccess: (content) => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.skills(workspaceId),
      });
      toast.success(`Skill “${content.skill.name}” created`);
      onDone();
    },
  });

  const onFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Reset so re-selecting the same file re-fires change.
    input.value = "";
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      setMarkdown(text);
      const derived =
        parseFrontmatterName(text) ?? defaultNameFromFile(file.name);
      setName((prev) => (prev.trim().length > 0 ? prev : derived));
    } catch {
      toast.error("Could not read that file.");
    }
  };

  const canSubmit =
    name.trim().length > 0 && markdown.trim().length > 0 && !create.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>New skill</CardTitle>
        <CardDescription>
          Give it a name and write the markdown playbook, or import a local{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">.md</code>{" "}
          file.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) {
              create.mutate();
            }
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="skill-name">Name</Label>
            <Input
              autoComplete="off"
              id="skill-name"
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. ADR consistency reviewer"
              value={name}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="skill-markdown">Markdown</Label>
              <Button
                onClick={() => fileInputRef.current?.click()}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Upload aria-hidden="true" className="size-4" />
                Import .md
              </Button>
              <input
                accept=".md,.markdown,text/markdown"
                className="hidden"
                onChange={onFileSelected}
                ref={fileInputRef}
                type="file"
              />
            </div>
            <Textarea
              className="min-h-48 text-sm"
              id="skill-markdown"
              onChange={(event) => setMarkdown(event.target.value)}
              placeholder="# When reviewing ADRs&#10;&#10;Cross-reference every decision against the ones it supersedes and flag conflicts."
              value={markdown}
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button onClick={onDone} type="button" variant="ghost">
              Cancel
            </Button>
            <Button disabled={!canSubmit} type="submit">
              {create.isPending ? "Creating…" : "Create skill"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

const SkillEditForm = ({
  workspaceId,
  skillId,
  content,
  onDone,
}: {
  readonly workspaceId: string;
  readonly skillId: string;
  readonly content: SkillContent;
  readonly onDone: () => void;
}) => {
  const [markdown, setMarkdown] = useState(content.markdown);
  const queryClient = useQueryClient();

  const update = useMutation({
    mutationFn: () =>
      updateSkill(workspaceId, skillId, { markdown: markdown.trim() }),
    onError: (error) =>
      errorToast(
        error,
        "Only an owner or admin can edit a skill.",
        "Could not save skill"
      ),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.skills(workspaceId),
      });
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.skill(workspaceId, skillId),
      });
      toast.success(`Skill “${saved.skill.name}” saved`);
      onDone();
    },
  });

  const canSubmit = markdown.trim().length > 0 && !update.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText aria-hidden="true" className="size-4 opacity-80" />
          {content.skill.name}
        </CardTitle>
        <CardDescription>
          Re-author the markdown. The name is fixed once a skill is created.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) {
              update.mutate();
            }
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="skill-edit-markdown">Markdown</Label>
            <Textarea
              className="min-h-48 text-sm"
              id="skill-edit-markdown"
              onChange={(event) => setMarkdown(event.target.value)}
              value={markdown}
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button onClick={onDone} type="button" variant="ghost">
              Cancel
            </Button>
            <Button disabled={!canSubmit} type="submit">
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

const SkillEditPanel = ({
  workspaceId,
  skill,
  onDone,
}: {
  readonly workspaceId: string;
  readonly skill: WorkspaceSkill;
  readonly onDone: () => void;
}) => {
  const content = useQuery(skillQuery(workspaceId, skill.id));

  if (content.isPending) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  if (content.isError) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlert />
          </EmptyMedia>
          <EmptyTitle>Could not load this skill</EmptyTitle>
          <EmptyDescription>
            This is usually transient — try again in a moment (
            {content.error instanceof ApiRequestError
              ? content.error.kind
              : "unknown_error"}
            ).
          </EmptyDescription>
        </EmptyHeader>
        <div className="flex justify-center pb-4">
          <Button onClick={onDone} size="sm" type="button" variant="outline">
            Back to skills
          </Button>
        </div>
      </Empty>
    );
  }

  return (
    <SkillEditForm
      content={content.data}
      onDone={onDone}
      skillId={skill.id}
      workspaceId={workspaceId}
    />
  );
};

const SkillsSettings = () => {
  const { workspaceId } = useParams({
    from: "/w/$workspaceId/settings/skills",
  });
  const skills = useQuery(skillsQuery(workspaceId));
  const [view, setView] = useState<View>({ kind: "list" });

  const backToList = () => setView({ kind: "list" });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-semibold text-foreground text-xl tracking-tight">
          Skills
        </h1>
        <p className="text-muted-foreground text-sm">
          A skill is a reusable markdown playbook a channel agent can load per
          turn. Author them here, then select them when you shape a channel.
        </p>
      </header>

      <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        Skills can&apos;t be deleted yet — a channel&apos;s shape may still
        reference one. Editing re-authors the markdown in place. Only a
        workspace owner or admin can create or edit skills.
      </p>

      {view.kind === "create" && (
        <SkillCreateForm onDone={backToList} workspaceId={workspaceId} />
      )}

      {view.kind === "edit" && (
        <SkillEditPanel
          onDone={backToList}
          skill={view.skill}
          workspaceId={workspaceId}
        />
      )}

      {view.kind === "list" &&
        (skills.isPending ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : (skills.isError ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TriangleAlert />
              </EmptyMedia>
              <EmptyTitle>Could not load skills</EmptyTitle>
              <EmptyDescription>
                This is usually transient — try again in a moment (
                {skills.error instanceof ApiRequestError
                  ? skills.error.kind
                  : "unknown_error"}
                ).
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <SkillList
            onCreate={() => setView({ kind: "create" })}
            onEdit={(skill) => setView({ kind: "edit", skill })}
            skills={skills.data}
          />
        )))}
    </div>
  );
};

export const Route = createFileRoute("/w/$workspaceId/settings/skills")({
  component: SkillsSettings,
  ssr: false,
});
