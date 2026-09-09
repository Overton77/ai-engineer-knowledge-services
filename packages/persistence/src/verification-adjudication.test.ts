import type { PreparedVerificationAdjudicationRequest } from "@aiengineer/knowledge-application";
import {
  VerificationAdjudicationPacketSchema,
  type OperationContext,
  type VerificationArtifactHandle,
} from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, digestCanonicalJson, sha256Digest } from "@aiengineer/knowledge-verification";
import { describe, expect, it, vi } from "vitest";
import { createVerificationArtifactHandle } from "./verification.js";
import { PostgresVerificationAdjudicationRepository } from "./verification-adjudication.js";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const tenantId = id(1), operationId = id(2), attemptId = id(3), stepId = id(4), subjectId = id(5), createdAt = "2026-09-07T15:00:00.000Z";
const digest = (value: string) => sha256Digest(`synthetic:${value}`);
function artifact(value: number, mediaType: string): VerificationArtifactHandle {
  const artifactDigest = digest(String(value));
  return { artifactId: id(value), tenantId, digest: artifactDigest, mediaType, byteLength: 2, objectKey: `${tenantId}/${artifactDigest.slice(7, 9)}/${artifactDigest.slice(7)}`, createdAt, producerActivityId: "synthetic-fixture", producerVersion: "synthetic.v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", dataClassification: "restricted", parentArtifactIds: [] };
}
const manifestArtifact = artifact(10, "application/vnd.aiengineer.verification-run-manifest+json");
const bundleArtifact = artifact(11, "application/vnd.aiengineer.verification-bundle+json");
const deterministicResultArtifact = artifact(12, "application/vnd.aiengineer.deterministic-verification-result+json");
const policyArtifact = artifact(13, "application/vnd.aiengineer.verification-policy+json");
const recordedPolicyInputsArtifact = artifact(14, "application/vnd.aiengineer.verification-policy-inputs+json");
const policyDecisionArtifact = artifact(15, "application/vnd.aiengineer.verification-policy-decision+json");
const parentArtifacts = [manifestArtifact, bundleArtifact, deterministicResultArtifact, policyArtifact, recordedPolicyInputsArtifact, policyDecisionArtifact];
const request = { verificationContractVersion: "verification.v1" as const, target: { kind: "run" as const, runId: id(20) }, reason: "policy_review" as const, evidencePacket: { artifactId: manifestArtifact.artifactId, digest: manifestArtifact.digest } };
const context: OperationContext = { contractVersion: "v1", tenantId, operationId, attemptId, missionId: id(21), correlationId: "synthetic-adjudication", actor: { kind: "service", id: id(22), serviceIdentity: "knowledge_worker" }, capabilityVersion: "verification-adjudication.v1", idempotencyKey: "synthetic-adjudication", reason: "synthetic unit test" };
const packet = VerificationAdjudicationPacketSchema.parse({ schemaVersion: "verification-adjudication-packet.v1", verificationContractVersion: "verification.v1", tenantId, requestBinding: { operationId, requestDigest: digestCanonicalJson(request), requesterActor: { kind: "service", id: context.actor.id }, target: request.target, targetObjectDigest: digest("target"), reason: request.reason }, reviewRequirements: { eligibleReviewerRoles: ["verification_expert"], quorumRequired: 2 }, sealedRun: { runKind: "claims", runId: request.target.runId, manifestArtifact, bundleArtifact, deterministicResultArtifact, policyArtifact, recordedPolicyInputsArtifact, policyDecisionArtifact, originalPolicyOutcome: "review" }, auditProof: { payloadDigest: digest("payload"), manifestDigest: digest("manifest-payload"), deterministicResultDigest: deterministicResultArtifact.digest, policyDecisionDigest: policyDecisionArtifact.digest, signatureStatus: "verified", deterministicReplay: "exact", policyReplay: "exact" } });
const packetBytes = new TextEncoder().encode(canonicalizeJson(packet));
const prepared: PreparedVerificationAdjudicationRequest = { subjectId, request, requestDigest: digestCanonicalJson(request), packet, packetDigest: sha256Digest(packetBytes), packetBytes, parentArtifacts };
const registration = { createdAt, producerAttemptId: attemptId, missionId: context.missionId!, producerActivityId: "verification-service:requestAdjudication", producerVersion: "verification-service.v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", storageBucket: "verification-ledger" };
const durable = { schemaVersion: "knowledge-operation-request/v1", kind: "verification_adjudication", input: { schemaVersion: "verification-service-request.v1", useCase: "requestAdjudication", request }, expectedVersions: { verification: "verification.v1", service: "verification-service-request.v1" }, authenticatedContext: context };
const step = { schemaVersion: "knowledge-operation-request/v1", kind: "verification_adjudication", operationInput: durable.input, expectedVersions: durable.expectedVersions, context, step: { name: "request_adjudication_and_register", ordinal: 0 } };
const lease = { operationId, stepId, inputSha256: digestCanonicalJson(step).slice(7), leaseToken: id(23), fencingToken: 4, holderIdentity: "synthetic-worker" };
const transformationSignature = digestCanonicalJson({ kind: "verification_adjudication_packet.v1", operationId, subjectId, requestDigest: prepared.requestDigest, parentArtifactIds: parentArtifacts.map((item) => item.artifactId) });
const proposedPacketArtifact = createVerificationArtifactHandle({ tenantId, bytes: packetBytes, mediaType: "application/vnd.aiengineer.verification-adjudication-packet+json", createdAt, producerActivityId: registration.producerActivityId, producerVersion: registration.producerVersion, encryptionClass: registration.encryptionClass, retentionClass: registration.retentionClass, dataClassification: "restricted", parentArtifactIds: parentArtifacts.map((item) => item.artifactId), transformationSignature });

