import type { VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { describe, expect, it, vi } from "vitest";
import type { PostgresCanonicalRepository, TenantSqlClient } from "./postgres.js";
import { PostgresVerificationRepository, type VerificationRunLease } from "./verification.js";

const ids = {
  tenant: "11111111-1111-4111-8111-111111111111", run: "22222222-2222-4222-8222-222222222222",
  producer: "33333333-3333-4333-8333-333333333333", verifier: "44444444-4444-4444-8444-444444444444",
  mission: "55555555-5555-4555-8555-555555555555", workItem: "66666666-6666-4666-8666-666666666666",
  operation: "77777777-7777-4777-8777-777777777777", step: "88888888-8888-4888-8888-888888888888",
};
const digest = (fill: string) => `sha256:${fill.repeat(64)}` as `sha256:${string}`;
const startedAt = "2026-09-05T02:00:00.000Z";
const endedAt = "2026-09-05T02:01:00.000Z";

function artifact(artifactId: string, fill: string): VerificationArtifactHandle {
  return {
    artifactId, tenantId: ids.tenant, digest: digest(fill), mediaType: "application/json", byteLength: 2,
    objectKey: `${ids.tenant}/${fill}${fill}/${fill.repeat(64)}`, createdAt: startedAt, producerActivityId: "test",
    producerVersion: "1", encryptionClass: "managed", retentionClass: "audit", dataClassification: "restricted", parentArtifactIds: [],
  };
}

const base = () => ({
  tenantId: ids.tenant, runId: ids.run, producerAttemptId: ids.producer, verifierAttemptId: ids.verifier,
  policyVersion: "verification-policy.v1", bundleArtifact: artifact("99999999-9999-4999-8999-999999999999", "a"),
  resultArtifact: artifact("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "b"),
  policyArtifact: artifact("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "c"),
  manifestArtifact: artifact("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "d"),
  startedAt, endedAt, status: "succeeded" as const,
});

type RunInput = Parameters<PostgresVerificationRepository["recordVerificationRun"]>[0];

function stored(input: RunInput) {
  return {
    id: input.runId, tenant_id: input.tenantId, producer_attempt_id: input.producerAttemptId, verifier_attempt_id: input.verifierAttemptId,
    policy_version: input.policyVersion, started_at: new Date(input.startedAt), ended_at: input.endedAt ? new Date(input.endedAt) : null,
    mission_id: input.missionId ?? null, work_item_id: input.workItemId ?? null, operation_id: input.operationId ?? null,
    contract_version: "verification.v1", bundle_artifact_id: input.bundleArtifact.artifactId,
    deterministic_result_artifact_id: input.resultArtifact.artifactId, policy_artifact_id: input.policyArtifact.artifactId,
    policy_artifact_sha256: input.policyArtifact.digest.slice(7), run_manifest_artifact_id: input.manifestArtifact.artifactId,
    manifest_sha256: input.manifestArtifact.digest.slice(7), status: input.status ?? "running",
  };
}

function subject(options: { operation?: Record<string, unknown>; liveLease?: boolean; timestampStrings?: boolean } = {}) {
  let run: Record<string, unknown> | undefined;
  const operations = { ...options.operation };
  const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
    if (normalized.startsWith("select id,tenant_id,producer_attempt_id,verifier_attempt_id")) return { rows: run ? [run] : [], rowCount: run ? 1 : 0 };
    if (normalized.startsWith("select id,mission_id,work_item_id,attempt_id,status from knowledge_service.operation")) {
      return { rows: Object.keys(operations).length ? [operations] : [], rowCount: Object.keys(operations).length ? 1 : 0 };
    }
    if (normalized.startsWith("select step.id from knowledge_service.operation_step")) {
      return { rows: options.liveLease ? [{ id: ids.step }] : [], rowCount: options.liveLease ? 1 : 0 };
    }
    if (normalized.startsWith("insert into evidence.verification_run")) {
      if (!run) {
        const [id, tenantId, producerAttemptId, verifierAttemptId, policyVersion, started, ended, missionId, workItemId, operationId, _contract, bundleArtifactId, resultArtifactId, policyArtifactId, policyArtifactSha256, manifestArtifactId, manifestSha256, status] = values as readonly [string, string, string, string, string, string, string | null, string | null, string | null, string | null, string, string, string, string, string, string, string, string];
        run = { id, tenant_id: tenantId, producer_attempt_id: producerAttemptId, verifier_attempt_id: verifierAttemptId, policy_version: policyVersion,
          started_at: options.timestampStrings ? started : new Date(started), ended_at: ended ? (options.timestampStrings ? ended : new Date(ended)) : null, mission_id: missionId ?? null, work_item_id: workItemId ?? null,
          operation_id: operationId ?? null, contract_version: "verification.v1", bundle_artifact_id: bundleArtifactId,
          deterministic_result_artifact_id: resultArtifactId, policy_artifact_id: policyArtifactId, policy_artifact_sha256: policyArtifactSha256,
          run_manifest_artifact_id: manifestArtifactId, manifest_sha256: manifestSha256, status };
      }
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`UNEXPECTED_SQL:${text}`);
  });
  const database = { transaction: vi.fn(async (_tenantId: string, work: (client: TenantSqlClient) => Promise<unknown>) => work({ query } as unknown as TenantSqlClient)) };
  const repository = new PostgresVerificationRepository(database as unknown as PostgresCanonicalRepository, {} as never, { authorize: async () => undefined });
  return { repository, query, database, get run() { return run; } };
}

describe("PostgresVerificationRepository.recordVerificationRun", () => {
  it("writes one immutable row and accepts an exact retry through conflict-safe locked comparison", async () => {
    const fixture = subject();
    const input = base();

    await fixture.repository.recordVerificationRun(input);

    expect(fixture.query.mock.calls.filter(([sql]) => String(sql).includes("insert into evidence.verification_run"))).toHaveLength(1);
    expect(fixture.query.mock.calls.find(([sql]) => String(sql).includes("insert into evidence.verification_run"))?.[0]).toContain("on conflict(tenant_id,id) do nothing");
    expect(fixture.run).toMatchObject({ id: ids.run, status: "succeeded" });
  });

  it("accepts an exact retry when PostgreSQL returns lifecycle timestamps as ISO strings", async () => {
    const fixture = subject({ timestampStrings: true });
    const input = base();
    await fixture.repository.recordVerificationRun(input);
    await expect(fixture.repository.recordVerificationRun(input)).resolves.toBeUndefined();
  });

  it.each([
    ["bundle artifact", (input: RunInput) => ({ ...input, bundleArtifact: artifact("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "e") })],
    ["result artifact", (input: RunInput) => ({ ...input, resultArtifact: artifact("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "f") })],
    ["policy artifact", (input: RunInput) => ({ ...input, policyArtifact: artifact("ffffffff-ffff-4fff-8fff-ffffffffffff", "0") })],
    ["manifest artifact", (input: RunInput) => ({ ...input, manifestArtifact: artifact("12121212-1212-4212-8212-121212121212", "1") })],
    ["operation", (input: RunInput) => ({ ...input, operationId: ids.operation })],
    ["producer", (input: RunInput) => ({ ...input, producerAttemptId: "13131313-1313-4313-8313-131313131313" })],
    ["verifier", (input: RunInput) => ({ ...input, verifierAttemptId: "14141414-1414-4414-8414-141414141414" })],
    ["policy version", (input: RunInput) => ({ ...input, policyVersion: "verification-policy.v2" })],
    ["lifecycle", (input: RunInput) => ({ ...input, endedAt: "2026-09-05T02:02:00.000Z" })],
  ])("rejects retry drift in %s", async (_name, mutate) => {
    const fixture = subject();
    const input = base();
    await fixture.repository.recordVerificationRun(input);
    await expect(fixture.repository.recordVerificationRun(mutate(input))).rejects.toThrow("VERIFICATION_RUN_IDENTITY_DRIFT");
  });

  it("requires a locked active operation with exact verifier mission/work-item/attempt ownership", async () => {
    const input = { ...base(), operationId: ids.operation, missionId: ids.mission, workItemId: ids.workItem };
    const owned = subject({ operation: { id: ids.operation, mission_id: ids.mission, work_item_id: ids.workItem, attempt_id: ids.verifier, status: "running" } });
    await expect(owned.repository.recordVerificationRun(input)).resolves.toBeUndefined();
    const completed = subject({ operation: { id: ids.operation, mission_id: ids.mission, work_item_id: ids.workItem, attempt_id: ids.verifier, status: "succeeded" } });
    await expect(completed.repository.recordVerificationRun(input)).resolves.toBeUndefined();

    const cancelled = subject({ operation: { id: ids.operation, mission_id: ids.mission, work_item_id: ids.workItem, attempt_id: ids.verifier, status: "cancelled" } });
    await expect(cancelled.repository.recordVerificationRun(input)).rejects.toThrow("VERIFICATION_RUN_OPERATION_NOT_ACTIVE");
    expect(cancelled.query.mock.calls.some(([sql]) => String(sql).includes("insert into evidence.verification_run"))).toBe(false);

    const wrongAttempt = subject({ operation: { id: ids.operation, mission_id: ids.mission, work_item_id: ids.workItem, attempt_id: ids.producer, status: "succeeded" } });
    await expect(wrongAttempt.repository.recordVerificationRun(input)).rejects.toThrow("VERIFICATION_RUN_OPERATION_CONTEXT_MISMATCH");
  });

  it("optionally fences operation-linked sealing on the live step lease", async () => {
    const input = { ...base(), operationId: ids.operation, missionId: ids.mission, workItemId: ids.workItem,
      lease: { stepId: ids.step, leaseToken: "lease-token", fencingToken: 1, holderIdentity: "verification-worker" } satisfies VerificationRunLease };
    const operation = { id: ids.operation, mission_id: ids.mission, work_item_id: ids.workItem, attempt_id: ids.verifier, status: "running" };
    await expect(subject({ operation, liveLease: true }).repository.recordVerificationRun(input)).resolves.toBeUndefined();
    await expect(subject({ operation, liveLease: false }).repository.recordVerificationRun(input)).rejects.toThrow("VERIFICATION_RUN_STALE_LEASE");
  });
});
