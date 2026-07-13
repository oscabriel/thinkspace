import { describe, expect, test } from "bun:test";

import {
  createMemoryModelRouter,
  createMemoryTenantDataAccess,
  createMemoryThreadAgentDirectory,
} from "../src/adapters/memory";
import type { Channel, Visibility } from "../src/channel";
import { createChannelCrudFlow } from "../src/flows/channel-crud";
import { modelIdSchema } from "../src/ids";
import type { Model } from "../src/model";
import { modelProviderSchema } from "../src/model";
import {
  goalSchema,
  nonEmptyStringSchema,
  systemPromptSchema,
} from "../src/primitives";
import type { TenantContext } from "../src/seams/tenant-data-access";
import type { Shape, ShapeStructure } from "../src/shape";
import {
  channelId,
  makeChannel,
  makeShape,
  makeShapeStructure,
  makeThread,
  memberId,
  shapeId,
  testMemberId,
  testTenantContext,
  testWorkspace,
  testWorkspaceId,
  unwrapErr,
  unwrapOk,
} from "../src/testing/fixtures";
import type { Thread } from "../src/thread";

const crudClock = () => new Date("2026-07-06T10:00:00Z");

/** The one catalogued, keyed model both create and edit validate the shape against. */
const testProvider = modelProviderSchema.parse("test-provider");
const catalogModel: Model = {
  capabilities: {
    attachment: false,
    reasoning: false,
    structuredOutput: true,
    toolCall: true,
  },
  catalogSource: "models_dev",
  cost: { cacheRead: 0, cacheWrite: 0, input: 1, output: 1 },
  displayName: nonEmptyStringSchema.parse("Test Model"),
  id: modelIdSchema.parse("test-provider/model-1"),
  limits: { context: 1000, output: 1000 },
  provider: testProvider,
  releaseDate: "2026-07-01",
};

const makeHarness = (input?: {
  readonly channels?: readonly Channel[];
  readonly context?: TenantContext;
  readonly keyedProviders?: readonly string[];
  readonly shapes?: readonly Shape[];
  readonly threads?: readonly Thread[];
}) => {
  const context = input?.context ?? testTenantContext;
  const tenantDataAccess = createMemoryTenantDataAccess({
    channels: input?.channels ?? [],
    context,
    shapes: input?.shapes ?? [],
    threads: input?.threads ?? [],
    workspace: testWorkspace,
  });
  const threadAgents = createMemoryThreadAgentDirectory();
  const flow = createChannelCrudFlow({
    clock: crudClock,
    modelRouter: createMemoryModelRouter({
      context,
      keyedProviders:
        input?.keyedProviders === undefined
          ? [testProvider]
          : input.keyedProviders.map((provider) =>
              modelProviderSchema.parse(provider)
            ),
      models: [catalogModel],
    }),
    tenantDataAccess,
    threadAgents,
  });

  return { context, flow, tenantDataAccess, threadAgents };
};

const catalogStructure = (overrides?: {
  readonly systemPrompt?: string;
}): ShapeStructure =>
  makeShapeStructure({
    modelId: "test-provider/model-1",
    systemPrompt: overrides?.systemPrompt,
  });

describe("Channel CRUD flow — create (ADR 0030 strict 1:1, ADR 0019 owner)", () => {
  test("create writes the channel and its shape in one batch; creator is owner, shared by default", async () => {
    const harness = makeHarness();

    const created = unwrapOk(
      await harness.flow.createChannel({
        channelId: channelId("ch-new"),
        goal: goalSchema.parse("ship the launch"),
        shapeId: shapeId("shape-new"),
        structure: catalogStructure(),
      })
    );

    expect(created.channel.ownerMemberId).toBe(testMemberId);
    expect(created.channel.visibility).toEqual({ kind: "shared" });
    expect(created.channel.lifecycle).toEqual({ state: "active" });
    expect(created.channel.shapeId).toBe(shapeId("shape-new"));
    expect(created.shape.structure).toEqual(catalogStructure());

    const channelRead = unwrapOk(
      await harness.tenantDataAccess.getChannel({
        channelId: channelId("ch-new"),
      })
    );
    expect(channelRead).toEqual(created.channel);
    const shapeRead = unwrapOk(
      await harness.tenantDataAccess.getShape({ shapeId: shapeId("shape-new") })
    );
    expect(shapeRead).toEqual(created.shape);
  });

  test("create honors an explicit private visibility (ADR 0019 escape hatch)", async () => {
    const harness = makeHarness();
    const visibility: Visibility = { kind: "private" };

    const created = unwrapOk(
      await harness.flow.createChannel({
        channelId: channelId("ch-priv"),
        goal: goalSchema.parse("sensitive work"),
        shapeId: shapeId("shape-priv"),
        structure: catalogStructure(),
        visibility,
      })
    );

    expect(created.channel.visibility).toEqual({ kind: "private" });
  });

  test("create rejects a shape whose model the workspace has not keyed with byok_key_missing, writing nothing", async () => {
    const harness = makeHarness({ keyedProviders: [] });

    const error = unwrapErr(
      await harness.flow.createChannel({
        channelId: channelId("ch-unkeyed"),
        goal: goalSchema.parse("no key"),
        shapeId: shapeId("shape-unkeyed"),
        structure: catalogStructure(),
      })
    );

    expect(error.kind).toBe("byok_key_missing");
    const channelRead = unwrapOk(
      await harness.tenantDataAccess.getChannel({
        channelId: channelId("ch-unkeyed"),
      })
    );
    expect(channelRead).toBeNull();
  });
});