function artifactRow(handle: VerificationArtifactHandle, extra: Record<string, unknown> = {}) {
  return { id: handle.artifactId, tenant_id: handle.tenantId, artifact_type: "verification_fixture", schema_version: 1, sha256: handle.digest.slice(7), verification_contract_version: "verification.v1", bucket_class: "ledger", storage_bucket: registration.storageBucket, object_path: handle.objectKey, media_type: handle.mediaType, size_bytes: handle.byteLength, storage_state: "available", created_at: handle.createdAt, producer_attempt_id: attemptId, mission_id: context.missionId, producer_activity_id: handle.producerActivityId, producer_version: handle.producerVersion, content_encoding: handle.contentEncoding ?? null, encryption_class: handle.encryptionClass, retention_class: handle.retentionClass, data_classification: handle.dataClassification, parent_artifact_ids: handle.parentArtifactIds, transformation_signature: handle.transformationSignature?.slice(7) ?? null, attestation_artifact_id: handle.attestationArtifactId ?? null, ...extra };
}
function subjectRow(originalLease = lease) {
  return { id: subjectId, tenant_id: tenantId, request_operation_id: operationId, request_step_id: stepId, request_lease_token: originalLease.leaseToken, request_fencing_token: originalLease.fencingToken, request_operation_sha256: digestCanonicalJson(durable).slice(7), request_step_input_sha256: lease.inputSha256, request_payload_sha256: prepared.requestDigest.slice(7), target_kind: "run", target_id: request.target.runId, target_object_sha256: packet.requestBinding.targetObjectDigest.slice(7), reason: request.reason, requester_actor_id: context.actor.id, requester_actor_kind: context.actor.kind, requester_note: null, eligible_reviewer_roles: ["verification_expert"], quorum_required: 2, verification_run_id: request.target.runId, run_kind: "claims", run_manifest_artifact_id: manifestArtifact.artifactId, run_manifest_sha256: manifestArtifact.digest.slice(7), run_manifest_payload_sha256: packet.auditProof.manifestDigest.slice(7), bundle_artifact_id: bundleArtifact.artifactId, bundle_sha256: bundleArtifact.digest.slice(7), deterministic_result_artifact_id: deterministicResultArtifact.artifactId, deterministic_result_sha256: deterministicResultArtifact.digest.slice(7), policy_artifact_id: policyArtifact.artifactId, policy_artifact_sha256: policyArtifact.digest.slice(7), recorded_policy_inputs_artifact_id: recordedPolicyInputsArtifact.artifactId, recorded_policy_inputs_sha256: recordedPolicyInputsArtifact.digest.slice(7), policy_decision_artifact_id: policyDecisionArtifact.artifactId, policy_decision_sha256: policyDecisionArtifact.digest.slice(7), original_policy_outcome: "review", audit_payload_sha256: packet.auditProof.payloadDigest.slice(7), report_gate_artifact_id: null, report_gate_sha256: null, packet_artifact_id: proposedPacketArtifact.artifactId, packet_sha256: proposedPacketArtifact.digest.slice(7), expires_at: null };
}

