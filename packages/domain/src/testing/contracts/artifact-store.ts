import type { ArtifactOrigin } from "../../artifact";
import { artifactIdSchema, runIdSchema } from "../../ids";
import type { ArtifactId } from "../../ids";
import { artifactNameSchema, contentTypeSchema } from "../../primitives";
import { ARTIFACT_VERSION_CAP } from "../../seams/artifact-store";
import type {
  ArtifactStore,
  ArtifactVersionDraft,
} from "../../seams/artifact-store";
import type { TenantContext } from "../../seams/tenant-data-access";
import type { ContractTestApi } from "../contract-api";
import {
  otherWorkspaceId,
  testChannelId,
  testMemberId,
  testTenantContext,
  testThreadId,
  unwrapErr,
  unwrapOk,
} from "../fixtures";

/** A per-test backend the factory stands up fresh; `forContext` shares it across tenants. */
export interface ArtifactStoreHarness {
  readonly forContext: (context: TenantContext) => ArtifactStore;
}

export type ArtifactStoreFactory = () =>
  | ArtifactStoreHarness
  | Promise<ArtifactStoreHarness>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const bytesOf = (text: string) => ({
  contentType: contentTypeSchema.parse("text/plain"),
  data: encoder.encode(text),
});

const draft = {
  homeChannelId: testChannelId,
  name: artifactNameSchema.parse("Launch Plan"),
};

const versionDraft = (): ArtifactVersionDraft => ({
  contentType: contentTypeSchema.parse("text/plain"),
  mediaKind: { kind: "text_extractable" },
  origin: {
    kind: "agent",
    runId: runIdSchema.parse("run-1"),
    threadId: testThreadId,
  } satisfies ArtifactOrigin,
});

const otherTenantContext: TenantContext = {
  memberId: testMemberId,
  role: "member",
  workspaceId: otherWorkspaceId,
};

/** Appends `count` versions one at a time; recursion keeps the writes ordered without a loop. */
const appendVersions = async (
  store: ArtifactStore,
  artifactId: ArtifactId,
  count: number
): Promise<void> => {
  if (count === 0) {
    return;
  }
  unwrapOk(
    await store.append({
      artifactId,
      bytes: bytesOf(`version ${count}`),
      version: versionDraft(),
    })
  );
  await appendVersions(store, artifactId, count - 1);
};

