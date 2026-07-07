import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { signUpWithWorkspace } from "./auth-fixtures";
import { demoteToMember } from "./role-fixtures";

const skillsUrl = (workspaceId: string) =>
  `https://test.local/api/w/${workspaceId}/skills`;

const postSkill = (
  workspaceId: string,
  cookie: string,
  body: Record<string, unknown>
) =>
  SELF.fetch(skillsUrl(workspaceId), {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", cookie },
    method: "POST",
  });

describe("skill CRUD (owner-gated writes, member-visible reads)", () => {
  it("creates, lists, reads content, and re-authors a skill for an owner", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "skills-happy@example.com",
      slug: "skills-happy-space",
    });

    const empty = await SELF.fetch(skillsUrl(workspaceId), {
      headers: { cookie },
    });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ skills: [] });

    const created = await postSkill(workspaceId, cookie, {
      markdown: "# Triage\nStep one.",
      name: "Triage",
    });
    expect(created.status).toBe(200);
    const createdBody = await created.json<{
      markdown: string;
      skill: { id: string; name: string };
    }>();
    expect(createdBody.markdown).toBe("# Triage\nStep one.");
    expect(createdBody.skill.name).toBe("Triage");
    const skillId = createdBody.skill.id;

    const listed = await SELF.fetch(skillsUrl(workspaceId), {
      headers: { cookie },
    });
    const listBody = await listed.json<{ skills: { id: string }[] }>();
    expect(listBody.skills.map((skill) => skill.id)).toEqual([skillId]);

    const content = await SELF.fetch(`${skillsUrl(workspaceId)}/${skillId}`, {
      headers: { cookie },
    });
    expect(content.status).toBe(200);
    expect((await content.json<{ markdown: string }>()).markdown).toBe(
      "# Triage\nStep one."
    );

    const updated = await SELF.fetch(`${skillsUrl(workspaceId)}/${skillId}`, {
      body: JSON.stringify({ markdown: "# Triage\nStep two." }),
      headers: { "content-type": "application/json", cookie },
      method: "PUT",
    });
    expect(updated.status).toBe(200);
    expect((await updated.json<{ markdown: string }>()).markdown).toBe(
      "# Triage\nStep two."
    );

    const reread = await SELF.fetch(`${skillsUrl(workspaceId)}/${skillId}`, {
      headers: { cookie },
    });
    expect((await reread.json<{ markdown: string }>()).markdown).toBe(
      "# Triage\nStep two."
    );
  });

  it("reads a skill for a member but rejects a member write with 403", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "skills-member@example.com",
      slug: "skills-member-space",
    });
    // Seed one skill as owner before demoting so the read has something to return.
    const created = await postSkill(workspaceId, cookie, {
      markdown: "# Seeded",
      name: "Seeded",
    });
    expect(created.status).toBe(200);

    await demoteToMember(memberId);

    // Reads stay open to members.
    const listed = await SELF.fetch(skillsUrl(workspaceId), {
      headers: { cookie },
    });
    expect(listed.status).toBe(200);
    expect((await listed.json<{ skills: unknown[] }>()).skills).toHaveLength(1);

    // Writes are owner/admin only.
    const forbidden = await postSkill(workspaceId, cookie, {
      markdown: "# Nope",
      name: "Nope",
    });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({
      error: { kind: "insufficient_role" },
    });
  });

  it("answers 404 for an unknown skill id", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "skills-missing@example.com",
      slug: "skills-missing-space",
    });

    const response = await SELF.fetch(
      `${skillsUrl(workspaceId)}/skill-does-not-exist`,
      { headers: { cookie } }
    );
    expect(response.status).toBe(404);
  });
});
