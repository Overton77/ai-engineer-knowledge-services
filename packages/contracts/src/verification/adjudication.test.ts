import { describe, expect, it } from "vitest";
import { VerificationAdjudicationOperationResultSchema, VerificationAdjudicationPacketSchema, VerificationAdjudicationDecisionResultSchema } from "./adjudication.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const handle = (n: number, character: string) => ({ artifactId: id(n), tenantId: id(1), digest: digest(character), mediaType: "application/json", byteLength: 2, objectKey: `${id(1)}/${character}`, createdAt: "2026-09-07T00:00:00.000Z", producerActivityId: "test-only-synthetic-fixture", producerVersion: "test.v1", encryptionClass: "managed", retentionClass: "audit", dataClassification: "restricted" as const, parentArtifactIds: [] });

const packet = () => ({
  schemaVersion: "verification-adjudication-packet.v1" as const,
  verificationContractVersion: "verification.v1" as const,
  tenantId: id(1),
  requestBinding: { operationId: id(2), requestDigest: digest("a"), requesterActor: { kind: "service" as const, id: id(3) }, target: { kind: "run" as const, runId: id(4) }, targetObjectDigest: digest("b"), reason: "policy_review" as const },
  reviewRequirements: { eligibleReviewerRoles: ["verification_reviewer"], quorumRequired: 1 },
  sealedRun: { runKind: "claims" as const, runId: id(4), manifestArtifact: handle(5, "c"), bundleArtifact: handle(6, "d"), deterministicResultArtifact: handle(7, "e"), policyArtifact: handle(8, "f"), recordedPolicyInputsArtifact: handle(9, "1"), policyDecisionArtifact: handle(10, "2"), originalPolicyOutcome: "review" as const },
  auditProof: { payloadDigest: digest("3"), manifestDigest: digest("4"), deterministicResultDigest: digest("e"), policyDecisionDigest: digest("2"), signatureStatus: "verified" as const, deterministicReplay: "exact" as const, policyReplay: "exact" as const },
});

describe("verification adjudication request contracts", () => {
  it("rejects impossible human quorum claims and preserves counts above the required threshold", () => {
    const value={schemaVersion:"verification-adjudication-decision-result.v1",subjectId:id(1),packetArtifact:{artifactId:id(2),digest:digest("a")},decisionArtifact:{artifactId:id(3),digest:digest("b")},decision:"affirm",reviewerProvenance:"synthetic_engineering",quorum:{required:2,humanAffirmRecorded:0,humanRejectRecorded:0,humanDeferRecorded:0,syntheticAffirmRecorded:25,reached:false},admissionChanged:false,humanGoldScoringEligible:false};
    expect(VerificationAdjudicationDecisionResultSchema.parse(value).quorum.syntheticAffirmRecorded).toBe(25);
    expect(()=>VerificationAdjudicationDecisionResultSchema.parse({...value,quorum:{...value.quorum,reached:true}})).toThrow();
    expect(()=>VerificationAdjudicationDecisionResultSchema.parse({...value,quorum:{...value.quorum,humanAffirmRecorded:3,humanRejectRecorded:1,reached:true}})).toThrow();
    expect(VerificationAdjudicationDecisionResultSchema.parse({...value,quorum:{...value.quorum,humanAffirmRecorded:20,reached:true}}).quorum.humanAffirmRecorded).toBe(20);
  });
  it("accepts only a server-composed pending packet and makes no human/admission claim", () => {
    const parsed = VerificationAdjudicationPacketSchema.parse(packet());
    const packetArtifact = handle(12, "5");
    const result = VerificationAdjudicationOperationResultSchema.parse({ schemaVersion: "verification-operation-result.v1", operationId: id(2), useCase: "requestAdjudication", requestDigest: digest("a"), output: { subjectId: id(11), status: "pending_human_adjudication", packetArtifact: { artifactId: packetArtifact.artifactId, digest: packetArtifact.digest }, originalPolicyOutcome: "review", humanDecisionRecorded: false, admissionChanged: false }, resultArtifact: packetArtifact });
    expect(parsed.reviewRequirements).toEqual({ eligibleReviewerRoles: ["verification_reviewer"], quorumRequired: 1 });
    expect(result.output).toMatchObject({ humanDecisionRecorded: false, admissionChanged: false });
  });

  it("rejects duplicate roles, cross-tenant handles, missing report gates, digest drift, and invented authority fields", () => {
    expect(() => VerificationAdjudicationPacketSchema.parse({ ...packet(), reviewRequirements: { eligibleReviewerRoles: ["reviewer", "reviewer"], quorumRequired: 1 } })).toThrow();
    expect(() => VerificationAdjudicationPacketSchema.parse({ ...packet(), sealedRun: { ...packet().sealedRun, policyArtifact: { ...packet().sealedRun.policyArtifact, tenantId: id(99) } } })).toThrow();
    expect(() => VerificationAdjudicationPacketSchema.parse({ ...packet(), sealedRun: { ...packet().sealedRun, runKind: "report" } })).toThrow();
    expect(() => VerificationAdjudicationPacketSchema.parse({ ...packet(), auditProof: { ...packet().auditProof, policyDecisionDigest: digest("9") } })).toThrow();
    expect(() => VerificationAdjudicationPacketSchema.parse({ ...packet(), reviewerIdentity: "synthetic-human" })).toThrow();
  });
});
