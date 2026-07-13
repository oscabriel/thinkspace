/**
 * Canonical outbound-service mock (BACKLOG E1.1 spike finding 5).
 *
 * Wired as miniflare `outboundService`, it intercepts every global-fetch egress from the test
 * workers at the workerd layer — including DO-originated absolute-URL calls — and serves
 * deterministic fixtures for the two hosts the domain talks to:
 *   - models.dev            → a fixture catalog for E1.4 assembly (anthropic with two valid models
 *                             + one boundary-schema reject, plus openai — allowlisted since ADR
 *                             0038 §1 — whose visibility the BYOK key gate decides per workspace);
 *   - gateway.ai.cloudflare.com → a canned Anthropic Messages response for E1.7/E1.8 completions;
 *   - auth.test.local       → the E4.2 hub-connect JWKS: the public half of a fixed Ed25519
 *                             keypair whose private half the hub-upgrade tests sign tokens with.
 *   - api.cloudflare.com    → an in-memory Secrets Store for E3.2 BYOK key registration: the
 *                             list/create/patch/delete subset the E3.1 client drives. State is a
 *                             module-level Map keyed by secret name (unique per workspace), so a
 *                             POST-then-DELETE round-trips faithfully. A create/patch whose value
 *                             equals CF_BYOK_WRITE_FAIL_KEY returns a 500 CF error envelope — the
 *                             per-test failure trigger travels in the request body (the raw key
 *                             the test POSTs), not a startup-time interceptor.
 * Everything else passes through. Response variation happens by inspecting the request here —
 * the outbound is fixed at miniflare startup, so there is no per-test interceptor registration.
 *
 * Plain JavaScript (.mjs) on purpose: miniflare auxiliary workers are not transpiled.
 */

// Raw-key sentinel: a POST/PATCH carrying this value makes the mock Secrets Store 500. Kept a
// plain const (not exported) — miniflare treats every named export of a module worker as a
// service entry and rejects non-handler exports. Tests mirror this literal locally.
const CF_BYOK_WRITE_FAIL_KEY = "cf-byok-write-should-fail";

/** In-memory Secrets Store: secret name → { id }. Persists across a file's tests (names unique). */
const secretsStore = new Map();
let secretSeq = 0;

const cfError = (status, message) =>
  Response.json({ errors: [{ message }] }, { status });

/** The list/create/patch/delete subset of the CF Secrets Store REST API the E3.1 client uses. */
const handleSecretsStore = async (request, url) => {
  const secretId = url.pathname.split("/secrets/")[1];

  if (request.method === "GET") {
    const search = url.searchParams.get("search") ?? "";
    const result = [...secretsStore.entries()]
      .filter(([name]) => name.includes(search))
      .map(([name, secret]) => ({ id: secret.id, name }));
    return Response.json({ result });
  }
  if (request.method === "POST") {
    const [entry] = await request.json();
    if (entry.value === CF_BYOK_WRITE_FAIL_KEY) {
      return cfError(500, "secret write rejected");
    }
    const id = `secret-${(secretSeq += 1)}`;
    secretsStore.set(entry.name, { id });
    return Response.json({ result: [{ id, name: entry.name }] });
  }
  if (request.method === "PATCH") {
    const body = await request.json();
    if (body.value === CF_BYOK_WRITE_FAIL_KEY) {
      return cfError(500, "secret write rejected");
    }
    return Response.json({ result: { id: secretId } });
  }
  if (request.method === "DELETE") {
    for (const [name, secret] of secretsStore) {
      if (secret.id === secretId) {
        secretsStore.delete(name);
      }
    }
    return Response.json({ result: { id: secretId } });
  }
  return cfError(405, "method not allowed");
};

const modelsDevFixture = {
  anthropic: {
    models: {
      "claude-test-haiku": {
        attachment: false,
        cost: { cache_read: 0.03, cache_write: 0.3, input: 0.25, output: 1.25 },
        id: "claude-test-haiku",
        limit: { context: 200_000, output: 4096 },
        name: "Claude Test Haiku",
        reasoning: false,
        release_date: "2026-03-01",
        structured_output: true,
        tool_call: true,
      },
      "claude-test-sonnet": {
        attachment: true,
        cost: { cache_read: 0.1, cache_write: 1, input: 1, output: 5 },
        id: "claude-test-sonnet",
        limit: { context: 200_000, output: 8192 },
        name: "Claude Test Sonnet",
        reasoning: true,
        release_date: "2026-01-01",
        structured_output: true,
        tool_call: true,
      },
      // Deliberately fails the boundary schema (no cost/limit): E1.4 must skip it, not fail.
      "malformed-model": { id: "malformed-model", name: "Malformed" },
    },
  },
  // ADR 0038 §1: openai is now allowlisted, so its models survive assembly. Whether they surface
  // to a workspace is decided by the BYOK key gate (see model-catalog-routing.integration).
  openai: {
    models: {
      "gpt-test": {
        attachment: true,
        cost: { cache_read: 0.1, cache_write: 1, input: 2, output: 8 },
        id: "gpt-test",
        limit: { context: 128_000, output: 16_384 },
        name: "GPT Test",
        reasoning: true,
        release_date: "2026-02-01",
        structured_output: true,
        tool_call: true,
      },
    },
  },
};

