import { describe, expect, it } from "vitest";
import { VerificationFailureSetSchema, VerificationRecoveryBatchSchema, VerificationRecoveryBindingSchema, VerificationRecoveryPlanSchema, VerificationRecoveryReceiptSchema } from "./recovery.js";

const digest = `sha256:${"1".repeat(64)}`;
const tenant = "11111111-1111-4111-8111-111111111111";
const artifact = { artifactId: tenant, tenantId: tenant, digest, mediaType: "application/json", byteLength: 1, objectKey: "test", createdAt: "2026-09-13T00:00:00.000Z", producerActivityId: "test", producerVersion: "1", encryptionClass: "managed", retentionClass: "audit", dataClassification: "internal", parentArtifactIds: [] };
const binding = { claim: { statement: "Value for 2025", qualifiers: ["2025"] }, evidence: [{ representationDigest: digest, contextDigest: digest, selector: { kind: "json_pointer", pointer: "/value" } }], captureDigests: [digest], policyDigest: digest, profileDigest: digest };
function batch() {
  return { tenantId: tenant, callerId: "caller", batchId: "batch", caseId: "case", parentAttemptId: "parent", recoveryPolicyVersion: "1", capturedAt: "2026-09-13T00:00:00.000Z", questionIds: ["q"], requirements: [{ questionId: "q", requirementId: "scope", description: "original scope" }],
    items: [{ originalId: "original", questionIds: ["q"], inputDigest: digest, binding,
      observation: { operationId: tenant, runId: "run", execution: "completed", mechanical: "failed", policy: "fail", semantic: "locator_error", family: "selector", earliestStage: "selector", signature: "table", dependencyIds: [], diagnosticArtifacts: [artifact] }, usedRounds: 0, attemptedInputDigests: [], attemptedRepairDigests: [] }],
    limits: { maxRoundsPerOriginal: 2, maxProbeRounds: 1, remainingCalls: 5, remainingCostMicros: 100, deadline: "2026-09-14T00:00:00.000Z" }, allowedActions: ["repair"], probeRounds: [] };
}
describe("versioned recovery artifact contracts", () => {
  it("rejects denominator manipulation, omitted original requirements and foreign diagnostic tenants", () => {
    const set = { schemaVersion: "verification-failure-set.v1", batch: batch(), counts: { submitted: 1, terminal: 1, passed: 0, failed: 1, held: 0, pending: 0, unknown: 0, cancelled: 0 }, questionDenominator: 1, failureRatio: 1, cohortTriage: false, payloadDigest: digest };
    expect(VerificationFailureSetSchema.safeParse(set).success).toBe(true);
    expect(VerificationFailureSetSchema.safeParse({ ...set, questionDenominator: 0 }).success).toBe(false);
    expect(VerificationFailureSetSchema.safeParse({ ...set, counts: { ...set.counts, passed: 1 } }).success).toBe(false);
    expect(VerificationRecoveryBatchSchema.safeParse({ ...batch(), requirements: [] }).success).toBe(false);
    const foreign = batch(); foreign.items[0]!.observation.diagnosticArtifacts[0] = { ...artifact, tenantId: "22222222-2222-4222-8222-222222222222" };
    expect(VerificationRecoveryBatchSchema.safeParse(foreign).success).toBe(false);
  });
  it("forbids unbounded repair limits, duplicate originals and invented judge metadata", () => {
    const value = batch();
    expect(VerificationRecoveryBatchSchema.safeParse({ ...value, items: [...value.items, ...value.items] }).success).toBe(false);
    expect(VerificationRecoveryBatchSchema.safeParse({ ...value, limits: { ...value.limits, maxRoundsPerOriginal: 3 } }).success).toBe(false);
    expect(VerificationRecoveryBindingSchema.safeParse({ ...binding, judge: "different model" }).success).toBe(false);
    expect(VerificationRecoveryBindingSchema.safeParse({ ...binding, claim: { ...binding.claim, nonce: "retry" } }).success).toBe(false);
  });
  it("exposes strict plan and receipt wire schemas without creating operations or admission overrides", () => {
    expect(VerificationRecoveryPlanSchema.shape.schemaVersion.value).toBe("verification-recovery-plan.v1");
    expect(VerificationRecoveryReceiptSchema.shape.schemaVersion.value).toBe("verification-recovery-receipt.v1");
    const value = { schemaVersion: "verification-recovery-plan.v1", tenantId: tenant, caseId: "case", parentAttemptId: "parent", recoveryPolicyVersion: "1", failureSetDigest: digest,
      actions: [{ originalId: "original", route: "adjudicate", rerunStages: [], reason: "held", diagnosticArtifactIds: [tenant] }], probes: [], probeExecutions: [], reservation: { calls: 0, costMicros: 0 }, leaseKeys: [], stopRules: ["no_new_information", "repeated_input", "limits_exhausted"], payloadDigest: digest };
    expect(VerificationRecoveryPlanSchema.safeParse(value).success).toBe(true);
    expect(VerificationRecoveryPlanSchema.safeParse({ ...value, actions: [...value.actions, ...value.actions] }).success).toBe(false);
    expect(VerificationRecoveryPlanSchema.safeParse({ ...value, admissionChanged: true }).success).toBe(false);
  });
});
