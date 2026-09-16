import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { digestCanonicalJson, canonicalizeJson } from "@aiengineer/knowledge-verification";
import type { DurableRecoveryCase, VerificationRecoveryBatch, VerificationRecoveryPlan, VerificationFailureSet } from "@aiengineer/knowledge-contracts";
import { DurableVerificationRecoveryService } from "./verification-recovery-durable.js";
import type { DurableRecoveryStore, DurableRecoveryEvidenceAuthority, DurableRecoveryRuntime, DurableRecoveryCheckpoints, DurableRecoveryCustody } from "./verification-recovery-durable-ports.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const operationId = "22222222-2222-4222-8222-222222222222";
const clock = "2026-09-13T00:00:00.000Z";
function fixture() {
  const values = new Map<string, unknown>();
  const custody: DurableRecoveryCustody = {
    async register(input) {
      const bytes = new TextEncoder().encode(canonicalizeJson(input.value));
      const handle = { artifactId: randomUUID(), tenantId, digest: digestCanonicalJson(input.value), byteLength: bytes.byteLength, objectKey: `artifacts/${digestCanonicalJson(input.value).slice(7)}`, mediaType: "application/json", createdAt: clock,
        producerActivityId: input.identity, producerVersion: "test.v1", encryptionClass: "managed", retentionClass: "audit", dataClassification: "internal" as const, parentArtifactIds: [...input.parentArtifactIds] };
      values.set(handle.artifactId, input.value); return handle;
    },
    async read({ artifact }) { if (!values.has(artifact.artifactId)) throw new Error("MISSING_BYTES"); return values.get(artifact.artifactId); },
  };
  return { custody, values, async setup(mode: "pending" | "failed" = "pending") {
    const authorityArtifact = await custody.register({ tenantId, kind: "batch", identity: "authority", parentArtifactIds: [], value: { trusted: true } });
    const binding = { claim: { statement: "metric", qualifiers: [], value: 1 }, evidence: [{ representationDigest: digestCanonicalJson("representation"), contextDigest: digestCanonicalJson("context"), selector: { kind: "json_pointer" as const, pointer: "/metric" } }], captureDigests: [], policyDigest: digestCanonicalJson("policy"), profileDigest: digestCanonicalJson("profile") };
    const batch: VerificationRecoveryBatch = { tenantId, callerId: "caller", batchId: "batch", caseId: "case", parentAttemptId: "parent", capturedAt: clock,
      recoveryPolicyVersion: "v1", questionIds: ["question"], requirements: [{ requirementId: "requirement", questionId: "question", description: "original scope" }],
      items: [{ originalId: "original", questionIds: ["question"], inputDigest: digestCanonicalJson(binding), binding,
        observation: mode === "pending" ? { operationId, execution: "pending", family: "execution", earliestStage: "capture", signature: "pending", dependencyIds: [], diagnosticArtifacts: [] } : { operationId, execution: "completed", mechanical: "failed", semantic: "locator_error", policy: "fail", family: "selector", earliestStage: "selector", signature: "selector", dependencyIds: [], diagnosticArtifacts: [authorityArtifact] },
        usedRounds: 0, attemptedInputDigests: [], attemptedRepairDigests: [] }],
      limits: { maxRoundsPerOriginal: 2, maxProbeRounds: 1, remainingCalls: 2, remainingCostMicros: 10, deadline: "2026-09-15T00:00:00.000Z" }, allowedActions: ["repair"], probeRounds: [] };
    const batchArtifact = await custody.register({ tenantId, kind: "batch", identity: "batch", parentArtifactIds: [authorityArtifact.artifactId], value: batch });
    const snapshot: DurableRecoveryCase = { tenantId, caseId: "case", revision: 1, state: "ready", initialBatch: structuredClone(batch), batch,
      authorityDigest: authorityArtifact.digest, initialAuthorityArtifact: authorityArtifact,
      revisions: [{ revision: 1, kind: "batch", idempotencyKey: "batch", artifact: batchArtifact, value: batch }], executions: [], claims: [], spent: { calls: 0, costMicros: 0 }, reserved: { calls: 0, costMicros: 0 } };
    const store = { read: vi.fn(async () => structuredClone(snapshot)), append: vi.fn(async () => structuredClone(snapshot)) };
    const authority = { readResult: vi.fn<DurableRecoveryEvidenceAuthority["readResult"]>(async () => null), now: () => clock, readInitialBatch: vi.fn(async () => ({ batch, authorityArtifact })), authorizeResume: vi.fn(async () => ({ kind: "review", priorAuthorityDigest: authorityArtifact.digest, nextAuthorityDigest: authorityArtifact.digest, artifact: authorityArtifact })) };
    const checkpoints = { verify: vi.fn(async () => { throw new Error("CHECKPOINT_NOT_VERIFIED"); }) };
    const runtime = { ensureOperation: vi.fn(), reconcile: vi.fn() };
    const service = new DurableVerificationRecoveryService(store as unknown as DurableRecoveryStore, authority as unknown as DurableRecoveryEvidenceAuthority,
      custody, runtime as DurableRecoveryRuntime, checkpoints as DurableRecoveryCheckpoints);
    return { snapshot, store, authority, checkpoints, runtime, service, authorityArtifact };
  } };
}

