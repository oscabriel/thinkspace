/**
 * Canonical outbound-service mock (BACKLOG E1.1 spike finding 5).
 *
 * Wired as miniflare `outboundService`, it intercepts every global-fetch egress from the test
 * workers at the workerd layer — including DO-originated absolute-URL calls — and serves
 * deterministic fixtures for the two hosts the domain talks to:
 *   - models.dev            → a fixture catalog for E1.4 assembly (one allowlisted provider with
 *                             two valid models + one boundary-schema reject, plus one
 *                             non-allowlisted provider that filtering must drop);
 *   - gateway.ai.cloudflare.com → a canned Anthropic Messages response for E1.7/E1.8 completions;
 *   - auth.test.local       → the E4.2 hub-connect JWKS: the public half of a fixed Ed25519
 *                             keypair whose private half the hub-upgrade tests sign tokens with.
 * Everything else passes through. Response variation happens by inspecting the request here —
 * the outbound is fixed at miniflare startup, so there is no per-test interceptor registration.
 *
 * Plain JavaScript (.mjs) on purpose: miniflare auxiliary workers are not transpiled.
 */

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
  // Not on the provider allowlist: assembly must drop the whole provider.
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

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname === "models.dev") {
      return Response.json(modelsDevFixture);
    }
    if (url.hostname === "gateway.ai.cloudflare.com") {
      return Response.json(anthropicMessageFixture);
    }
    if (url.hostname === "auth.test.local") {
      return Response.json(hubJwksFixture);
    }
    if (url.hostname === "mcp.test.local") {
      return handleMcpRequest(request);
    }
    return fetch(request);
  },
};
