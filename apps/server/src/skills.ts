import {
  createD1TenantDataAccess,
  createR2MarkdownSkillStore,
} from "@thinkspace/domain/adapters/production";
import { skillIdSchema } from "@thinkspace/domain/ids";
import {
  skillMarkdownSchema,
  skillNameSchema,
} from "@thinkspace/domain/primitives";
import type { TenantContext } from "@thinkspace/domain/seams/tenant-data-access";
import { env } from "@thinkspace/env/server";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import { domainErrorStatus } from "./error-translation";
import type { TenantVariables } from "./tenant-context";
import { WORKSPACE_MANAGER_ROLES } from "./tenant-context";

/**
 * E8.2: the HTTP surface for the R2-markdown skill registry (ADR 0029), a wave-7 debt item.
 * Reads are member-visible (browsable, key-first — ADR 0011); writes are owner/admin only,
 * reusing the E3.2 BYOK role-gate pattern. There is deliberately no DELETE: the SkillStore seam
 * has no delete (a shape's frozen skillSelection may still reference a skill), so deletion
 * semantics stay future work.
 */

const skillPathSchema = z.object({ skillId: skillIdSchema });

const createBodySchema = z.object({
  markdown: skillMarkdownSchema,
  name: skillNameSchema,
});

const updateBodySchema = z.object({ markdown: skillMarkdownSchema });

const importBodySchema = z.object({ source: z.string().min(1) });

/**
 * E11.4: control-plane import of a skill from skills.sh (ADR 0005 markdown-only). This is the
 * worker's OWN outbound egress — like invitation-email's Resend POST — and is deliberately NOT the
 * ADR 0002 MCP run-time allowlist; the two must never be conflated. SSRF posture: we NEVER fetch a
 * user-supplied host. Any paste is reduced to `owner/repo[/subpath]`, every path segment is
 * charset-validated, and the only hosts contacted are the two hardcoded below (ratified: api.github
 * for a single default-branch lookup, raw for the SKILL.md itself).
 */
const GITHUB_API_HOST = "api.github.com";
const GITHUB_RAW_HOST = "raw.githubusercontent.com";

/** Web hosts a paste may arrive as; the path is still reduced to a slug, never fetched directly. */
const SOURCE_URL_HOSTS: ReadonlySet<string> = new Set([
  "github.com",
  "skills.sh",
  "www.github.com",
  "www.skills.sh",
]);

/** One slug segment: GitHub's owner/repo/path charset, minus the `.`/`..` traversal tokens. */
const SLUG_SEGMENT = /^[A-Za-z0-9._-]+$/u;

/** Response caps: SKILL.md is prose, so a generous ceiling still fences a hostile body. */
const MAX_SKILL_BYTES = 256 * 1024;
const MARKDOWN_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "application/octet-stream",
  "text/markdown",
  "text/plain",
  "text/x-markdown",
]);

const IMPORT_USER_AGENT = "thinkspace-skill-import";

interface SkillSource {
  readonly owner: string;
  readonly repo: string;
  readonly subpath: readonly string[];
}

const isSlugSegment = (segment: string): boolean =>
  SLUG_SEGMENT.test(segment) && segment !== "." && segment !== "..";

/** Reduce a paste (bare slug or skills.sh/GitHub URL) to a validated owner/repo[/subpath], or null. */
const parseSkillSource = (raw: string): SkillSource | null => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let segments: string[];
  if (trimmed.includes("://")) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    if (!SOURCE_URL_HOSTS.has(parsed.hostname)) {
      return null;
    }
    segments = parsed.pathname.split("/").filter((part) => part.length > 0);
    // github.com/{owner}/{repo}/(tree|blob)/{ref}/{...path}: drop the ref hop — we always
    // resolve the default branch ourselves rather than trust a pasted ref.
    if (
      segments.length >= 4 &&
      (segments[2] === "tree" || segments[2] === "blob")
    ) {
      segments = [...segments.slice(0, 2), ...segments.slice(4)];
    }
  } else {
    segments = trimmed.split("/").filter((part) => part.length > 0);
  }

  // A trailing SKILL.md (from a blob URL or a fully-qualified paste) is implied, not path.
  if (segments.at(-1)?.toLowerCase() === "skill.md") {
    segments = segments.slice(0, -1);
  }

  const [owner, repo, ...subpath] = segments;
  if (owner === undefined || repo === undefined) {
    return null;
  }
  if (!segments.every(isSlugSegment)) {
    return null;
  }
  return { owner, repo, subpath };
};

const sourceSlug = ({ owner, repo, subpath }: SkillSource): string =>
  [owner, repo, ...subpath].join("/");

interface SkillFrontmatter {
  readonly name: string | null;
  readonly description: string | null;
  readonly license: string | null;
}

