import type { DeterministicVerificationResult, VerificationArtifactHandle, VerificationPolicyDefinition, VerificationRecordedPolicyInputs } from "@aiengineer/knowledge-contracts";
import { VerificationAdjudicationCapabilityStateSchema, VerificationAdjudicationPacketSchema, VerificationAdjudicationPendingSubjectSchema } from "@aiengineer/knowledge-contracts";
import { evaluateVerificationPolicy } from "@aiengineer/knowledge-policy";
import { digestCanonicalJson, sha256Digest } from "@aiengineer/knowledge-verification";
import { describe, expect, it } from "vitest";

const tenantId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const createdAt = "2026-09-08T00:00:00.000Z";
const digest = (value: string) => sha256Digest(value);
const policy: VerificationPolicyDefinition = {
  schemaVersion: "verification-policy.v1", policyVersion: "vr014-policy.v1", definitionId: "vr014-synthetic-capability",
  criticalDownstreamUses: ["clinical_decision"], requireCrossFamilyForRisk: ["high", "critical"],
  requireIndependentAuthorityForScopes: ["clinical_utility"], mixedEvidenceOutcome: "review", unknownCriticalOutcome: "abstain", authorityWithheldOutcome: "review", reviewAvailable: true,
};
function deterministic(): DeterministicVerificationResult { return { verificationContractVersion: "verification.v1", status: "passed", semanticEligibility: true,
  deploymentSeparation: { status: "established", basis: "runtime_principal_binding", producerDeploymentId: "producer", verifierDeploymentId: "verifier" }, captureChecks: [],
  assertions: [{ assertionId: "claim-1", status: "passed", semanticEligibility: true, verdict: "pending_semantic_review", evidence: [], checks: [] }], metrics: [],
  summary: { capturesTotal: 1, capturesPassed: 1, assertionsTotal: 1, assertionsPassed: 1, metricsTotal: 0, metricsPassed: 0, failedCheckCodes: [], reviewReasons: [] },
}; }
function inputs(kind: "ambiguous" | "critical"): VerificationRecordedPolicyInputs {
  const result = deterministic();
  return { schemaVersion: "verification-policy-inputs.v1", policyVersion: policy.policyVersion, runId, recordedAt: createdAt, deterministicResult: result,
    assertions: [{ assertionId: "claim-1", riskClass: kind === "critical" ? "critical" : "high", downstreamUse: kind === "critical" ? ["clinical_decision"] : ["internal_research"], claimScope: kind === "critical" ? "clinical_utility" : "descriptive_fact",
      semantic: { assertionId: "claim-1", verdict: kind === "ambiguous" ? "mixed_or_conflicting" : "directly_supported", disposition: kind === "ambiguous" ? "review" : "admit", evidenceSupport: kind === "ambiguous" ? "unknown" : "satisfied", worldCorrectness: kind === "critical" ? "unknown" : "not_assessed", attributionFaithfulness: "not_assessed", sourceAuthority: "not_assessed", provenanceIntegrity: "satisfied", judgeIdentities: [], supportingFragmentIds: [], contradictingFragmentIds: [], unsupportedFacets: [], reasonCodes: [], crossFamilySecondJudge: false, rawProviderConfidences: [] },
      authorityStatus: "unknown", independentCorroboration: false, conflictPresent: false, criticalFactsKnown: kind !== "critical" }], metrics: [], sourceAssessments: [] };
}
function handle(index: number): VerificationArtifactHandle { const value = digest(`artifact-${index}`); return { artifactId: `${index.toString().padStart(8, "0")}-1111-4111-8111-111111111111`, tenantId, digest: value, mediaType: "application/json", byteLength: 1, objectKey: `${tenantId}/${index}`, createdAt, producerActivityId: "vr014-synthetic", producerVersion: "v1", encryptionClass: "managed", retentionClass: "audit", dataClassification: "restricted", parentArtifactIds: [] }; }
function packet(originalPolicyOutcome: "review" | "abstain") {
  const [manifest,bundle,deterministicResult,policyArtifact,recordedInputs,policyDecision] = [1,2,3,4,5,6].map(handle);
  return VerificationAdjudicationPacketSchema.parse({ schemaVersion: "verification-adjudication-packet.v1", verificationContractVersion: "verification.v1", tenantId,
    requestBinding: { operationId: "33333333-3333-4333-8333-333333333333", requestDigest: digest(`request-${originalPolicyOutcome}`), requesterActor: { kind: "service", id: "44444444-4444-4444-8444-444444444444" }, target: { kind: "run", runId }, targetObjectDigest: digest("target"), reason: "policy_review", requesterNote: "Synthetic capability fixture; no human decision." },
    reviewRequirements: { eligibleReviewerRoles: ["verification_expert"], quorumRequired: 2 },
    sealedRun: { runKind: "claims", runId, manifestArtifact: manifest, bundleArtifact: bundle, deterministicResultArtifact: deterministicResult, policyArtifact, recordedPolicyInputsArtifact: recordedInputs, policyDecisionArtifact: policyDecision, originalPolicyOutcome },
    auditProof: { payloadDigest: digest("payload"), manifestDigest: digest("manifest"), deterministicResultDigest: deterministicResult!.digest, policyDecisionDigest: policyDecision!.digest, signatureStatus: "verified", deterministicReplay: "exact", policyReplay: "exact" },
  });
}

describe("VR-014 synthetic policy-to-review capability", () => {
  it("routes ambiguous and critical-unknown outcomes to a schema-validated pending-human-review subject without human authority", () => {
    const ambiguous = evaluateVerificationPolicy(policy, inputs("ambiguous"));
    const critical = evaluateVerificationPolicy(policy, inputs("critical"));
    expect(ambiguous.outcome).toBe("review");
    expect(critical.outcome).toBe("abstain");
    if (ambiguous.outcome !== "review" || critical.outcome !== "abstain") throw new Error("VR014_POLICY_OUTCOME_DRIFT");
    for (const outcome of [ambiguous.outcome, critical.outcome] as const) {
      const subject = VerificationAdjudicationPendingSubjectSchema.parse({ subjectId: "55555555-5555-4555-8555-555555555555", status: "pending_human_adjudication", packetArtifact: { artifactId: "66666666-6666-4666-8666-666666666666", digest: digest(`packet-${outcome}`) }, originalPolicyOutcome: outcome, humanDecisionRecorded: false, admissionChanged: false });
      const queued = packet(outcome);
      expect(queued.reviewRequirements).toEqual({ eligibleReviewerRoles: ["verification_expert"], quorumRequired: 2 });
      expect(subject).toMatchObject({ originalPolicyOutcome: outcome, humanDecisionRecorded: false, admissionChanged: false });
    }
  });
  it("keeps request-subject capability separate from benchmark human-gold or decision authority", () => {
    const capability = VerificationAdjudicationCapabilityStateSchema.parse({ requestSubjectsEnabled: true, humanDecisionsEnabled: false, policyOverridesEnabled: false, explanation: "Synthetic queue capability only." });
    expect(capability).toMatchObject({ requestSubjectsEnabled: true, humanDecisionsEnabled: false, policyOverridesEnabled: false });
    expect(digestCanonicalJson(capability)).not.toContain("human-gold");
  });
});