function fixture(options: { existing?: boolean; live?: boolean; packetProducerAttemptId?: string; register?: (input: { handle: VerificationArtifactHandle }) => Promise<VerificationArtifactHandle> } = {}) {
  let subject = options.existing ? subjectRow({ ...lease, leaseToken: id(90), fencingToken: 2 }) : undefined;
  let packetRow = options.existing ? artifactRow({ ...proposedPacketArtifact, createdAt: "2026-09-07T14:00:00.000Z" }, { artifact_type: "verification_adjudication_packet", producer_attempt_id: options.packetProducerAttemptId ?? attemptId }) : undefined;
  const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
    if (sql.includes("from knowledge_service.operation o") && sql.includes("for update of o,s,l")) return { rows: options.live === false ? [] : [{ request: durable, request_sha256: digestCanonicalJson(durable).slice(7), actor_identity: `service:${context.actor.id}`, attempt_id: attemptId, mission_id: context.missionId, input: step, input_sha256: lease.inputSha256 }], rowCount: 1 };
    if (sql.includes("from evidence.verification_adjudication_subject") && sql.includes("for update")) return { rows: subject ? [subject] : [], rowCount: subject ? 1 : 0 };
    if (sql.startsWith("select * from evidence.verification_adjudication_subject")) return { rows: subject ? [subject] : [], rowCount: subject ? 1 : 0 };
    if (sql.includes("from orchestration.artifact a join orchestration.verification_artifact_metadata")) {
      const artifactId = String(values?.[1]);
      if (artifactId === proposedPacketArtifact.artifactId) return { rows: packetRow ? [packetRow] : [], rowCount: packetRow ? 1 : 0 };
      const parent = parentArtifacts.find((item) => item.artifactId === artifactId);
      return { rows: parent ? [artifactRow(parent)] : [], rowCount: parent ? 1 : 0 };
    }
    if (sql.includes("insert into orchestration.artifact\n")) { packetRow = artifactRow(proposedPacketArtifact, { artifact_type: "verification_adjudication_packet" }); return { rows: [], rowCount: 1 }; }
    if (sql.includes("insert into evidence.verification_adjudication_subject")) { subject = subjectRow(); return { rows: [], rowCount: 1 }; }
    return { rows: [], rowCount: 1 };
  });
  const transaction = vi.fn(async (_tenant: string, work: (client: { query: typeof query }) => Promise<unknown>) => work({ query }));
  const registerFencedContentAddressedArtifact = vi.fn(async (input: { artifact: { readonly createdAt: string } }) => {
    const handle = packetRow
      ? { ...proposedPacketArtifact, createdAt: String(packetRow.created_at) }
      : { ...proposedPacketArtifact, createdAt: input.artifact.createdAt };
    if (!packetRow) packetRow = artifactRow(handle, { artifact_type: "verification_adjudication_packet" });
    return options.register ? options.register({ handle }) : handle;
  });
  return { repository: new PostgresVerificationAdjudicationRepository({ transaction } as never, { registerFencedContentAddressedArtifact } as never), query, transaction, registerFencedContentAddressedArtifact };
}