describe("durable recovery admission boundaries", () => {
  it("permits custody reads but prevents mutation when execution and checkpoint ports are absent", async () => {
    const fixtures = fixture();
    const test = await fixtures.setup();
    const service = new DurableVerificationRecoveryService(test.store as unknown as DurableRecoveryStore,
      test.authority as unknown as DurableRecoveryEvidenceAuthority, fixtures.custody);
    expect(await service.read(tenantId, "case")).toEqual(test.snapshot);
    await expect(service.plan(tenantId, { caseId: "case", expectedRevision: 1, actions: [], probes: [],
      reservation: { calls: 0, costMicros: 0 } })).rejects.toThrow("RECOVERY_RUNTIME_NOT_CONFIGURED");
    await expect(service.claim(tenantId, { caseId: "case", planDigest: "digest", holderIdentity: "holder", leaseMs: 1000 }))
      .rejects.toThrow("RECOVERY_RUNTIME_NOT_CONFIGURED");
    await expect(service.reconcile(tenantId, { caseId: "case", planDigest: "digest" })).rejects.toThrow("RECOVERY_RUNTIME_NOT_CONFIGURED");
    await expect(service.wait(tenantId, { caseId: "case", expectedRevision: 1, checkpointId: operationId, reason: "review" }))
      .rejects.toThrow("RECOVERY_CHECKPOINTS_NOT_CONFIGURED");
    expect(test.store.append).not.toHaveBeenCalled();
    expect(test.runtime.ensureOperation).not.toHaveBeenCalled();
  });
  it("does not release claims or mutate wait state before checkpoint verification", async () => {
    const test = await fixture().setup();
    await expect(test.service.wait(tenantId, { caseId: "case", expectedRevision: 1, checkpointId: operationId, reason: "review" })).rejects.toThrow("CHECKPOINT_NOT_VERIFIED");
    expect(test.store.append).not.toHaveBeenCalled();
    expect(test.runtime.ensureOperation).not.toHaveBeenCalled();
  });
  it("rejects unchanged authenticated resume authority without resetting counters", async () => {
    const test = await fixture().setup(); test.snapshot.state = "waiting";
    await expect(test.service.resume(tenantId, { caseId: "case", expectedRevision: 1, authorityArtifact: test.authorityArtifact })).rejects.toThrow("RECOVERY_RESUME_REQUIRES_NEW_AUTHORITY");
    expect(test.store.append).not.toHaveBeenCalled();
  });
  it("does not persist a receipt claiming an unissued semantic round", async () => {
    const fixtures = fixture(); const test = await fixtures.setup();
    const digest = digestCanonicalJson("plan");
    const failureDigest = digestCanonicalJson("failure");
    const plan = { payloadDigest: digest, failureSetDigest: failureDigest, actions: [{ originalId: "original", newBinding: test.snapshot.batch.items[0]!.binding }] };
    const failure = { payloadDigest: failureDigest, batch: test.snapshot.batch };
    for (const [kind, value, idempotencyKey] of [["failure_set", failure, failureDigest], ["plan", plan, digest]] as const) {
      const artifact = await fixtures.custody.register({ tenantId, kind, value, identity: idempotencyKey, parentArtifactIds: [] });
      test.snapshot.revisions.push({ revision: test.snapshot.revisions.length + 1, kind, value, artifact, idempotencyKey });
    }
    await expect(test.service.reconcile(tenantId, { caseId: "case", planDigest: digest })).rejects.toThrow("RECOVERY_EXECUTION_AUTHORIZATION_REQUIRED");
    expect(test.runtime.ensureOperation).not.toHaveBeenCalled();
    expect(test.store.append).not.toHaveBeenCalled();
  });
  it("preserves a previously repaired candidate in the next planning snapshot without another round", async () => {
    const test = await fixture().setup("failed");
    const original = test.snapshot.batch.items[0]!;
    const changed = { ...original.binding, evidence: [{ ...original.binding.evidence[0]!, selector: { kind: "json_pointer" as const, pointer: "/corrected" } }] };
    const stages = ["selector", "mechanical", "semantic", "policy", "report"] as const;
    await test.service.plan(tenantId, { caseId: "case", expectedRevision: 1, actions: [{ originalId: "original", route: "repair", newBinding: changed,
      rerunStages: [...stages], reason: "correct selector", diagnosticArtifactIds: [test.authorityArtifact.artifactId] }], probes: [], reservation: { calls: 1, costMicros: 5 } });
    const first = (test.store.append.mock.calls[0] as unknown as [Parameters<DurableRecoveryStore["append"]>[0]])[0];
    const previousPlan = first.entries.find(entry => entry.kind === "plan")!.value as VerificationRecoveryPlan;
    for (const entry of first.entries) test.snapshot.revisions.push({ ...entry, revision: ++test.snapshot.revision });
    const repairedOperation = "33333333-3333-4333-8333-333333333333";
    const changedDigest = digestCanonicalJson(changed);
    test.snapshot.executions.push({ executionId: repairedOperation, tenantId, caseId: "case", originalId: "original", planDigest: previousPlan.payloadDigest,
      repairDigest: digestCanonicalJson({ originalId: "original", binding: changed }), inputDigest: changedDigest, plannedOperationId: repairedOperation,
      operationId: repairedOperation, requestDigest: digestCanonicalJson("request"), state: "settled", reservation: { calls: 1, costMicros: 5 }, usage: { calls: 1, costMicros: 2 },
      authorizationToken: repairedOperation, claimToken: repairedOperation, claimFence: 1 });
    original.usedRounds = 1; original.attemptedInputDigests = [changedDigest];
    test.authority.readResult.mockResolvedValue({ tenantId, inputDigest: changedDigest, binding: changed,
      observation: { ...original.observation, runId: "run", operationId: repairedOperation, mechanical: "passed", semantic: "directly_supported", policy: "pass", family: "none" },
      coveredRequirementIds: ["requirement"], verifiedStages: ["capture", "parser", ...stages], revoked: false, usage: { calls: 1, costMicros: 2 } });
    await test.service.plan(tenantId, { caseId: "case", expectedRevision: test.snapshot.revision, actions: [{ originalId: "original", route: "preserve",
      rerunStages: [], reason: "existing admitted repair", diagnosticArtifactIds: [test.authorityArtifact.artifactId] }], probes: [], reservation: { calls: 0, costMicros: 0 } });
    const second = (test.store.append.mock.calls.at(-1) as unknown as [Parameters<DurableRecoveryStore["append"]>[0]])[0];
    const set = second.entries.find(entry => entry.kind === "failure_set")!.value as VerificationFailureSet;
    expect(set.batch.items[0]).toMatchObject({ inputDigest: changedDigest, usedRounds: 1 });
    expect(set.questionDenominator).toBe(1);
    expect(test.snapshot.initialBatch.items[0]!.inputDigest).not.toBe(changedDigest);
    expect(test.runtime.ensureOperation).not.toHaveBeenCalled();
  });
  it("fails a read when immutable batch bytes disappear", async () => {
    const fixtureValue = fixture(); const test = await fixtureValue.setup();
    fixtureValue.values.delete(test.snapshot.revisions[0]!.artifact.artifactId);
    await expect(test.service.read(tenantId, "case")).rejects.toThrow("MISSING_BYTES");
  });
  it("routes pending original execution through the P1.4 reconcile plan without dispatch", async () => {
    const test = await fixture().setup();
    await test.service.plan(tenantId, { caseId: "case", expectedRevision: 1, actions: [{ originalId: "original", route: "reconcile", rerunStages: [], reason: "original request pending", diagnosticArtifactIds: [] }], probes: [], reservation: { calls: 0, costMicros: 0 } });
    expect(test.store.append).toHaveBeenCalledOnce();
    expect(test.runtime.ensureOperation).not.toHaveBeenCalled();
  });
});
