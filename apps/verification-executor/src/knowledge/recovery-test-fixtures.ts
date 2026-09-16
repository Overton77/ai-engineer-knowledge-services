import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { DurableRecoveryCase, VerificationRecoveryBatch } from "@aiengineer/knowledge-contracts";
import { DurableVerificationRecoveryService, type DurableRecoveryEvidenceAuthority, type DurableRecoveryStore, type DurableRecoveryCustody, type VerificationRecoveryVerifiedResult } from "@aiengineer/knowledge-application";
import { digestCanonicalJson } from "@aiengineer/knowledge-verification";
import { FilesystemStore } from "../store.js";
import { ClaimsIntentSchema } from "../intents.js";
import { RecoveryRunAuthority } from "./recovery-authority.js";
import { AutomaticRecoveryRouting } from "./recovery-routing.js";

/** Small persistence double; integration tests replace it with the canonical Postgres implementation. */
export function memoryRecoveryStore(): DurableRecoveryStore {
  const cases = new Map<string, DurableRecoveryCase>();
  const unavailable = async (): Promise<never> => { throw new Error("TEST_EXECUTION_NOT_CONFIGURED"); };
  return {
    async open(input) {
      const previous = cases.get(input.batch.caseId);
      if (previous) return structuredClone(previous);
      const row: DurableRecoveryCase = { tenantId: input.tenantId, caseId: input.batch.caseId, revision: 1, state: "ready",
        initialBatch: structuredClone(input.batch), batch: structuredClone(input.batch), initialAuthorityArtifact: input.authorityArtifact,
        authorityDigest: input.authorityArtifact.digest, spent: { calls: 0, costMicros: 0 }, reserved: { calls: 0, costMicros: 0 }, executions: [], claims: [],
        revisions: [{ revision: 1, kind: "batch", idempotencyKey: input.batch.caseId, value: input.batch, artifact: input.batchArtifact }] };
      cases.set(row.caseId, row); return structuredClone(row);
    },
    async read(tenantId, caseId) {
      const value = cases.get(caseId);
      if (!value || value.tenantId !== tenantId) throw new Error("RECOVERY_CASE_NOT_FOUND");
      return structuredClone(value);
    },
    async append(input) {
      const value = cases.get(input.caseId)!;
      for (const entry of input.entries) {
        const prior = value.revisions.find(row => row.kind === entry.kind && row.idempotencyKey === entry.idempotencyKey);
        if (prior && (digestCanonicalJson(prior.value) !== digestCanonicalJson(entry.value) || prior.artifact.artifactId !== entry.artifact.artifactId)) throw new Error("RECOVERY_REVISION_IDEMPOTENCY_CONFLICT");
        if (!prior) value.revisions.push({ ...entry, revision: ++value.revision });
      }
      return structuredClone(value);
    },
    claim: unavailable, reserve: unavailable, link: unavailable, settle: unavailable,
  };
}