const FRONTMATTER_BLOCK = /^---\r?\n(?<body>[\s\S]*?)\r?\n---\r?\n?/u;

const readFrontmatterField = (block: string, key: string): string | null => {
  const prefix = new RegExp(`^${key}:\\s*`, "u");
  const line = block.split("\n").find((entry) => prefix.test(entry));
  if (!line) {
    return null;
  }
  const value = line
    .replace(prefix, "")
    .trim()
    .replaceAll(/^["']|["']$/gu, "");
  return value.length > 0 ? value : null;
};

/** Strip a leading YAML frontmatter block, returning the parsed fields + the markdown body. */
const stripFrontmatter = (
  markdown: string
): { readonly frontmatter: SkillFrontmatter; readonly body: string } => {
  const match = markdown.match(FRONTMATTER_BLOCK);
  if (!match?.groups) {
    return {
      body: markdown,
      frontmatter: { description: null, license: null, name: null },
    };
  }
  const block = match.groups.body ?? "";
  return {
    body: markdown.slice(match[0].length).replace(/^\s*\n/u, ""),
    frontmatter: {
      description: readFrontmatterField(block, "description"),
      license: readFrontmatterField(block, "license"),
      name: readFrontmatterField(block, "name"),
    },
  };
};

interface SkillImportPreview {
  readonly name: string;
  readonly description: string | null;
  readonly markdown: string;
  readonly license: string | null;
  readonly sourceSlug: string;
}

type ImportErrorKind =
  | "invalid_source"
  | "skill_source_not_found"
  | "skill_source_rate_limited"
  | "skill_source_too_large"
  | "skill_source_unreadable";

const IMPORT_ERROR_STATUS: Record<ImportErrorKind, ContentfulStatusCode> = {
  invalid_source: 400,
  skill_source_not_found: 404,
  skill_source_rate_limited: 429,
  skill_source_too_large: 422,
  skill_source_unreadable: 422,
};

type ImportOutcome =
  | { readonly ok: true; readonly preview: SkillImportPreview }
  | { readonly ok: false; readonly kind: ImportErrorKind };

const isRateLimited = (response: Response): boolean =>
  response.status === 429 ||
  (response.status === 403 &&
    response.headers.get("x-ratelimit-remaining") === "0");

type DefaultBranchOutcome =
  | { readonly ok: true; readonly branch: string }
  | { readonly ok: false; readonly rateLimited: boolean };

/** The repo's default branch via a single api.github.com lookup. */
const resolveDefaultBranch = async (
  source: SkillSource
): Promise<DefaultBranchOutcome> => {
  let response: Response;
  try {
    response = await fetch(
      `https://${GITHUB_API_HOST}/repos/${source.owner}/${source.repo}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": IMPORT_USER_AGENT,
        },
      }
    );
  } catch {
    return { ok: false, rateLimited: false };
  }
  if (!response.ok) {
    return { ok: false, rateLimited: isRateLimited(response) };
  }
  const body = (await response.json().catch(() => null)) as {
    default_branch?: unknown;
  } | null;
  return typeof body?.default_branch === "string" &&
    body.default_branch.length > 0
    ? { branch: body.default_branch, ok: true }
    : { ok: false, rateLimited: false };
};

/**
 * Fetch + parse a SKILL.md into a create-form preview. Never persists (ADR 0005 markdown-only: only
 * the SKILL.md body imports; bundled scripts/references/assets and their relative links are lost).
 */
const importSkillFromSource = async (raw: string): Promise<ImportOutcome> => {
  const source = parseSkillSource(raw);
  if (!source) {
    return { kind: "invalid_source", ok: false };
  }

  const branchOutcome = await resolveDefaultBranch(source);
  if (!branchOutcome.ok) {
    return {
      kind: branchOutcome.rateLimited
        ? "skill_source_rate_limited"
        : "skill_source_not_found",
      ok: false,
    };
  }

  const rawUrl = `https://${GITHUB_RAW_HOST}/${[source.owner, source.repo, branchOutcome.branch, ...source.subpath, "SKILL.md"].join("/")}`;

  let response: Response;
  try {
    response = await fetch(rawUrl, {
      headers: { "user-agent": IMPORT_USER_AGENT },
    });
  } catch {
    return { kind: "skill_source_unreadable", ok: false };
  }

  if (response.status === 404) {
    return { kind: "skill_source_not_found", ok: false };
  }
  if (isRateLimited(response)) {
    return { kind: "skill_source_rate_limited", ok: false };
  }
  if (!response.ok) {
    return { kind: "skill_source_unreadable", ok: false };
  }

  const contentType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  if (
    contentType !== undefined &&
    contentType.length > 0 &&
    !MARKDOWN_CONTENT_TYPES.has(contentType)
  ) {
    return { kind: "skill_source_unreadable", ok: false };
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SKILL_BYTES) {
    return { kind: "skill_source_too_large", ok: false };
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_SKILL_BYTES) {
    return { kind: "skill_source_too_large", ok: false };
  }

  const markdown = new TextDecoder().decode(bytes);
  if (markdown.trim().length === 0) {
    return { kind: "skill_source_unreadable", ok: false };
  }

  const { body, frontmatter } = stripFrontmatter(markdown);
  return {
    ok: true,
    preview: {
      description: frontmatter.description,
      license: frontmatter.license,
      markdown: body,
      name: frontmatter.name ?? source.subpath.at(-1) ?? source.repo,
      sourceSlug: sourceSlug(source),
    },
  };
};

const buildSkillStore = (context: TenantContext) =>
  createR2MarkdownSkillStore({ bucket: env.SKILLS, context, db: env.DB });

const buildTenantDataAccess = (context: TenantContext) =>
  createD1TenantDataAccess({ context, db: env.DB });

export const skillRoutes = new Hono<{ Variables: TenantVariables }>()
  /**
   * The skill index — identity + R2-key mapping, no markdown bodies (ADR 0037 §5: the resolver's
   * skills layer reads the same tenant-guarded `listSkills`). Any member may browse.
   */
  .get("/skills", async (c) => {
    const context = c.get("tenantContext");
    const skills = await buildTenantDataAccess(context).listSkills();
    if (!skills.ok) {
      return c.json({ error: skills.error }, domainErrorStatus(skills.error));
    }
    return c.json({ skills: skills.value }, 200);
  })
  /** A single skill's content, including its live markdown body. A missing id is 404. */
  .get("/skills/:skillId", async (c) => {
    const context = c.get("tenantContext");

    const path = skillPathSchema.safeParse({ skillId: c.req.param("skillId") });
    if (!path.success) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    const content = await buildSkillStore(context).get({
      skillId: path.data.skillId,
    });
    if (!content.ok) {
      return c.json({ error: content.error }, domainErrorStatus(content.error));
    }
    if (content.value === null) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    return c.json(content.value, 200);
  })
  /** Author a new skill (owner/admin): the adapter mints the id and R2 key. */
  .post("/skills", async (c) => {
    const context = c.get("tenantContext");
    if (!WORKSPACE_MANAGER_ROLES.has(context.role)) {
      return c.json({ error: { kind: "insufficient_role" } }, 403);
    }

    const body = createBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!body.success) {
      return c.json({ error: { kind: "malformed_request" } }, 400);
    }

    const created = await buildSkillStore(context).create({
      draft: { name: body.data.name },
      markdown: body.data.markdown,
    });
    if (!created.ok) {
      return c.json({ error: created.error }, domainErrorStatus(created.error));
    }

    return c.json(created.value, 200);
  })
  /**
   * E11.4: server-side SKILL.md import (owner/admin), the SSRF-guarded control-plane egress. Parses
   * a slug/URL, fetches from the hardcoded GitHub host allowlist under size/content-type caps, and
   * returns a create-form preview — it does NOT persist. The member reviews the prefilled form and
   * saves through POST /skills above.
   */
  .post("/skills/import", async (c) => {
    const context = c.get("tenantContext");
    if (!WORKSPACE_MANAGER_ROLES.has(context.role)) {
      return c.json({ error: { kind: "insufficient_role" } }, 403);
    }

    const body = importBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!body.success) {
      return c.json({ error: { kind: "malformed_request" } }, 400);
    }

    const outcome = await importSkillFromSource(body.data.source);
    if (!outcome.ok) {
      return c.json(
        { error: { kind: outcome.kind } },
        IMPORT_ERROR_STATUS[outcome.kind]
      );
    }

    return c.json(outcome.preview, 200);
  })
  /** Re-author a skill's markdown (owner/admin); editing re-indexes it. A missing id is 404. */
  .put("/skills/:skillId", async (c) => {
    const context = c.get("tenantContext");
    if (!WORKSPACE_MANAGER_ROLES.has(context.role)) {
      return c.json({ error: { kind: "insufficient_role" } }, 403);
    }

    const path = skillPathSchema.safeParse({ skillId: c.req.param("skillId") });
    if (!path.success) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    const body = updateBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!body.success) {
      return c.json({ error: { kind: "malformed_request" } }, 400);
    }

    const updated = await buildSkillStore(context).update({
      markdown: body.data.markdown,
      skillId: path.data.skillId,
    });
    if (!updated.ok) {
      return c.json({ error: updated.error }, domainErrorStatus(updated.error));
    }
    if (updated.value === null) {
      return c.json({ error: { kind: "unknown_resource" } }, 404);
    }

    return c.json(updated.value, 200);
  });
