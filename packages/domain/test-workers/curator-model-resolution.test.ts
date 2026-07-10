import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, test } from "vitest";

import { encodeCuratorAddress } from "../src/adapters/curator-address";
import type { CuratorAgentDurableObject } from "../src/adapters/production/curator-agent";
import { resolveCuratorModelId } from "../src/adapters/production/model-routing";
import { formatModelId } from "../src/ids";
import type { TenantContext } from "../src/seams/tenant-data-access";
import { memberId, unwrapOk, workspaceId } from "../src/testing";

/** getModel returns `string | LanguageModelV3`; narrow the union to the constructed model's slug. */
const modelSlugOf = (instance: CuratorAgentDurableObject): string => {
  const built = instance.getModel();
  return typeof built === "string" ? built : built.modelId;
};

const anthropicModelId = formatModelId("anthropic", "claude-sonnet-5");
const openAiModelId = formatModelId("openai", "gpt-5.5");

const contextFor = (ws: string): TenantContext => ({
  memberId: memberId("member-curator-model"),
  role: "member",
  workspaceId: workspaceId(ws),
});

/** Seed a keyed-provider row with an explicit created_at so ordering is deterministic. */
const keyProvider = (input: {
  readonly createdAt: number;
  readonly provider: string;
  readonly workspaceId: string;
}) =>
  env.DB.prepare(
    "INSERT INTO workspace_provider_key (workspace_id, provider, created_at) VALUES (?1, ?2, ?3)"
  )
    .bind(input.workspaceId, input.provider, input.createdAt)
    .run();

// No injected allowlist: since E9.1 the production list carries anthropic + openai, so the
// suite pins the exact resolution a live edge performs.
const resolve = (ws: string) =>
  resolveCuratorModelId({
    context: contextFor(ws),
    db: env.DB,
  });

describe("resolveCuratorModelId — earliest-keyed curator provider (ADR 0038 §2)", () => {
  test("an openai-only-keyed workspace resolves the openai default model", async () => {
    const ws = "ws-curmodel-openai-only";
    await keyProvider({ createdAt: 1000, provider: "openai", workspaceId: ws });

    expect(await resolve(ws)).toBe(openAiModelId);
  });

  test("an anthropic-only-keyed workspace is unchanged from pre-0038 behaviour", async () => {
    const ws = "ws-curmodel-anthropic-only";
    await keyProvider({
      createdAt: 1000,
      provider: "anthropic",
      workspaceId: ws,
    });

    expect(await resolve(ws)).toBe(anthropicModelId);
  });

  test("a two-provider workspace picks the earlier created_at (openai first)", async () => {
    const ws = "ws-curmodel-openai-first";
    await keyProvider({ createdAt: 1000, provider: "openai", workspaceId: ws });
    await keyProvider({
      createdAt: 2000,
      provider: "anthropic",
      workspaceId: ws,
    });

    expect(await resolve(ws)).toBe(openAiModelId);
  });

  test("a two-provider workspace picks the earlier created_at (anthropic first)", async () => {
    const ws = "ws-curmodel-anthropic-first";
    await keyProvider({
      createdAt: 1000,
      provider: "anthropic",
      workspaceId: ws,
    });
    await keyProvider({ createdAt: 2000, provider: "openai", workspaceId: ws });

    expect(await resolve(ws)).toBe(anthropicModelId);
  });

  test("a created_at tie breaks on provider ASC (anthropic < openai)", async () => {
    const ws = "ws-curmodel-tie";
    await keyProvider({ createdAt: 5000, provider: "openai", workspaceId: ws });
    await keyProvider({
      createdAt: 5000,
      provider: "anthropic",
      workspaceId: ws,
    });

    expect(await resolve(ws)).toBe(anthropicModelId);
  });

  test("a workspace with no keyed provider falls back to the allowlist-head default", async () => {
    // The edge runs this id through the model router, which then answers 409 byok_key_missing —
    // this resolver only decides *which* model, never key presence.
    expect(await resolve("ws-curmodel-unkeyed")).toBe(anthropicModelId);
  });
});

/**
 * ADR 0038 §2 / ADR 0036 §1: the DO persists the edge-resolved model in its own SQLite and
 * getModel self-constructs from it — nothing injected survives a wake. Addressed by a real
 * encoded name (no seed) so getModel takes the production self-construction path.
 */
describe("Curator DO — model persistence + self-construction (ADR 0038 §2)", () => {
  const address = {
    memberId: memberId("member-curmodel-do"),
    workspaceId: workspaceId("ws-curmodel-do"),
  };
  const stubFor = () =>
    env.CURATOR_AGENT.get(
      env.CURATOR_AGENT.idFromName(encodeCuratorAddress(address))
    );

  test("getModel self-constructs from the persisted id after a wake (no startSession replay)", async () => {
    // A slug distinct from the allowlist default so a fallback would be observably wrong.
    const persistedModelId = formatModelId("anthropic", "claude-test-sonnet");
    const stub = stubFor();

    unwrapOk(
      await runInDurableObject(stub, (instance) =>
        (instance as CuratorAgentDurableObject).startSession({
          modelId: persistedModelId,
        })
      )
    );

    // A fresh runInDurableObject entry reads the model purely from persisted SQLite state; no
    // in-memory model is ever cached and startSession is not re-run.
    const modelSlug = await runInDurableObject(stub, (instance) =>
      modelSlugOf(instance as CuratorAgentDurableObject)
    );
    expect(modelSlug).toBe("claude-test-sonnet");
  });

  test("getModel self-constructs an openai gateway model from a persisted openai id (ADR 0038 §1×§2)", async () => {
    // The cross-issue pin E9.2 deferred to the merge: an openai-keyed workspace's edge resolution
    // (pinned above) persists openai/gpt-5.5, and the DO builds it through E9.1's real openai
    // gateway factory — no fallback to the anthropic default.
    const openAi = {
      memberId: memberId("member-curmodel-openai"),
      workspaceId: workspaceId("ws-curmodel-do-openai"),
    };
    const stub = env.CURATOR_AGENT.get(
      env.CURATOR_AGENT.idFromName(encodeCuratorAddress(openAi))
    );

    unwrapOk(
      await runInDurableObject(stub, (instance) =>
        (instance as CuratorAgentDurableObject).startSession({
          modelId: openAiModelId,
        })
      )
    );

    const modelSlug = await runInDurableObject(stub, (instance) =>
      modelSlugOf(instance as CuratorAgentDurableObject)
    );
    expect(modelSlug).toBe("gpt-5.5");
  });

  test("getModel falls back to the allowlist default when nothing was persisted (pre-upgrade session)", async () => {
    // A different DO that never had a model persisted — mirrors a session predating ADR 0038.
    const preUpgrade = {
      memberId: memberId("member-curmodel-preupgrade"),
      workspaceId: workspaceId("ws-curmodel-preupgrade"),
    };
    const stub = env.CURATOR_AGENT.get(
      env.CURATOR_AGENT.idFromName(encodeCuratorAddress(preUpgrade))
    );

    const modelSlug = await runInDurableObject(stub, (instance) =>
      modelSlugOf(instance as CuratorAgentDurableObject)
    );
    expect(modelSlug).toBe("claude-sonnet-5");
  });
});
