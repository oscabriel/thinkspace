import { createDb } from "@thinkspace/db";
import * as schema from "@thinkspace/db/schema/auth";
import { env } from "@thinkspace/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt, organization } from "better-auth/plugins";

import {
  buildInvitationEmail,
  createResendEmailSender,
  type EmailSender,
} from "./invitation-email";

/**
 * E5.5: the invitation email delivery is injectable so tests substitute a recorder
 * and never hit Resend. Production defaults to the Resend HTTP sender.
 */
export const createAuth = (options?: { readonly sendEmail?: EmailSender }) => {
  const db = createDb();
  const sendEmail = options?.sendEmail ?? createResendEmailSender();

  /**
   * ADR 0039: cross-subdomain cookies + cookie-cache are gated on the prod-only
   * AUTH_COOKIE_DOMAIN binding (set to the registrable domain in alchemy.run.ts, absent in dev).
   * Its presence is the sole prod signal — no stage literal leaks into the auth code. Absent in
   * dev, both features stay off and cookies behave exactly as before.
   */
  const cookieDomain = env.AUTH_COOKIE_DOMAIN;

  return betterAuth({
    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "none",
        secure: true,
      },
      ...(cookieDomain
        ? { crossSubDomainCookies: { domain: cookieDomain, enabled: true } }
        : {}),
    },
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, {
      provider: "sqlite",

      schema,
    }),
    emailAndPassword: {
      enabled: true,
    },
    /**
     * ADR 0035 §6: default roles only — creator = owner, no teams, no dynamic
     * roles. E5.5 turns invitations on: the org plugin's default access control
     * already gates `invitation: ["create"]` to owner/admin (member's statement
     * is empty), so no custom AC is needed. better-auth does not generate the
     * accept URL — we build it from INVITATION_ORIGIN + invitation id and hand
     * the rendered message to the injected sender.
     */
    plugins: [
      organization({
        sendInvitationEmail: (data) =>
          sendEmail(
            buildInvitationEmail(data, {
              from: env.INVITATION_FROM,
              origin: env.INVITATION_ORIGIN,
            })
          ),
      }),
      /**
       * E4.1: JWKS-backed JWTs for the hub WS handshake. The plugin serves its public
       * keys at /api/auth/jwks; the workspace token route mints claim-carrying tokens
       * off it (see token.ts). `disableSettingJwtHeader` turns off the per-get-session
       * `set-auth-jwt` header — that token carries no workspace claim and would sign a
       * JWT (and lazily seed a jwks row) on every session read; the hub path uses the
       * explicit /token route instead.
       */
      jwt({
        disableSettingJwtHeader: true,
        jwt: {
          /**
           * Short-lived by design: 10 minutes is long enough to open a hub WebSocket and
           * ride a brief reconnect, short enough that a leaked token expires before it is
           * worth replaying. E4.2's hub rejects on `exp`, so this is the blast-radius cap
           * on a stolen connect token.
           */
          expirationTime: "10m",
        },
      }),
    ],
    secret: env.BETTER_AUTH_SECRET,
    /**
     * ADR 0039: prod-only, gated on the same cookie-domain signal. cookieCache serves the session
     * from a signed cookie for up to 60s, cutting per-request DB reads under the cross-subdomain
     * cookie regime. Off in dev.
     */
    ...(cookieDomain
      ? { session: { cookieCache: { enabled: true, maxAge: 60 } } }
      : {}),
    // ADR 0039: prod CORS_ORIGIN resolves to https://think-space.app (the web apex).
    trustedOrigins: [env.CORS_ORIGIN],
  });
};
