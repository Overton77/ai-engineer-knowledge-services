import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { AssertionSchema, VerifyClaimsRequestSchema, type DurableRecoveryCase, type VerificationArtifactHandle, type VerificationRecoveryAction, type VerificationRecoveryBatch, type VerificationRecoveryBinding, type VerificationRecoveryItem } from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, sha256Digest } from "@aiengineer/knowledge-verification";
import { CheckpointApplicationService, type DurableRecoveryEvidenceAuthority, type DurableRecoveryRuntime, type DurableRecoveryCheckpoints } from "@aiengineer/knowledge-application";
import { DurableVerificationRecoveryService, type VerificationRecoveryVerifiedResult } from "@aiengineer/knowledge-application";
import { disposableDatabaseUrl, disposableStorageConfig } from "../../../../packages/persistence/test/disposable.mjs";
import { PostgresCanonicalRepository, PostgresDurableVerificationRecoveryStore, PostgresCheckpointStore } from "@aiengineer/knowledge-persistence";
import { FilesystemStore } from "../store.js";
import { createExecutorCustody } from "../store-custody-postgres.js";
import { createDurableRecoveryCustody } from "./recovery-durable-custody.js";
import { createDurableRecoveryCheckpoints } from "./recovery-durable-checkpoints.js";
import { createCheckpointCustody } from "./checkpoints-custody.js";
import { CHECKPOINT_POLICY, CHECKPOINT_PROFILE_PINS } from "./checkpoints-policy.js";
import { createDurableRecoveryRuntime } from "./recovery-durable-runtime.js";

const databaseUrl = disposableDatabaseUrl(), storageConfig = disposableStorageConfig();
const hash = (value: unknown) => sha256Digest(canonicalizeJson(value));
const at = "2026-09-13T10:00:00.000Z";
const deadline = "2099-09-14T00:00:00.000Z";

function binding(n: number): VerificationRecoveryBinding {
  return { claim: { statement: `Metric ${n} is 10 for 2025`, qualifiers: ["2025"], value: 10 },
    evidence: [{ representationDigest: hash("table"), contextDigest: hash("headers"), selector: { kind: "json_pointer", pointer: `/rows/${n}` } }],
    captureDigests: [hash("capture")], policyDigest: hash("policy"), profileDigest: hash("profile") };
}
function action(original: VerificationRecoveryItem, route: VerificationRecoveryAction["route"] = "repair"): VerificationRecoveryAction {
  return { originalId: original.originalId, route, reason: "Preserve the original question and repair its locator",
    diagnosticArtifactIds: original.observation.diagnosticArtifacts.map(ref => ref.artifactId),
    rerunStages: route === "repair" ? ["selector", "mechanical", "semantic", "policy", "report"] : [],
    ...(route === "repair" ? { newBinding: { ...original.binding, evidence: [{ ...original.binding.evidence[0]!, selector: { kind: "json_pointer" as const, pointer: "/corrected" } }] } } : {}) };
}

