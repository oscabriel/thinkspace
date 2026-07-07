import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { signUpWithWorkspace } from "./auth-fixtures";
import { demoteToMember } from "./role-fixtures";

const serversUrl = (workspaceId: string) =>
  `https://test.local/api/w/${workspaceId}/mcp/servers`;

const approveUrl = (workspaceId: string) =>
  `https://test.local/api/w/${workspaceId}/mcp/hosts/approve`;

const jsonPost = (
  url: string,
  cookie: string,
  body: Record<string, unknown>
) =>
  SELF.fetch(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", cookie },
    method: "POST",
  });

/** How many registry rows a workspace holds for a host — the egress-gate ground truth. */
const serverRowsForHost = async (workspaceId: string, host: string) => {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM mcp_server WHERE workspace_id = ?1 AND host = ?2"
  )
    .bind(workspaceId, host)
    .first<{ n: number }>();
  return row?.n ?? 0;
};

/** Insert a live thread row so the revoke fan-out has a DO address to enumerate and contact. */
const seedThread = (input: {
  readonly channelId: string;
  readonly memberId: string;
  readonly threadId: string;
  readonly workspaceId: string;
}) =>
  env.DB.prepare(
    `INSERT INTO thread (id, channel_id, created_at, created_by_member_id, last_activity_at, lifecycle, name, workspace_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  )
    .bind(
      input.threadId,
      input.channelId,
      Date.now(),
      input.memberId,
      Date.now(),
      JSON.stringify({ state: "active" }),
      "fan-out thread",
      input.workspaceId
    )
    .run();

describe("MCP registry CRUD (owner-gated writes + egress gate + revoke fan-out)", () => {
  it("approves a host, registers a server on it, then lists it (member-visible)", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "mcp-happy@example.com",
      slug: "mcp-happy-space",
    });

    const approved = await jsonPost(approveUrl(workspaceId), cookie, {
      host: "mcp.example.com",
    });
    expect(approved.status).toBe(200);

    const registered = await jsonPost(serversUrl(workspaceId), cookie, {
      host: "mcp.example.com",
      name: "Docs",
      url: "https://mcp.example.com/mcp",
    });
    expect(registered.status).toBe(200);
    const registeredBody = await registered.json<{
      server: { host: string; id: string; name: string };
    }>();
    expect(registeredBody.server.name).toBe("Docs");
    expect(await serverRowsForHost(workspaceId, "mcp.example.com")).toBe(1);

    const listed = await SELF.fetch(serversUrl(workspaceId), {
      headers: { cookie },
    });
    expect(listed.status).toBe(200);
    const listBody = await listed.json<{ servers: { id: string }[] }>();
    expect(listBody.servers.map((server) => server.id)).toEqual([
      registeredBody.server.id,
    ]);
  });

  it("fails closed registering on an unapproved host — 403 and nothing persisted", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "mcp-unapproved@example.com",
      slug: "mcp-unapproved-space",
    });

    const registered = await jsonPost(serversUrl(workspaceId), cookie, {
      host: "rogue.example.com",
      name: "Rogue",
      url: "https://rogue.example.com/mcp",
    });
    expect(registered.status).toBe(403);
    expect(await registered.json()).toMatchObject({
      error: { host: "rogue.example.com", kind: "mcp_host_not_allowed" },
    });
    expect(await serverRowsForHost(workspaceId, "rogue.example.com")).toBe(0);
  });

  it("deletes a server, dropping its row, with a live thread present for the fan-out", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "mcp-delete@example.com",
      slug: "mcp-delete-space",
    });
    // A live thread row so fanOutDisconnect enumerates it and calls the real DO (ADR 0037 §4).
    await seedThread({
      channelId: "mcp-del-ch-1",
      memberId,
      threadId: "mcp-del-th-1",
      workspaceId,
    });

    await jsonPost(approveUrl(workspaceId), cookie, { host: "mcp.example.com" });
    const registered = await jsonPost(serversUrl(workspaceId), cookie, {
      host: "mcp.example.com",
      name: "Docs",
      url: "https://mcp.example.com/mcp",
    });
    const { server } = await registered.json<{ server: { id: string } }>();
    expect(await serverRowsForHost(workspaceId, "mcp.example.com")).toBe(1);

    const deleted = await SELF.fetch(
      `${serversUrl(workspaceId)}/${server.id}`,
      { headers: { cookie }, method: "DELETE" }
    );
    // 200 with the row gone proves the fan-out over the seeded thread ran without failing the
    // write (revoke is durable-first; a fan-out throw would be swallowed, not surfaced here).
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ mcpServerId: server.id });
    expect(await serverRowsForHost(workspaceId, "mcp.example.com")).toBe(0);
  });

  it("rejects a member registry write with 403 and persists nothing", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "mcp-member@example.com",
      slug: "mcp-member-space",
    });
    // Approve as owner first so the reject is on the role gate, not the egress gate.
    await jsonPost(approveUrl(workspaceId), cookie, { host: "mcp.example.com" });
    await demoteToMember(memberId);

    const registered = await jsonPost(serversUrl(workspaceId), cookie, {
      host: "mcp.example.com",
      name: "Docs",
      url: "https://mcp.example.com/mcp",
    });
    expect(registered.status).toBe(403);
    expect(await registered.json()).toEqual({
      error: { kind: "insufficient_role" },
    });
    expect(await serverRowsForHost(workspaceId, "mcp.example.com")).toBe(0);

    // Members may still read the registry.
    const listed = await SELF.fetch(serversUrl(workspaceId), {
      headers: { cookie },
    });
    expect(listed.status).toBe(200);
    expect((await listed.json<{ servers: unknown[] }>()).servers).toEqual([]);
  });
});
