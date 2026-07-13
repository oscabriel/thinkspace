# Cloudflare AI Gateway — Custom Provider API (primary-source research)

Research date: **2026-07-11**. Sources are Cloudflare's own docs (`developers.cloudflare.com`)
and the Cloudflare API schema docs. Every claim below carries a URL + verbatim quote/snippet.

This resolves the two facts ADR 0040 §7 records as UNVERIFIED:

1. the CF Custom Provider **provisioning API surface** (the write the stub
   `createUnverifiedCustomProviderProvisioner` skips), and
2. the **runtime route segment** the code assumes is `compat/<slug>`.

**Headline:** both assumptions in the code are wrong.
The route segment is **`custom-<slug>`**, not `compat/<slug>`; `compat` is a _different_
endpoint (the OpenAI-compatible Unified API), and when you use it the custom provider is
named in the **request body's `model` field** as `custom-<slug>/<model>`, not in the URL path.

---

## 1. Custom Provider management API (create / read / update / delete)

**Verified.** These live under `/accounts/{account_id}/ai-gateway/custom-providers`, on
`api.cloudflare.com/client/v4`, Bearer-token authenticated.

| Op       | Method + path                                                    |
| -------- | ---------------------------------------------------------------- |
| Create   | `POST /accounts/{account_id}/ai-gateway/custom-providers`        |
| List     | `GET /accounts/{account_id}/ai-gateway/custom-providers`         |
| Read one | `GET /accounts/{account_id}/ai-gateway/custom-providers/{id}`    |
| Update   | `PATCH /accounts/{account_id}/ai-gateway/custom-providers/{id}`  |
| Delete   | `DELETE /accounts/{account_id}/ai-gateway/custom-providers/{id}` |

Source: <https://developers.cloudflare.com/api/resources/ai_gateway/subresources/custom_providers/methods/create/>
and the resource index <https://developers.cloudflare.com/api/resources/ai_gateway/>.

> "**Create a Custom Provider:** `POST /accounts/{account_id}/ai-gateway/custom-providers`"
> "**Delete a Custom Provider:** `DELETE /accounts/{account_id}/ai-gateway/custom-providers/{id}`"

Auth: every endpoint requires `Authorization: Bearer $CLOUDFLARE_API_TOKEN`
(<https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/>):

> "All endpoints require header: `Authorization: Bearer $CLOUDFLARE_API_TOKEN`"

### Create request body

Required: `name`, `slug`, `base_url`. Optional: `description`, `link`, `enable`, `beta`,
`curl_example`, `js_example`, `headers`, `position`.

> "**Required Request Body Fields:** `base_url: string`, `name: string`, `slug: string`.
> **Optional:** `beta: boolean`, `curl_example: string`, `description: string`,
> `enable: boolean`, `headers: string`, `js_example: string`, `link: string`, `position: number`"
> — <https://developers.cloudflare.com/api/resources/ai_gateway/subresources/custom_providers/methods/create/>

Note `headers` is a **string** (not an object) — it carries default headers baked into the
provider config. `base_url` is the upstream root.

### Response shape

```json
{
  "result": {
    "id": "string",
    "base_url": "string",
    "created_at": "string",
    "modified_at": "string",
    "name": "string",
    "slug": "string",
    "beta": "boolean?",
    "curl_example": "string?",
    "description": "string?",
    "enable": "boolean?",
    "headers": "string?",
    "js_example": "string?",
    "link": "string?",
    "logo": "string?",
    "position": "number?"
  },
  "success": "boolean"
}
```

Source: <https://developers.cloudflare.com/api/resources/ai_gateway/>. A default SVG logo is
auto-generated and returned base64-encoded (custom-providers config page).

### API token permission scope

**Verified (config page) / not restated in API schema.** The config page names the scope:

> "Required scope: **AI Gateway - Edit**"
> — <https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/>

(The per-method API schema page does not restate the scope; the config page is the source.)

---

## 2. Runtime request routing — the route segment

**REFUTED: it is NOT `compat/<slug>`.** There are two distinct request styles; neither
matches the code's current `${GW}/compat/${slug}` construction.

### (a) Provider-specific endpoint — segment is `custom-<slug>`

> "`https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/custom-{slug}/{provider-path}`"
> "Everything after `custom-{slug}/` in your request URL is appended directly to the
> `base_url` to form the final upstream URL."
> — <https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/>