/** External authority is a fixture owner of immutable remote records, separate from recovery case state. */
async function fixture(count = 1) {
  const tenantId = randomUUID(), root = await mkdtemp(join(tmpdir(), "ks-recovery-cases-"));
  const attemptId = randomUUID(), actorId = randomUUID();
  let sourceArtifact: VerificationArtifactHandle;
  const connections: { database: PostgresCanonicalRepository; remote: ReturnType<typeof createExecutorCustody> }[] = [];
  const batches = new Map<string, { batch: VerificationRecoveryBatch; artifact: VerificationArtifactHandle }>();
  const results = new Map<string, VerificationArtifactHandle>();
  const resumes = new Map<string, { priorAuthorityDigest: string; nextAuthorityDigest: string }>();
  let checkpointOwner: DurableRecoveryCheckpoints = { async verify() { throw new Error("TEST_CHECKPOINT_OWNER_REQUIRED"); } };
  const connect = async (name: string) => {
    const database = new PostgresCanonicalRepository({ connectionString: databaseUrl! });
    const remote = createExecutorCustody({ databaseUrl: databaseUrl!, tenantId, projectUrl: storageConfig!.projectUrl, secretKey: storageConfig!.secretKey });
    connections.push({ database, remote });
    const local = new FilesystemStore(join(root, name), tenantId); await local.init(); local.attachCustody(remote);
    const custody = createDurableRecoveryCustody(local, remote);
    const evidence: DurableRecoveryEvidenceAuthority = {
      now: () => at,
      async readInitialBatch(request) {
        if (request.tenantId !== tenantId) throw new Error("TEST_AUTHORITY_TENANT_DENIED");
        const held = batches.get(request.batchId); if (!held) throw new Error("TEST_BATCH_NOT_AUTHORIZED");
        expect(await custody.read({ tenantId, artifact: held.artifact })).toEqual(held.batch);
        return { batch: structuredClone(held.batch), authorityArtifact: held.artifact };
      },
      async authorizeResume(request) {
        const admitted = resumes.get(request.authorityArtifact.artifactId);
        if (request.tenantId !== tenantId || !admitted) throw new Error("TEST_RESUME_NOT_AUTHENTICATED");
        expect(await custody.read({ tenantId, artifact: request.authorityArtifact })).toMatchObject(admitted);
        return { kind: "review", ...admitted, artifact: request.authorityArtifact };
      },
      async readResult(request) {
        if (request.tenantId !== tenantId) throw new Error("TEST_AUTHORITY_TENANT_DENIED");
        const artifact = results.get(request.inputDigest); if (!artifact) return null;
        const result = await custody.read({ tenantId, artifact }) as VerificationRecoveryVerifiedResult;
        if (request.operationId && request.operationId !== result.observation.operationId) return null;
        const operation = await database.getOperation(tenantId, result.observation.operationId);
        if (operation?.operationKind === "verification_claims") {
          expect(operation.status).toBe("succeeded");
          const receipts = await database.listReceipts(tenantId, operation.id);
          expect(receipts).toHaveLength(1);
          expect(receipts[0]!.body).toMatchObject({ resultArtifactId: artifact.artifactId, usage: result.usage });
        }
        return result;
      },
      async readProbe() { throw new Error("TEST_NO_PROBE_AUTHORITY"); },
      async readInvalidation(request) {
        const value = { schemaVersion: "verification-recovery-invalidation.v1" as const, ...request, complete: true as const,
          evaluations: [], invalidatedOutputIds: [], revalidatedOutputIds: [], blockedOutputIds: [] };
        return { ...value, payloadDigest: hash(value) };
      },
    };
    const durable = new PostgresDurableVerificationRecoveryStore(database);
    const runtime = createDurableRecoveryRuntime({ store: durable, database, admittedOperationKinds: ["verification_claims"], origin: "http://localhost",
      materializer: { async materialize(input) {
        await local.writeCapture({ captureId: "fixture-source", sourceId: "fixture-table", requestedUrl: "https://example.com/metrics", finalUrl: "https://example.com/metrics",
          capturedAt: at, captureMethod: "fixture", captureMethodVersion: "v1", contentArtifact: sourceArtifact, characters: sourceArtifact.byteLength,
          sourceKind: "api", logicalIdentity: "fixture-table" });
        const assertion = AssertionSchema.parse({ assertionId: input.execution.originalId, kind: "claim", claimType: "measurement",
          proposition: input.binding.claim.statement, value: input.binding.claim.value, qualifiers: input.binding.claim.qualifiers,
          producer: { deploymentId: "fixture-producer", attemptId, capabilityVersion: "fixture.v1" },
          entityBindings: [], derivation: "direct", evidence: input.binding.evidence.map((evidence, index) => ({
            evidenceId: `fixture-${index}`, fragment: { fragmentId: `fragment-${index}`, captureId: "fixture-source", representationArtifactId: sourceArtifact.artifactId, selector: evidence.selector },
            role: "supports", origin: "declared", parserLineageArtifactIds: [],
            authority: { authority: "primary", independence: "self_reported", directness: "direct", freshness: "historical", applicability: "direct" },
          })), riskClass: "low", downstreamUse: ["research"], atomic: true,
          intent: { intentId: input.execution.originalId, operation: "verify_claim_support", subject: input.binding.claim.statement,
            expectedResult: "Grounded measurement", method: "Inspect preserved evidence", acceptanceCriteria: ["Original metric and year"], abstainWhen: ["Evidence unavailable"] } });
        const assertions = await local.putJson([assertion], { mediaType: "application/json", producerActivityId: `recovery-fixture:${input.execution.executionId}`, producerVersion: "fixture.v1", parentArtifactIds: [sourceArtifact.artifactId], transformation: { kind: "fixture-claim", inputDigest: input.execution.inputDigest } });
        const request = VerifyClaimsRequestSchema.parse({ verificationContractVersion: "verification.v1", captureIds: ["fixture-source"],
          assertions: { artifactId: assertions.handle.artifactId, digest: assertions.handle.digest } });
        return { kind: "verification_claims", envelope: {
          context: { tenantId, operationId: input.execution.plannedOperationId, attemptId, correlationId: input.execution.executionId,
            actor: { kind: "service", id: actorId, serviceIdentity: "knowledge_worker" }, capabilityVersion: "verification-service.v1",
            idempotencyKey: input.idempotencyKey, reason: "Authorized bounded repair", contractVersion: "v1" },
          input: { schemaVersion: "verification-service-request.v1", useCase: "verifyClaims", request },
          expectedVersions: { verification: "verification.v1", service: "verification-service-request.v1" },
        } };
      } },
      async reconcileOriginalOperation(request) {
        const operation = await database.getOperationRecord(request.tenantId, request.operationId);
        if (!operation || `sha256:${operation.requestSha256}` !== request.requestDigest) throw new Error("TEST_OPERATION_BINDING_MISMATCH");
      },
    });
    const service = new DurableVerificationRecoveryService(durable, evidence, custody, runtime, { verify: input => checkpointOwner.verify(input) });
    return { database, remote, local, custody, evidence, runtime, durable, service };
  };
  const first = await connect("producer");
  await first.database.transaction(tenantId, async client => {
    const missionId = randomUUID(), workItemId = randomUUID();
    await client.query("insert into orchestration.mission(id,tenant_id,goal) values($1,$2,'Isolated recovery service proof')", [missionId, tenantId]);
    await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind) values($1,$2,$3,'build_vectors')", [workItemId, tenantId, missionId]);
    await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,1,'service:recovery-fixture')", [attemptId, tenantId, workItemId]);
  });
  const diagnostic = await first.custody.register({ tenantId, kind: "batch", identity: "fixture-diagnostic", value: { table: "retained selector failure" }, parentArtifactIds: [] });
  sourceArtifact = (await first.local.putJson({ rows: { 1: 10, 2: 10, 3: 10, 4: 10 }, corrected: 10, "corrected-again": 10 },
    { mediaType: "application/json", producerActivityId: "fixture-table", producerVersion: "v1" })).handle;
  const items: VerificationRecoveryItem[] = [];
  for (let n = 1; n <= count; n++) {
    const originalBinding = binding(n), operationId = randomUUID();
    originalBinding.evidence[0]!.representationDigest = sourceArtifact.digest;
    originalBinding.captureDigests = [sourceArtifact.digest];
    await first.database.createOperation({ tenantId, id: operationId, operationKind: "verification.fixture_original", idempotencyKey: `original-${n}`,
      actorIdentity: "authenticated-audit-fixture", correlationId: randomUUID(), request: originalBinding, steps: [] });
    items.push({ originalId: `item-${n}`, questionIds: [`question-${n}`], inputDigest: hash(originalBinding), binding: originalBinding,
      observation: { operationId, runId: `run-${n}`, execution: "completed", mechanical: "failed", semantic: "locator_error", policy: "fail", family: "selector", earliestStage: "selector", signature: "selector-shared", dependencyIds: ["shared-table"], diagnosticArtifacts: [diagnostic] },
      usedRounds: 0, attemptedInputDigests: [], attemptedRepairDigests: [] });
  }
  const batch: VerificationRecoveryBatch = { tenantId, callerId: "authenticated-audit-fixture", batchId: randomUUID(), caseId: randomUUID(), parentAttemptId: randomUUID(), recoveryPolicyVersion: "recovery.v1", capturedAt: at, closedAt: at,
    items, questionIds: items.flatMap(item => item.questionIds), requirements: items.flatMap(item => item.questionIds.map(questionId => ({ questionId, requirementId: `${questionId}-scope`, description: "Same metric, year, units and population" }))),
    limits: { maxRoundsPerOriginal: 2, maxProbeRounds: 1, remainingCalls: 20, remainingCostMicros: 100_000, deadline }, allowedActions: ["repair", "seek_evidence"], probeRounds: [] };
  async function authorizeBatch(value = batch) {
    const artifact = await first.custody.register({ tenantId, kind: "batch", identity: `authority-${value.batchId}`, value, parentArtifactIds: [diagnostic.artifactId] });
    batches.set(value.batchId, { batch: structuredClone(value), artifact }); return artifact;
  }
  async function recordResult(original: VerificationRecoveryItem, changed: VerificationRecoveryBinding, operationId: string, passed = true) {
    const value: VerificationRecoveryVerifiedResult = { tenantId, inputDigest: hash(changed), binding: changed,
      observation: { ...original.observation, operationId, execution: "completed", mechanical: passed ? "passed" : "failed", semantic: passed ? "directly_supported" : "locator_error", policy: passed ? "pass" : "fail", family: passed ? "none" : "selector", dependencyIds: [`verified:${original.originalId}`] },
      coveredRequirementIds: passed ? original.questionIds.map(question => `${question}-scope`) : [], verifiedStages: ["capture", "parser", "selector", "mechanical", "semantic", "policy", "report"], revoked: false, usage: { calls: 1, costMicros: 10 } };
    const artifact = await first.custody.register({ tenantId, kind: "receipt", identity: `verified-owner-${operationId}`, value, parentArtifactIds: [diagnostic.artifactId] });
    const operation = await first.database.getOperation(tenantId, operationId);
    if (operation?.operationKind === "verification_claims") {
      const lease = await first.database.claimOperation(tenantId, operationId, "independent-verifier-fixture", 60_000);
      if (!lease) throw new Error("TEST_VERIFIER_LEASE_REQUIRED");
      await first.database.completeStep(tenantId, lease, { id: randomUUID(), idempotencyKey: `fixture-result:${operationId}`,
        receiptKind: "verify_claims_and_register.succeeded", executorIdentity: "independent-verifier-fixture", output: { resultArtifactId: artifact.artifactId, usage: value.usage } });
    }
    results.set(value.inputDigest, artifact); return artifact;
  }
  async function checkpoint(current: DurableRecoveryCase, owner = first) {
    const scope = { tenantId, runId: current.caseId, producerAttemptId: "recovery-proof", sessionId: current.caseId, sandboxId: current.caseId, namespace: "notes" };
    const service = new CheckpointApplicationService(new PostgresCheckpointStore(owner.database), createCheckpointCustody(owner.local, owner.remote),
      { async reconcile({ operation }) { return { ...operation, state: "unresolved", artifacts: [] }; } }, CHECKPOINT_POLICY);
    const artifact = await owner.custody.register({ tenantId, kind: "wait", identity: `wait-notes-${current.revision}`, value: { objective: "Preserve all original questions", batch: current.batch, reserved: current.reserved }, parentArtifactIds: [] });
    const receipt = await service.commit(tenantId, { idempotencyKey: randomUUID(), expectedHead: null, manifest: {
      schemaVersion: "scoped-checkpoint.v1", scope, parentCheckpointId: null, ...CHECKPOINT_PROFILE_PINS,
      mode: "archive", boundary: "manual", files: [{ path: "notes/recovery.json", artifact }], requiredArtifacts: [], pendingOperations: [],
    } });
    checkpointOwner = createDurableRecoveryCheckpoints({ checkpoints: service, profilePins: CHECKPOINT_PROFILE_PINS,
      async scopeForCase(input) { if (input.caseId !== current.caseId || input.tenantId !== tenantId) throw new Error("TEST_CHECKPOINT_SCOPE_DENIED"); return scope; } });
    return receipt;
  }
  async function removeStore(owner: Awaited<ReturnType<typeof connect>>) {
    const target = resolve(owner.local.rootDir); if (!target.startsWith(resolve(root) + sep)) throw new Error("TEST_CLEANUP_PATH_DENIED");
    await owner.database.close(); await owner.remote.close(); await rm(target, { recursive: true });
    const index = connections.findIndex(connection => connection.database === owner.database); if (index >= 0) connections.splice(index, 1);
  }
  return { tenantId, root, first, connect, batch, authorizeBatch, recordResult, resumes,
    checkpoint, removeStore,
    setCheckpointOwner(owner: DurableRecoveryCheckpoints) { checkpointOwner = owner; },
    async removeProducer() {
      await removeStore(first);
    },
    async close() {
      await Promise.all(connections.map(async connection => { await connection.remote.close(); await connection.database.close(); }));
      if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !root.includes("ks-recovery-cases-")) throw new Error("TEST_CLEANUP_PATH_DENIED");
      await rm(root, { recursive: true, force: true });
    },
  };
}

