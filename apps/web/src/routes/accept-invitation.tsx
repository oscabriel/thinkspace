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
import { Loader2, MailWarning } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { authClient } from "@/lib/auth-client";

type InvitationState =
  | { status: "accepting" }
  | { status: "error"; message: string }
  | { status: "success" };

const AcceptInvitation = () => {
  const { id } = Route.useSearch();
  const navigate = useNavigate();
  const [state, setState] = useState<InvitationState>({ status: "accepting" });
  // Accepting an invitation is a non-idempotent POST; guard against a double
  // run (StrictMode double-mount, fast-refresh, re-render) so the second call
  // can't race the success navigation or flash a spurious failure.
  const hasRun = useRef(false);

  useEffect(() => {
    if (!id) {
      setState({
        message:
          "This invitation link is incomplete. Ask the workspace owner for a new invitation.",
        status: "error",
      });
      return;
    }
    if (hasRun.current) {
      return;
    }
    hasRun.current = true;

    const accept = async () => {
      const result = await authClient.organization.acceptInvitation({
        invitationId: id,
      });
      if (result.data) {
        const workspaceId = result.data.invitation.organizationId;
        await authClient.organization.setActive({
          organizationId: workspaceId,
        });
        setState({ status: "success" });
        navigate({ params: { workspaceId }, to: "/w/$workspaceId" });
        return;
      }

      // better-auth collapses expired / not-found / already-accepted /
      // canceled / rejected invitations into a single INVITATION_NOT_FOUND
      // (see the acceptInvitation handler) with no organizationId, so the
      // client cannot tell "already accepted" apart from "invalid". Present one
      // honest error; a signed-in user recovers via "/", which routes them into
      // their workspace shell (already-a-member users land where they expect).
      setState({
        message:
          "We couldn't accept this invitation. It may have expired, already been used, or been sent to a different email.",
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
            {accepting ? (
              <Loader2
                aria-label="Loading"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : (
              <MailWarning />
            )}
          </EmptyMedia>
          <EmptyTitle>
            {accepting ? "Joining workspace…" : "Invitation unavailable"}
          </EmptyTitle>
          <EmptyDescription>
            {accepting
              ? "Confirming your invitation and preparing your workspace."
              : state.message}
          </EmptyDescription>
        </EmptyHeader>
        {!accepting && (
          <EmptyContent>
            <Button render={<Link to="/" />}>Go to Thinkspace</Button>
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