const anthropicMessageFixture = {
  content: [{ text: "mock gateway response", type: "text" }],
  id: "msg_mock_gateway",
  model: "claude-test-sonnet",
  role: "assistant",
  stop_reason: "end_turn",
  stop_sequence: null,
  type: "message",
  usage: { input_tokens: 1, output_tokens: 1 },
};

// E8.3: the curator DO (getSystemPrompt) pins a JSON `{reply, draft}` envelope contract; a plain
// free-text turn would fail its parse and surface curator_execution_failed. When the request's
// system prompt is the curator's, answer with a well-formed envelope so a real curator turn
// materializes an envelope-shaped CuratorTurn end to end. `draft` is null — the common
// early-interview turn (the manual E5.2 shape form remains the draft materialization path).
//
// Think drives the model with `streamText`, so the answer must be a real Anthropic Messages SSE
// stream (the non-streaming JSON fixture above is never consumed as text — the dispatch tests
// only assert the queue-time receipt, not the turn output). This is the first outbound path that
// exercises a real gateway turn end to end.
const CURATOR_SYSTEM_MARKER = "channel-authoring curator";

const curatorEnvelopeText = JSON.stringify({
  draft: null,
  reply: "Tell me more about the channel you want to build.",
});

/** A minimal single-text-block Anthropic Messages SSE stream carrying the curator envelope. */
const anthropicSseStream = (text) => {
  const event = (type, data) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  const body =
    event("message_start", {
      message: {
        content: [],
        id: "msg_mock_curator",
        model: "claude-sonnet-5",
        role: "assistant",
        stop_reason: null,
        stop_sequence: null,
        type: "message",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    }) +
    event("content_block_start", {
      content_block: { text: "", type: "text" },
      index: 0,
    }) +
    event("content_block_delta", {
      delta: { text, type: "text_delta" },
      index: 0,
    }) +
    event("content_block_stop", { index: 0 }) +
    event("message_delta", {
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 1 },
    }) +
    event("message_stop", {});

  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
};

const isCuratorRequest = async (request) => {
  const body = await request.clone().text().catch(() => "");
  return body.includes(CURATOR_SYSTEM_MARKER);
};

// E4.2: the public half of a fixed Ed25519 keypair (EdDSA — the better-auth JWT plugin's
// default). The hub-upgrade tests hold the private half and sign connect tokens with it; the
// hub fetches this set to verify. `kid` matches the token header so jose resolves it directly.
const hubJwksFixture = {
  keys: [
    {
      alg: "EdDSA",
      crv: "Ed25519",
      kid: "hub-test-key-1",
      kty: "OKP",
      use: "sig",
      x: "J8wEBy_lq4XDHlbgX7rIgZ8oS_LFYm9Xffjl848l2HY",
    },
  ],
};

// E6.3: a minimal Streamable-HTTP MCP server so the real ThreadAgent DO can `addMcpServer`
// against a live endpoint under miniflare and we can pin the ADR 0015 §4 persist/restore
// gotcha. Non-streaming JSON mode: initialize + tools/list answer with 200 application/json;
// the `notifications/initialized` notification answers 202. One tool ("echo") is advertised.
const MCP_SESSION_ID = "mcp-test-session-1";

const mcpToolsFixture = [
  {
    description: "Echo back the provided text (mock MCP tool).",
    inputSchema: {
      properties: { text: { type: "string" } },
      required: ["text"],
      type: "object",
    },
    name: "echo",
  },
];

const jsonRpcResult = (id, result) => ({ id, jsonrpc: "2.0", result });

const handleMcpRequest = async (request) => {
  if (request.method !== "POST") {
    // No standalone SSE stream — the client's `notifications/initialized` GET falls back here.
    return new Response(null, { status: 405 });
  }

  const message = await request.json().catch(() => null);
  if (message === null || message.method === undefined) {
    return new Response(null, { status: 400 });
  }

  // Notifications carry no id and expect a bodyless 202.
  if (message.id === undefined) {
    return new Response(null, { status: 202 });
  }

  const headers = { "mcp-session-id": MCP_SESSION_ID };

  if (message.method === "initialize") {
    return Response.json(
      jsonRpcResult(message.id, {
        capabilities: { tools: {} },
        protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
        serverInfo: { name: "mock-mcp", version: "0.0.0" },
      }),
      { headers }
    );
  }

  if (message.method === "tools/list") {
    return Response.json(
      jsonRpcResult(message.id, { tools: mcpToolsFixture }),
      {
        headers,
      }
    );
  }

  // Any other request (prompts/list, resources/list, ping…) gets an empty-ish ok result.
  return Response.json(jsonRpcResult(message.id, {}), { headers });
};