export async function recoveryFixture(options: {
  tenantId?: string; store?: FilesystemStore; custody?: DurableRecoveryCustody; persistence?: DurableRecoveryStore;
} = {}) {
  const tenantId = options.tenantId ?? randomUUID();
  const root = options.store ? undefined : await mkdtemp(join(tmpdir(), "ks-recovery-routing-"));
  const store = options.store ?? new FilesystemStore(root!, tenantId); await store.init();
  const custody = options.custody ?? {
    async register(input: Parameters<DurableRecoveryCustody["register"]>[0]) {
      return (await store.putJson(input.value, { mediaType: "application/json", producerActivityId: `recovery-fixture:${input.identity}`,
        producerVersion: "test.v1", parentArtifactIds: [...input.parentArtifactIds], transformation: { kind: input.kind } })).handle;
    },
    async read(input: Parameters<DurableRecoveryCustody["read"]>[0]) { return store.json(input.artifact); },
  };
  const source = (await store.putJson({ metric: 10 }, { mediaType: "application/json", producerActivityId: "retained-source", producerVersion: "v1" })).handle;
  const policy = (await store.putJson({ policy: "test.v1" }, { mediaType: "application/json", producerActivityId: "verification-executor:policy_definition", producerVersion: "v1" })).handle;
  const decision = (await store.putJson({ outcome: "fail" }, { mediaType: "application/json", producerActivityId: "verification-executor:evaluate_policy", producerVersion: "v1", parentArtifactIds: [policy.artifactId], transformation: { kind: "decision" } })).handle;
  const runId = randomUUID();
  const binding = { claim: { statement: "Metric is 10", qualifiers: [] },
    evidence: [{ representationDigest: source.digest, contextDigest: digestCanonicalJson("context"), selector: { kind: "json_pointer" as const, pointer: "/missing" } }],
    captureDigests: [source.digest], policyDigest: policy.digest, profileDigest: digestCanonicalJson("run-pin") };
  const items: VerificationRecoveryBatch["items"] = [1, 2, 3, 4].map(index => {
    const itemBinding = structuredClone(binding);
    itemBinding.claim.statement = `Metric ${index} is 10`;
    if (index === 4) itemBinding.evidence[0]!.selector.pointer = "/metric";
    return { originalId: `claim-${index}`, questionIds: [`question-${index}`], inputDigest: digestCanonicalJson(itemBinding), binding: itemBinding,
      observation: { operationId: randomUUID(), runId, execution: "pending", family: "execution", earliestStage: "mechanical", signature: "pending", dependencyIds: [], diagnosticArtifacts: [] },
      usedRounds: 0, attemptedInputDigests: [], attemptedRepairDigests: [] };
  });
  const batch: VerificationRecoveryBatch = { tenantId, callerId: "host", batchId: randomUUID(), caseId: randomUUID(), parentAttemptId: randomUUID(),
    recoveryPolicyVersion: "recovery.v1", capturedAt: "2026-09-14T00:00:00.000Z", questionIds: items.flatMap(item => item.questionIds),
    requirements: items.map(item => ({ questionId: item.questionIds[0]!, requirementId: item.originalId, description: "Retain original metric" })), items,
    limits: { maxRoundsPerOriginal: 2, maxProbeRounds: 1, remainingCalls: 8, remainingCostMicros: 100, deadline: "2099-01-01T00:00:00.000Z" },
    allowedActions: ["repair", "seek_evidence"], probeRounds: [] };
  const intent = ClaimsIntentSchema.parse({ schemaVersion: "verification-claims-intent.v1", intentId: "fixture", claims: items.map(item => ({ claimId: item.originalId,
    proposition: item.binding.claim.statement, evidence: [{ captureId: "source", quote: "10" }] })) });
  const authorization = await custody.register({ tenantId, kind: "batch", identity: "host-authorization",
    value: { schemaVersion: "verification-recovery-run-authorization.v1", runId, claimsIntentDigest: digestCanonicalJson(intent), batch }, parentArtifactIds: [source.artifactId] });
  const results = new Map<string, VerificationRecoveryVerifiedResult>();
  for (const [index, item] of items.entries()) results.set(item.inputDigest, {
    tenantId, inputDigest: item.inputDigest, binding: item.binding, coveredRequirementIds: [], revoked: false,
    observation: { ...item.observation, execution: "completed", mechanical: index === 3 ? "passed" : "failed", semantic: index === 3 ? "directly_supported" : "locator_error",
      policy: index === 3 ? "pass" : "fail", family: index === 3 ? "none" : "selector", earliestStage: "selector", signature: "missing-pointer",
      dependencyIds: index === 3 ? [] : ["shared-selector"], diagnosticArtifacts: [decision] },
    verifiedStages: ["selector", "mechanical", "semantic", "policy"], usage: { calls: 0, costMicros: 0 },
  });
  const evidence: Omit<DurableRecoveryEvidenceAuthority, "readInitialBatch"> = {
    now: () => "2026-09-14T01:00:00.000Z",
    async readResult(request) { return structuredClone(results.get(request.inputDigest) ?? null); },
    async readProbe() { throw new Error("TEST_PROBE_NOT_BOUND"); },
    async readInvalidation() { throw new Error("TEST_INVALIDATION_NOT_BOUND"); },
    async authorizeResume() { throw new Error("TEST_RESUME_NOT_BOUND"); },
  };
  const authority = new RecoveryRunAuthority({ tenantId, custody, evidence, pins: {
    async forRun(id) { if (id !== runId) throw new Error("RUN_PIN_NOT_FOUND"); return authorization; },
    async forBatch(id) { if (id !== batch.batchId) throw new Error("BATCH_PIN_NOT_FOUND"); return authorization; },
  } });
  const recovery = new DurableVerificationRecoveryService(options.persistence ?? memoryRecoveryStore(), authority, custody,
    { async ensureOperation() { throw new Error("TEST_RUNTIME_NOT_BOUND"); }, async reconcile() { throw new Error("TEST_RUNTIME_NOT_BOUND"); } },
    { async verify() { throw new Error("TEST_CHECKPOINT_NOT_BOUND"); } });
  const router = new AutomaticRecoveryRouting({ tenantId, authority, recovery });
  return { tenantId, store, custody, source, policy, decision, runId, batch, intent, authority, recovery, router, authorization, results,
    notify: () => router.notify({ runId, authorityArtifactId: authorization.artifactId, policyArtifact: policy, decisionArtifact: decision }),
    representation: async (digest: string) => { if (digest !== source.digest) throw new Error("UNKNOWN_REPRESENTATION"); return { artifact: source, bytes: await store.bytes(source) }; },
    async close() { if (root) { const absolute = resolve(root); if (!absolute.startsWith(`${resolve(tmpdir())}${sep}`)) throw new Error("TEST_CLEANUP_PATH_DENIED"); await rm(absolute, { recursive: true, force: true }); } },
  };
}
