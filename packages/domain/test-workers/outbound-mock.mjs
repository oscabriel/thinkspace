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

export default {
  fetch(request) {
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
    return fetch(request);
  },
};
