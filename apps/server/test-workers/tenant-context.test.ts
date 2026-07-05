import { err, ok } from "@thinkspace/domain/result";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { resolveTenantContext } from "../src/tenant-context";
import { signUpWithWorkspace } from "./auth-fixtures";

const requestWithCookie = (workspaceId: string, cookie: string): Request =>
  new Request(`https://test.local/api/w/${workspaceId}/threads`, {
    headers: { cookie },
  });

describe("resolveTenantContext", () => {
  it("resolves a signed-in member of the path workspace to their TenantContext", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "owner@example.com",
      slug: "acme",
    });

    const result = await resolveTenantContext(
      requestWithCookie(workspaceId, cookie),
      workspaceId
    );

    expect(result).toEqual(ok({ memberId, role: "owner", workspaceId }));
  });

  it("resolves a request without a session to unauthenticated", async () => {
    const { workspaceId } = await signUpWithWorkspace({
      email: "anonymous@example.com",
      slug: "anonymous",
    });

    const result = await resolveTenantContext(
      new Request(`https://test.local/api/w/${workspaceId}/threads`),
      workspaceId
    );

    expect(result).toEqual(err({ kind: "unauthenticated" }));
  });

  it("resolves a valid session against a workspace it has no member row for to not_a_member", async () => {
    const outsider = await signUpWithWorkspace({
      email: "outsider@example.com",
      slug: "outsider-space",
    });
    const other = await signUpWithWorkspace({
      email: "resident@example.com",
      slug: "resident-space",
    });

    const result = await resolveTenantContext(
      requestWithCookie(other.workspaceId, outsider.cookie),
      other.workspaceId
    );

    expect(result).toEqual(err({ kind: "not_a_member" }));
  });

  it("resolves a member row that fails the branded role parse to malformed_identity", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "drifted@example.com",
      slug: "drifted-space",
    });
    await env.DB.prepare(
      "UPDATE member SET role = 'superadmin' WHERE organization_id = ?1"
    )
      .bind(workspaceId)
      .run();

    const result = await resolveTenantContext(
      requestWithCookie(workspaceId, cookie),
      workspaceId
    );

    expect(result).toEqual(err({ kind: "malformed_identity" }));
  });
});
