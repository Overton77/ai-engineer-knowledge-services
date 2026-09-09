import { describe, expect, it, vi } from "vitest";
import { digestCanonicalJson } from "@aiengineer/knowledge-verification";
import type { OperationContext, VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import type { PostgresCanonicalRepository } from "./postgres.js";
import { PostgresVerificationMetricRuntimePrincipals } from "./verification-metric-principals.js";

const ids = {
  tenant: "11111111-1111-4111-8111-111111111111",
  artifact: "22222222-2222-4222-8222-222222222222",
  mission: "33333333-3333-4333-8333-333333333333",
  workItem: "44444444-4444-4444-8444-444444444444",
  producerAttempt: "55555555-5555-4555-8555-555555555555",
  producerWorkItem: "66666666-6666-4666-8666-666666666666",
  verifierAttempt: "77777777-7777-4777-8777-777777777777",
  operation: "88888888-8888-4888-8888-888888888888",
  actor: "99999999-9999-4999-8999-999999999999",
};
const digest = `sha256:${"a".repeat(64)}` as const;

const observationsArtifact: VerificationArtifactHandle = {
  artifactId: ids.artifact, tenantId: ids.tenant, digest, mediaType: "application/json", byteLength: 2,
  objectKey: "proof/observations.json", createdAt: "2026-09-05T00:00:00.000Z",
  producerActivityId: "metric-proof", producerVersion: "1", encryptionClass: "managed", retentionClass: "audit",
  dataClassification: "restricted", parentArtifactIds: [],
};
const context: OperationContext = {
  tenantId: ids.tenant, operationId: ids.operation, attemptId: ids.verifierAttempt, workItemId: ids.workItem, missionId: ids.mission,
  correlationId: "metric-principals-test", actor: { kind: "service", id: ids.actor, serviceIdentity: "knowledge_worker" },
  capabilityVersion: "metric-principals-test.v1", idempotencyKey: "metric-principals-test", reason: "focused principal binding test", contractVersion: "v1",
};
const row = () => ({
  artifact_id: ids.artifact, artifact_tenant_id: ids.tenant, artifact_sha256: digest.slice(7), artifact_mission_id: ids.mission,
  producer_attempt_id: ids.producerAttempt, producer_work_item_id: ids.producerWorkItem, producer_mission_id: ids.mission, producer_deployment_id: "producer-deployment",
  verifier_attempt_id: ids.verifierAttempt, verifier_work_item_id: ids.workItem, verifier_mission_id: ids.mission, verifier_deployment_id: "verifier-deployment",
});

function subject(result: Record<string, unknown> | undefined) {
  const query = vi.fn(async () => ({ rows: result ? [result] : [], rowCount: result ? 1 : 0 }));
  const transaction = vi.fn(async (_tenant: string, work: (client: { query: typeof query }) => Promise<unknown>) => work({ query }));
  return { principals: new PostgresVerificationMetricRuntimePrincipals({ transaction } as unknown as PostgresCanonicalRepository), query, transaction };
}

describe("PostgresVerificationMetricRuntimePrincipals", () => {
  it("derives canonical producer and verifier bindings from the registered observations artifact and authenticated context", async () => {
    const fixture = subject(row());
    const binding = await fixture.principals.bind({ context, observationsArtifact, captureIds: ["capture-a"] });

    expect(binding).toEqual({
      producerAttemptId: ids.producerAttempt,
      runtimePrincipals: {
        basis: "runtime_principal_binding",
        producerDeploymentId: "producer-deployment", verifierDeploymentId: "verifier-deployment",
        producerPrincipalDigest: digestCanonicalJson({ schemaVersion: "verification-metric-runtime-principal.v1", role: "producer", tenantId: ids.tenant,
          artifactId: ids.artifact, attemptId: ids.producerAttempt, workItemId: ids.producerWorkItem, missionId: ids.mission, deploymentId: "producer-deployment" }),
        verifierPrincipalDigest: digestCanonicalJson({ schemaVersion: "verification-metric-runtime-principal.v1", role: "verifier", tenantId: ids.tenant,
          attemptId: ids.verifierAttempt, workItemId: ids.workItem, missionId: ids.mission, deploymentId: "verifier-deployment" }),
      },
    });
    expect(fixture.transaction).toHaveBeenCalledWith(ids.tenant, expect.any(Function));
    expect(fixture.query).toHaveBeenCalledWith(expect.stringContaining("join orchestration.attempt producer"), [ids.tenant, ids.artifact, ids.verifierAttempt]);
  });

  it("returns same-deployment bindings for deterministic quality rejection instead of inventing an admission denial", async () => {
    const same = row(); same.verifier_deployment_id = "producer-deployment";
    const binding = await subject(same).principals.bind({ context, observationsArtifact, captureIds: ["capture-a"] });
    expect(binding.runtimePrincipals.producerDeploymentId).toBe(binding.runtimePrincipals.verifierDeploymentId);
    expect(binding.runtimePrincipals.producerPrincipalDigest).not.toBe(binding.runtimePrincipals.verifierPrincipalDigest);
  });

  it("fails before SQL when authenticated context lacks mission or work-item ownership", async () => {
    const fixture = subject(row());
    await expect(fixture.principals.bind({ context: { ...context, missionId: undefined }, observationsArtifact, captureIds: ["capture-a"] }))
      .rejects.toThrow("VERIFICATION_METRIC_CONTEXT_OWNERSHIP_REQUIRED");
    expect(fixture.transaction).not.toHaveBeenCalled();
  });

  it("denies absent durable artifact, producer, or verifier ownership joins", async () => {
    await expect(subject(undefined).principals.bind({ context, observationsArtifact, captureIds: ["capture-a"] }))
      .rejects.toThrow("VERIFICATION_METRIC_RUNTIME_BINDING_NOT_FOUND");
  });

  it.each([
    ["registered artifact digest", { artifact_sha256: "b".repeat(64) }, "VERIFICATION_METRIC_OBSERVATIONS_ARTIFACT_IDENTITY_MISMATCH"],
    ["artifact mission", { artifact_mission_id: ids.producerWorkItem }, "VERIFICATION_METRIC_MISSION_OWNERSHIP_MISMATCH"],
    ["producer mission", { producer_mission_id: ids.producerWorkItem }, "VERIFICATION_METRIC_MISSION_OWNERSHIP_MISMATCH"],
    ["verifier work item", { verifier_work_item_id: ids.producerWorkItem }, "VERIFICATION_METRIC_VERIFIER_OWNERSHIP_MISMATCH"],
    ["producer attempt UUID", { producer_attempt_id: "not-a-uuid" }, "VERIFICATION_METRIC_PRODUCER_OWNERSHIP_MISMATCH"],
  ])("denies mismatched %s", async (_name, override, code) => {
    await expect(subject({ ...row(), ...override }).principals.bind({ context, observationsArtifact, captureIds: ["capture-a"] }))
      .rejects.toThrow(code);
  });
});