// E11.4: skill import (apps/server POST /skills/import). Two GitHub hosts back the SSRF-guarded
// control-plane egress — api.github.com for a single default-branch lookup, raw.githubusercontent
// for the SKILL.md — served deterministically here so no import test touches the real network. The
// domain never contacts either host; these fixtures exist purely for the server route tests.
const SKILL_MD_FIXTURE = `---
name: adr-consistency-reviewer
description: Cross-references every ADR against the ones it supersedes and flags conflicts.
license: MIT
---
# When reviewing ADRs

Cross-reference every decision against the ones it supersedes and flag conflicts.
`;

const SKILL_MD_NO_FRONTMATTER = `# Plain playbook

No frontmatter here — the importer falls back to the repo name.
`;

// Keyed by "owner/repo": the repos api.github.com knows (each on default branch "main"). A repo
// absent from this map 404s, exercising the not-found path.
const githubRepoFixtures = {
  "acme/api-forbidden": { status: 403 },
  "acme/api-rate-limited-403": { rateLimited: true, status: 403 },
  "acme/api-rate-limited-429": { status: 429 },
  "acme/html-page": { default_branch: "main" },
  "acme/huge": { default_branch: "main" },
  "acme/no-frontmatter": { default_branch: "main" },
  "acme/raw-forbidden": { default_branch: "main" },
  "acme/raw-rate-limited-403": { default_branch: "main" },
  "acme/raw-rate-limited-429": { default_branch: "main" },
  "acme/reviewer": { default_branch: "main" },
};

const handleGithubApi = (url) => {
  const match = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)$/u);
  const repo = match ? githubRepoFixtures[`${match[1]}/${match[2]}`] : undefined;
  if (!repo) {
    return Response.json({ message: "Not Found" }, { status: 404 });
  }
  if (repo.status !== undefined) {
    const headers = repo.rateLimited ? { "x-ratelimit-remaining": "0" } : {};
    return Response.json({ message: "Forbidden" }, { headers, status: repo.status });
  }
  return Response.json({ default_branch: repo.default_branch });
};

const handleGithubRaw = (url) => {
  // /{owner}/{repo}/{ref}/{...path}/SKILL.md — respond by the (owner/repo) prefix.
  const path = url.pathname;
  if (path === "/acme/reviewer/main/SKILL.md") {
    return new Response(SKILL_MD_FIXTURE, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (path === "/acme/reviewer/main/deep/path/SKILL.md") {
    return new Response(SKILL_MD_FIXTURE, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (path === "/acme/no-frontmatter/main/SKILL.md") {
    return new Response(SKILL_MD_NO_FRONTMATTER, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (path === "/acme/html-page/main/SKILL.md") {
    return new Response("<!doctype html><title>not markdown</title>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (path === "/acme/huge/main/SKILL.md") {
    return new Response("x".repeat(300 * 1024), {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (path === "/acme/raw-rate-limited-429/main/SKILL.md") {
    return new Response("Too Many Requests", { status: 429 });
  }
  if (path === "/acme/raw-rate-limited-403/main/SKILL.md") {
    return new Response("Forbidden", {
      headers: { "x-ratelimit-remaining": "0" },
      status: 403,
    });
  }
  if (path === "/acme/raw-forbidden/main/SKILL.md") {
    return new Response("Forbidden", { status: 403 });
  }
  return new Response("Not Found", { status: 404 });
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname === "api.github.com") {
      return handleGithubApi(url);
    }
    if (url.hostname === "raw.githubusercontent.com") {
      return handleGithubRaw(url);
    }
    if (url.hostname === "models.dev") {
      return Response.json(modelsDevFixture);
    }
    if (url.hostname === "gateway.ai.cloudflare.com") {
      if (await isCuratorRequest(request)) {
        return anthropicSseStream(curatorEnvelopeText);
      }
      return Response.json(anthropicMessageFixture);
    }
    if (url.hostname === "auth.test.local") {
      return Response.json(hubJwksFixture);
    }
    if (url.hostname === "api.cloudflare.com") {
      return handleSecretsStore(request, url);
    }
    if (url.hostname === "mcp.test.local") {
      return handleMcpRequest(request);
    }
    return fetch(request);
  },
};
