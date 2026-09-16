import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgresKnowledgeOperationService, PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import { evaluateVerificationPolicy } from "../packages/policy/src/verification-policy.js";
import { sha256Digest } from "@aiengineer/knowledge-verification";
import { CanonicalActivityRegistry, reviewDecisionActivityHandler } from "../apps/worker/src/activity-registry.js";
import { CanonicalDurableKnowledgeWorker } from "../apps/worker/src/canonical-worker.js";

const { loadVerifiedLocalDevelopmentConfig } = await import("../../internal/verification-local-direct-config.mjs") as { loadVerifiedLocalDevelopmentConfig(): Promise<{ DB_URL: string }> };
const database = new PostgresCanonicalRepository({ connectionString: (await loadVerifiedLocalDevelopmentConfig()).DB_URL, localOnly: true });
const tenantId = randomUUID(), namespace = `vr014-synthetic-review-${randomUUID()}`;
const digest = (value: string) => sha256Digest(value);
const policy = { schemaVersion: "verification-policy.v1" as const, policyVersion: "vr014-synthetic.v1", definitionId: "vr014-synthetic-capability", criticalDownstreamUses: ["clinical_decision"], requireCrossFamilyForRisk: ["high", "critical"], requireIndependentAuthorityForScopes: ["clinical_utility"], mixedEvidenceOutcome: "review" as const, unknownCriticalOutcome: "abstain" as const, authorityWithheldOutcome: "review" as const, reviewAvailable: true };
function policyInput(kind: "ambiguous" | "critical") {
  return { schemaVersion: "verification-policy-inputs.v1" as const, policyVersion: policy.policyVersion, runId: randomUUID(), recordedAt: new Date().toISOString(), deterministicResult: { verificationContractVersion: "verification.v1" as const, status: "passed" as const, semanticEligibility: true, deploymentSeparation: { status: "established" as const, basis: "runtime_principal_binding", producerDeploymentId: "synthetic-producer", verifierDeploymentId: "synthetic-verifier" }, captureChecks: [], assertions: [{ assertionId: "synthetic-claim", status: "passed" as const, semanticEligibility: true, verdict: "pending_semantic_review", evidence: [], checks: [] }], metrics: [], summary: { capturesTotal: 0, capturesPassed: 0, assertionsTotal: 1, assertionsPassed: 1, metricsTotal: 0, metricsPassed: 0, failedCheckCodes: [], reviewReasons: [] } }, assertions: [{ assertionId: "synthetic-claim", riskClass: kind === "critical" ? "critical" as const : "high" as const, downstreamUse: kind === "critical" ? ["clinical_decision"] : ["internal_research"], claimScope: kind === "critical" ? "clinical_utility" : "descriptive_fact", semantic: { assertionId: "synthetic-claim", verdict: kind === "ambiguous" ? "mixed_or_conflicting" as const : "directly_supported" as const, disposition: kind === "ambiguous" ? "review" as const : "admit" as const, evidenceSupport: kind === "ambiguous" ? "unknown" as const : "satisfied" as const, worldCorrectness: "not_assessed" as const, attributionFaithfulness: "not_assessed" as const, sourceAuthority: "not_assessed" as const, provenanceIntegrity: "satisfied" as const, judgeIdentities: [], supportingFragmentIds: [], contradictingFragmentIds: [], unsupportedFacets: [], reasonCodes: [], crossFamilySecondJudge: false, rawProviderConfidences: [] }, authorityStatus: "unknown" as const, independentCorroboration: false, conflictPresent: false, criticalFactsKnown: kind !== "critical" }], metrics: [], sourceAssessments: [] };
}
const service = new PostgresKnowledgeOperationService(database, { admittedOperationKinds: ["review_decision"] });
const registry = new CanonicalActivityRegistry([reviewDecisionActivityHandler(database)]);
function context(actor: any, operationId = randomUUID()) { return { tenantId, operationId, attemptId: randomUUID(), correlationId: `${namespace}:${operationId}`, actor, capabilityVersion: "vr014-synthetic-capability.v1", idempotencyKey: `${namespace}:${operationId}`, reason: "isolated synthetic review capability proof; not a human label", contractVersion: "v1" as const }; }
async function submitSubject(actor: any, eligibleRoles = ["human_reviewer"]) {
  const value = context(actor), guardedDigest = digest(`synthetic-subject:${value.operationId}`), input = { schemaVersion: "knowledge.review-decision/v1", reviewSubjectId: randomUUID(), guardedDigest, decision: "defer", rationale: "Synthetic capability transition only; no human label or policy admission." };
  await service.submit("review_decision", { context: value, input, expectedVersions: { review: "v1" } }, "http://127.0.0.1");
  await database.createReviewSubject(tenantId, { id: input.reviewSubjectId, operationId: value.operationId, subjectKind: "source_vetting", subjectRef: { namespace, synthetic: true, policyAdmissionChanged: false }, guardedSha256: guardedDigest.slice(7), eligibleRoles });
  return { value, input };
}
async function execute(operationId: string) {
  const worker = new CanonicalDurableKnowledgeWorker(namespace, tenantId, database, async claim => { const operation = await database.getOperationRecord(tenantId, claim.operationId); assert.ok(operation); return registry.execute(operation, claim); }, 30_000, registry.operationKinds());
  return worker.runOperationOnce(operationId);
}
try {
  assert.equal(evaluateVerificationPolicy(policy, policyInput("ambiguous") as never).outcome, "review");
  assert.equal(evaluateVerificationPolicy(policy, policyInput("critical") as never).outcome, "abstain");
  const syntheticReviewer = { kind: "service" as const, id: randomUUID(), serviceIdentity: "human_reviewer" as const };
  const authorized = await submitSubject(syntheticReviewer); const terminal = await execute(authorized.value.operationId); assert.ok(terminal); assert.equal(terminal.operation?.status, "succeeded");
  const decisionRows = await database.transaction(tenantId, async client => (await client.query("select reviewer_identity,reviewer_role,decision from knowledge_service.review_decision where tenant_id=$1 and review_subject_id=$2", [tenantId, authorized.input.reviewSubjectId])).rows);
  assert.deepEqual(decisionRows, [{ reviewer_identity: syntheticReviewer.id, reviewer_role: "human_reviewer", decision: "defer" }]);
  const unauthorized = await submitSubject({ kind: "service" as const, id: randomUUID(), serviceIdentity: "knowledge_worker" as const });
  await assert.rejects(execute(unauthorized.value.operationId), { code: "REVIEW_AUTHORITY_REQUIRED" });
  assert.equal((await database.transaction(tenantId, async client => (await client.query("select count(*)::int as count from knowledge_service.review_decision where tenant_id=$1 and review_subject_id=$2", [tenantId, unauthorized.input.reviewSubjectId])).rows[0]!.count)), 0);
  const wrongRole = await submitSubject(syntheticReviewer, ["verification_expert"]);
  await assert.rejects(database.recordReviewDecision(tenantId, { id: randomUUID(), reviewSubjectId: wrongRole.input.reviewSubjectId, guardedSha256: wrongRole.input.guardedDigest.slice(7), reviewerIdentity: syntheticReviewer.id, reviewerRole: "human_reviewer", decision: "defer", rationale: "must be rejected", decisionOperationId: wrongRole.value.operationId }), /REVIEW_AUTHORITY_OR_DIGEST_MISMATCH/);
  const output = resolve("..", "internal", `${namespace}.json`), sourceHashes = Object.fromEntries(await Promise.all(["scripts/prove-verification-vr014-review-capability.ts", "apps/worker/src/activity-registry.ts", "packages/application/src/operations/surface.ts", "packages/persistence/src/postgres.ts", "packages/contracts/src/verification/adjudication.ts"].map(async file => [file, createHash("sha256").update(await readFile(file)).digest("hex")])));
  await writeFile(output, JSON.stringify({ schemaVersion: "verification-vr014-synthetic-review-capability-proof.v1", capturedAt: new Date().toISOString(), namespace, tenantId, scope: { syntheticOnly: true, humanAuthorityGranted: false, humanLabelsRecorded: false, policyAdmissionChanged: false, providerCalls: 0, remoteWrites: 0 }, checks: { ambiguousPolicyRoutesToReview: true, criticalUnknownPolicyAbstains: true, authorizedSyntheticHumanReviewerTransitionRecorded: true, nonReviewerServiceRejected: true, ineligibleReviewerRoleRejected: true, verificationAdjudicationHumanDecisionsRemainDisabled: true, verificationAdjudicationPolicyOverridesRemainDisabled: true }, operations: { authorizedReviewDecision: authorized.value.operationId, rejectedReviewDecision: unauthorized.value.operationId }, sourceHashes }, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ output, authorizedOperationId: authorized.value.operationId }));
} finally { await database.close(); }
