import type { Database } from "@aiengineer/database-contract";
import {
  OperationContextSchema,
  RequestAdjudicationRequestSchema,
  UuidSchema,
  VerificationAdjudicationPacketSchema,
  VerificationArtifactHandleSchema,
  type VerificationArtifactHandle,
} from "@aiengineer/knowledge-contracts";
import {
  KNOWLEDGE_OPERATION_REQUEST_SCHEMA_VERSION,
  type VerificationAdjudicationPendingSubjectCommitPort,
} from "@aiengineer/knowledge-application";
import { deepFreeze } from "@aiengineer/knowledge-domain";
import { createVerificationArtifactHandle, type PostgresVerificationRepository } from "./verification.js";
import type { PostgresCanonicalRepository, TenantSqlClient } from "./postgres.js";
import { canonicalizeJson, digestCanonicalJson, sha256Digest } from "@aiengineer/knowledge-verification";
import { z } from "zod";

type SubjectInsert = Database["evidence"]["Tables"]["verification_adjudication_subject"]["Insert"];
type Row = Record<string, unknown>;
type CommitInput = Parameters<VerificationAdjudicationPendingSubjectCommitPort["commitPendingSubject"]>[0];

const serviceInputSchema = z.strictObject({
  schemaVersion: z.literal("verification-service-request.v1"),
  useCase: z.literal("requestAdjudication"),
  request: RequestAdjudicationRequestSchema,
});
const durableRequestSchema = z.strictObject({
  schemaVersion: z.literal(KNOWLEDGE_OPERATION_REQUEST_SCHEMA_VERSION),
  kind: z.literal("verification_adjudication"),
  input: serviceInputSchema,
  expectedVersions: z.record(z.string(), z.string().min(1)),
  authenticatedContext: OperationContextSchema,
});
const durableStepInputSchema = z.strictObject({
  schemaVersion: z.literal(KNOWLEDGE_OPERATION_REQUEST_SCHEMA_VERSION),
  kind: z.literal("verification_adjudication"),
  operationInput: serviceInputSchema,
  expectedVersions: z.record(z.string(), z.string().min(1)),
  context: OperationContextSchema,
  step: z.strictObject({ name: z.literal("request_adjudication_and_register"), ordinal: z.literal(0) }),
});

/**
 * Registers immutable packet bytes through the canonical verification registrar,
 * then commits the pending subject in a lease-locked database transaction. It never records a
 * reviewer, decision, authority grant, override, or changed admission state.
 */
export class PostgresVerificationAdjudicationRepository implements VerificationAdjudicationPendingSubjectCommitPort {
  constructor(
    private readonly database: Pick<PostgresCanonicalRepository, "transaction">,
    private readonly registrations: Pick<PostgresVerificationRepository, "registerFencedContentAddressedArtifact">,
  ) {}

