import { SELF } from "cloudflare:test";
import type { JSONWebKeySet } from "jose";
import { createLocalJWKSet, decodeJwt, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";

import { signUpWithWorkspace } from "./auth-fixtures";

const tokenUrl = (workspaceId: string) =>
  `https://test.local/api/w/${workspaceId}/token`;

const fetchJwks = async (): Promise<JSONWebKeySet> => {
  const response = await SELF.fetch("https://test.local/api/auth/jwks");
  expect(response.status).toBe(200);
  return response.json<JSONWebKeySet>();
};

describe("GET /api/w/:workspaceId/token", () => {
  it("mints a short-lived JWT carrying the caller's workspace/member claims", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "token-happy@example.com",
      slug: "token-happy-space",
    });

    const response = await SELF.fetch(tokenUrl(workspaceId), {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    const { token } = await response.json<{ token: string }>();

    const claims = decodeJwt(token);
    expect(claims).toMatchObject({
      memberId,
      role: "owner",
      sub: memberId,
      workspaceId,
    });

    // Short-lived by design (E4.1): a 10-minute window from now, never hours.
    expect(claims.exp).toBeDefined();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const secondsUntilExpiry = (claims.exp ?? 0) - nowSeconds;
    expect(secondsUntilExpiry).toBeGreaterThan(0);
    expect(secondsUntilExpiry).toBeLessThanOrEqual(15 * 60);
  });

  it("serves a JWKS whose keys verify the minted token's signature", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "token-jwks@example.com",
      slug: "token-jwks-space",
    });

    const response = await SELF.fetch(tokenUrl(workspaceId), {
      headers: { cookie },
    });
    const { token } = await response.json<{ token: string }>();

    const jwks = await fetchJwks();
    expect(jwks.keys.length).toBeGreaterThanOrEqual(1);

    const keySet = createLocalJWKSet(jwks);
    const { payload } = await jwtVerify(token, keySet);
    expect(payload).toMatchObject({
      memberId,
      role: "owner",
      sub: memberId,
      workspaceId,
    });
  });

  it("rejects an unauthenticated request for a token as 401", async () => {
    const { workspaceId } = await signUpWithWorkspace({
      email: "token-anon@example.com",
      slug: "token-anon-space",
    });

    const response = await SELF.fetch(tokenUrl(workspaceId));

    expect(response.status).toBe(401);
  });
});
