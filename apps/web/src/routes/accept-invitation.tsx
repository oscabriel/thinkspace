import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { Button } from "@thinkspace/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@thinkspace/ui/components/empty";
import { Check, MailWarning } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";

import { authClient } from "@/lib/auth-client";

type InvitationState =
  | { status: "accepting" }
  | { status: "error"; message: string; workspaceId?: string }
  | { status: "success"; workspaceId: string };

const AcceptInvitation = () => {
  const { id } = Route.useSearch();
  const navigate = useNavigate();
  const [state, setState] = useState<InvitationState>({ status: "accepting" });

  useEffect(() => {
    if (!id) {
      setState({
        message: "This invitation link is incomplete. Ask the workspace owner for a new invitation.",
        status: "error",
      });
      return;
    }

    const accept = async () => {
      const result = await authClient.organization.acceptInvitation({
        invitationId: id,
      });
      if (result.data) {
        const workspaceId = result.data.invitation.organizationId;
        await authClient.organization.setActive({ organizationId: workspaceId });
        setState({ status: "success", workspaceId });
        navigate({ params: { workspaceId }, to: "/w/$workspaceId" });
        return;
      }

      const message = result.error?.message?.toLowerCase() ?? "";
      if (message.includes("already") || message.includes("accepted")) {
        const organizations = await authClient.organization.list();
        const workspaceId = organizations.data?.[0]?.id;
        setState({
          message: "This invitation has already been accepted. You can continue to your workspace.",
          status: "error",
          workspaceId,
        });
        return;
      }

      setState({
        message: "This invitation is invalid or has expired. Ask the workspace owner for a new invitation.",
        status: "error",
      });
    };

    void accept();
  }, [id, navigate]);

  if (state.status === "success") {
    return null;
  }

  const accepting = state.status === "accepting";
  return (
    <div className="mx-auto flex min-h-svh w-full max-w-md items-center px-6">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            {accepting ? <Check /> : <MailWarning />}
          </EmptyMedia>
          <EmptyTitle>
            {accepting ? "Joining workspace…" : "Invitation unavailable"}
          </EmptyTitle>
          <EmptyDescription>
            {accepting
              ? "We are confirming your invitation and preparing the workspace."
              : state.message}
          </EmptyDescription>
        </EmptyHeader>
        {!accepting && (
          <EmptyContent>
            {state.workspaceId ? (
              <Button
                render={
                  <Link
                    params={{ workspaceId: state.workspaceId }}
                    to="/w/$workspaceId"
                  />
                }
              >
                Open workspace
              </Button>
            ) : (
              <Button render={<Link to="/" />} variant="secondary">
                Go to Thinkspace
              </Button>
            )}
          </EmptyContent>
        )}
      </Empty>
    </div>
  );
};

export const Route = createFileRoute("/accept-invitation")({
  beforeLoad: async ({ search }) => {
    const session = await authClient.getSession();
    if (!session.data) {
      const suffix = search.id ? `?id=${encodeURIComponent(search.id)}` : "";
      throw redirect({
        search: { redirect: `/accept-invitation${suffix}` },
        to: "/login",
      });
    }
  },
  component: AcceptInvitation,
  ssr: false,
  validateSearch: z.object({ id: z.string().optional() }),
});
