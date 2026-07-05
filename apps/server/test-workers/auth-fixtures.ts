import { env } from "cloudflare:test";

import { createAuth } from "../src/auth";

/** Replays a response's session cookies as a request cookie header. */
export const cookieFrom = (headers: Headers): string =>
  headers
    .getSetCookie()
    .map((setCookie) => setCookie.split(";")[0] ?? "")
    .join("; ");

/**
 * Signs up a fresh user and creates their workspace through better-auth's own
 * endpoints — the same writes production performs (ADR 0035 §6). D1 is shared
 * across tests in a file: keep emails and slugs unique per test.
 */
export const signUpWithWorkspace = async (input: {
  readonly email: string;
  readonly slug: string;
}) => {
  const auth = createAuth();
  const signUp = await auth.api.signUpEmail({
    body: {
      email: input.email,
      name: "Test Member",
      password: "password-123456",
    },
    returnHeaders: true,
  });
  const cookie = cookieFrom(signUp.headers);
  const workspace = await auth.api.createOrganization({
    body: { name: input.slug, slug: input.slug },
    headers: new Headers({ cookie }),
  });
  if (workspace === null) {
    throw new Error("workspace creation failed");
  }
  const memberRow = await env.DB.prepare(
    "SELECT id FROM member WHERE organization_id = ?1"
  )
    .bind(workspace.id)
    .first<{ id: string }>();
  if (memberRow === null) {
    throw new Error("creator member row missing");
  }
  return { cookie, memberId: memberRow.id, workspaceId: workspace.id };
};