describe("Channel CRUD flow — shape edit (ADR 0007 config-as-data + resnapshot, ADR 0019 ACL)", () => {
  const seedChannelAndShape = (input?: {
    readonly context?: TenantContext;
    readonly lifecycle?: Channel["lifecycle"];
    readonly ownerMemberId?: Channel["ownerMemberId"];
    readonly threads?: readonly Thread[];
    readonly visibility?: Visibility;
  }) => {
    const channel = makeChannel({
      id: "ch-1",
      lifecycle: input?.lifecycle,
      ownerMemberId: input?.ownerMemberId,
      shapeId: "shape-1",
      visibility: input?.visibility,
    });
    const shape = makeShape({ id: "shape-1" });
    return makeHarness({
      channels: [channel],
      context: input?.context,
      shapes: [shape],
      threads: input?.threads,
    });
  };

  test("owner edit updates the shape structure and re-snapshots every thread of the channel", async () => {
    const harness = seedChannelAndShape({
      threads: [
        makeThread({ channelId: "ch-1", id: "th-a" }),
        makeThread({ channelId: "ch-1", id: "th-b" }),
      ],
    });
    const structure = catalogStructure({ systemPrompt: "Edited prompt." });

    const edited = unwrapOk(
      await harness.flow.editShape({
        channelId: channelId("ch-1"),
        structure,
      })
    );

    expect(edited.shape.structure).toEqual(structure);
    expect(edited.shape.updatedAt).toEqual(crudClock());
    // One resnapshot per thread, each carrying the freshly edited structure.
    expect(
      edited.resnapshots.map((snap) => `${snap.threadId}`).toSorted()
    ).toEqual(["th-a", "th-b"]);
    for (const snap of edited.resnapshots) {
      expect(snap.shapeSnapshot.structure).toEqual(structure);
      expect(snap.shapeSnapshot.shapeId).toBe(shapeId("shape-1"));
    }

    const shapeRead = unwrapOk(
      await harness.tenantDataAccess.getShape({ shapeId: shapeId("shape-1") })
    );
    expect(shapeRead?.structure).toEqual(structure);
  });

  test("an admin who is not the owner may edit the shape (ADR 0019 owner + admins)", async () => {
    const adminContext: TenantContext = {
      memberId: memberId("member-admin"),
      role: "admin",
      workspaceId: testWorkspaceId,
    };
    const harness = seedChannelAndShape({
      context: adminContext,
      ownerMemberId: memberId("member-owner"),
    });

    const edited = unwrapOk(
      await harness.flow.editShape({
        channelId: channelId("ch-1"),
        structure: catalogStructure({ systemPrompt: "Admin edit." }),
      })
    );

    expect(edited.shape.structure.systemPrompt).toBe(
      systemPromptSchema.parse("Admin edit.")
    );
  });

  test("a plain member who is not the owner is refused with insufficient_role (403 at the edge)", async () => {
    const memberContext: TenantContext = {
      memberId: memberId("member-plain"),
      role: "member",
      workspaceId: testWorkspaceId,
    };
    const harness = seedChannelAndShape({
      context: memberContext,
      ownerMemberId: memberId("member-owner"),
    });

    const error = unwrapErr(
      await harness.flow.editShape({
        channelId: channelId("ch-1"),
        structure: catalogStructure({ systemPrompt: "Sneaky edit." }),
      })
    );

    expect(error).toEqual({
      actualRole: "member",
      kind: "insufficient_role",
      requiredRole: "admin",
      workspaceId: testWorkspaceId,
    });
    const shapeRead = unwrapOk(
      await harness.tenantDataAccess.getShape({ shapeId: shapeId("shape-1") })
    );
    expect(shapeRead?.structure.systemPrompt).toBe(
      makeShapeStructure().systemPrompt
    );
  });

  test("a non-owner cannot even see a private channel: shape edit is channel_not_visible (404 at the edge)", async () => {
    const outsiderContext: TenantContext = {
      memberId: memberId("member-outsider"),
      role: "member",
      workspaceId: testWorkspaceId,
    };
    const harness = seedChannelAndShape({
      context: outsiderContext,
      ownerMemberId: memberId("member-owner"),
      visibility: { kind: "private" },
    });

    const error = unwrapErr(
      await harness.flow.editShape({
        channelId: channelId("ch-1"),
        structure: catalogStructure(),
      })
    );

    expect(error.kind).toBe("channel_not_visible");
  });

  test("editing an archived channel's shape is refused as channel_read_only (ADR 0018)", async () => {
    const harness = seedChannelAndShape({
      lifecycle: {
        archivedAt: new Date("2026-07-05T00:00:00Z"),
        state: "archived",
      },
    });

    const error = unwrapErr(
      await harness.flow.editShape({
        channelId: channelId("ch-1"),
        structure: catalogStructure(),
      })
    );

    expect(error).toEqual({
      channelId: channelId("ch-1"),
      kind: "channel_read_only",
    });
  });

  test("an owner edit to an unkeyed model is refused with byok_key_missing", async () => {
    const channel = makeChannel({ id: "ch-1", shapeId: "shape-1" });
    const harness = makeHarness({
      channels: [channel],
      keyedProviders: [],
      shapes: [makeShape({ id: "shape-1" })],
    });

    const error = unwrapErr(
      await harness.flow.editShape({
        channelId: channelId("ch-1"),
        structure: catalogStructure(),
      })
    );

    expect(error.kind).toBe("byok_key_missing");
  });
});

