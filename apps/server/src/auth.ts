import { createDb } from "@thinkspace/db";
import * as schema from "@thinkspace/db/schema/auth";
import { env } from "@thinkspace/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt, organization } from "better-auth/plugins";

export const createAuth = () => {
  const db = createDb();

  return betterAuth({
    advanced: {
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "none",
        secure: true,
      },
      // uncomment crossSubDomainCookies setting when ready to deploy and replace <your-workers-subdomain> with your actual workers subdomain
      // https://developers.cloudflare.com/workers/wrangler/configuration/#workersdev
      // crossSubDomainCookies: {
      //   enabled: true,
      //   domain: "<your-workers-subdomain>",
      // },
    },
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, {
      provider: "sqlite",

      schema,
    }),
    emailAndPassword: {
      enabled: true,
    },
    /** ADR 0035 §6: defaults only — creator = owner, no teams, no dynamic roles; invitations deferred (no email sender). */
    plugins: [
      organization(),
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
    // uncomment cookieCache setting when ready to deploy to Cloudflare using *.workers.dev domains
    // session: {
    //   cookieCache: {
    //     enabled: true,
    //     maxAge: 60,
    //   },
    // },
    trustedOrigins: [env.CORS_ORIGIN],
  });
};
