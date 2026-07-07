import { env } from "@thinkspace/env/server";

/**
 * E5.5 (baked decision 4): better-auth's organization plugin owns the invitation
 * flow; we only supply the email delivery. The seam is the *message*, not the raw
 * hook payload — auth.ts builds the accept-link-bearing message and hands it to an
 * injected `EmailSender`, so tests substitute a recorder and never reach Resend.
 */
export type EmailMessage = {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly text: string;
};

export type EmailSender = (message: EmailMessage) => Promise<void>;

/**
 * The subset of better-auth's `sendInvitationEmail` hook payload we render. Kept
 * structural (not imported from the plugin) so the seam stays narrow; the full
 * hook object satisfies it by structural subtyping.
 */
export type InvitationEmailInput = {
  readonly id: string;
  readonly email: string;
  readonly organization: { readonly name: string };
  readonly inviter: { readonly user: { readonly name: string; readonly email: string } };
};

/**
 * better-auth deliberately does not generate invitation URLs — we construct the
 * accept link from the configured origin + invitation id, the shape its own
 * `acceptInvitation` endpoint reads (`?id=`).
 */
const acceptInvitationUrl = (origin: string, invitationId: string): string =>
  `${origin}/accept-invitation?id=${invitationId}`;

/** Minimal text template (scope guard: no HTML): who invited you, workspace, accept link. */
export const buildInvitationEmail = (
  data: InvitationEmailInput,
  config: { readonly origin: string; readonly from: string }
): EmailMessage => {
  const inviterName = data.inviter.user.name || data.inviter.user.email;
  const workspaceName = data.organization.name;
  const acceptLink = acceptInvitationUrl(config.origin, data.id);
  return {
    from: config.from,
    subject: `${inviterName} invited you to join ${workspaceName}`,
    text: `${inviterName} invited you to join the ${workspaceName} workspace on Thinkspace.\n\nAccept the invitation: ${acceptLink}`,
    to: data.email,
  };
};

/**
 * Production sender: POSTs to Resend's HTTP API with a bearer key. Reads env
 * lazily (at call time) so constructing the auth builder in an env without the
 * Resend secret never throws — the closure only fires when an invite is sent.
 */
export const createResendEmailSender = (): EmailSender => async (message) => {
  const response = await fetch("https://api.resend.com/emails", {
    body: JSON.stringify(message),
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Resend invitation email failed: ${response.status}`);
  }
};