  async commitPendingSubject(input: CommitInput): Promise<{ subjectId: string; packetArtifact: VerificationArtifactHandle }> {
    const validated = validateCommitInput(input);
    const packetArtifact = await this.registrations.registerFencedContentAddressedArtifact({
      artifact: {
        tenantId: validated.packet.tenantId,
        bytes: validated.bytes,
        mediaType: validated.handle.mediaType,
        createdAt: validated.handle.createdAt,
        producerActivityId: validated.handle.producerActivityId,
        producerVersion: validated.handle.producerVersion,
        encryptionClass: validated.handle.encryptionClass,
        retentionClass: validated.handle.retentionClass,
        dataClassification: validated.handle.dataClassification,
        parentArtifactIds: validated.handle.parentArtifactIds,
        ...(validated.handle.transformationSignature ? { transformationSignature: validated.handle.transformationSignature as `sha256:${string}` } : {}),
        artifactType: "verification_adjudication_packet",
        bucketClass: "ledger",
        storageBucket: validated.registration.storageBucket,
        producerAttemptId: validated.registration.producerAttemptId,
        ...(validated.registration.missionId ? { missionId: validated.registration.missionId } : {}),
      },
      lease: {
        stepId: validated.lease.stepId,
        leaseToken: validated.lease.leaseToken,
        fencingToken: validated.lease.fencingToken,
        holderIdentity: validated.lease.holderIdentity,
      },
    });
    if (!sameHandleIgnoringCreatedAt(packetArtifact, validated.handle)) {
      throw new Error("VERIFICATION_ADJUDICATION_PACKET_ARTIFACT_COLLISION");
    }

    return this.database.transaction(validated.packet.tenantId, async (client) => {
      const durable = await lockDurableRequest(client, validated);
      await verifyParents(client, validated.packet.tenantId, validated.prepared.parentArtifacts);
      const existing = (await client.query<Row>(
        "select * from evidence.verification_adjudication_subject where tenant_id=$1 and request_operation_id=$2 for update",
        [validated.packet.tenantId, validated.lease.operationId],
      )).rows[0];
      if (existing) {
        verifySubjectRow(existing, validated, durable.requestSha256);
        const registeredPacketArtifact = await readPacketArtifact(client, validated);
        if (!sameHandleIgnoringCreatedAt(registeredPacketArtifact, packetArtifact)) throw new Error("VERIFICATION_ADJUDICATION_PACKET_ARTIFACT_COLLISION");
        return { subjectId: validated.prepared.subjectId, packetArtifact: registeredPacketArtifact };
      }

      const registeredPacketArtifact = await readPacketArtifact(client, validated);
      if (!sameHandleIgnoringCreatedAt(registeredPacketArtifact, packetArtifact)) throw new Error("VERIFICATION_ADJUDICATION_PACKET_ARTIFACT_COLLISION");
      const subject = subjectInsert(validated, durable.requestSha256);
      await client.query(`insert into evidence.verification_adjudication_subject
        (id,tenant_id,request_operation_id,request_step_id,request_lease_token,request_fencing_token,
         request_operation_sha256,request_step_input_sha256,request_payload_sha256,target_kind,target_id,target_object_sha256,
         reason,requester_actor_id,requester_actor_kind,requester_note,eligible_reviewer_roles,quorum_required,
         verification_run_id,run_kind,run_manifest_artifact_id,run_manifest_sha256,run_manifest_payload_sha256,
         bundle_artifact_id,bundle_sha256,deterministic_result_artifact_id,deterministic_result_sha256,
         policy_artifact_id,policy_artifact_sha256,recorded_policy_inputs_artifact_id,recorded_policy_inputs_sha256,
         policy_decision_artifact_id,policy_decision_sha256,original_policy_outcome,audit_payload_sha256,
         report_gate_artifact_id,report_gate_sha256,packet_artifact_id,packet_sha256,expires_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::text[],$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40)`, [
        subject.id, subject.tenant_id, subject.request_operation_id, subject.request_step_id,
        subject.request_lease_token, subject.request_fencing_token, subject.request_operation_sha256,
        subject.request_step_input_sha256, subject.request_payload_sha256, subject.target_kind, subject.target_id,
        subject.target_object_sha256, subject.reason, subject.requester_actor_id, subject.requester_actor_kind,
        subject.requester_note, subject.eligible_reviewer_roles, subject.quorum_required, subject.verification_run_id,
        subject.run_kind, subject.run_manifest_artifact_id, subject.run_manifest_sha256,
        subject.run_manifest_payload_sha256, subject.bundle_artifact_id, subject.bundle_sha256,
        subject.deterministic_result_artifact_id, subject.deterministic_result_sha256, subject.policy_artifact_id,
        subject.policy_artifact_sha256, subject.recorded_policy_inputs_artifact_id, subject.recorded_policy_inputs_sha256,
        subject.policy_decision_artifact_id, subject.policy_decision_sha256, subject.original_policy_outcome,
        subject.audit_payload_sha256, subject.report_gate_artifact_id, subject.report_gate_sha256,
        subject.packet_artifact_id, subject.packet_sha256, subject.expires_at,
      ]);
      const inserted = (await client.query<Row>(
        "select * from evidence.verification_adjudication_subject where tenant_id=$1 and request_operation_id=$2",
        [validated.packet.tenantId, validated.lease.operationId],
      )).rows[0];
      if (!inserted) throw new Error("VERIFICATION_ADJUDICATION_SUBJECT_COMMIT_LOST");
      verifySubjectRow(inserted, validated, durable.requestSha256);
      return { subjectId: validated.prepared.subjectId, packetArtifact: registeredPacketArtifact };
    });
  }
}