describe.skipIf(!databaseUrl || !storageConfig)("RC09/RC12 durable verification recovery through PostgreSQL and Storage", () => {
  it("RC09/RC12 preserves a recovered member while repairing another in round two without charging or resetting the original twice", async () => {
    const f = await fixture(2);
    try {
      await f.authorizeBatch();
      const opened = await f.first.service.open(f.tenantId, { batchId: f.batch.batchId, notificationId: "mixed-rounds" });
      const repairs = f.batch.items.map(item => action(item));
      const firstPlan = await f.first.service.plan(f.tenantId, { caseId: opened.caseId, expectedRevision: opened.revision, actions: repairs, probes: [], reservation: { calls: 2, costMicros: 200 } });
      const claim = await f.first.service.claim(f.tenantId, { caseId: opened.caseId, planDigest: firstPlan.activePlanDigest!, holderIdentity: "round-one", leaseMs: 60_000 });
      for (const [index, item] of f.batch.items.entries()) {
        const execution = await f.first.service.execute(f.tenantId, { claim, originalId: item.originalId, reservation: { calls: 1, costMicros: 100 } });
        await f.recordResult(item, repairs[index]!.newBinding!, execution.operationId!, index === 0);
      }
      const partial = await f.first.service.reconcile(f.tenantId, { caseId: opened.caseId, planDigest: firstPlan.activePlanDigest! });
      expect(partial.spent).toEqual({ calls: 2, costMicros: 20 });
      expect(partial.latestReceipt!.coveredQuestionIdsAfter).toEqual([f.batch.items[0]!.questionIds[0]]);
      const nextRepair = action(f.batch.items[1]!);
      nextRepair.newBinding!.evidence[0]!.selector = { kind: "json_pointer", pointer: "/corrected-again" };
      const secondPlan = await f.first.service.plan(f.tenantId, { caseId: opened.caseId, expectedRevision: partial.revision,
        actions: [nextRepair, action(f.batch.items[0]!, "preserve")], probes: [], reservation: { calls: 1, costMicros: 100 } });
      const nextClaim = await f.first.service.claim(f.tenantId, { caseId: opened.caseId, planDigest: secondPlan.activePlanDigest!, holderIdentity: "round-two", leaseMs: 60_000 });
      expect(nextClaim.keys).toEqual(expect.arrayContaining([`dependency:${hash("verified:item-1")}`, `dependency:${hash("verified:item-2")}`]));
      const execution = await f.first.service.execute(f.tenantId, { claim: nextClaim, originalId: f.batch.items[1]!.originalId, reservation: { calls: 1, costMicros: 100 } });
      await f.recordResult(f.batch.items[1]!, nextRepair.newBinding!, execution.operationId!);
      await f.removeProducer();
      const restored = await f.connect("restored-round-two");
      const complete = await restored.service.reconcile(f.tenantId, { caseId: opened.caseId, planDigest: secondPlan.activePlanDigest! });
      expect(complete.latestReceipt!.questionDenominator).toBe(2);
      expect(complete.latestReceipt!.coveredQuestionIdsAfter).toEqual(f.batch.questionIds);
      expect(complete.latestReceipt!.remainingQuestionIds).toEqual([]);
      expect(complete.batch.items.map(item => item.usedRounds)).toEqual([1, 2]);
      expect(complete.spent).toEqual({ calls: 3, costMicros: 30 });
      expect(complete.reserved).toEqual({ calls: 0, costMicros: 0 });
      expect(complete.initialBatch).toEqual(f.batch);
      expect(complete.executions).toHaveLength(3);
      const operations = await restored.database.transaction(f.tenantId, client => client.query("select id from knowledge_service.operation where tenant_id=$1 and operation_kind='verification_claims'", [f.tenantId]));
      expect(operations.rows).toHaveLength(3);
    } finally { await f.close(); }
  }, 90_000);

  it("RC09 deduplicates notifications and preserves immutable case state after the producer store is gone", async () => {
    const f = await fixture();
    try {
      await f.authorizeBatch();
      const second = await f.connect("worker-two");
      const request = { batchId: f.batch.batchId, notificationId: "original-policy-notification" };
      const [left, right] = await Promise.all([f.first.service.open(f.tenantId, request), second.service.open(f.tenantId, request)]);
      expect(left).toEqual(right);
      expect(left.batch.items).toEqual(f.batch.items);
      const drift = await f.first.custody.register({ tenantId: f.tenantId, kind: "notification", identity: "policy-observation",
        value: { originalIds: f.batch.items.map(item => item.originalId), policyVersion: "recovery.v2", requiresReview: true }, parentArtifactIds: [] });
      const notification = { caseId: left.caseId, notificationId: "original-policy-v2", artifact: drift };
      const notified = await f.first.service.ingestDrift(f.tenantId, notification);
      expect(await second.service.ingestDrift(f.tenantId, notification)).toEqual(notified);
      const changed = await f.first.custody.register({ tenantId: f.tenantId, kind: "notification", identity: "changed-policy-observation", value: { different: true }, parentArtifactIds: [] });
      await expect(second.service.ingestDrift(f.tenantId, { ...notification, artifact: changed })).rejects.toThrow(/CONFLICT/);
      const reset = { ...f.batch, caseId: randomUUID(), batchId: randomUUID() };
      await f.authorizeBatch(reset);
      await expect(second.service.open(f.tenantId, { batchId: reset.batchId, notificationId: "regrouped-reset" })).rejects.toThrow();
      await f.removeProducer();
      const restored = await f.connect("restored");
      expect(await restored.service.read(f.tenantId, f.batch.caseId)).toEqual(notified);
      for (const revision of notified.revisions) expect(await restored.custody.read({ tenantId: f.tenantId, artifact: revision.artifact })).toEqual(revision.value);
      const retained = await restored.database.transaction(f.tenantId, client => client.query<{ artifact_id: string }>("select artifact_id from knowledge_service.recovery_artifact_reference where tenant_id=$1 and case_id=$2", [f.tenantId, f.batch.caseId]));
      expect(retained.rows.map(row => row.artifact_id)).toEqual(expect.arrayContaining([notified.initialAuthorityArtifact.artifactId, f.batch.items[0]!.observation.diagnosticArtifacts[0]!.artifactId]));
      await expect(restored.service.read(randomUUID(), f.batch.caseId)).rejects.toThrow();
      await f.removeStore(restored);
      const reconstructedAgain = await f.connect("restored-again");
      expect(await reconstructedAgain.service.read(f.tenantId, f.batch.caseId)).toEqual(notified);
    } finally { await f.close(); }
  }, 60_000);

  it("RC09 retains uncertain spend and one canonical execution across independent workers and restart, then charges the original once", async () => {
    const f = await fixture();
    try {
      await f.authorizeBatch();
      const opened = await f.first.service.open(f.tenantId, { batchId: f.batch.batchId, notificationId: "duplicate" });
      const repair = action(f.batch.items[0]!);
      const planned = await f.first.service.plan(f.tenantId, { caseId: opened.caseId, expectedRevision: opened.revision,
        actions: [repair], probes: [], reservation: { calls: 1, costMicros: 100 } });
      const second = await f.connect("worker-two");
      const claims = await Promise.allSettled([f.first, second].map((worker, index) => worker.service.claim(f.tenantId,
        { caseId: planned.caseId, planDigest: planned.activePlanDigest!, holderIdentity: `worker-${index}`, leaseMs: 60_000 })));
      expect(claims.filter(result => result.status === "fulfilled")).toHaveLength(1);
      const claim = claims.find(result => result.status === "fulfilled")!;
      if (claim.status !== "fulfilled") throw new Error("TEST_CLAIM_REQUIRED");
      expect(claim.value.keys).toEqual([...claim.value.keys].sort());
      const request = { claim: claim.value, originalId: f.batch.items[0]!.originalId, reservation: { calls: 1, costMicros: 100 } };
      const execution = await f.first.service.execute(f.tenantId, request);
      expect(await second.service.execute(f.tenantId, request)).toEqual(execution);
      const unknown = await second.service.reconcile(f.tenantId, { caseId: planned.caseId, planDigest: planned.activePlanDigest! });
      expect(unknown.reserved).toEqual({ calls: 1, costMicros: 100 });
      expect(unknown.spent).toEqual({ calls: 0, costMicros: 0 });
      expect(unknown.executions).toHaveLength(1);
      const operations = await second.database.transaction(f.tenantId, client => client.query("select id from knowledge_service.operation where tenant_id=$1 and operation_kind='verification_claims'", [f.tenantId]));
      expect(operations.rows).toHaveLength(1);
      await f.recordResult(f.batch.items[0]!, repair.newBinding!, execution.operationId!);
      await f.removeProducer();
      const restored = await f.connect("restored");
      const completed = await restored.service.reconcile(f.tenantId, { caseId: planned.caseId, planDigest: planned.activePlanDigest! });
      expect(completed.spent).toEqual({ calls: 1, costMicros: 10 });
      expect(completed.reserved).toEqual({ calls: 0, costMicros: 0 });
      expect(completed.batch.items[0]!.usedRounds).toBe(1);
      const repeated = await restored.service.reconcile(f.tenantId, { caseId: planned.caseId, planDigest: planned.activePlanDigest! });
      expect(repeated.spent).toEqual(completed.spent);
      expect(repeated.executions).toEqual(completed.executions);
      const policy = await restored.custody.register({ tenantId: f.tenantId, kind: "notification", identity: "post-spend-policy",
        value: { recoveryPolicyVersion: "recovery.v2", originalId: f.batch.items[0]!.originalId }, parentArtifactIds: [] });
      const notified = await restored.service.ingestDrift(f.tenantId, { caseId: repeated.caseId, notificationId: "post-spend-policy", artifact: policy });
      expect(notified.spent).toEqual(completed.spent);
      expect(notified.batch.items[0]!.usedRounds).toBe(1);
      expect(notified.batch.limits.remainingCalls).toBe(19);
      await expect(restored.service.plan(f.tenantId, { caseId: notified.caseId, expectedRevision: notified.revision,
        actions: [repair], probes: [], reservation: { calls: 1, costMicros: 100 } })).rejects.toThrow(/REPEATED_INPUT|UNSAFE_ROUTE/);
      for (const revision of repeated.revisions) expect(await restored.custody.read({ tenantId: f.tenantId, artifact: revision.artifact })).toEqual(revision.value);
    } finally { await f.close(); }
  }, 90_000);

  it("RC09 excludes overlapping dependency workers and rejects an expired fence for new execution", async () => {
    const f = await fixture(2);
    try {
      await f.authorizeBatch();
      const opened = await f.first.service.open(f.tenantId, { batchId: f.batch.batchId, notificationId: "dependency" });
      const planned = await f.first.service.plan(f.tenantId, { caseId: opened.caseId, expectedRevision: opened.revision,
        actions: f.batch.items.map(item => action(item)), probes: [], reservation: { calls: 2, costMicros: 200 } });
      const stale = await f.first.service.claim(f.tenantId, { caseId: planned.caseId, planDigest: planned.activePlanDigest!, holderIdentity: "expired-worker", leaseMs: 60_000 });
      const overlapping = structuredClone(f.batch);
      overlapping.caseId = randomUUID(); overlapping.batchId = randomUUID();
      for (const item of overlapping.items) {
        item.observation.operationId = randomUUID();
        await f.first.database.createOperation({ tenantId: f.tenantId, id: item.observation.operationId,
          operationKind: "verification.fixture_original", idempotencyKey: `overlap-${item.originalId}`, actorIdentity: "authenticated-audit-fixture",
          correlationId: randomUUID(), request: item.binding, steps: [] });
      }
      await f.authorizeBatch(overlapping);
      const other = await f.first.service.open(f.tenantId, { batchId: overlapping.batchId, notificationId: "overlap" });
      const otherPlan = await f.first.service.plan(f.tenantId, { caseId: other.caseId, expectedRevision: other.revision,
        actions: overlapping.items.map(item => action(item)).reverse(), probes: [], reservation: { calls: 2, costMicros: 200 } });
      await expect(f.first.service.claim(f.tenantId, { caseId: otherPlan.caseId, planDigest: otherPlan.activePlanDigest!, holderIdentity: "overlapping-worker", leaseMs: 60_000 })).rejects.toThrow("DEPENDENCY_BUSY");
      await f.first.database.transaction(f.tenantId, client => client.query("update knowledge_service.recovery_dependency_claim set expires_at=clock_timestamp()-interval '1 second' where tenant_id=$1 and case_id=$2 and claim_token=$3", [f.tenantId, planned.caseId, stale.token]));
      const fresh = await f.connect("fresh-worker");
      const replacement = await fresh.service.claim(f.tenantId, { caseId: planned.caseId, planDigest: planned.activePlanDigest!, holderIdentity: "replacement", leaseMs: 60_000 });
      expect(replacement.fencingToken).toBeGreaterThan(stale.fencingToken);
      await expect(f.first.service.execute(f.tenantId, { claim: stale, originalId: f.batch.items[0]!.originalId, reservation: { calls: 1, costMicros: 100 } })).rejects.toThrow(/STALE_CLAIM/);
      const execution = await fresh.service.execute(f.tenantId, { claim: replacement, originalId: f.batch.items[0]!.originalId, reservation: { calls: 1, costMicros: 100 } });
      expect(execution.claimFence).toBe(replacement.fencingToken);
      const state = await fresh.service.read(f.tenantId, planned.caseId);
      expect(state.batch.items.map(item => item.usedRounds)).toEqual([1, 0]);
      expect(state.executions).toHaveLength(1);
      await fresh.database.transaction(f.tenantId, client => client.query("update knowledge_service.recovery_dependency_claim set expires_at=clock_timestamp()-interval '1 second' where tenant_id=$1 and case_id=$2 and claim_token=$3", [f.tenantId, planned.caseId, replacement.token]));
      await expect(fresh.service.claim(f.tenantId, { caseId: otherPlan.caseId, planDigest: otherPlan.activePlanDigest!, holderIdentity: "cannot-bypass-unknown-owner", leaseMs: 60_000 })).rejects.toThrow(/RECONCIL|UNRESOLVED/);
      const sameCase = await fresh.service.claim(f.tenantId, { caseId: planned.caseId, planDigest: planned.activePlanDigest!, holderIdentity: "recover-original-only", leaseMs: 60_000 });
      expect(await fresh.service.execute(f.tenantId, { claim: sameCase, originalId: f.batch.items[0]!.originalId, reservation: { calls: 1, costMicros: 100 } })).toEqual(execution);
      await expect(fresh.service.execute(f.tenantId, { claim: sameCase, originalId: f.batch.items[1]!.originalId, reservation: { calls: 1, costMicros: 100 } })).rejects.toThrow("PREVIOUS_OWNER_RECONCILIATION_REQUIRED");
    } finally { await f.close(); }
  }, 90_000);

  it("RC09 recovers canonical operation creation before link persistence without creating a second dispatch", async () => {
    const f = await fixture();
    try {
      await f.authorizeBatch();
      const opened = await f.first.service.open(f.tenantId, { batchId: f.batch.batchId, notificationId: "link-loss" });
      const planned = await f.first.service.plan(f.tenantId, { caseId: opened.caseId, expectedRevision: opened.revision,
        actions: [action(f.batch.items[0]!)], probes: [], reservation: { calls: 1, costMicros: 100 } });
      const claim = await f.first.service.claim(f.tenantId, { caseId: planned.caseId, planDigest: planned.activePlanDigest!, holderIdentity: "dies-before-link", leaseMs: 60_000 });
      f.first.durable.link = async () => { throw new Error("TEST_PROCESS_LOST_BEFORE_LINK"); };
      await expect(f.first.service.execute(f.tenantId, { claim, originalId: f.batch.items[0]!.originalId, reservation: { calls: 1, costMicros: 100 } })).rejects.toThrow("TEST_PROCESS_LOST_BEFORE_LINK");
      const authorized = await f.first.service.read(f.tenantId, planned.caseId);
      expect(authorized.executions[0]!.state).toBe("authorized");
      expect(await f.first.database.getOperation(f.tenantId, authorized.executions[0]!.plannedOperationId)).toBeDefined();
      await f.removeProducer();
      const restored = await f.connect("restored");
      const reconciled = await restored.service.reconcile(f.tenantId, { caseId: planned.caseId, planDigest: planned.activePlanDigest! });
      expect(reconciled.executions).toHaveLength(1);
      expect(reconciled.executions[0]).toMatchObject({ state: "linked", operationId: authorized.executions[0]!.plannedOperationId });
      expect(reconciled.reserved).toEqual({ calls: 1, costMicros: 100 });
      expect(reconciled.batch.items[0]!.usedRounds).toBe(1);
      const steps = await restored.database.transaction(f.tenantId, client => client.query("select step_kind,attempt_count from knowledge_service.operation_step where tenant_id=$1 and operation_id=$2", [f.tenantId, authorized.executions[0]!.plannedOperationId]));
      expect(steps.rows).toEqual([{ step_kind: "verify_claims_and_register", attempt_count: 0 }]);
    } finally { await f.close(); }
  }, 90_000);

  it("RC12 verifies real checkpoint custody before releasing claims and only resumes under authenticated changed authority", async () => {
    const f = await fixture(4);
    try {
      f.batch.items[0]!.usedRounds = 2;
      f.batch.items[0]!.attemptedInputDigests = [hash("prior-input-one"), hash("prior-input-two")];
      f.batch.items[1]!.observation.policy = "review";
      f.batch.items[2]!.observation.execution = "cancelled";
      f.batch.items[3]!.observation.execution = "unknown";
      const initialAuthority = await f.authorizeBatch();
      const opened = await f.first.service.open(f.tenantId, { batchId: f.batch.batchId, notificationId: "review-policy" });
      const planned = await f.first.service.plan(f.tenantId, { caseId: opened.caseId, expectedRevision: opened.revision,
        actions: f.batch.items.map((item, index) => action(item, ["exhausted", "adjudicate", "cancelled", "reconcile"][index] as VerificationRecoveryAction["route"])), probes: [], reservation: { calls: 0, costMicros: 0 } });
      await f.first.service.claim(f.tenantId, { caseId: planned.caseId, planDigest: planned.activePlanDigest!, holderIdentity: "review-holder", leaseMs: 60_000 });
      await expect(f.first.service.wait(f.tenantId, { caseId: planned.caseId, expectedRevision: planned.revision, checkpointId: randomUUID(), reason: "review" })).rejects.toThrow("TEST_CHECKPOINT_OWNER_REQUIRED");
      expect((await f.first.service.read(f.tenantId, planned.caseId)).claims).toHaveLength(1);
      const receipt = await f.first.service.reconcile(f.tenantId, { caseId: planned.caseId, planDigest: planned.activePlanDigest! });
      expect(receipt.latestReceipt!.questionDenominator).toBe(4);
      expect(receipt.latestReceipt!.results.map(result => result.outcome)).toEqual(["exhausted", "review_required", "cancelled", "reconciliation_unresolved"]);
      const checkpoint = await f.checkpoint(receipt);
      let waiting = await f.first.service.wait(f.tenantId, { caseId: receipt.caseId, expectedRevision: receipt.revision, checkpointId: checkpoint.checkpointId, reason: "authenticated review required" });
      expect(waiting.state).toBe("waiting"); expect(waiting.claims).toHaveLength(0);
      await expect(f.first.service.resume(f.tenantId, { caseId: waiting.caseId, expectedRevision: waiting.revision, authorityArtifact: initialAuthority })).rejects.toThrow("TEST_RESUME_NOT_AUTHENTICATED");
      const unchanged = { priorAuthorityDigest: waiting.authorityDigest, nextAuthorityDigest: waiting.authorityDigest };
      const unchangedArtifact = await f.first.custody.register({ tenantId: f.tenantId, kind: "resume", identity: "unchanged-review", value: unchanged, parentArtifactIds: [] });
      f.resumes.set(unchangedArtifact.artifactId, unchanged);
      await expect(f.first.service.resume(f.tenantId, { caseId: waiting.caseId, expectedRevision: waiting.revision, authorityArtifact: unchangedArtifact })).rejects.toThrow("REQUIRES_NEW_AUTHORITY");
      const changed = { priorAuthorityDigest: waiting.authorityDigest, nextAuthorityDigest: hash("authenticated-new-review") };
      const changedArtifact = await f.first.custody.register({ tenantId: f.tenantId, kind: "resume", identity: "changed-review", value: changed, parentArtifactIds: [] });
      f.resumes.set(changedArtifact.artifactId, changed);
      const previouslyUnknown = f.batch.items[3]!;
      await f.recordResult(previouslyUnknown, previouslyUnknown.binding, previouslyUnknown.observation.operationId);
      waiting = await f.first.service.reconcile(f.tenantId, { caseId: waiting.caseId, planDigest: planned.activePlanDigest! });
      await f.removeProducer();
      const restored = await f.connect("restored");
      const resumed = await restored.service.resume(f.tenantId, { caseId: waiting.caseId, expectedRevision: waiting.revision, authorityArtifact: changedArtifact });
      expect(resumed.batch).toEqual(waiting.batch);
      expect(resumed.spent).toEqual(waiting.spent); expect(resumed.reserved).toEqual(waiting.reserved);
      expect(resumed.batch.items.map(item => item.originalId)).toEqual(f.batch.items.map(item => item.originalId));
      expect(resumed.batch.items[0]!.usedRounds).toBe(2);
      const regrouped = await restored.service.plan(f.tenantId, { caseId: resumed.caseId, expectedRevision: resumed.revision,
        actions: f.batch.items.map((item, index) => action(item, ["exhausted", "adjudicate", "cancelled", "preserve"][index] as VerificationRecoveryAction["route"])).reverse(), probes: [], reservation: { calls: 0, costMicros: 0 } });
      expect(regrouped.batch.items).toEqual(resumed.batch.items);
      expect(regrouped.batch.limits).toEqual(resumed.batch.limits);
      expect(regrouped.latestPlan!.actions.map(item => item.originalId)).toEqual([...planned.latestPlan!.actions].reverse().map(item => item.originalId));
      const operationCount = await restored.database.transaction(f.tenantId, client => client.query<{ count: string }>("select count(*) from knowledge_service.operation_step where tenant_id=$1", [f.tenantId]));
      expect(Number(operationCount.rows[0]!.count)).toBe(0);
      expect(await restored.custody.read({ tenantId: f.tenantId, artifact: checkpoint.manifestArtifact })).toMatchObject({ mode: "archive" });
    } finally { await f.close(); }
  }, 90_000);
});
