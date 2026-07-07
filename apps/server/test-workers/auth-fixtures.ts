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

/** Signs up a user without creating a workspace, returning their session cookie and userId. */
export const signUpUser = async (input: { readonly email: string }) => {
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
  const userRow = await env.DB.prepare("SELECT id FROM user WHERE email = ?1")
    .bind(input.email)
    .first<{ id: string }>();
  if (userRow === null) {
    throw new Error("signed-up user row missing");
  }
  return { cookie, userId: userRow.id };
};

/**
 * Adds an existing user to a workspace with a given role by writing the better-auth member
 * row directly (the same row resolveTenantContext reads); avoids the invitation round-trip.
 */
export const addWorkspaceMember = async (input: {
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}) => {
  const memberId = `member-${crypto.randomUUID()}`;
  await env.DB.prepare(
    "INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"
  )
    .bind(memberId, input.workspaceId, input.userId, input.role, Date.now())
    .run();
  return { memberId };
};
