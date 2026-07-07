import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Button } from "@thinkspace/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@thinkspace/ui/components/empty";
import { Input } from "@thinkspace/ui/components/input";
import { Label } from "@thinkspace/ui/components/label";
import { Building2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

/**
 * Onboarding is you (E7.2, ADR 0011 key-first). A signed-in visitor with no workspace lands here
 * and creates their first workspace — the workspace IS a better-auth organization
 * (authClient.organization.create), so this mints the org and routes into the shell at
 * /w/<orgId>. The next step of onboarding — registering a provider key so agents can run — lives
 * in the shell at Settings › Provider keys; the shell teaches that gap wherever an unkeyed agent
 * run is attempted. A signed-in visitor who already has a workspace never sees this component
 * (beforeLoad redirects into the shell); a signed-out visitor is sent to sign-in.
 */
const slugify = (name: string): string => {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  // A slug must be unique per better-auth org; a short random suffix avoids a collision with an
  // existing workspace of the same name without forcing the user to pick a slug.
  const suffix = crypto.randomUUID().slice(0, 6);
  return base.length > 0 ? `${base}-${suffix}` : `workspace-${suffix}`;
};

const CreateWorkspace = () => {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();

  const canSubmit = name.trim().length > 0 && !pending;

  const create = async () => {
    setPending(true);
    const result = await authClient.organization.create({
      name: name.trim(),
      slug: slugify(name),
    });
    if (result.error || !result.data) {
      setPending(false);
      toast.error(
        result.error?.message ?? "Could not create workspace. Please try again."
      );
      return;
    }
    // Align the better-auth active org with the workspace we are about to enter so later
    // cookie-scoped surfaces (hub JWT, invitations) agree with the path.
    await authClient.organization.setActive({ organizationId: result.data.id });
    toast.success("Workspace created");
    navigate({
      params: { workspaceId: result.data.id },
      to: "/w/$workspaceId",
    });
  };

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center gap-6 px-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Building2 />
          </EmptyMedia>
          <EmptyTitle>Create your workspace</EmptyTitle>
          <EmptyDescription>
            A workspace is where your channels, agents, and threads live. Name it
            to get started — you will register a provider key and author your
            first channel inside.
          </EmptyDescription>
        </EmptyHeader>
        <form
          className="flex w-full max-w-sm flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) {
              void create();
            }
          }}
        >
          <div className="flex flex-col gap-1.5 text-left">
            <Label htmlFor="workspace-name">Workspace name</Label>
            <Input
              autoFocus
              id="workspace-name"
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Acme Research"
              value={name}
            />
          </div>
          <Button disabled={!canSubmit} type="submit">
            {pending ? "Creating…" : "Create workspace"}
          </Button>
        </form>
      </Empty>
    </div>
  );
};

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({ to: "/login" });
    }
    const organizations = await authClient.organization.list();
    const target =
      session.data.session.activeOrganizationId ??
      organizations.data?.[0]?.id ??
      null;
    if (target) {
      throw redirect({
        params: { workspaceId: target },
        to: "/w/$workspaceId",
      });
    }
  },
  component: CreateWorkspace,
  ssr: false,
});
