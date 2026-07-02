# SDK signature verification — the ADR 0015 matched set at `2351e5c`

**Date:** 2026-07-01
**Clone:** `~/Developer/clones/github.com/cloudflare/agents` @ `2351e5c1256e012398ad02e551e077865eea1b5b` (clean)
**Method:** source-first read of the pinned clone (no docs, no web), verified against the
`packages/domain` seams and ADRs 0002/0005/0006/0007/0010/0015/0016/0017/0025–0030.
All `file:line` references below are paths inside the clone at that commit.

## Verdict

The **matched set is confirmed at this commit**: `agents@0.17.1`, `@cloudflare/think@0.11.1`,
`@cloudflare/shell@0.4.1`. All five ADR 0015 §3 gotchas are **real, load-bearing behaviors**
at this commit — and two of them are _sharper_ than the ADR text assumes:

1. **MCP persist/restore bypasses add-time gates.** The hibernation-restore path reconnects
   straight from the persisted SQLite row and never re-runs `addMcpServer`, `registerServer`,
   or even the built-in SSRF guard. An egress allowlist enforced only at add-time is silently
   bypassed on every DO wake. See §4.
2. **The readonly-connection boundary is narrower than "authz boundary" implies.** It gates
   exactly two paths (client state-push, context-scoped `setState`); it does **not** gate
   `@callable` RPC, raw `onMessage` frames, or server-side `_setStateInternal`. See §5.

**Package-name corrections** (ADR 0015 wording): the packages are `agents` (not
`@cloudflare/agents`) and `@cloudflare/think` (not `think`). ADR 0002's
`this.mcp.addMcpServer(...)` is wrong — the method lives on the **Agent**:
`this.addMcpServer(...)` (corrected in the ADR).

---

## 1. Think agent class — `ThreadAgent` / `CuratorAgent` adapters

Class: `Think<Env, State, Props> extends Agent<Env, State, Props>` — `think/src/think.ts:2391`.
Import: `import { Think } from "@cloudflare/think"`. (ADR 0015's `BespokeAgent` is our
anti-corruption facade name, not an SDK symbol.)

### Config-as-data — VERIFIED, adapter-enforced shape

`configure<T>(config: T): void` / `getConfig<T>(): T | null` — `think.ts:3525/3539`.
Persisted as opaque JSON under key `_think_config` in DO-SQLite table `think_config`
(DDL `think.ts:3587`); survives hibernation; in-memory cached.

**Caveat:** the SDK never reads model/tools/prompt out of the config. Behavior is driven by
the overridden sync accessors — the adapter must call `getConfig()` _inside_
`getModel()/getTools()/getSystemPrompt()` to make the shape snapshot data-driven. ADR 0007's
"structure frozen, content live" split is SDK-supported but adapter-enforced.

### Sync accessors — VERIFIED

```ts
getModel(): LanguageModel   // think.ts:3628 — throws if not overridden
getSystemPrompt(): string   // think.ts:3636
getTools(): ToolSet         // think.ts:3647
```

All three synchronous; called sync in the turn path (`think.ts:4968/5011/5026`). By contrast
`getActions()` and `configureSession()` MAY return promises.

### `beforeTurn` — VERIFIED additive-only

```ts
beforeTurn(ctx: TurnContext): TurnConfig | void | Promise<TurnConfig | void>  // think.ts:4394
```

`TurnContext = { system, messages, tools, model, continuation, body? }` (`think.ts:1888`).
The merge is an object spread — `{ ...tools, ...config.tools }` (`think.ts:5058`): add or
same-name override only, **never remove**. Narrowing goes through `TurnConfig.activeTools:
string[]` / `toolChoice` (AI SDK), which restrict callability without deleting. True removal
exists only in the channel-definition `tools(tools)` transformer, applied _before_ beforeTurn
(`think.ts:5000`).

### Runs are "submissions" — naming map

The SDK has no "run" primitive; the durable-queued turn is a **submission**
(table `cf_think_submissions`, DDL `think.ts:8691`).

