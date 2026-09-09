import type {
  PreparedVerificationAdjudicationRequest,
  VerificationAdjudicationPendingSubjectCommitPort,
} from "@aiengineer/knowledge-application";
import {
  VerificationAdjudicationPacketSchema,
  type OperationContext,
  type VerificationArtifactHandle,
} from "@aiengineer/knowledge-contracts";
import type { CanonicalOperationRecord, LeasedStep } from "@aiengineer/knowledge-persistence";
import { canonicalizeJson, digestCanonicalJson, sha256Digest } from "@aiengineer/knowledge-verification";
import { describe, expect, it, vi } from "vitest";
import { verificationAdjudicationRequestActivityHandler } from "./verification-adjudication-activity.js";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const tenantId = id(1), operationId = id(2), attemptId = id(3), subjectId = id(4);
const createdAt = "2026-09-07T15:00:00.000Z";
const digest = (value: string) => sha256Digest(`synthetic:${value}`);

function artifact(value: number, mediaType: string): VerificationArtifactHandle {
  const artifactDigest = digest(String(value));
  return {
    artifactId: id(value), tenantId, digest: artifactDigest, mediaType, byteLength: 2,
    objectKey: `${tenantId}/${artifactDigest.slice(7, 9)}/${artifactDigest.slice(7)}`, createdAt,
    producerActivityId: "synthetic-fixture", producerVersion: "synthetic.v1", encryptionClass: "supabase-managed",
    retentionClass: "verification-audit", dataClassification: "restricted", parentArtifactIds: [],
  };
}

const manifestArtifact = artifact(10, "application/vnd.aiengineer.verification-run-manifest+json");
const bundleArtifact = artifact(11, "application/vnd.aiengineer.verification-bundle+json");
const deterministicResultArtifact = artifact(12, "application/vnd.aiengineer.deterministic-verification-result+json");
const policyArtifact = artifact(13, "application/vnd.aiengineer.verification-policy+json");
const recordedPolicyInputsArtifact = artifact(14, "application/vnd.aiengineer.verification-policy-inputs+json");
const policyDecisionArtifact = artifact(15, "application/vnd.aiengineer.verification-policy-decision+json");
const parentArtifacts = [manifestArtifact, bundleArtifact, deterministicResultArtifact, policyArtifact, recordedPolicyInputsArtifact, policyDecisionArtifact];
const request = {
  verificationContractVersion: "verification.v1" as const,
  target: { kind: "run" as const, runId: id(20) }, reason: "policy_review" as const,
  evidencePacket: { artifactId: manifestArtifact.artifactId, digest: manifestArtifact.digest },
};
const context: OperationContext = {
  contractVersion: "v1", tenantId, operationId, attemptId, missionId: id(21), correlationId: "synthetic-adjudication",
  actor: { kind: "service", id: id(22), serviceIdentity: "knowledge_worker" }, capabilityVersion: "verification-adjudication.v1",
  idempotencyKey: "synthetic-adjudication", reason: "synthetic unit test",
};
const packet = VerificationAdjudicationPacketSchema.parse({
  schemaVersion: "verification-adjudication-packet.v1", verificationContractVersion: "verification.v1", tenantId,
  requestBinding: { operationId, requestDigest: digestCanonicalJson(request), requesterActor: { kind: "service", id: context.actor.id }, target: request.target, targetObjectDigest: digest("target"), reason: request.reason },
  reviewRequirements: { eligibleReviewerRoles: ["verification_expert"], quorumRequired: 2 },
  sealedRun: { runKind: "claims", runId: request.target.runId, manifestArtifact, bundleArtifact, deterministicResultArtifact, policyArtifact, recordedPolicyInputsArtifact, policyDecisionArtifact, originalPolicyOutcome: "review" },
  auditProof: { payloadDigest: digest("payload"), manifestDigest: digest("manifest-payload"), deterministicResultDigest: deterministicResultArtifact.digest, policyDecisionDigest: policyDecisionArtifact.digest, signatureStatus: "verified", deterministicReplay: "exact", policyReplay: "exact" },
});
const packetBytes = new TextEncoder().encode(canonicalizeJson(packet));
const prepared: PreparedVerificationAdjudicationRequest = {
  subjectId, request, requestDigest: digestCanonicalJson(request), packet, packetDigest: sha256Digest(packetBytes),
  packetBytes, parentArtifacts,
};
const transformationSignature = digestCanonicalJson({
  kind: "verification_adjudication_packet.v1", operationId, subjectId, requestDigest: prepared.requestDigest,
  parentArtifactIds: parentArtifacts.map((item) => item.artifactId),
});
const packetArtifact: VerificationArtifactHandle = {
  ...artifact(30, "application/vnd.aiengineer.verification-adjudication-packet+json"),
  digest: prepared.packetDigest, byteLength: packetBytes.byteLength,
  objectKey: `${tenantId}/${prepared.packetDigest.slice(7, 9)}/${prepared.packetDigest.slice(7)}`,
  createdAt, producerActivityId: "verification-service:requestAdjudication", producerVersion: "verification-service.v1",
  parentArtifactIds: parentArtifacts.map((item) => item.artifactId), transformationSignature,
};
const operation: CanonicalOperationRecord = {
  id: operationId, tenantId, operationKind: "verification_adjudication", idempotencyKey: context.idempotencyKey,
  requestSha256: digest("operation").slice(7), status: "running", rowVersion: 1, createdAt, updatedAt: createdAt,
  ownershipMode: "mission_control", correlationId: context.correlationId, actorIdentity: `service:${context.actor.id}`, request: {},
};
const claim: LeasedStep = {
  id: id(31), tenantId, operationId, stepKey: "request_adjudication_and_register", stepKind: "request_adjudication_and_register",
  inputSha256: digest("step").slice(7), status: "running", attemptCount: 1, maxAttempts: 3, rowVersion: 1,
  holderIdentity: "synthetic-worker", leaseToken: id(32), fencingToken: 7, expiresAt: "2026-09-07T16:00:00.000Z",
};
const activity = {
  schemaVersion: "knowledge-operation-request/v1" as const, kind: "verification_adjudication" as const,
  operationInput: { schemaVersion: "verification-service-request.v1" as const, useCase: "requestAdjudication" as const, request },
  expectedVersions: { verification: "verification.v1" }, context, step: { name: "request_adjudication_and_register", ordinal: 0 },
};

