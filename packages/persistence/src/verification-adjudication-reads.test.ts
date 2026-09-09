import type { VerificationAdjudicationPacketReplayPort } from "@aiengineer/knowledge-application";
import { VerificationAdjudicationPacketSchema, type OperationContext, type VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, digestCanonicalJson, sha256Digest } from "@aiengineer/knowledge-verification";
import { describe, expect, it, vi } from "vitest";
import { AdjudicationReadPersistenceError, PostgresVerificationAdjudicationReadRepository } from "./verification-adjudication-reads.js";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const tenantId = id(1), operationId = id(2), subjectId = id(3), stepId = id(4), attemptId = id(5), missionId = id(6), createdAt = "2026-09-07T15:00:00.000Z";
const digest = (value: string) => sha256Digest(`synthetic:${value}`);
function handle(value: number, mediaType: string): VerificationArtifactHandle { const d = digest(String(value)); return { artifactId: id(value), tenantId, digest: d, mediaType, byteLength: 2, objectKey: `${tenantId}/${d.slice(7, 9)}/${d.slice(7)}`, createdAt, producerActivityId: "synthetic-source", producerVersion: "synthetic.v1", encryptionClass: "managed", retentionClass: "verification-audit", dataClassification: "restricted", parentArtifactIds: [] }; }
const manifest = handle(10, "application/vnd.aiengineer.verification-run-manifest+json"), bundle = handle(11, "application/vnd.aiengineer.verification-bundle+json"), deterministic = handle(12, "application/vnd.aiengineer.deterministic-verification-result+json"), policy = handle(13, "application/vnd.aiengineer.verification-policy+json"), inputs = handle(14, "application/vnd.aiengineer.verification-policy-inputs+json"), decision = handle(15, "application/vnd.aiengineer.verification-policy-decision+json");
const parents = [manifest, bundle, deterministic, policy, inputs, decision];
const request = { verificationContractVersion: "verification.v1" as const, target: { kind: "run" as const, runId: id(20) }, reason: "policy_review" as const, evidencePacket: { artifactId: manifest.artifactId, digest: manifest.digest } };
const context: OperationContext = { contractVersion: "v1", tenantId, operationId, attemptId, missionId, correlationId: id(21), actor: { kind: "service", id: id(22), serviceIdentity: "knowledge_worker" }, capabilityVersion: "verification-adjudication.v1", idempotencyKey: "synthetic-adjudication-read", reason: "synthetic unit test" };
const packet = VerificationAdjudicationPacketSchema.parse({ schemaVersion: "verification-adjudication-packet.v1", verificationContractVersion: "verification.v1", tenantId, requestBinding: { operationId, requestDigest: digestCanonicalJson(request), requesterActor: { kind: "service", id: context.actor.id }, target: request.target, targetObjectDigest: digest("target"), reason: request.reason }, reviewRequirements: { eligibleReviewerRoles: ["verification_expert"], quorumRequired: 2 }, sealedRun: { runKind: "claims", runId: request.target.runId, manifestArtifact: manifest, bundleArtifact: bundle, deterministicResultArtifact: deterministic, policyArtifact: policy, recordedPolicyInputsArtifact: inputs, policyDecisionArtifact: decision, originalPolicyOutcome: "review" }, auditProof: { payloadDigest: digest("payload"), manifestDigest: digest("manifest-payload"), deterministicResultDigest: deterministic.digest, policyDecisionDigest: decision.digest, signatureStatus: "verified", deterministicReplay: "exact", policyReplay: "exact" } });
const packetBytes = new TextEncoder().encode(canonicalizeJson(packet)), packetDigest = sha256Digest(packetBytes);
const parentIds = parents.map(item => item.artifactId), transformationSignature = digestCanonicalJson({ kind: "verification_adjudication_packet.v1", operationId, subjectId, requestDigest: packet.requestBinding.requestDigest, parentArtifactIds: parentIds });
const packetArtifact: VerificationArtifactHandle = { ...handle(30, "application/vnd.aiengineer.verification-adjudication-packet+json"), digest: packetDigest, byteLength: packetBytes.byteLength, objectKey: `${tenantId}/${packetDigest.slice(7, 9)}/${packetDigest.slice(7)}`, producerActivityId: "verification-service:requestAdjudication", producerVersion: "verification-service.v1", encryptionClass: "supabase-managed", parentArtifactIds: parentIds, transformationSignature };
const result = { schemaVersion: "verification-operation-result.v1" as const, operationId, useCase: "requestAdjudication" as const, requestDigest: packet.requestBinding.requestDigest, output: { subjectId, status: "pending_human_adjudication" as const, packetArtifact: { artifactId: packetArtifact.artifactId, digest: packetArtifact.digest }, originalPolicyOutcome: "review" as const, humanDecisionRecorded: false as const, admissionChanged: false as const }, resultArtifact: packetArtifact };
const durable = { schemaVersion: "knowledge-operation-request/v1", kind: "verification_adjudication", input: { schemaVersion: "verification-service-request.v1", useCase: "requestAdjudication", request }, expectedVersions: { verification: "verification.v1", service: "verification-service-request.v1" }, authenticatedContext: context };
const step = { schemaVersion: "knowledge-operation-request/v1", kind: "verification_adjudication", operationInput: durable.input, expectedVersions: durable.expectedVersions, context, step: { name: "request_adjudication_and_register", ordinal: 0 } };
const eventId = id(31), terminalFence = 8, operationSha = digestCanonicalJson(durable).slice(7), stepSha = digestCanonicalJson(step).slice(7), outputSha = digestCanonicalJson(result).slice(7);
const subject = { id: subjectId, tenant_id: tenantId, request_operation_id: operationId, request_step_id: stepId, request_lease_token: id(32), request_fencing_token: "4", request_operation_sha256: operationSha, request_step_input_sha256: stepSha, request_payload_sha256: packet.requestBinding.requestDigest.slice(7), target_kind: "run", target_id: request.target.runId, target_object_sha256: packet.requestBinding.targetObjectDigest.slice(7), reason: request.reason, requester_actor_id: context.actor.id, requester_actor_kind: context.actor.kind, requester_note: null, eligible_reviewer_roles: ["verification_expert"], quorum_required: 2, verification_run_id: request.target.runId, run_kind: "claims", run_manifest_artifact_id: manifest.artifactId, run_manifest_sha256: manifest.digest.slice(7), run_manifest_payload_sha256: packet.auditProof.manifestDigest.slice(7), bundle_artifact_id: bundle.artifactId, bundle_sha256: bundle.digest.slice(7), deterministic_result_artifact_id: deterministic.artifactId, deterministic_result_sha256: deterministic.digest.slice(7), policy_artifact_id: policy.artifactId, policy_artifact_sha256: policy.digest.slice(7), recorded_policy_inputs_artifact_id: inputs.artifactId, recorded_policy_inputs_sha256: inputs.digest.slice(7), policy_decision_artifact_id: decision.artifactId, policy_decision_sha256: decision.digest.slice(7), original_policy_outcome: "review", audit_payload_sha256: packet.auditProof.payloadDigest.slice(7), report_gate_artifact_id: null, report_gate_sha256: null, packet_artifact_id: packetArtifact.artifactId, packet_sha256: packetArtifact.digest.slice(7), expires_at: null };
const run = { id: request.target.runId, tenant_id: tenantId, contract_version: "verification.v1", status: "review", ended_at: createdAt, run_manifest_artifact_id: manifest.artifactId, manifest_sha256: manifest.digest.slice(7), bundle_artifact_id: bundle.artifactId, deterministic_result_artifact_id: deterministic.artifactId, policy_artifact_id: policy.artifactId, policy_artifact_sha256: policy.digest.slice(7) };
const packetArtifactRow = { id: packetArtifact.artifactId, tenant_id: tenantId, artifact_type: "verification_adjudication_packet", sha256: packetArtifact.digest.slice(7), bucket_class: "ledger", storage_bucket: "verification-ledger", object_path: packetArtifact.objectKey, media_type: packetArtifact.mediaType, size_bytes: packetArtifact.byteLength, storage_state: "available", verification_contract_version: "verification.v1", producer_attempt_id: attemptId, mission_id: missionId, created_at: createdAt };
const packetMetadataRow = { producer_activity_id: packetArtifact.producerActivityId, producer_version: packetArtifact.producerVersion, content_encoding: null, encryption_class: packetArtifact.encryptionClass, retention_class: packetArtifact.retentionClass, data_classification: packetArtifact.dataClassification, parent_artifact_ids: packetArtifact.parentArtifactIds, transformation_signature: packetArtifact.transformationSignature!.slice(7), attestation_artifact_id: null };
function row(overrides: Record<string, unknown> = {}) { return { status: "succeeded", request: durable, request_sha256: operationSha, idempotency_key: context.idempotencyKey, actor_identity: `service:${context.actor.id}`, attempt_id: attemptId, mission_id: missionId, work_item_id: null, correlation_id: context.correlationId, causation_id: null, ownership_mode: "standalone", external_run_id: null, ownership_chain_valid: false, step_id: stepId, step_status: "succeeded", step_key: "request_adjudication_and_register", step_kind: "request_adjudication_and_register", input: step, input_sha256: stepSha, receipt_id: id(33), receipt_kind: "request_adjudication_and_register.succeeded", outcome: "succeeded", receipt_input_sha256: stepSha, output_sha256: outputSha, body: { ...result, eventId, fencingToken: terminalFence }, event_id: eventId, event_operation_id: operationId, event_step_id: stepId, event_kind: "step.succeeded", event_from_state: "running", event_to_state: "succeeded", event_guarded_sha256: outputSha, event_payload: { outputSha256: outputSha, fencingToken: String(terminalFence) }, subject_row: subject, packet_artifact_row: packetArtifactRow, packet_metadata_row: packetMetadataRow, source_run_row: run, source_operation_kind: "verification_claims", source_operation_status: "succeeded", ...overrides }; }
function fixture(overrides: Record<string, unknown> = {}) {
  const current = row(overrides), query = vi.fn(async () => ({ rows: [current], rowCount: 1 })), transaction = vi.fn(async (_tenant: string, work: (client: { query: typeof query }) => Promise<unknown>) => work({ query }));
  const authorizeArtifact = vi.fn(async () => undefined), hydrateRegisteredArtifact = vi.fn(async () => ({ registration: packetArtifact, bytes: Uint8Array.from(packetBytes) }));
  const replayPacket = vi.fn<VerificationAdjudicationPacketReplayPort["replayPacket"]>(async () => ({ subjectId, request, requestDigest: packet.requestBinding.requestDigest as `sha256:${string}`, packet, packetDigest, packetBytes: Uint8Array.from(packetBytes), parentArtifacts: parents }));
  return { repository: new PostgresVerificationAdjudicationReadRepository({ transaction } as never, () => ({ authorizeArtifact, hydrateRegisteredArtifact }), { replayPacket }), transaction, query, authorizeArtifact, hydrateRegisteredArtifact, replayPacket };
}