| Domain seam (`seams/thread-agent.ts`) | SDK                                                                                                                                                        |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run(RunTrigger)`                     | `submitMessages(messages, {submissionId, idempotencyKey, metadata})` — `think.ts:9302`                                                                     |
| `getRun({runId})`                     | `inspectSubmission(submissionId)` — `think.ts:9157`                                                                                                        |
| `listRuns()`                          | `listSubmissions(options?)` — `think.ts:9164`                                                                                                              |
| `RunId`                               | `submissionId`                                                                                                                                             |
| `Run.status`                          | `ThinkSubmissionStatus = "pending"\|"running"\|"completed"\|"aborted"\|"skipped"\|"error"` — `think.ts:1701`                                               |
| `SubAgentActivity`                    | table `cf_agent_tool_child_runs` (DDL `think.ts:6897`); child DOs via `subAgent(cls, runId)`                                                               |
| `appendComment`                       | `addMessages(messages, {parentId?, mode?})` — `think.ts:9864` — appends to the Session message tree **without** enqueuing a turn; idempotent by message id |

The Session message tree is branched by `parentId` — it directly models the ADR 0016/0025
comment tree (ancestors + subtree loads walk this tree). `saveMessages` (`think.ts:9824`)
DOES trigger a turn — never use it for `appendComment`.

### Curator sessions — SEMANTIC MISMATCH, resolved by DO-per-member

Think's `Session` (from `agents/experimental/memory/session`, wired via
`configureSession()` — `think.ts:4268`) is **one transcript tree per DO instance**. There is
no per-member session multiplexer and no `startSession()` API. The `CuratorAgent` seam's
per-member isolation (ADR 0026) must be realized as **one curator DO instance per
member+workspace** — `CuratorSessionId` maps to a DO _name_, not an SDK session handle.
`send()` maps to `submitMessages`/`runTurn` on that DO.

---

## 2. Scheduling — `ThreadAgent.schedule`

### API — VERIFIED (on base `Agent`, `agents/src/index.ts`)

```ts
schedule<T>(when: Date | string | number, callback: keyof this, payload?: T,
            options?: { retry?: RetryOptions; idempotent?: boolean }): Promise<Schedule<T>>  // index.ts:4422
