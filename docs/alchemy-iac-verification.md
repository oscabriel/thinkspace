# Alchemy IaC verification — CF resources for the production adapters

**Date:** 2026-07-03
**Clone:** `~/Developer/clones/github.com/alchemy-run/alchemy` @ `d58304f8` (v0.93.12, clean)
**Project pin:** `alchemy@0.91.2` — every load-bearing claim below was re-verified against the
`v0.91.2` tag; the DO/D1/bindings/dev surfaces are **byte-identical or behaviorally identical**
at the pin. Version deltas are additive only (dev tunnels, AI-search bindings, local explorer).
**Method:** source-first read (replicant), scoped to what the production `ThreadAgent` DO and
D1 `TenantDataAccess` need from `packages/infra/alchemy.run.ts`.

## Verdict

Alchemy manages everything we need with **zero agents-SDK-specific support** — an `agents`
Agent class is, to alchemy, just a SQLite-backed Durable Object class exported from the
worker entrypoint. The existing `alchemy.run.ts` needs only: a `DurableObjectNamespace(...)`
per DO class bound into the `server` Worker, the class exports in `apps/server/src/index.ts`,
and new drizzle-generated migration files in the already-wired `migrationsDir`. No wrangler
config is hand-maintained; no migration tags are hand-written.

---

## 1. Durable Object namespaces

`DurableObjectNamespace(id, props)` (`alchemy/src/cloudflare/durable-object-namespace.ts:64-78`)
is a **pure plain-object factory** — no API call, no await. Props: `className` (required),
`sqlite?`, `scriptName?`, `environment?`, `namespaceId?`.

```ts
const threadAgent = DurableObjectNamespace("thread-agent", {
  className: "ThreadAgentDurableObject",
  sqlite: true,
});
// bound by name on the Worker:
//   bindings: { THREAD_AGENT: threadAgent }
// and the entrypoint MUST export `class ThreadAgentDurableObject ...`.
```

Load-bearing semantics:

- **The first arg is a stable identity, `className` is not.** Alchemy writes
  `alchemy:do:{stableId}:{bindingName}` + `alchemy:migration-tag:{tag}` tags onto the deployed
  worker (`worker-metadata.ts:261-284`) and diffs current bindings against them on every
  deploy. Same stable id + changed `className` → automatic `renamed_classes` migration
  (`worker-metadata.ts:716-721`). Binding disappears → `deleted_classes`
  (`worker-metadata.ts:287-341`). New stable id → `new_classes`/`new_sqlite_classes`
  (`:710-715`). Migration tags auto-bump `alchemy:v{N}` (`bumpMigrationTagVersion`, `:742-751`).
  **Never change the stable id of a live DO**, and never hand-write migrations.
- **`sqlite: true` has NO default and only matters at class creation** — it routes the new
  class into `new_sqlite_classes`. Omit it and the class is provisioned on the legacy KV
  backend **permanently** (the flag is not re-consulted later). The `agents` SDK stores
  everything in DO-SQLite (`cf_agents_*`, `cf_think_submissions`, `think_config` — see
  `docs/sdk-signature-verification.md`), so `sqlite: true` is **mandatory** for
  ThreadAgent/Curator/hub DOs. This is the sharpest footgun in the whole integration.
- **Migrations are configured only by the defining worker.** Cross-script consumers
  (`scriptName` set, or another worker binding `server.bindings.THREAD_AGENT`) skip migration
  config (`worker-metadata.ts:503-510`). `normalizeExportBindings` (`worker.ts:1431-1453`)
  stamps the owner's name onto `scriptName` at deploy, so re-binding a worker's DO elsewhere
  "just works" as a cross-script binding.
- Duplicate stable ids across a worker's DO bindings are a hard error
  (`worker-metadata.ts:404-417`).
- **agents SDK:** the alchemy repo has zero references to `agents`/`AIChatAgent`/
  `routeAgentRequest` — no helper, no template. Declare the Agent class like any DO.

## 2. D1Database + migrations

`alchemy/src/cloudflare/d1-database.ts` — byte-identical at v0.91.2. Our existing
`D1Database("database", { migrationsDir: "../../packages/db/src/migrations" })` already does
the right thing:

- SQL files are read eagerly at `D1Database()` call time (`:255-281`) and applied **when the
  D1 resource resolves — before any Worker that binds it** (the `DB: db` reference forces
  ordering). Migrations are decoupled from worker deploys.
- **Remote:** wrangler-compatible tracking table (default name `d1_migrations`) with
  `(id, name, applied_at)` (`d1-migrations.ts:154-158`); unapplied files are matched by
  filename and each file is sent as one HTTP query request (no transaction —
  `d1-migrations.ts:291-299`). Keep every migration file **individually atomic-ish and
  idempotent-shaped**; never edit an applied file (tracked by `name`).
- **Local dev:** a throwaway Miniflare applies migrations into the shared persist root
  (`d1-local-migrations.ts:13-92`), splitting on drizzle's `--> statement-breakpoint` (`:71`)
  — our drizzle-kit output is the expected dialect. Local tracking schema differs from remote
  by design (extra `type` column).
