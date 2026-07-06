import { env } from "@thinkspace/env/web";
import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Single better-auth client for the web app, pointed at the server origin
 * (VITE_SERVER_URL; see packages/env/src/web.ts).
 *
 * Plugins mirror the server (apps/server/src/auth.ts): the server enables
 * emailAndPassword (no client plugin required) and the organization() plugin,
 * so we register organizationClient() to expose the matching org/member calls.
 * Baseline plumbing only (E7.1) — sign-in/up screens land in E7.2.
 */
export const authClient = createAuthClient({
  baseURL: env.VITE_SERVER_URL,
  plugins: [organizationClient()],
});

/**
 * Session-reading surface. Routes/components read the current session via the
 * reactive `useSession` hook; server-side / imperative callers use
 * `getSession`. Re-exported here so consumers import from one auth module.
 */
export const { useSession, getSession, signIn, signOut, signUp } = authClient;