describe("Channel CRUD flow — archive + delete lifecycle (ADR 0018)", () => {
  const seedActiveChannel = (input?: {
    readonly context?: TenantContext;
    readonly lifecycle?: Channel["lifecycle"];
    readonly ownerMemberId?: Channel["ownerMemberId"];
  }) =>
    makeHarness({
      channels: [
        makeChannel({
          id: "ch-1",
          lifecycle: input?.lifecycle,
          ownerMemberId: input?.ownerMemberId ?? testMemberId,
          shapeId: "shape-1",
        }),
      ],
      context: input?.context,
      shapes: [makeShape({ id: "shape-1" })],
    });

  test("archive moves an active channel to archived; a replayed archive is idempotent", async () => {
    const harness = seedActiveChannel();

    const archived = unwrapOk(
      await harness.flow.archiveChannel({ channelId: channelId("ch-1") })
    );
    expect(archived.channel.lifecycle).toEqual({
      archivedAt: crudClock(),
      state: "archived",
    });

    const replay = unwrapOk(
      await harness.flow.archiveChannel({ channelId: channelId("ch-1") })
    );
    expect(replay.channel.lifecycle).toEqual({
      archivedAt: crudClock(),
      state: "archived",
    });
  });

  test("a non-owner plain member cannot archive (ADR 0019 owner + admins)", async () => {
    const harness = seedActiveChannel({
      context: {
        memberId: memberId("member-plain"),
        role: "member",
        workspaceId: testWorkspaceId,
      },
      ownerMemberId: memberId("member-owner"),
    });

    const error = unwrapErr(
      await harness.flow.archiveChannel({ channelId: channelId("ch-1") })
    );

    expect(error.kind).toBe("insufficient_role");
  });

  test("delete of a still-active channel is refused: archive-first (channel_not_archived, 409)", async () => {
    const harness = seedActiveChannel();

    const error = unwrapErr(
      await harness.flow.deleteChannel({ channelId: channelId("ch-1") })
    );

    expect(error).toEqual({
      channelId: channelId("ch-1"),
      kind: "channel_not_archived",
    });
  });

  test("delete of an archived channel transitions to deleted, preserving archivedAt; replay is idempotent", async () => {
    const archivedAt = new Date("2026-07-05T00:00:00Z");
    const harness = seedActiveChannel({
      lifecycle: { archivedAt, state: "archived" },
    });

    const deleted = unwrapOk(
      await harness.flow.deleteChannel({ channelId: channelId("ch-1") })
    );
    expect(deleted.channel.lifecycle).toEqual({
      archivedAt,
      deletedAt: crudClock(),
      state: "deleted",
    });

    const replay = unwrapOk(
      await harness.flow.deleteChannel({ channelId: channelId("ch-1") })
    );
    expect(replay.channel.lifecycle).toMatchObject({ state: "deleted" });
  });
});