function validateCommitInput(input: CommitInput) {
  const packet = deepFreeze(VerificationAdjudicationPacketSchema.parse(input.prepared.packet));
  const request = deepFreeze(RequestAdjudicationRequestSchema.parse(input.prepared.request));
  const parentArtifacts = deepFreeze(input.prepared.parentArtifacts.map((artifact) => VerificationArtifactHandleSchema.parse(artifact)));
  const lease = Object.freeze({ ...input.lease });
  const registration = Object.freeze({ ...input.registration });
  const bytes = Uint8Array.from(input.prepared.packetBytes);
  const canonicalBytes = new TextEncoder().encode(canonicalizeJson(packet));
  const parentArtifactIds = parentArtifacts.map((artifact) => artifact.artifactId);
  const packetParentArtifacts = [
    packet.sealedRun.manifestArtifact, packet.sealedRun.bundleArtifact,
    packet.sealedRun.deterministicResultArtifact, packet.sealedRun.policyArtifact,
    packet.sealedRun.recordedPolicyInputsArtifact, packet.sealedRun.policyDecisionArtifact,
    ...(packet.sealedRun.reportGateArtifact ? [packet.sealedRun.reportGateArtifact] : []),
  ];
  if (!UuidSchema.safeParse(input.prepared.subjectId).success || !UuidSchema.safeParse(lease.stepId).success
    || !UuidSchema.safeParse(lease.operationId).success || !UuidSchema.safeParse(lease.leaseToken).success
    || !UuidSchema.safeParse(registration.producerAttemptId).success
    || (registration.missionId !== undefined && !UuidSchema.safeParse(registration.missionId).success)
    || !Number.isSafeInteger(lease.fencingToken) || lease.fencingToken < 1
    || !/^[0-9a-f]{64}$/u.test(lease.inputSha256)
    || lease.operationId !== packet.requestBinding.operationId
    || input.prepared.requestDigest !== packet.requestBinding.requestDigest
    || digestCanonicalJson(request) !== packet.requestBinding.requestDigest
    || sha256Digest(bytes) !== input.prepared.packetDigest || !equalBytes(bytes, canonicalBytes)
    || new Set(parentArtifactIds).size !== parentArtifactIds.length
    || canonicalizeJson(parentArtifacts) !== canonicalizeJson(packetParentArtifacts)) {
    throw new Error("VERIFICATION_ADJUDICATION_PACKET_BINDING_MISMATCH");
  }
  const transformationSignature = digestCanonicalJson({
    kind: "verification_adjudication_packet.v1", operationId: lease.operationId,
    subjectId: input.prepared.subjectId, requestDigest: input.prepared.requestDigest, parentArtifactIds,
  });
  const handle = createVerificationArtifactHandle({
    tenantId: packet.tenantId, bytes, mediaType: "application/vnd.aiengineer.verification-adjudication-packet+json",
    createdAt: registration.createdAt, producerActivityId: registration.producerActivityId,
    producerVersion: registration.producerVersion, encryptionClass: registration.encryptionClass,
    retentionClass: registration.retentionClass, dataClassification: "restricted", parentArtifactIds,
    transformationSignature,
  });
  const prepared = Object.freeze({
    subjectId: input.prepared.subjectId,
    request,
    requestDigest: input.prepared.requestDigest,
    packet,
    packetDigest: input.prepared.packetDigest,
    packetBytes: bytes,
    parentArtifacts,
  });
  return Object.freeze({ prepared, packet, bytes, handle, lease, registration });
}

async function lockDurableRequest(client: TenantSqlClient, input: ReturnType<typeof validateCommitInput>) {
  const row = (await client.query<Row>(`select o.request,o.request_sha256,o.actor_identity,o.attempt_id,o.mission_id,
    s.input,s.input_sha256 from knowledge_service.operation o
    join knowledge_service.operation_step s on s.tenant_id=o.tenant_id and s.operation_id=o.id
    join knowledge_service.lease l on l.tenant_id=s.tenant_id and l.operation_step_id=s.id
    where o.tenant_id=$1 and o.id=$2 and o.operation_kind='verification_adjudication' and o.status='running'
      and s.id=$3 and s.step_key='request_adjudication_and_register' and s.step_kind='request_adjudication_and_register' and s.status='running'
      and l.lease_token=$4 and l.fencing_token=$5 and l.holder_identity=$6 and l.released_at is null and l.expires_at>clock_timestamp()
    for update of o,s,l`, [
    input.packet.tenantId, input.lease.operationId, input.lease.stepId, input.lease.leaseToken,
    input.lease.fencingToken, input.lease.holderIdentity,
  ])).rows[0];
  if (!row) throw new Error("VERIFICATION_ADJUDICATION_STALE_LEASE");
  const durable = durableRequestSchema.parse(row.request);
  const step = durableStepInputSchema.parse(row.input);
  if (digestCanonicalJson(durable) !== `sha256:${String(row.request_sha256)}`
    || digestCanonicalJson(step) !== `sha256:${String(row.input_sha256)}`
    || String(row.input_sha256) !== input.lease.inputSha256
    || canonicalizeJson(durable.input) !== canonicalizeJson(step.operationInput)
    || canonicalizeJson(durable.expectedVersions) !== canonicalizeJson(step.expectedVersions)
    || canonicalizeJson(durable.authenticatedContext) !== canonicalizeJson(step.context)
    || canonicalizeJson(durable.input.request) !== canonicalizeJson(input.prepared.request)
    || digestCanonicalJson(durable.input.request) !== input.packet.requestBinding.requestDigest
    || durable.authenticatedContext.tenantId !== input.packet.tenantId
    || durable.authenticatedContext.operationId !== input.lease.operationId
    || durable.authenticatedContext.actor.kind !== input.packet.requestBinding.requesterActor.kind
    || durable.authenticatedContext.actor.id !== input.packet.requestBinding.requesterActor.id
    || String(row.actor_identity) !== `${durable.authenticatedContext.actor.kind}:${durable.authenticatedContext.actor.id}`
    || String(row.attempt_id) !== input.registration.producerAttemptId
    || (row.mission_id ?? undefined) !== input.registration.missionId) {
    throw new Error("VERIFICATION_ADJUDICATION_DURABLE_REQUEST_MISMATCH");
  }
  return { requestSha256: String(row.request_sha256) };
}

