import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { signUpWithWorkspace } from "./auth-fixtures";
import { demoteToMember } from "./role-fixtures";

/**
 * E11.4: POST /skills/import — the SSRF-guarded control-plane import from skills.sh. GitHub egress
 * is served by the shared outbound mock (packages/domain/test-workers/outbound-mock.mjs), so no
 * test reaches the real network. Fixture repos: acme/reviewer (valid SKILL.md on default branch
 * main, optional deep/path subpath), acme/no-frontmatter, acme/html-page (non-markdown),
 * acme/huge (over the size cap); anything else 404s at api.github.com.
 */

const importUrl = (workspaceId: string) =>
  `https://test.local/api/w/${workspaceId}/skills/import`;

const postImport = (
  workspaceId: string,
  cookie: string,
  body: Record<string, unknown>
) =>
  SELF.fetch(importUrl(workspaceId), {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", cookie },
    method: "POST",
  });

interface Preview {
  description: string | null;
  license: string | null;
  markdown: string;
  name: string;
  sourceSlug: string;
}

describe("skill import (owner-gated, SSRF-guarded SKILL.md fetch)", () => {
  it("previews a valid slug: name/description/license from frontmatter, body without it", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "import-happy@example.com",
      slug: "import-happy-space",
    });

    const response = await postImport(workspaceId, cookie, {
      source: "acme/reviewer",
    });
    expect(response.status).toBe(200);
    const preview = await response.json<Preview>();
    expect(preview.name).toBe("adr-consistency-reviewer");
    expect(preview.description).toContain("Cross-references every ADR");
    expect(preview.license).toBe("MIT");
    expect(preview.sourceSlug).toBe("acme/reviewer");
    expect(preview.markdown.startsWith("# When reviewing ADRs")).toBe(true);
    // Nothing persists: the skill index stays empty after an import.
    expect(preview.markdown.includes("---")).toBe(false);

    const skills = await SELF.fetch(
      `https://test.local/api/w/${workspaceId}/skills`,
      { headers: { cookie } }
    );
    expect((await skills.json<{ skills: unknown[] }>()).skills).toHaveLength(0);
  });

  it("accepts a subpath slug and reflects it in sourceSlug", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "import-subpath@example.com",
      slug: "import-subpath-space",
    });

    const response = await postImport(workspaceId, cookie, {
      source: "acme/reviewer/deep/path",
    });
    expect(response.status).toBe(200);
    expect((await response.json<Preview>()).sourceSlug).toBe(
      "acme/reviewer/deep/path"
    );
  });

  it("accepts a skills.sh URL and a GitHub blob URL, reducing both to the slug", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "import-urls@example.com",
      slug: "import-urls-space",
    });

    const skillsSh = await postImport(workspaceId, cookie, {
      source: "https://skills.sh/acme/reviewer",
    });
    expect(skillsSh.status).toBe(200);
    expect((await skillsSh.json<Preview>()).sourceSlug).toBe("acme/reviewer");

    const blob = await postImport(workspaceId, cookie, {
      source: "https://github.com/acme/reviewer/blob/main/SKILL.md",
    });
    expect(blob.status).toBe(200);
    expect((await blob.json<Preview>()).sourceSlug).toBe("acme/reviewer");
  });

  it("falls back to the repo name when the SKILL.md has no frontmatter", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "import-nofm@example.com",
      slug: "import-nofm-space",
    });

    const response = await postImport(workspaceId, cookie, {
      source: "acme/no-frontmatter",
    });
    expect(response.status).toBe(200);
    const preview = await response.json<Preview>();
    expect(preview.name).toBe("no-frontmatter");
    expect(preview.license).toBeNull();
    expect(preview.description).toBeNull();
  });

  it("rejects absolute/non-allowlisted URLs and traversal as invalid_source (SSRF guard)", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "import-ssrf@example.com",
      slug: "import-ssrf-space",
    });

    for (const source of [
      "https://evil.example/acme/reviewer",
      "http://169.254.169.254/latest/meta-data",
      "https://raw.githubusercontent.com/acme/reviewer/main/SKILL.md",
      "../../etc/passwd",
      "just-one-segment",
    ]) {
      const response = await postImport(workspaceId, cookie, { source });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { kind: "invalid_source" },
      });
    }
  });

  it("404s an unknown repo as skill_source_not_found", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "import-missing@example.com",
      slug: "import-missing-space",
    });

    const response = await postImport(workspaceId, cookie, {
      source: "ghost/missing",
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { kind: "skill_source_not_found" },
    });
  });

  it.each([
    "api-rate-limited-429",
    "api-rate-limited-403",
    "raw-rate-limited-429",
    "raw-rate-limited-403",
  ])("429s GitHub rate limiting for %s", async (repo) => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: `import-${repo}@example.com`,
      slug: `import-${repo}-space`,
    });

    const response = await postImport(workspaceId, cookie, {
      source: `acme/${repo}`,
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: { kind: "skill_source_rate_limited" },
    });
  });

  it.each(["api-forbidden", "raw-forbidden"])(
    "does not treat a plain 403 as rate limiting for %s",
    async (repo) => {
      const { cookie, workspaceId } = await signUpWithWorkspace({
        email: `import-${repo}@example.com`,
        slug: `import-${repo}-space`,
      });

      const response = await postImport(workspaceId, cookie, {
        source: `acme/${repo}`,
      });
      expect(response.status).not.toBe(429);
      expect(await response.json()).not.toEqual({
        error: { kind: "skill_source_rate_limited" },
      });
    }
  );

  it("422s a non-markdown response as skill_source_unreadable", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "import-html@example.com",
      slug: "import-html-space",
    });

    const response = await postImport(workspaceId, cookie, {
      source: "acme/html-page",
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: { kind: "skill_source_unreadable" },
    });
  });

  it("422s an oversized response as skill_source_too_large", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "import-huge@example.com",
      slug: "import-huge-space",
    });

    const response = await postImport(workspaceId, cookie, {
      source: "acme/huge",
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: { kind: "skill_source_too_large" },
    });
  });

  it("rejects a member import with 403 insufficient_role", async () => {
    const { cookie, memberId, workspaceId } = await signUpWithWorkspace({
      email: "import-member@example.com",
      slug: "import-member-space",
    });
    await demoteToMember(memberId);

    const response = await postImport(workspaceId, cookie, {
      source: "acme/reviewer",
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { kind: "insufficient_role" },
    });
  });

  it("400s a malformed body", async () => {
    const { cookie, workspaceId } = await signUpWithWorkspace({
      email: "import-malformed@example.com",
      slug: "import-malformed-space",
    });

    const response = await postImport(workspaceId, cookie, { source: "" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { kind: "malformed_request" },
    });
  });
});
