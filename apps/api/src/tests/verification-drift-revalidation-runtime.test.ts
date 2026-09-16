import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const { compare } = vi.hoisted(() => ({ compare: vi.fn() }));
vi.mock("@aiengineer/knowledge-application", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@aiengineer/knowledge-application")
  >()),
  compareVerifiedComponentVersions: compare,
}));
import { createVerificationDriftRevalidationRuntime } from "../verification-drift-revalidation-runtime.js";

const tenant = "11111111-1111-4111-8111-111111111111";
const other = "99999999-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const digest = `sha256:${"a".repeat(64)}`;
const handle = (tenantId = tenant, number = 1) => ({
  artifactId: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
  tenantId,
  digest,
  mediaType: "application/json",
  byteLength: 1,
  objectKey: `audit-${number}`,
  createdAt: "2026-09-08T00:00:00.000Z",
  producerActivityId: "fixture",
  producerVersion: "v1",
  encryptionClass: "managed",
  retentionClass: "audit",
  dataClassification: "restricted",
  parentArtifactIds: [],
});
const keys = () => {
  const pair = generateKeyPairSync("ed25519");
  return JSON.stringify([
    {
      keyId: "k",
      publicKeyPem: pair.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    },
  ]);
};
function db(modelRows = 0) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("verification_semantic_response_observation"))
      return {
        rows: Array.from({ length: modelRows }, (_, index) => ({
          observation_artifact_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          observation_sha256: "a".repeat(64),
          operation_id: id,
        })),
      };
    if (sql.includes("plan_verification_drift_revalidation"))
      return { rows: [{ inserted: true }] };
    return { rows: [] };
  });
  return {
    transaction: async (_: string, work: any) => work({ query }),
    query,
  };
}
const monitor = (tenantId = tenant) =>
  JSON.stringify([
    { tenantId, baseline: handle(tenantId), candidate: handle(tenantId, 2) },
  ]);
function monitorSet() {
  return JSON.stringify(
    [1, 2, 3].map((number) => ({
      tenantId: tenant,
      baseline: handle(tenant, number * 2),
      candidate: handle(tenant, number * 2 + 1),
    })),
  );
}
function component(publisher: {
  publishComponentObservation: ReturnType<typeof vi.fn>;
}) {
  return {
    forTenant: vi.fn(() => ({
      publisher: publisher as never,
      createResolver: vi.fn() as never,
    })),
  };
}
function observation(changedDimensions: string[]) {
  return {
    schemaVersion: "verification-component-drift-observation.v1",
    tenantId: tenant,
    baseline: { runId: "a", auditBundleArtifact: { artifactId: id, digest } },
    candidate: { runId: "b", auditBundleArtifact: { artifactId: id, digest } },
    baselineComponents: {
      provider: "a",
      model: "a",
      parser: "a",
      grader: "a",
      policy: "a",
    },
    candidateComponents: {
      provider: "b",
      model: "b",
      parser: "b",
      grader: "b",
      policy: "b",
    },
    changedDimensions,
    payloadDigest: digest,
  };
}

describe("component drift runtime", () => {
  it("fails closed for incomplete monitor configuration and missing dependencies", () => {
    const database = db();
    expect(() =>
      createVerificationDriftRevalidationRuntime(
        database as never,
        JSON.stringify(["mission_control"]),
        monitor(),
        undefined,
      ),
    ).toThrow("INCOMPLETE");
    expect(() =>
      createVerificationDriftRevalidationRuntime(
        database as never,
        JSON.stringify(["mission_control"]),
        monitor(),
        keys(),
      ),
    ).toThrow("PUBLISHER_REQUIRED");
  });
  it("does not read or publish foreign tenant monitors", async () => {
    const publisher = { publishComponentObservation: vi.fn() };
    const runtime = createVerificationDriftRevalidationRuntime(
      db() as never,
      JSON.stringify(["mission_control"]),
      monitor(other),
      keys(),
      component(publisher),
    );
    await runtime.scan({ tenantId: tenant, limit: 1 });
    expect(compare).not.toHaveBeenCalled();
    expect(publisher.publishComponentObservation).not.toHaveBeenCalled();
  });
  it("does not publish equal components", async () => {
    const publisher = { publishComponentObservation: vi.fn() };
    const runtime = createVerificationDriftRevalidationRuntime(
      db() as never,
      JSON.stringify(["mission_control"]),
      monitor(),
      keys(),
      component(publisher),
    );
    compare.mockResolvedValueOnce(observation([]));
    await expect(runtime.scan({ tenantId: tenant, limit: 1 })).resolves.toEqual(
      { planned: 0, alreadyPlanned: 0 },
    );
    expect(publisher.publishComponentObservation).not.toHaveBeenCalled();
  });
  it("publishes derived drift once and returns durable replay count", async () => {
    const publisher = {
      publishComponentObservation: vi
        .fn()
        .mockResolvedValueOnce("planned")
        .mockResolvedValueOnce("already_planned"),
    };
    const runtime = createVerificationDriftRevalidationRuntime(
      db() as never,
      JSON.stringify(["mission_control"]),
      monitor(),
      keys(),
      component(publisher),
    );
    compare.mockResolvedValue(observation(["provider", "model"]));
    expect(await runtime.scan({ tenantId: tenant, limit: 1 })).toEqual({
      planned: 1,
      alreadyPlanned: 0,
    });
    expect(await runtime.scan({ tenantId: tenant, limit: 1 })).toEqual({
      planned: 0,
      alreadyPlanned: 1,
    });
    expect(publisher.publishComponentObservation).toHaveBeenCalledTimes(2);
  });
  it("reserves the aggregate limit for model observations before component monitors", async () => {
    const publisher = { publishComponentObservation: vi.fn() };
    const runtime = createVerificationDriftRevalidationRuntime(
      db(1) as never,
      JSON.stringify(["mission_control"]),
      monitor(),
      keys(),
      component(publisher),
    );
    compare.mockClear();
    compare.mockResolvedValue(observation(["policy"]));
    expect(await runtime.scan({ tenantId: tenant, limit: 1 })).toEqual({
      planned: 1,
      alreadyPlanned: 0,
    });
    expect(compare).not.toHaveBeenCalled();
  });
  it("rotates bounded scans so configured monitors cannot starve", async () => {
    const publisher = {
      publishComponentObservation: vi.fn().mockResolvedValue("planned"),
    };
    const runtime = createVerificationDriftRevalidationRuntime(
      db() as never,
      JSON.stringify(["mission_control"]),
      monitorSet(),
      keys(),
      component(publisher),
    );
    compare.mockClear();
    compare.mockResolvedValue(observation(["policy"]));
    await runtime.scan({ tenantId: tenant, limit: 1 });
    await runtime.scan({ tenantId: tenant, limit: 1 });
    await runtime.scan({ tenantId: tenant, limit: 1 });
    expect(
      compare.mock.calls.map(([input]) => input.baseline.artifact.artifactId),
    ).toEqual([
      handle(tenant, 2).artifactId,
      handle(tenant, 4).artifactId,
      handle(tenant, 6).artifactId,
    ]);
  });
});