- drizzle-kit remains **generate-only** (`bun db:generate`); alchemy is the applier in both
  worlds. Don't introduce `drizzle-kit migrate`/wrangler-applied migrations alongside it.
- `primaryLocationHint` and `jurisdiction` are immutable after create; `readReplication` is
  the only mutable prop.

## 3. Bindings composition, cross-resource references

- `Bindings` is a name→resource record; `worker-metadata.ts:445-609` converts each resource
  object to its wire binding; `Bound<T>` (`bound.ts:52-129`) maps it to the runtime type —
  a DO binding becomes `DurableObjectNamespace<O & Rpc.DurableObjectBranded>` where `O` is the
  phantom class type: `DurableObjectNamespace<ThreadAgentDurableObject>("thread-agent", ...)`.
- Worker→Worker service bindings: bind the worker object itself; self-binding via `Self`.
  Circular topologies need `WorkerStub`/`WorkerRef` — avoid; our topology is acyclic.
- **TanStackStart** is `Vite`→`Website`→`Worker`; every binding except the reserved `ASSETS`
  passes through unchanged (`website.ts:282-299`, `tanstack-start.ts:14-17`). The web app
  _could_ take `server.bindings.THREAD_AGENT` as a cross-script DO binding, but our web→server
  path is HTTP (`VITE_SERVER_URL`), so we don't.

## 4. Env typing

**No codegen** (stated at `alchemy-web/.../concepts/bindings.md:70`). The Worker output type
carries a phantom `Env` (`worker.ts:768-773`, runtime `undefined!`). Two patterns:

1. `import type { server } from "@thinkspace/infra/alchemy.run"; type Env = typeof server.Env;`
2. Hand-written `env.d.ts` augmenting `cloudflare:workers`' `Cloudflare.Env`.

For `apps/server` (which needs `Env` inside the DO class), prefer pattern 1 as a type-only
import — it stays in lockstep with `alchemy.run.ts` with no generated file to drift. Watch the
import cycle shape: infra imports the server only as an entrypoint path string, so a
type-only import back is safe.

## 5. Local dev semantics (`alchemy dev`)

- One shared Miniflare 4.x instance hosts **all** alchemy-managed Workers
  (`miniflare-controller.ts:33-36,114-115`); DO + D1 are fully emulated with persistence at
  `<workspaceRoot>/.alchemy/miniflare/v3` (`paths.ts:21-24`).
- Website-style resources (our `web`) instead **spawn their own dev command** (vite) as a
  child process (`website.ts:346-373`). Cross-process DO access works via the wrangler dev
  registry (`unsafeDevRegistryDurableObjectProxy: true`, `miniflare-controller.ts:101-108`) —
  relevant only if the web app ever binds a DO directly.
- `Website` generates `.alchemy/local/wrangler.jsonc` (`WranglerJson`, `website.ts:314-326`)
  including `durable_objects.bindings` and `d1_databases` — available to tools that read
  wrangler config. Plain `Worker`s don't generate one; **the vitest-pool-workers contract-test
  harness should carry its own minimal test wrangler config** (declaring the DO classes + a
  test D1 seeded from `packages/db/src/migrations`) rather than depending on alchemy's dev
  artifacts.

## 6. Secrets/env (brief)

`alchemy.env.X` reads `process.env` (throws if unset, no dotenv auto-load — our explicit
`config()` calls stay). `alchemy.secret.env.X` is the same lookup wrapped in `Secret`.

---

## Consequences for `packages/infra/alchemy.run.ts` (the step-2 wiring)

```ts
import { D1Database, DurableObjectNamespace, TanStackStart, Worker } from "alchemy/cloudflare";
// unchanged: const db = await D1Database("database", { migrationsDir: ... });

const threadAgent = DurableObjectNamespace<ThreadAgentDurableObject>("thread-agent", {
  className: "ThreadAgentDurableObject",
  sqlite: true, // REQUIRED: agents SDK state lives in DO-SQLite; no alchemy default
});

export const server = await Worker("server", {
  bindings: {
    ...existing,
    DB: db,
    THREAD_AGENT: threadAgent,
  },
  compatibility: "node", // agents SDK needs nodejs_compat — already set
  ...
});
```

plus `export class ThreadAgentDurableObject ... from "@thinkspace/..."` in
`apps/server/src/index.ts`. Future DOs (curator: one per member+workspace; workspace/channel
hubs) follow the same pattern, each with its own immutable stable id.

Footguns to respect, in priority order:

1. `sqlite: true` on every agents-SDK DO — irreversible if forgotten at first deploy
   (recovery = new stable id = losing DO state).
2. Stable ids are forever; rename `className` freely, never the first argument.
3. Never edit an applied D1 migration file; alchemy tracks by filename.
4. The class export in the entrypoint must exactly match `className`, or deploy fails at
   upload time.
