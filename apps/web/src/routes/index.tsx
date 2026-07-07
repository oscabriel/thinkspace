import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { Button } from "@thinkspace/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@thinkspace/ui/components/empty";
import { Building2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";

/**
 * The entry point. A signed-in member with a workspace is routed straight into the shell
 * (`/w/$workspaceId`), landing on the recent-activity home (ADR 0020). Workspace selection
 * prefers the better-auth active org, falling back to the first org in the member's list. A
 * signed-in member with no workspace sees a teaching hand-off to onboarding (sibling #26 owns
 * workspace creation); a signed-out visitor is sent to sign-in.
 */
const Landing = () => (
  <div className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center gap-6 px-6">
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Building2 />
        </EmptyMedia>
        <EmptyTitle>No workspace yet</EmptyTitle>
        <EmptyDescription>
          A workspace is where your channels, agents, and threads live. Create
          one to get started — you will register a provider key and author your
          first channel there.
        </EmptyDescription>
      </EmptyHeader>
      <Link to="/login">
        <Button variant="outline">Back to sign in</Button>
      </Link>
    </Empty>
  </div>
);

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
  component: Landing,
  ssr: false,
});