The slug in the URL **must** carry the `custom-` prefix:

> "All custom provider slugs must be prefixed with `custom-` when making requests through
> AI Gateway. For example, if your provider slug is `some-provider`, you must use
> `custom-some-provider` in your requests."

So for an OpenAI-compatible upstream whose `base_url` is `https://api.myprovider.com`, the
call `.../custom-my-openai-compat/v1/chat/completions` proxies to
`https://api.myprovider.com/v1/chat/completions`. The `base_url` holds only the **root**;
the API path (`/v1/chat/completions`) lives in the request URL, appended after `custom-<slug>/`.

### (b) Unified API (OpenAI-compat) — segment is `compat`, slug goes in the body

This is where `compat` actually appears — but it is a _fixed_ endpoint, and the custom
provider is selected by the **`model` field**, not a path segment:

> "`https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/compat/chat/completions`"
> "Specify the model using the format `custom-{slug}/{model-name}`."
> — <https://developers.cloudflare.com/ai-gateway/configuration/custom-providers/>
> and <https://developers.cloudflare.com/ai-gateway/usage/chat-completion/>

So the correct Unified-API shape is:

- URL: `${GW}/compat/chat/completions` (no slug in the path)
- body: `{ "model": "custom-<slug>/<model>", ... }`

The code's `${GW}/compat/${slug}` + SDK-appended `/chat/completions` yields
`${GW}/compat/<slug>/chat/completions` — which is **neither** valid shape (it injects the
slug as a path segment the `compat` endpoint does not expect, and drops the required
`custom-` prefix + body-model form).

### BYOK / Secrets Store interaction with custom providers

**Partially documented — a real caveat for this repo.**

- BYOK generally: keys are stored in Secrets Store; at runtime the gateway injects them.
  The alias selector header is `cf-aig-byok-alias`, default alias is `default`:
  > "When making requests, AI Gateway uses the key with the `default` alias by default. To
  > use a different key, include the `cf-aig-byok-alias` header with the alias of the key
  > you want to use." — <https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/>
- Secret naming format (API path): `{gateway_id}_{provider_slug}_{alias}`, e.g.
  `my-gateway_anthropic_default`.
  > "Name the secret with this format: `{gateway_id}_{provider_slug}_{alias}`"
  > — BYOK page. **Open:** what `{provider_slug}` is for a custom provider (bare slug vs
  > `custom-<slug>`) is not documented.
- Custom-provider caveat: the custom-providers docs example still passes the **provider's
  own key** in the request:

  > "`-H "Authorization: Bearer $PROVIDER_API_KEY"` … `-H "cf-aig-authorization: Bearer $CF_AIG_TOKEN"`"
  > — custom-providers page.

  i.e. the docs do **not** show BYOK/Secrets-Store key _substitution_ for custom providers
  the way native providers get it. The safe, documented path for a custom provider is to
  **send the real provider key verbatim** on the upstream auth header — which is exactly
  what this repo's ADR 0040 _envelope_ (header) adapter already does. The legacy
  _alias/blank-header_ substitution path is **unverified for custom providers**.

---

## 3. Constraints

- **Slug rules:** alphanumeric with hyphens; unique within the account.
  > "Slug rules: `alphanumeric with hyphens` and `must be unique within your account`"
  > — custom-providers page (via `-` prefix requirement at request time).
- **Base URL:** must be a valid **HTTPS** URL; HTTP not supported; root only (no
  `/v1/chat/completions` in `base_url` — that goes in the request path).
  > "Must be a valid HTTPS URL — HTTP URLs are not supported."
- **Max providers per gateway/account:** **no documented limit.** (Not stated on any page
  fetched — treat as unbounded but unverified for ~124 providers.)
- **Arbitrary hosts:** yes — any HTTPS endpoint is allowed as `base_url`; that is the whole
  point of custom providers ("any AI provider that has an HTTPS API endpoint").
- **Streaming:** **not explicitly documented** on the custom-providers or chat-completion
  pages. The OpenAI-compatible Unified API mirrors OpenAI's `stream: true` semantics in
  practice, but there is no verbatim custom-provider streaming guarantee. Treat as
  "expected to work, unverified."

---

## 4. API version / changelog dates (this area is new)

Source: <https://developers.cloudflare.com/ai-gateway/changelog/>

