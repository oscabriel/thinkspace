import { ok } from "@thinkspace/domain/result";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { createAuth } from "../src/auth";
import type { EmailMessage } from "../src/invitation-email";
import { resolveTenantContext } from "../src/tenant-context";
import { cookieFrom, signUpWithWorkspace } from "./auth-fixtures";

/** Signs up a fresh user (no workspace) and returns their session cookie. */
const signUpUser = async (email: string): Promise<string> => {
  const auth = createAuth();
  const signUp = await auth.api.signUpEmail({
    body: { email, name: "Invitee", password: "password-123456" },
    returnHeaders: true,
  });
  return cookieFrom(signUp.headers);
};

/**
 * An auth instance whose invitation emails land in `sent` instead of Resend —
 * the injectable-sender seam (E5.5). Tests never make an outbound HTTP call.
 */
const authWithRecorder = () => {
  const sent: EmailMessage[] = [];
  const auth = createAuth({
    sendEmail: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
  });
  return { auth, sent };
};

describe("organization invitations", () => {
  it("records an invitation email whose payload carries the accept link", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "inviter@example.com",
      slug: "inviter-space",
    });
    const { auth, sent } = authWithRecorder();

    const invitation = await auth.api.createInvitation({
      body: {
        email: "guest@example.com",
        organizationId: workspaceId,
        role: "member",
      },
      headers: new Headers({ cookie }),
    });

    expect(sent).toHaveLength(1);
    const message = sent[0];
    expect(message?.to).toBe("guest@example.com");
    expect(message?.text).toContain(
      `https://test.local/accept-invitation?id=${invitation.id}`
    );
    expect(message?.text).toContain("inviter-space");
  });

  it("lands the accepted member with the invited role, resolvable through resolveTenantContext", async () => {
    const { cookie: ownerCookie, workspaceId } = await signUpWithWorkspace({
      email: "accept-owner@example.com",
      slug: "accept-space",
    });
    const { auth } = authWithRecorder();

    const invitation = await auth.api.createInvitation({
      body: {
        email: "newmember@example.com",
        organizationId: workspaceId,
        role: "admin",
      },
      headers: new Headers({ cookie: ownerCookie }),
    });

    const inviteeCookie = await signUpUser("newmember@example.com");
    const accepted = await createAuth().api.acceptInvitation({
      body: { invitationId: invitation.id },
      headers: new Headers({ cookie: inviteeCookie }),
    });

    expect(accepted?.member.role).toBe("admin");

    const memberRow = await env.DB.prepare(
      "SELECT id, role FROM member WHERE organization_id = ?1 AND role = 'admin'"
    )
      .bind(workspaceId)
      .first<{ id: string; role: string }>();
    expect(memberRow?.role).toBe("admin");

    const context = await resolveTenantContext(
      new Request(`https://test.local/api/w/${workspaceId}/threads`, {
        headers: { cookie: inviteeCookie },
      }),
      workspaceId
    );
    expect(context).toEqual(
      ok({ memberId: memberRow?.id, role: "admin", workspaceId })
    );
  });

  it("rejects an invitation attempt by a plain member (default AC gates invitation:create)", async () => {
    const { cookie: ownerCookie, workspaceId } = await signUpWithWorkspace({
      email: "member-gate-owner@example.com",
      slug: "member-gate-space",
    });
    const { auth } = authWithRecorder();

    const invitation = await auth.api.createInvitation({
      body: {
        email: "plain-member@example.com",
        organizationId: workspaceId,
        role: "member",
      },
      headers: new Headers({ cookie: ownerCookie }),
    });
    const memberCookie = await signUpUser("plain-member@example.com");
    await createAuth().api.acceptInvitation({
      body: { invitationId: invitation.id },
      headers: new Headers({ cookie: memberCookie }),
    });

    await expect(
      createAuth().api.createInvitation({
        body: {
          email: "outsider@example.com",
          organizationId: workspaceId,
          role: "member",
        },
        headers: new Headers({ cookie: memberCookie }),
      })
    ).rejects.toThrow();
  });
});