async function verifyParents(client: TenantSqlClient, tenantId: string, expected: readonly VerificationArtifactHandle[]) {
  for (const candidate of expected) {
    const stored = await readArtifact(client, tenantId, candidate.artifactId);
    if (!stored || stored.storageState !== "available" || canonicalizeJson(stored.handle) !== canonicalizeJson(VerificationArtifactHandleSchema.parse(candidate))) {
      throw new Error("VERIFICATION_ADJUDICATION_PARENT_BINDING_MISMATCH");
    }
  }
}

async function readPacketArtifact(client: TenantSqlClient, input: ReturnType<typeof validateCommitInput>): Promise<VerificationArtifactHandle> {
  const stored = await readArtifact(client, input.packet.tenantId, input.handle.artifactId);
  if (!stored || stored.storageState !== "available" || stored.artifactType !== "verification_adjudication_packet"
    || stored.bucketClass !== "ledger" || stored.storageBucket !== input.registration.storageBucket
    || stored.producerAttemptId !== input.registration.producerAttemptId
    || stored.missionId !== input.registration.missionId
    || !sameHandleIgnoringCreatedAt(stored.handle, input.handle)) {
    throw new Error("VERIFICATION_ADJUDICATION_PACKET_ARTIFACT_COLLISION");
  }
  return stored.handle;
}

async function readArtifact(client: TenantSqlClient, tenantId: string, artifactId: string) {
  const row = (await client.query<Row>(`select a.*,m.producer_activity_id,m.producer_version,m.content_encoding,
    m.encryption_class,m.retention_class,m.data_classification,m.parent_artifact_ids,m.transformation_signature,m.attestation_artifact_id
    from orchestration.artifact a join orchestration.verification_artifact_metadata m
      on m.tenant_id=a.tenant_id and m.artifact_id=a.id
    where a.tenant_id=$1 and a.id=$2 and a.verification_contract_version='verification.v1'`, [tenantId, artifactId])).rows[0];
  if (!row) return undefined;
  const handle = VerificationArtifactHandleSchema.parse({
    artifactId: String(row.id), tenantId: String(row.tenant_id), digest: `sha256:${String(row.sha256)}`,
    mediaType: String(row.media_type), byteLength: Number(row.size_bytes), objectKey: String(row.object_path),
    ...(row.content_encoding ? { contentEncoding: String(row.content_encoding) } : {}),
    createdAt: iso(row.created_at), producerActivityId: String(row.producer_activity_id), producerVersion: String(row.producer_version),
    encryptionClass: String(row.encryption_class), retentionClass: String(row.retention_class),
    dataClassification: row.data_classification, parentArtifactIds: (row.parent_artifact_ids as unknown[]).map(String),
    ...(row.transformation_signature ? { transformationSignature: `sha256:${String(row.transformation_signature)}` } : {}),
    ...(row.attestation_artifact_id ? { attestationArtifactId: String(row.attestation_artifact_id) } : {}),
  });
  return {
    handle, storageState: String(row.storage_state), artifactType: String(row.artifact_type),
    bucketClass: String(row.bucket_class), storageBucket: String(row.storage_bucket),
    producerAttemptId: row.producer_attempt_id === null || row.producer_attempt_id === undefined ? undefined : String(row.producer_attempt_id),
    missionId: row.mission_id === null || row.mission_id === undefined ? undefined : String(row.mission_id),
  };
}

