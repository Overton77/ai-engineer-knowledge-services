import { VerificationAdjudicationPacketSchema, type VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { sha256Digest } from "@aiengineer/knowledge-verification";
import { describe, expect, it, vi } from "vitest";
import { VerificationAdjudicationReadError, VerificationAdjudicationReadService, type VerifiedVerificationAdjudicationReadPort } from "./verification-adjudication-reads.js";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const tenantId = id(1), operationId = id(2), subjectId = id(3), createdAt = "2026-09-07T15:00:00.000Z";
const digest = (value: string) => sha256Digest(`synthetic:${value}`);
function handle(value: number): VerificationArtifactHandle { const d = digest(String(value)); return { artifactId: id(value), tenantId, digest: d, mediaType: "application/json", byteLength: 2, objectKey: `private/${d.slice(7)}`, createdAt, producerActivityId: "synthetic", producerVersion: "synthetic.v1", encryptionClass: "managed", retentionClass: "audit", dataClassification: "restricted", parentArtifactIds: [] }; }
const manifest = { ...handle(10), mediaType: "application/vnd.aiengineer.verification-run-manifest+json" };
const bundle = { ...handle(11), mediaType: "application/vnd.aiengineer.verification-bundle+json" };
const deterministic = { ...handle(12), mediaType: "application/vnd.aiengineer.deterministic-verification-result+json" };
const policy = { ...handle(13), mediaType: "application/vnd.aiengineer.verification-policy+json" };
const inputs = { ...handle(14), mediaType: "application/vnd.aiengineer.verification-policy-inputs+json" };
const decision = { ...handle(15), mediaType: "application/vnd.aiengineer.verification-policy-decision+json" };
const requestDigest = digest("request"), packetDigest = digest("packet");
const packet = VerificationAdjudicationPacketSchema.parse({ schemaVersion: "verification-adjudication-packet.v1", verificationContractVersion: "verification.v1", tenantId, requestBinding: { operationId, requestDigest, requesterActor: { kind: "service", id: id(20) }, target: { kind: "run", runId: id(21) }, targetObjectDigest: digest("target"), reason: "policy_review" }, reviewRequirements: { eligibleReviewerRoles: ["verification_expert"], quorumRequired: 2 }, sealedRun: { runKind: "claims", runId: id(21), manifestArtifact: manifest, bundleArtifact: bundle, deterministicResultArtifact: deterministic, policyArtifact: policy, recordedPolicyInputsArtifact: inputs, policyDecisionArtifact: decision, originalPolicyOutcome: "review" }, auditProof: { payloadDigest: digest("payload"), manifestDigest: digest("manifest-payload"), deterministicResultDigest: deterministic.digest, policyDecisionDigest: decision.digest, signatureStatus: "verified", deterministicReplay: "exact", policyReplay: "exact" } });
const resultArtifact = { ...handle(30), digest: packetDigest, mediaType: "application/vnd.aiengineer.verification-adjudication-packet+json" };
const result = { schemaVersion: "verification-operation-result.v1", operationId, useCase: "requestAdjudication", requestDigest, output: { subjectId, status: "pending_human_adjudication", packetArtifact: { artifactId: resultArtifact.artifactId, digest: resultArtifact.digest }, originalPolicyOutcome: "review", humanDecisionRecorded: false, admissionChanged: false }, resultArtifact };

describe("verification adjudication read service", () => {
  it("returns only the compact pending-review resource", async () => {
    const service = new VerificationAdjudicationReadService({ loadVerifiedAdjudication: async () => ({ state: "succeeded", result, packet, terminalFencingToken: 9 }) });
    const value = await service.getPendingSubject({ tenantId, operationId });
    expect(value.output).toMatchObject({ subjectId, status: "pending_human_adjudication", originalPolicyOutcome: "review", humanDecisionRecorded: false, admissionChanged: false, proof: { signatureStatus: "verified", terminalFencingToken: 9 } });
    expect(value.output.source.manifestArtifact).toEqual({ artifactId: manifest.artifactId, digest: manifest.digest });
    expect(JSON.stringify(value)).not.toContain("private/");
    expect(JSON.stringify(value)).not.toContain("requesterActor");
  });

  it("maps nonterminal states and rejects invalid input before I/O", async () => {
    const loadVerifiedAdjudication = vi.fn<VerifiedVerificationAdjudicationReadPort["loadVerifiedAdjudication"]>();
    const service = new VerificationAdjudicationReadService({ loadVerifiedAdjudication });
    await expect(service.getPendingSubject({ tenantId: "bad", operationId })).rejects.toMatchObject({ code: "INVALID" });
    expect(loadVerifiedAdjudication).not.toHaveBeenCalled();
    for (const state of ["pending", "failed", "cancelled"] as const) {
      loadVerifiedAdjudication.mockResolvedValueOnce({ state });
      await expect(service.getPendingSubject({ tenantId, operationId })).rejects.toBeInstanceOf(VerificationAdjudicationReadError);
    }
  });

  it("rejects packet, result, and fence drift without projecting a body", async () => {
    const subject = (snapshot: Record<string, unknown>) => new VerificationAdjudicationReadService({ loadVerifiedAdjudication: async () => ({ state: "succeeded", result, packet, terminalFencingToken: 9, ...snapshot }) });
    await expect(subject({ packet: { ...packet, tenantId: id(99) } }).getPendingSubject({ tenantId, operationId })).rejects.toMatchObject({ code: "INTEGRITY" });
    await expect(subject({ result: { ...result, requestDigest: digest("drift") } }).getPendingSubject({ tenantId, operationId })).rejects.toMatchObject({ code: "INTEGRITY" });
    await expect(subject({ terminalFencingToken: "overflow" }).getPendingSubject({ tenantId, operationId })).rejects.toMatchObject({ code: "INTEGRITY" });
  });
});