function dependencies(overrides: Record<string, unknown> = {}) {
  const commitPendingSubject = vi.fn(async (_input: Parameters<VerificationAdjudicationPendingSubjectCommitPort["commitPendingSubject"]>[0]) => ({ subjectId, packetArtifact }));
  return {
    service: { prepare: vi.fn(async () => prepared) }, subjects: { commitPendingSubject },
    operations: { getOperationRecord: vi.fn(async () => operation) }, storageBucket: "verification-ledger", now: () => createdAt,
    ...overrides,
  };
}

describe("verification adjudication request activity", () => {
  it("commits an exact packet under the leased step and returns pending-only state", async () => {
    const deps = dependencies();
    const result = await verificationAdjudicationRequestActivityHandler(deps).execute({ activity, claim, operation });
    expect(result).toMatchObject({
      operationId, useCase: "requestAdjudication",
      output: { subjectId, status: "pending_human_adjudication", humanDecisionRecorded: false, admissionChanged: false },
      resultArtifact: packetArtifact,
    });
    expect(deps.subjects.commitPendingSubject).toHaveBeenCalledWith(expect.objectContaining({
      lease: { operationId, stepId: claim.id, inputSha256: claim.inputSha256, leaseToken: claim.leaseToken, fencingToken: 7, holderIdentity: claim.holderIdentity },
      prepared: expect.objectContaining({ packetDigest: prepared.packetDigest, packetBytes: expect.any(Uint8Array) }),
    }));
    const committed = deps.subjects.commitPendingSubject.mock.calls[0]![0]!;
    expect(committed.prepared.packetBytes).not.toBe(prepared.packetBytes);
    expect(sha256Digest(committed.prepared.packetBytes)).toBe(prepared.packetDigest);
  });

  it("rejects mutable packet-byte drift before the native commit", async () => {
    const mutated = Uint8Array.from(packetBytes); mutated[0] = 0;
    const deps = dependencies({ service: { prepare: vi.fn(async () => ({ ...prepared, packetBytes: mutated })) } });
    await expect(verificationAdjudicationRequestActivityHandler(deps).execute({ activity, claim, operation })).rejects.toMatchObject({ code: "VERIFICATION_ADJUDICATION_PACKET_BINDING_MISMATCH", retryable: false });
    expect(deps.subjects.commitPendingSubject).not.toHaveBeenCalled();
  });

  it("rejects cancellation and malformed commit results without claiming a human decision", async () => {
    const cancelled = dependencies({ operations: { getOperationRecord: vi.fn(async () => ({ ...operation, status: "cancelled" })) } });
    await expect(verificationAdjudicationRequestActivityHandler(cancelled).execute({ activity, claim, operation })).rejects.toMatchObject({ code: "VERIFICATION_ADJUDICATION_CANCELLED", retryable: false });
    expect(cancelled.subjects.commitPendingSubject).not.toHaveBeenCalled();

    const malformed = dependencies();
    malformed.subjects.commitPendingSubject.mockResolvedValueOnce({ subjectId: id(99), packetArtifact });
    await expect(verificationAdjudicationRequestActivityHandler(malformed).execute({ activity, claim, operation })).rejects.toMatchObject({ code: "VERIFICATION_ADJUDICATION_COMMIT_BINDING_MISMATCH", retryable: false });
  });

  it("fails a stale native lease without retrying an unowned append", async () => {
    const deps = dependencies();
    deps.subjects.commitPendingSubject.mockRejectedValueOnce(new Error("VERIFICATION_ADJUDICATION_STALE_LEASE"));
    await expect(verificationAdjudicationRequestActivityHandler(deps).execute({ activity, claim, operation })).rejects.toMatchObject({ code: "VERIFICATION_ADJUDICATION_STALE_LEASE", retryable: false });
  });
});