function subjectInsert(input: ReturnType<typeof validateCommitInput>, requestSha256: string): SubjectInsert {
  const packet = input.packet, target = packet.requestBinding.target, gate = packet.sealedRun.reportGateArtifact;
  const targetId = target.kind === "assertion" ? target.assertionId : target.kind === "evidence" ? target.evidenceId : target.runId;
  return {
    id: input.prepared.subjectId, tenant_id: packet.tenantId, request_operation_id: input.lease.operationId,
    request_step_id: input.lease.stepId, request_lease_token: input.lease.leaseToken,
    request_fencing_token: input.lease.fencingToken, request_operation_sha256: requestSha256,
    request_step_input_sha256: input.lease.inputSha256, request_payload_sha256: hex(packet.requestBinding.requestDigest),
    target_kind: target.kind, target_id: targetId, target_object_sha256: hex(packet.requestBinding.targetObjectDigest),
    reason: packet.requestBinding.reason, requester_actor_id: packet.requestBinding.requesterActor.id,
    requester_actor_kind: packet.requestBinding.requesterActor.kind, requester_note: packet.requestBinding.requesterNote ?? null,
    eligible_reviewer_roles: packet.reviewRequirements.eligibleReviewerRoles, quorum_required: packet.reviewRequirements.quorumRequired,
    verification_run_id: packet.sealedRun.runId, run_kind: packet.sealedRun.runKind,
    run_manifest_artifact_id: packet.sealedRun.manifestArtifact.artifactId,
    run_manifest_sha256: hex(packet.sealedRun.manifestArtifact.digest),
    run_manifest_payload_sha256: hex(packet.auditProof.manifestDigest),
    bundle_artifact_id: packet.sealedRun.bundleArtifact.artifactId, bundle_sha256: hex(packet.sealedRun.bundleArtifact.digest),
    deterministic_result_artifact_id: packet.sealedRun.deterministicResultArtifact.artifactId,
    deterministic_result_sha256: hex(packet.sealedRun.deterministicResultArtifact.digest),
    policy_artifact_id: packet.sealedRun.policyArtifact.artifactId, policy_artifact_sha256: hex(packet.sealedRun.policyArtifact.digest),
    recorded_policy_inputs_artifact_id: packet.sealedRun.recordedPolicyInputsArtifact.artifactId,
    recorded_policy_inputs_sha256: hex(packet.sealedRun.recordedPolicyInputsArtifact.digest),
    policy_decision_artifact_id: packet.sealedRun.policyDecisionArtifact.artifactId,
    policy_decision_sha256: hex(packet.sealedRun.policyDecisionArtifact.digest),
    original_policy_outcome: packet.sealedRun.originalPolicyOutcome, audit_payload_sha256: hex(packet.auditProof.payloadDigest),
    report_gate_artifact_id: gate?.artifactId ?? null, report_gate_sha256: gate ? hex(gate.digest) : null,
    packet_artifact_id: input.handle.artifactId, packet_sha256: hex(input.handle.digest),
    expires_at: packet.reviewRequirements.expiresAt ?? null,
  };
}

function verifySubjectRow(row: Row, input: ReturnType<typeof validateCommitInput>, requestSha256: string): void {
  const expected = subjectInsert(input, requestSha256) as Record<string, unknown>;
  for (const [field, value] of Object.entries(expected)) {
    const stored = row[field];
    if (field === "request_lease_token" || field === "request_fencing_token") continue;
    if (Array.isArray(value)) {
      if (canonicalizeJson((stored as unknown[]).map(String)) !== canonicalizeJson(value)) throw new Error("VERIFICATION_ADJUDICATION_SUBJECT_RECOVERY_DRIFT");
    } else if (field === "expires_at") {
      if ((stored === null ? null : iso(stored)) !== (value === null ? null : iso(value))) throw new Error("VERIFICATION_ADJUDICATION_SUBJECT_RECOVERY_DRIFT");
    } else if ((stored === null ? null : String(stored)) !== (value === null ? null : String(value))) {
      throw new Error("VERIFICATION_ADJUDICATION_SUBJECT_RECOVERY_DRIFT");
    }
  }
}

function sameHandleIgnoringCreatedAt(stored: VerificationArtifactHandle, proposed: VerificationArtifactHandle): boolean {
  const { createdAt: _storedCreatedAt, ...storedStable } = stored;
  const { createdAt: _proposedCreatedAt, ...proposedStable } = proposed;
  return canonicalizeJson(storedStable) === canonicalizeJson(proposedStable);
}

function hex(value: string): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) throw new Error("VERIFICATION_ADJUDICATION_DIGEST_INVALID");
  return value.slice(7);
}
function iso(value: unknown): string { return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString(); }
function equalBytes(left: Uint8Array, right: Uint8Array): boolean { return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]); }