describe("Postgres verification adjudication terminal reader", () => {
  it("authenticates the terminal fence, packet bytes, subject, source run, and canonical replay", async () => {
    const value = fixture(), snapshot = await value.repository.loadVerifiedAdjudication(tenantId, operationId);
    expect(snapshot).toMatchObject({ state: "succeeded", result: { output: { subjectId, humanDecisionRecorded: false, admissionChanged: false } }, packet, terminalFencingToken: terminalFence });
    expect(value.authorizeArtifact).toHaveBeenCalledWith({ tenantId, artifactId: packetArtifact.artifactId, purpose: "verification_replay" });
    expect(value.replayPacket).toHaveBeenCalledWith(expect.objectContaining({ request, context, reviewRequirements: packet.reviewRequirements, signal: expect.any(AbortSignal) }));
    expect(value.query).toHaveBeenCalledTimes(2);
  });

  it("fails closed on receipt fence, subject, source, or canonical replay drift", async () => {
    for (const changed of [
      { event_payload: { outputSha256: outputSha, fencingToken: "7" } },
      { subject_row: { ...subject, bundle_sha256: digest("drift").slice(7) } },
      { subject_row: { ...subject, request_fencing_token: String(terminalFence + 1) } },
      { source_operation_kind: "verification_report" },
      { ownership_chain_valid: true },
    ]) await expect(fixture(changed).repository.loadVerifiedAdjudication(tenantId, operationId)).rejects.toBeInstanceOf(AdjudicationReadPersistenceError);
    const replay = fixture(); replay.replayPacket.mockResolvedValueOnce({ subjectId, request, requestDigest: packet.requestBinding.requestDigest as `sha256:${string}`, packet: { ...packet, tenantId: id(99) } as never, packetDigest, packetBytes, parentArtifacts: parents });
    await expect(replay.repository.loadVerifiedAdjudication(tenantId, operationId)).rejects.toMatchObject({ code: "INTEGRITY" });
  });

  it("bounds a canonical replay port that ignores cancellation", async () => {
    const value = fixture();
    value.replayPacket.mockImplementationOnce(() => new Promise<never>(() => undefined));
    const repository = new PostgresVerificationAdjudicationReadRepository(
      { transaction: value.transaction } as never,
      () => ({ authorizeArtifact: value.authorizeArtifact, hydrateRegisteredArtifact: value.hydrateRegisteredArtifact }),
      { replayPacket: value.replayPacket },
      { maximumReplayMs: 100 },
    );
    await expect(repository.loadVerifiedAdjudication(tenantId, operationId)).rejects.toMatchObject({ code: "INTEGRITY" });
  });

  it("returns nonterminal state without hydrating or replaying private artifacts", async () => {
    const value = fixture({ status: "cancelled" });
    await expect(value.repository.loadVerifiedAdjudication(tenantId, operationId)).resolves.toEqual({ state: "cancelled" });
    expect(value.authorizeArtifact).not.toHaveBeenCalled();
    expect(value.replayPacket).not.toHaveBeenCalled();
  });
});
