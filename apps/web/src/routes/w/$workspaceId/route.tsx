import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useParams,
} from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import { WorkspaceSidebar } from "@/components/shell/workspace-sidebar";
import UserMenu from "@/components/user-menu";
import { authClient } from "@/lib/auth-client";

/**
 * The authenticated workspace shell (E7.3): a Panel-tinted sidebar rail beside a Paper main
 * panel (DESIGN §1 two-layer neutral system). The route is `/w/$workspaceId/*` — the workspace
 * IS the better-auth organization, and its id lives in the path, matching the server's
 * path-resident tenant model (apps/server tenantContextMiddleware). Sibling wave-7 issues mount
 * their subtrees under this layout: threads (#28) under channels, shape form (#29), library
 * (#30). Membership is enforced server-side (a non-member's reads 404), so the shell trusts the
 * path and lets the child reads fail closed; it only best-effort aligns the better-auth active
 * org so later cookie-scoped surfaces (invitations, hub JWT) agree with the path.
 */
const WorkspaceShell = () => {
  const { workspaceId } = useParams({ from: "/w/$workspaceId" });
  const { data: organizations } = authClient.useListOrganizations();

  const workspaceName = useMemo(
    () =>
      organizations?.find((org) => org.id === workspaceId)?.name ?? "Workspace",
    [organizations, workspaceId]
  );

  useEffect(() => {
    authClient.organization.setActive({ organizationId: workspaceId });
  }, [workspaceId]);

  return (
    <div className="grid h-svh grid-cols-1 grid-rows-[auto_1fr] md:grid-cols-[16rem_1fr] md:grid-rows-1">
      <aside className="hidden min-h-0 border-border border-r bg-sidebar md:flex md:flex-col">
        <div className="flex h-12 shrink-0 items-center border-border border-b px-4">
          <Link
            className="truncate font-semibold text-sidebar-foreground text-sm tracking-tight"
            params={{ workspaceId }}
            to="/w/$workspaceId"
          >
            {workspaceName}
          </Link>
        </div>
        <div className="min-h-0 flex-1">
          <WorkspaceSidebar workspaceId={workspaceId} />
        </div>
      </aside>

      <div className="flex min-h-0 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-border border-b bg-background px-4">
          <span className="font-semibold text-foreground text-sm md:hidden">
            {workspaceName}
          </span>
          <span className="hidden md:block" />
          <UserMenu />
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto bg-background">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export const Route = createFileRoute("/w/$workspaceId")({
  beforeLoad: async () => {
    const session = await authClient.getSession();
    if (!session.data) {
      throw redirect({ to: "/login" });
    }
    return { session };
  },
  component: WorkspaceShell,
  ssr: false,
});