- **2025-06-03** — "AI Gateway adds OpenAI compatible endpoint" (the `compat` Unified API).
- **2025-08-25** — "Manage and deploy your AI provider keys through BYOK … now powered by
  Cloudflare Secrets Store" (BYOK moved onto Secrets Store; the
  `{gateway_id}_{provider_slug}_{alias}` naming dates from here).
- **2026-05-21** — "Call any AI model through AI Gateway's new REST API" (the
  `api.cloudflare.com` AI REST endpoints).

Custom providers themselves have **no dedicated changelog entry**, consistent with the
feature being newer/less-documented than native providers — matches ADR 0040 §7's caution.

---

## Open questions (still unverified against a live gateway)

1. **`{provider_slug}` in the BYOK secret name for a custom provider** — bare slug or
   `custom-<slug>`? Undocumented. Only matters if we adopt the alias/substitution path.
2. **Does BYOK key substitution work at all for custom providers?** Docs show the provider
   key passed inline; no example of a stored-key substitution for a custom provider.
3. **Max custom providers per account** for the ~124-provider fan-out — no published limit.
4. **Streaming** guarantee for custom providers — not documented.
5. **`headers` field semantics** (string form) — whether it is raw HTTP header lines or a
   JSON string; the create schema only says `headers: string`.

---

## Implications for the provisioner adapter and `model-gateway.ts`

Comparing verified facts to what the code assumes today:

### `custom-provider.ts` (`createUnverifiedCustomProviderProvisioner`)

- The provisioning write is now **fully specified**: `POST
/accounts/{account_id}/ai-gateway/custom-providers` with body
  `{ name, slug, base_url }` (+ optional `enable`), Bearer `$CLOUDFLARE_API_TOKEN`,
  scope **AI Gateway - Edit**. Idempotency: the API rejects a duplicate `slug`
  ("unique within your account"), so `ensureProvider` should treat a create-conflict
  (or a prior `GET .../custom-providers/{id}` / list hit) as success — not a 200-only path.
- `CustomProviderRoute { slug, upstreamBaseUrl }` maps cleanly: `slug → slug`,
  `upstreamBaseUrl → base_url`. Caveat: `base_url` must be the **root** (HTTPS), so if
  models.dev's `api` already includes `/v1`, that path must move out of `base_url` into
  the request path (see below) — or the provider must be created with the `/v1`-bearing
  base_url and the request path adjusted accordingly. This base_url/path split is the main
  design decision the real adapter must pin down.
- The stub's "best-effort, first-run-confirms" posture remains reasonable, but the write is
  no longer "underdocumented" — it can be implemented and verified now.

### `model-gateway.ts` (`AI_GATEWAY_CUSTOM_PROVIDER_SEGMENT = "compat"` + `genericGatewayBaseUrl`)

- **`AI_GATEWAY_CUSTOM_PROVIDER_SEGMENT = "compat"` is wrong** for the provider-specific
  route and misleading for the Unified route. Correct choices:
  - **Provider-specific route** (recommended, matches the SDK's `${baseURL}/chat/completions`
    call): segment is `custom-<slug>`, and `base_url` holds the upstream root. To land the
    upstream `/v1/chat/completions`, baseURL should be
    `${GW}/custom-${slug}/v1` (so the SDK appends `/chat/completions`). Constant should be
    `"custom-"` used as a **prefix on the slug**, not a standalone path segment.
  - **Unified route** (`compat`): baseURL is `${GW}/compat` and the model passed to
    `.chat()` must be `custom-<slug>/<model>` — i.e. the slug leaves the URL entirely and
    joins the model string. This changes `createGenericGatewayModel`: it would pass
    `custom-${slug}/${modelSlug}` to `.chat()` instead of bare `modelSlug`.
- Today `genericGatewayBaseUrl` builds `${GW}/compat/${slug}`; the SDK then posts
  `${GW}/compat/${slug}/chat/completions`. This is a **third, non-existent shape** — it will
  404/misroute at the gateway (surfacing as the ADR 0028 first-run failure the comment
  predicts, so the "first run confirms" contract holds, but it will never succeed).
- **Auth:** the verbatim-header (envelope) path is the safe, documented one for custom
  providers — keep sending the real provider key on `Authorization`/`x-api-key`. The
  alias/blank-header substitution path (legacy adapter) is **unverified for custom
  providers**; do not assume the gateway substitutes a Secrets Store secret for a
  `custom-<slug>` route.