scheduleEvery<T>(intervalSeconds: number, callback: keyof this, payload?: T, ...)            // index.ts:4483
getScheduleById(id): Promise<Schedule<unknown> | undefined>   // index.ts:4569 (preferred; getSchedule deprecated)
listSchedules(criteria?): Promise<Schedule<unknown>[]>        // index.ts:4606 (preferred; getSchedules deprecated)
cancelSchedule(id): Promise<boolean>                          // index.ts:4630
```

Kind is discriminated by the **runtime type of `when`**: `Date` → `scheduled`, `number` →
`delayed`, `string` → `cron`. Persisted in DO-SQLite `cf_agents_schedules`
(DDL `index.ts:1930`); a single DO alarm drives firing; callback invoked as
`this[callback](parsedPayload, schedule)` (`index.ts:6211`). `scheduleEvery` caps at 30 days
(DO alarm max). Payload is `JSON.stringify`-round-tripped — **`Date` does not survive**.

**Naming trap:** `agents` exports the runtime `Schedule` type (`index.ts:549`);
`agents/schedule` exports a _different_ `Schedule` — a Zod schema for LLM natural-language
schedule parsing (`schedule.ts:134`). Import from `"agents"` only.

### Domain `Schedule` vs SDK — NOT ISOMORPHIC

| Domain field (`run.ts`)                      | SDK                           | Verdict                                                    |
| -------------------------------------------- | ----------------------------- | ---------------------------------------------------------- |
| `id: ScheduleId` (caller-minted)             | nanoid(9) generated at insert | mismatch — external id map needed                          |
| `recurrence: RecurrenceRule`                 | cron string only              | mappable iff recurrence is plain cron                      |
| `active: boolean`                            | none                          | mismatch — pause = cancel; resume = re-create (new SDK id) |
| `createdAt`, `createdByMemberId`, tenant ids | none                          | carry in payload (as ISO string) or own store              |

**Adapter pattern:** the domain store is the source of truth; the SDK is purely the alarm
mechanism. The seam's `schedule(input) => AsyncResult<Schedule, …>` echoes back the domain
Schedule it was given — never surface the SDK-generated id as `ScheduleId`.

---

## 3. MCP client — `ToolResolver` / `McpEgressPolicy` adapters

### Surface — VERIFIED

Paved entry is **`Agent.addMcpServer`** (`index.ts:12140` RPC overload, `:12154` HTTP
overload) — _not_ a method on `this.mcp`. The manager `MCPClientManager`
(`agents/src/mcp/client.ts:332`, constructed in the Agent ctor at `index.ts:2253`) exposes
`registerServer(id, options)` (`client.ts:1176`) + `connectToServer(id)` (`client.ts:1231`)
(+ deprecated `connect`). Transport: streamable-http/SSE/RPC, `type: "auto"` default; bearer
headers via `transport.headers`.

Tools surface via `getAITools(filter?)` (`client.ts:1626`), namespaced
`tool_${serverId}_${name}`; per-**server** filtering exists (`MCPServerFilter`,
`client.ts:320`) but no per-tool filter. **Think spreads `getAITools()` unfiltered into the
turn tool set** (`think.ts:4988`) — our catalog∩workspace∩shape narrowing (ADR 0004) is
entirely adapter work in `getTools()`.

### Persist/restore across hibernation — VERIFIED, and it's the critical path

Servers persist in DO-SQLite `cf_agents_mcp_servers` (DDL `index.ts:1909`; row includes
`server_url`, transport options, OAuth `client_id`/`auth_url`). On DO wake, `onStart` calls
`this.mcp.restoreConnectionsFromStorage(...)` + `this._restoreRpcMcpServers()`
(`index.ts:2641`), which reconnect **directly from the stored rows**:
`restoreConnectionsFromStorage` (`client.ts:784`) → `createConnection` → `connectToServer` →
transport connect. OAuth tokens live separately in DO KV under
`/{clientName}/{serverId}/...` and reconnect silently when valid.

**The restore path runs NO gate.** `isBlockedUrl` (SSRF-only, private-IP blocking,
`client.ts:199`) is called only from `registerServer`/deprecated `connect` — not from the
restore path. There is no allowlist or authorize hook anywhere in the MCP client.
Consequences for ADR 0002 enforcement (`McpEgressPolicy.authorize`):

- **Gate before persistence** — authorize must pass before `addMcpServer`/`registerServer`
  ever writes the row. The persisted `server_url` is trusted verbatim on every wake.
- **Revocation must delete the row** — `removeMcpServer(id)` (`index.ts:12484`) →
  `removeServer` (`client.ts:1788`) deletes the SQLite row. `closeConnection` does NOT
  (explicitly documented: the server restores on next wake, `client.ts:1706`). A host removed
  from the workspace allowlist must trigger `removeMcpServer`, or it reconnects forever.
- **OAuth-token residue:** `removeServer` does not purge the `/{clientName}/{serverId}/...`
  KV keys — tokens for a removed server persist in DO storage. Revocation-completeness needs
  an explicit KV sweep (or accept the residue consciously).

OAuth flow (`DurableObjectOAuthClientProvider`, callback via
`isCallbackRequest`/`handleCallbackRequest` — `client.ts:1306/1406`) is paved; wired
automatically at `index.ts:12580`.

---

## 4. Core DO surface — hubs, addressing, connections

### Addressing + RPC — VERIFIED

- `getAgentByName(namespace, name, options?)` — `index.ts:12877` (partyserver
  `getServerByName`; named-DO addressing).
- `routeAgentRequest(request, env, options?)` — `index.ts:12694` — routes
  `/agents/{kebab-class}/{instance-name}`.
- WS RPC only through `@callable()`-decorated methods (`index.ts:507`; enforced
  `index.ts:2394`). Server→sub-agent RPC via `subAgent(cls, name)` (`index.ts:7924`).
- `broadcast(msg, without?)` (`index.ts:6840`), `getConnections(tag?)` (`index.ts:6875`),
  per-connection `state`/`setState`/tags (partyserver `Connection`, re-exported
  `index.ts:143`).

### Readonly connections — VERIFIED, but the boundary is NARROW

Marked via override `shouldConnectionBeReadonly(conn, ctx)` (`index.ts:3059`) or
`setConnectionReadonly(conn, true)` (`index.ts:2975`); flag survives hibernation.

**Enforced:** (a) inbound client state-update messages rejected (`index.ts:2353`);
(b) `setState()` called within a readonly connection's agent-context throws
(`index.ts:2828`). Readonly connections **still receive** all state broadcasts and the
on-connect state push — readonly gates writes, not reads.

**NOT enforced:** `@callable` RPC invocations (no readonly check on the RPC branch,
`index.ts:2384`), raw `onMessage` frames, and server-side `_setStateInternal`. The
ADR 0015 "readonly-connection authz boundary" is app-cooperative: hub adapters must do their
own authz inside every callable/message handler. Contract tests should pin **both** the
enforced paths and the non-enforced RPC path (so an SDK bump that changes either is caught).

### `think/channels` is NOT a hub primitive — MISMATCH

`think/src/channels/index.ts` is config-as-data **ingress/delivery routing**
(messenger/web/voice surfaces): no presence, no roster, no `publishEvent` fan-out, no thread
lifecycle. The `WorkspaceHub`/`ChannelHub` seams (ADR 0010) map to **custom DOs built on the
`agents` surface** above (per-DO state + `broadcast` + tagged connections +
`getAgentByName` sharding) — exactly as the ADR assumed. Nothing to reuse from
`think/channels` for hubs.

Email/HTTP ingress exists if needed: `onRequest(request)` (`index.ts:2316`),
`onEmail(AgentEmail)` + `routeAgentEmail` (`index.ts:3218/12796`).

---

## 5. Shell virtual FS — `ArtifactStore` / `SkillStore` adapters

Three distinct FS-shaped surfaces in `@cloudflare/shell` — do not conflate:

1. **`FileSystem`** (`shell/src/fs/interface.ts:52`) — 19-method minimal interface
   (read/write/bytes/stat/mkdir/readdir/rm/cp/mv/symlink/`glob`). No grep. Implementations:
   `InMemoryFs`, `WorkspaceFileSystem`.
2. **`StateBackend`** (`shell/src/backend.ts:275`) — the rich 47-method surface;
   grep lives here (`searchText`/`searchFiles`/`find`, `backend.ts:299-314`). Derived
   generically from any `FileSystem` via `FileSystemStateBackend` (`memory.ts:85` — the
   plug-in seam: implement `FileSystem`, pass it in).
3. **`Workspace`** (`shell/src/filesystem.ts:223`) — the durable store.
   `WorkspaceOptions = { sql (REQUIRED), namespace?, r2?, r2Prefix?, inlineThreshold? (1.5MB) }`
   (`filesystem.ts:96`). **SQL is mandatory; R2 is only a large-blob spill target** above
   `inlineThreshold`. Tenancy via `namespace` → table `cf_workspace_<ns>`. Null-returning
   reads (vs throwing `FileSystem`), `FileInfo` carries `mimeType` — the only metadata field.

**There is no standalone R2-backed FileSystem.** The R2 artifact store is either `Workspace`
(dragging in DO-SQLite/D1 for content rows) or a hand-rolled `FileSystem` over `R2Bucket`.

### `ArtifactStore` mapping

| Seam op           | Primitive                                                                        | Status                                             |
| ----------------- | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| `put`             | `Workspace.writeFileBytes(path, data, mimeType)` (`filesystem.ts:611`) or raw R2 | implementable                                      |
| `get`             | `Workspace.readFileBytes` (null on miss)                                         | implementable                                      |
| `search` lexical  | `StateBackend.searchText/searchFiles` = content-scan **grep**, not an index      | gap — adapter builds its own index or accepts grep |
| `search` metadata | nothing — `Workspace` has no metadata columns beyond `mimeType`/`size`           | gap — adapter-owned D1 index (as ADR 0006 assumed) |

All rich `Artifact` fields (`homeChannelId`, `mediaKind`, `origin`, `r2Key`, …) are
adapter-owned records; shell is only the blob layer.

### `SkillStore` mapping — skills are `agents/skills`, not shell

Think loads skills via `agents/skills` (`SkillRegistry`, injected as context block
`think_skills` — `think.ts:4288-4311`), **not** through shell's FS. The R2 source:

- `r2(bucket, { prefix?, fingerprint?, refreshIntervalMs? })` — `agents/src/skills/r2.ts:195`.
- Layout: one directory per skill with top-level `SKILL.md` (`r2.ts:217`); resources under
  `references/`/`scripts/`/`assets/`. Frontmatter requires `name` + `description`
  (`frontmatter.ts:31` returns null otherwise — a malformed skill silently disappears).
- **`SkillSource` is read-only** (`list`/`load`/`readResource` — `types.ts:84`).
  `SkillStore.create/update` = direct `R2Bucket.put` of `<dir>/SKILL.md` + adapter-owned D1
  records; re-index is passive (fingerprint/refresh-interval).
- **Keying mismatch:** shell keys skills by frontmatter `name` (`r2.ts:277`); the seam keys
  by `SkillId` with adapter-minted `r2Key` — the adapter owns the lookup table. Matches
  ADR 0005/0029.

---

## Contract tests to pin against real SDK adapters (the ADR 0015 §3 CI gate)

When production adapters exist, pin these — each is a verified behavior that an SDK bump
could silently change:

1. `getModel`/`getTools`/`getSystemPrompt` remain sync (a bump making them async breaks the
   config-as-data wake path).
2. `beforeTurn` tool merge remains additive (spread semantics at the `think.ts:5058` analog).
3. MCP: a server row in `cf_agents_mcp_servers` reconnects on wake **without** re-invoking
   any adapter gate → assert the egress gate runs before persistence AND that
   `removeMcpServer` deletes the row (revocation actually stops reconnection).
4. Readonly connections: state-push rejected + context-scoped `setState` throws, **and**
   `@callable` RPC still goes through (documenting the gap our hub authz must cover).
5. `configure()/getConfig()` round-trip through `think_config` across a simulated restart.
6. `addMessages` appends without enqueuing a submission; `submitMessages` round-trips
   `submissionId` ↔ `RunId` and `ThinkSubmissionStatus` ↔ `Run.status`.
7. Schedule: domain-id ↔ SDK-id mapping survives; cancel-on-deactivate works; cron-only
   recurrence enforced at the boundary.

## Corrections applied to docs alongside this verification

- ADR 0002: `this.mcp.addMcpServer(...)` → `this.addMcpServer(...)`; consequence added for
  the restore-path bypass + row-deletion revocation requirement.
- ADR 0015 package names noted above (`agents`, `@cloudflare/think`) — ADR text left as-is;
  this document is the authoritative signature reference.