describe("Postgres verification adjudication repository", () => {
  it("routes the packet through the canonical registrar before the live-lease subject transaction", async () => {
    const value = fixture();
    const result = await value.repository.commitPendingSubject({ prepared, lease, registration });
    expect(result).toEqual({ subjectId, packetArtifact: proposedPacketArtifact });
    expect(value.registerFencedContentAddressedArtifact).toHaveBeenCalledOnce();
    expect(value.transaction).toHaveBeenCalledTimes(1);
    const writes = value.query.mock.calls.map(([sql]) => String(sql)).filter((sql) => sql.startsWith("insert into"));
    expect(writes.some((sql) => sql.includes("orchestration.artifact\n"))).toBe(false);
    expect(writes.some((sql) => sql.includes("evidence.verification_adjudication_subject"))).toBe(true);
  });

  it("does not create an adjudication subject when canonical artifact registration fails", async () => {
    const value = fixture({ register: async () => { throw new Error("OBJECT_STORE_WRITE_NOT_VERIFIED"); } });
    await expect(value.repository.commitPendingSubject({ prepared, lease, registration })).rejects.toThrow("OBJECT_STORE_WRITE_NOT_VERIFIED");
    expect(value.transaction).not.toHaveBeenCalled();
  });

  it("recovers the original immutable subject and packet under a higher active fence", async () => {
    const value = fixture({ existing: true });
    const recovered = await value.repository.commitPendingSubject({ prepared, lease: { ...lease, leaseToken: id(91), fencingToken: 8 }, registration: { ...registration, createdAt: "2026-09-07T16:00:00.000Z" } });
    expect(recovered.subjectId).toBe(subjectId);
    expect(recovered.packetArtifact.createdAt).toBe("2026-09-07T14:00:00.000Z");
    expect(value.query.mock.calls.map(([sql]) => String(sql)).some((sql) => sql.startsWith("insert into"))).toBe(false);
  });

  it("rejects a recovered packet registered by a different producer attempt", async () => {
    const value = fixture({ existing: true, packetProducerAttemptId: id(99) });
    await expect(value.repository.commitPendingSubject({ prepared, lease, registration })).rejects.toThrow("VERIFICATION_ADJUDICATION_PACKET_ARTIFACT_COLLISION");
  });

  it("uses a complete pre-await snapshot when caller-owned objects mutate during registration", async () => {
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const value = fixture({ register: async ({ handle }) => { entered.resolve(); await release.promise; return handle; } });
    const mutablePrepared = structuredClone(prepared) as PreparedVerificationAdjudicationRequest;
    const mutableLease = { ...lease }, mutableRegistration = { ...registration };
    const pending = value.repository.commitPendingSubject({ prepared: mutablePrepared, lease: mutableLease, registration: mutableRegistration });
    await entered.promise;
    (mutablePrepared.parentArtifacts as VerificationArtifactHandle[])[0] = artifact(98, "application/json");
    mutablePrepared.packetBytes[0] = 0;
    mutableLease.fencingToken = 99;
    mutableRegistration.producerAttemptId = id(99);
    release.resolve();
    await expect(pending).resolves.toEqual({ subjectId, packetArtifact: proposedPacketArtifact });
  });

  it("rejects stale leases and packet byte drift without a database write", async () => {
    const stale = fixture({ live: false });
    await expect(stale.repository.commitPendingSubject({ prepared, lease, registration })).rejects.toThrow("VERIFICATION_ADJUDICATION_STALE_LEASE");
    expect(stale.query.mock.calls.map(([sql]) => String(sql)).some((sql) => sql.startsWith("insert into"))).toBe(false);

    const changed = Uint8Array.from(packetBytes); changed[0] = 0;
    const drift = fixture();
    await expect(drift.repository.commitPendingSubject({ prepared: { ...prepared, packetBytes: changed }, lease, registration })).rejects.toThrow("VERIFICATION_ADJUDICATION_PACKET_BINDING_MISMATCH");
    expect(drift.transaction).not.toHaveBeenCalled();
  });

  it("rejects a packet handle whose metadata diverges from the separately hydrated parent vector", async () => {
    const changedPacket = VerificationAdjudicationPacketSchema.parse({
      ...packet,
      sealedRun: { ...packet.sealedRun, manifestArtifact: { ...packet.sealedRun.manifestArtifact, objectKey: "divergent/object/key" } },
    });
    const changedBytes = new TextEncoder().encode(canonicalizeJson(changedPacket));
    const value = fixture();
    await expect(value.repository.commitPendingSubject({
      prepared: { ...prepared, packet: changedPacket, packetBytes: changedBytes, packetDigest: sha256Digest(changedBytes) },
      lease,
      registration,
    })).rejects.toThrow("VERIFICATION_ADJUDICATION_PACKET_BINDING_MISMATCH");
    expect(value.transaction).not.toHaveBeenCalled();
  });
});
