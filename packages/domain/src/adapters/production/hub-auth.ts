import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";
import { z } from "zod";

import { memberIdSchema, workspaceIdSchema } from "../../ids";
import { roleSchema } from "../../workspace";

/**
 * E4.2 (baked decision 5): the hub WebSocket handshake is authorized by the short-lived
 * better-auth JWT the client fetched from the /token route (E4.1) — never a session cookie
 * over WS. The hub verifies the token against the auth origin's JWKS and matches its claims
 * to the hub's own decoded address (ADR 0033); a failure closes the socket with 4401.
 */

/** WS close code for a rejected upgrade — 4xxx is the app-defined range, 4401 ≈ "unauthorized". */
export const HUB_UPGRADE_REJECT_CODE = 4401;

/** Query parameter carrying the connect token: browser WebSocket cannot set request headers. */
const HUB_TOKEN_PARAM = "token";

/**
 * The JWKS endpoint the better-auth JWT plugin publishes (E4.1: /api/auth/jwks). Bound from
 * env like the AI Gateway URL so the auth origin is deployment-configured, never baked in.
 */
export interface HubAuthEnv {
  readonly AUTH_JWKS_URL: string;
}

/**
 * The connect token's claim shape is E4.1's contract (see apps/server/src/token.ts): the
 * resolved TenantContext, minted straight off the session. `sub` doubles as `memberId`.
 */
const hubConnectClaimsSchema = z.object({
  memberId: memberIdSchema,
  role: roleSchema,
  sub: z.string().min(1),
  workspaceId: workspaceIdSchema,
});

export type HubConnectClaims = z.infer<typeof hubConnectClaimsSchema>;

export type HubUpgradeAuthResult =
  | { readonly claims: HubConnectClaims; readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * A remote JWK set, cached: jose serves keys from memory and only refetches the JWKS when a
 * token names a `kid` it has not seen (subject to its own cooldown). Hold the returned getter
 * on a DO instance field so the cache lives as long as the hub does.
 */
export const createHubJwks = (env: HubAuthEnv): JWTVerifyGetKey =>
  createRemoteJWKSet(new URL(env.AUTH_JWKS_URL));

/** The connect token rides the upgrade URL's query string; absent means an anonymous probe. */
export const readHubConnectToken = (request: Request): string | null => {
  const token = new URL(request.url).searchParams.get(HUB_TOKEN_PARAM);
  return token && token.length > 0 ? token : null;
};

/**
 * Verify signature (EdDSA — the better-auth JWT plugin's Ed25519 default) and expiry against
 * the cached JWKS, then narrow the payload to the connect-claim shape. Any failure — bad
 * signature, unknown key, expired `exp`, or a claim that does not parse — is a flat rejection:
 * the caller closes the socket, never learning which check tripped.
 */
export const verifyHubConnectToken = async (
  token: string,
  jwks: JWTVerifyGetKey
): Promise<HubUpgradeAuthResult> => {
  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(token, jwks, { algorithms: ["EdDSA"] }));
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "token_unverified",
    };
  }

  const parsed = hubConnectClaimsSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, reason: "malformed_claims" };
  }

  return { claims: parsed.data, ok: true };
};