/** Pins the ArtifactStore seam semantics (ADR 0032) on whichever adapter the factory builds. */
export const defineArtifactStoreContract = (input: {
  readonly api: ContractTestApi;
  readonly makeArtifactStore: ArtifactStoreFactory;
}): void => {
  const { describe, expect, test } = input.api;
  const { makeArtifactStore } = input;

  const tenantStore = async (): Promise<ArtifactStore> => {
    const harness = await makeArtifactStore();
    return harness.forContext(testTenantContext);
  };

  describe("ArtifactStore identity + versioning (ADR 0032)", () => {
    test("create mints an identity whose head reads back its first version", async () => {
      const store = await tenantStore();

      const created = unwrapOk(
        await store.create({
          bytes: bytesOf("v1 body"),
          draft,
          version: versionDraft(),
        })
      );
      expect(created.name).toEqual(draft.name);
      expect(created.byteLength).toEqual(encoder.encode("v1 body").byteLength);

      const blob = unwrapOk(await store.get({ artifactId: created.id }));
      expect(blob === null).toBe(false);
      expect(decoder.decode(blob?.bytes.data)).toEqual("v1 body");
      expect(blob?.version.id).toEqual(created.headVersionId);
    });

    test("get returns null for an unknown artifact id", async () => {
      const store = await tenantStore();
      const missing = unwrapOk(
        await store.get({
          artifactId: artifactIdSchema.parse("artifact-missing"),
        })
      );
      expect(missing).toBeNull();
    });

    test("append adds a version and advances head; the prior version stays pinnable", async () => {
      const store = await tenantStore();

      const v1 = unwrapOk(
        await store.create({
          bytes: bytesOf("v1 body"),
          draft,
          version: versionDraft(),
        })
      );
      const v2 = unwrapOk(
        await store.append({
          artifactId: v1.id,
          bytes: bytesOf("v2 body"),
          version: versionDraft(),
        })
      );
      expect(v2 === null).toBe(false);
      expect(v2?.headVersionId === v1.headVersionId).toBe(false);

      const head = unwrapOk(await store.get({ artifactId: v1.id }));
      expect(decoder.decode(head?.bytes.data)).toEqual("v2 body");

      const pinned = unwrapOk(
        await store.get({ artifactId: v1.id, versionId: v1.headVersionId })
      );
      expect(decoder.decode(pinned?.bytes.data)).toEqual("v1 body");
    });

    test("append on an unknown artifact id returns null", async () => {
      const store = await tenantStore();
      const missing = unwrapOk(
        await store.append({
          artifactId: artifactIdSchema.parse("artifact-missing"),
          bytes: bytesOf("body"),
          version: versionDraft(),
        })
      );
      expect(missing).toBeNull();
    });

    test("listVersions returns history newest-first", async () => {
      const store = await tenantStore();

      const v1 = unwrapOk(
        await store.create({
          bytes: bytesOf("v1 body"),
          draft,
          version: versionDraft(),
        })
      );
      const v2 = unwrapOk(
        await store.append({
          artifactId: v1.id,
          bytes: bytesOf("v2 body"),
          version: versionDraft(),
        })
      );
      const v3 = unwrapOk(
        await store.append({
          artifactId: v1.id,
          bytes: bytesOf("v3 body"),
          version: versionDraft(),
        })
      );

      const versions = unwrapOk(
        await store.listVersions({ artifactId: v1.id })
      );
      expect(versions?.length).toEqual(3);
      expect(versions?.map((version) => version.id)).toEqual([
        v3?.headVersionId,
        v2?.headVersionId,
        v1.headVersionId,
      ]);
    });

    test("writing past the version cap trims the oldest version's row and bytes", async () => {
      const store = await tenantStore();

      const first = unwrapOk(
        await store.create({
          bytes: bytesOf("version 0"),
          draft,
          version: versionDraft(),
        })
      );
      // One create + CAP appends = CAP + 1 writes; the oldest (create's) version trims out.
      // Sequential (recursive) because append advances head and reads prior seq — order matters.
      await appendVersions(store, first.id, ARTIFACT_VERSION_CAP);

      const versions = unwrapOk(
        await store.listVersions({ artifactId: first.id })
      );
      expect(versions?.length).toEqual(ARTIFACT_VERSION_CAP);

      const trimmed = unwrapOk(
        await store.get({
          artifactId: first.id,
          versionId: first.headVersionId,
        })
      );
      expect(trimmed).toBeNull();
    });

    test("head returns the projection without bytes; null for an unknown id", async () => {
      const store = await tenantStore();

      const created = unwrapOk(
        await store.create({
          bytes: bytesOf("v1 body"),
          draft,
          version: versionDraft(),
        })
      );

      const head = unwrapOk(await store.head({ artifactId: created.id }));
      expect(head?.id).toEqual(created.id);
      expect(head?.headVersionId).toEqual(created.headVersionId);

      const missing = unwrapOk(
        await store.head({
          artifactId: artifactIdSchema.parse("artifact-missing"),
        })
      );
      expect(missing).toBeNull();
    });

    test("list projects each artifact over its head version only", async () => {
      const store = await tenantStore();

      const created = unwrapOk(
        await store.create({
          bytes: bytesOf("v1 body"),
          draft,
          version: versionDraft(),
        })
      );
      unwrapOk(
        await store.append({
          artifactId: created.id,
          bytes: bytesOf("v2 body longer"),
          version: versionDraft(),
        })
      );

      const listed = unwrapOk(await store.list());
      expect(listed.artifacts.length).toEqual(1);
      expect(listed.artifacts[0]?.byteLength).toEqual(
        encoder.encode("v2 body longer").byteLength
      );
    });

    test("a foreign tenant context fails closed on every read and write", async () => {
      const harness = await makeArtifactStore();
      const owner = harness.forContext(testTenantContext);
      const intruder = harness.forContext(otherTenantContext);

      const created = unwrapOk(
        await owner.create({
          bytes: bytesOf("v1 body"),
          draft,
          version: versionDraft(),
        })
      );

      const readError = unwrapErr(
        await intruder.get({ artifactId: created.id })
      );
      expect(readError.kind).toEqual("tenant_guard_violation");

      const headError = unwrapErr(
        await intruder.head({ artifactId: created.id })
      );
      expect(headError.kind).toEqual("tenant_guard_violation");

      const listError = unwrapErr(
        await intruder.listVersions({ artifactId: created.id })
      );
      expect(listError.kind).toEqual("tenant_guard_violation");

      const appendError = unwrapErr(
        await intruder.append({
          artifactId: created.id,
          bytes: bytesOf("intrusion"),
          version: versionDraft(),
        })
      );
      expect(appendError.kind).toEqual("tenant_guard_violation");

      // The intruder's own workspace-scoped list never sees the owner's artifact.
      const intruderList = unwrapOk(await intruder.list());
      expect(intruderList.artifacts.length).toEqual(0);
    });
  });
};
