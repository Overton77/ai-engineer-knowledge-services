import {
  OperationContextSchema,
  RequestAdjudicationRequestSchema,
  UuidSchema,
  VerificationAdjudicationOperationResultSchema,
  VerificationAdjudicationPacketSchema,
  VerificationArtifactHandleSchema,
  type OperationContext,
  type RequestAdjudicationRequest,
  type VerificationAdjudicationOperationResult,
  type VerificationAdjudicationPacket,
  type VerificationArtifactHandle,
} from "@aiengineer/knowledge-contracts";
import {
  KNOWLEDGE_OPERATION_REQUEST_SCHEMA_VERSION,
  type VerificationAdjudicationPacketReplayPort,
  type VerificationAdjudicationReadState,
  type VerifiedVerificationAdjudicationReadPort,
} from "@aiengineer/knowledge-application";
import { deepFreeze } from "@aiengineer/knowledge-domain";
import { deterministicUuid } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, digestCanonicalJson, sha256Digest, type TrustedArtifactResolver } from "@aiengineer/knowledge-verification";
import { z } from "zod";
import type { PostgresCanonicalRepository } from "./postgres.js";

type Row = Record<string, unknown>;
type SucceededSnapshot = {
  readonly state: "succeeded";
  readonly result: VerificationAdjudicationOperationResult;
  readonly packetArtifact: VerificationArtifactHandle;
  readonly subject: Row;
  readonly run: Row;
  readonly sourceOperationKind: string;
  readonly sourceOperationStatus: string;
  readonly request: RequestAdjudicationRequest;
  readonly context: OperationContext;
  readonly terminalFencingToken: number;
  readonly stepId: string;
  readonly operationRequestSha256: string;
  readonly stepInputSha256: string;
};
type Snapshot = { readonly state: Exclude<VerificationAdjudicationReadState, "succeeded"> } | SucceededSnapshot;

const decoder = new TextDecoder("utf-8", { fatal: true });
const same = (left: unknown, right: unknown) => canonicalizeJson(left) === canonicalizeJson(right);
const databaseUuid = (namespace: string, value: string) => UuidSchema.safeParse(value).success ? value : deterministicUuid(namespace, value);
const serviceInputSchema = z.strictObject({ schemaVersion: z.literal("verification-service-request.v1"), useCase: z.literal("requestAdjudication"), request: RequestAdjudicationRequestSchema });
const durableSchema = z.strictObject({ schemaVersion: z.literal(KNOWLEDGE_OPERATION_REQUEST_SCHEMA_VERSION), kind: z.literal("verification_adjudication"), input: serviceInputSchema, expectedVersions: z.record(z.string(), z.string().min(1)), authenticatedContext: OperationContextSchema });
const stepSchema = z.strictObject({ schemaVersion: z.literal(KNOWLEDGE_OPERATION_REQUEST_SCHEMA_VERSION), kind: z.literal("verification_adjudication"), operationInput: serviceInputSchema, expectedVersions: z.record(z.string(), z.string().min(1)), context: OperationContextSchema, step: z.strictObject({ name: z.literal("request_adjudication_and_register"), ordinal: z.literal(0) }) });

export class AdjudicationReadPersistenceError extends Error {
  constructor(readonly code: "INVALID" | "NOT_FOUND" | "INTEGRITY", cause?: unknown) {
    super(`VERIFICATION_ADJUDICATION_READ_${code}`, cause === undefined ? undefined : { cause });
  }
}

/** Authenticates the terminal fence and immutable packet/subject before public projection. */
export class PostgresVerificationAdjudicationReadRepository implements VerifiedVerificationAdjudicationReadPort {
  readonly #maximumReplayMs: number;
  constructor(
    private readonly database: Pick<PostgresCanonicalRepository, "transaction">,
    private readonly createResolver: () => TrustedArtifactResolver,
    private readonly packetReplay: VerificationAdjudicationPacketReplayPort,
    options: { readonly maximumReplayMs?: number } = {},
  ) {
    this.#maximumReplayMs = options.maximumReplayMs ?? 30_000;
    if (!Number.isSafeInteger(this.#maximumReplayMs) || this.#maximumReplayMs < 100 || this.#maximumReplayMs > 120_000) throw new Error("VERIFICATION_ADJUDICATION_READ_REPLAY_TIMEOUT_INVALID");
  }

  async loadVerifiedAdjudication(tenantId: string, operationId: string) {
    if (!UuidSchema.safeParse(tenantId).success || !UuidSchema.safeParse(operationId).success) throw new AdjudicationReadPersistenceError("INVALID");
    try {
      const snapshot = await this.#snapshot(tenantId, operationId);
      if (snapshot.state !== "succeeded") return snapshot;
      const resolver = this.createResolver();
      await resolver.authorizeArtifact({ tenantId, artifactId: snapshot.packetArtifact.artifactId, purpose: "verification_replay" });
      const loaded = await resolver.hydrateRegisteredArtifact({ tenantId, artifactId: snapshot.packetArtifact.artifactId });
      const registration = VerificationArtifactHandleSchema.parse(loaded.registration), bytes = Uint8Array.from(loaded.bytes);
      if (!same(registration, snapshot.packetArtifact) || bytes.byteLength !== snapshot.packetArtifact.byteLength || sha256Digest(bytes) !== snapshot.packetArtifact.digest) throw new Error("PACKET_BYTES");
      const raw = decoder.decode(bytes), decoded: unknown = JSON.parse(raw);
      if (canonicalizeJson(decoded) !== raw) throw new Error("PACKET_CANONICAL_BYTES");
      const packet = VerificationAdjudicationPacketSchema.parse(decoded);
      verifyPacketArtifact(snapshot, packet, bytes);
      verifySubject(snapshot, packet);
      verifyNativeRun(snapshot, packet);

      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let replayed;
      try {
        const timeoutFailure = new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error("CANONICAL_PACKET_REPLAY_TIMEOUT"));
          }, this.#maximumReplayMs);
        });
        replayed = await Promise.race([
          this.packetReplay.replayPacket({ request: snapshot.request, context: snapshot.context, reviewRequirements: packet.reviewRequirements, signal: controller.signal }),
          timeoutFailure,
        ]);
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
        controller.abort();
      }
      if (replayed.subjectId !== snapshot.result.output.subjectId
        || replayed.packetDigest !== snapshot.packetArtifact.digest || !same(replayed.packet, packet)
        || sha256Digest(replayed.packetBytes) !== snapshot.packetArtifact.digest
        || !same(replayed.parentArtifacts, packetParents(packet))) throw new Error("CANONICAL_PACKET_REPLAY_DRIFT");
      const after = await this.#snapshot(tenantId, operationId);
      if (!same(after, snapshot)) throw new Error("TERMINAL_DRIFT");
      return deepFreeze({ state: "succeeded" as const, result: snapshot.result, packet, terminalFencingToken: snapshot.terminalFencingToken });
    } catch (error) {
      if (error instanceof AdjudicationReadPersistenceError) throw error;
      throw new AdjudicationReadPersistenceError("INTEGRITY", error);
    }
  }

  async #snapshot(tenantId: string, operationId: string): Promise<Snapshot> {
    return this.database.transaction(tenantId, async client => {
      const rows = (await client.query<Row>(`select o.status,o.request,o.request_sha256,o.idempotency_key,o.actor_identity,o.attempt_id,o.mission_id,o.work_item_id,o.correlation_id,o.causation_id,o.ownership_mode,o.external_run_id,
        exists(select 1 from orchestration.attempt owned_attempt join orchestration.work_item owned_work on owned_work.tenant_id=owned_attempt.tenant_id and owned_work.id=owned_attempt.work_item_id join orchestration.mission owned_mission on owned_mission.tenant_id=owned_work.tenant_id and owned_mission.id=owned_work.mission_id where owned_attempt.tenant_id=o.tenant_id and owned_attempt.id=o.attempt_id and owned_work.id=o.work_item_id and owned_mission.id=o.mission_id) ownership_chain_valid,
        s.id step_id,s.status step_status,s.step_key,s.step_kind,s.input,s.input_sha256,
        receipt.id receipt_id,receipt.receipt_kind,receipt.outcome,receipt.input_sha256 receipt_input_sha256,receipt.output_sha256,receipt.body,
        event.id event_id,event.operation_id event_operation_id,event.step_id event_step_id,event.event_kind,event.from_state event_from_state,event.to_state event_to_state,event.guarded_sha256 event_guarded_sha256,event.payload event_payload,
        to_jsonb(subject) subject_row,to_jsonb(packet_artifact) packet_artifact_row,to_jsonb(packet_metadata) packet_metadata_row,
        to_jsonb(source_run) source_run_row,source_operation.operation_kind source_operation_kind,source_operation.status source_operation_status
        from knowledge_service.operation o
        left join knowledge_service.operation_step s on s.tenant_id=o.tenant_id and s.operation_id=o.id
        left join knowledge_service.receipt receipt on receipt.tenant_id=o.tenant_id and receipt.operation_id=o.id and receipt.step_id=s.id
        left join knowledge_service.operation_event event on event.tenant_id=o.tenant_id and event.id=(receipt.body->>'eventId')::uuid
        left join evidence.verification_adjudication_subject subject on subject.tenant_id=o.tenant_id and subject.request_operation_id=o.id
        left join orchestration.artifact packet_artifact on packet_artifact.tenant_id=subject.tenant_id and packet_artifact.id=subject.packet_artifact_id
        left join orchestration.verification_artifact_metadata packet_metadata on packet_metadata.tenant_id=packet_artifact.tenant_id and packet_metadata.artifact_id=packet_artifact.id
        left join evidence.verification_run source_run on source_run.tenant_id=subject.tenant_id and source_run.id=subject.verification_run_id
        left join knowledge_service.operation source_operation on source_operation.tenant_id=source_run.tenant_id and source_operation.id=source_run.operation_id
        where o.tenant_id=$1 and o.id=$2 and o.operation_kind='verification_adjudication'`, [tenantId, operationId])).rows;
      if (rows.length === 0) throw new AdjudicationReadPersistenceError("NOT_FOUND");
      if (rows.length !== 1) throw new Error("TERMINAL_COUNT");
      const row = rows[0]!, status = String(row.status);
      if (["queued", "running", "needs_review", "quarantined"].includes(status)) return deepFreeze({ state: "pending" as const });
      if (status === "failed") return deepFreeze({ state: "failed" as const });
      if (status === "cancelled") return deepFreeze({ state: "cancelled" as const });
      if (status !== "succeeded") throw new Error("OPERATION_STATUS");
      const durable = durableSchema.parse(row.request), step = stepSchema.parse(row.input);
      if (!same(durable.input, step.operationInput) || !same(durable.expectedVersions, step.expectedVersions) || !same(durable.authenticatedContext, step.context)
        || digestCanonicalJson(durable) !== `sha256:${String(row.request_sha256)}` || digestCanonicalJson(step) !== `sha256:${String(row.input_sha256)}`
        || step.context.tenantId !== tenantId || step.context.operationId !== operationId
        || row.idempotency_key !== step.context.idempotencyKey || row.actor_identity !== `${step.context.actor.kind}:${step.context.actor.id}`
        || row.attempt_id !== step.context.attemptId || (row.mission_id ?? undefined) !== step.context.missionId || (row.work_item_id ?? undefined) !== step.context.workItemId
        || row.correlation_id !== databaseUuid("correlation", step.context.correlationId) || (row.causation_id ?? undefined) !== (step.context.causationId ? databaseUuid("causation", step.context.causationId) : undefined)
        || row.ownership_mode !== (step.context.externalExecution?.runtime === "eve" ? "eve" : step.context.externalExecution?.runtime === "mission_control" ? "mission_control" : "standalone")
        || (row.external_run_id ?? undefined) !== step.context.externalExecution?.runId
        || row.ownership_chain_valid !== Boolean(step.context.workItemId && step.context.missionId)
        || row.step_status !== "succeeded" || row.step_key !== "request_adjudication_and_register" || row.step_kind !== "request_adjudication_and_register"
        || row.receipt_kind !== "request_adjudication_and_register.succeeded" || row.outcome !== "succeeded"
        || row.receipt_input_sha256 !== row.input_sha256 || !UuidSchema.safeParse(row.step_id).success || !UuidSchema.safeParse(row.receipt_id).success
        || !row.subject_row || !row.packet_artifact_row || !row.packet_metadata_row || !row.source_run_row) throw new Error("TERMINAL_BINDING");
      if (!row.body || typeof row.body !== "object" || Array.isArray(row.body)) throw new Error("RECEIPT_BODY");
      const { eventId, fencingToken, ...body } = row.body as Row;
      const result = VerificationAdjudicationOperationResultSchema.parse(body), fence = Number(fencingToken);
      if (!UuidSchema.safeParse(eventId).success || !Number.isSafeInteger(fence) || fence < 1
        || row.event_id !== eventId || row.event_operation_id !== operationId || row.event_step_id !== row.step_id
        || row.event_kind !== "step.succeeded" || row.event_from_state !== "running" || row.event_to_state !== "succeeded"
        || row.event_guarded_sha256 !== row.output_sha256 || !same(row.event_payload, { outputSha256: row.output_sha256, fencingToken: String(fence) })
        || result.operationId !== operationId || result.requestDigest !== digestCanonicalJson(durable.input.request)
        || digestCanonicalJson(result) !== `sha256:${String(row.output_sha256)}`) throw new Error("RECEIPT_BINDING");
      const packetArtifactRow = row.packet_artifact_row as Row, packetMetadataRow = row.packet_metadata_row as Row;
      if (packetArtifactRow.artifact_type !== "verification_adjudication_packet" || packetArtifactRow.bucket_class !== "ledger"
        || packetArtifactRow.storage_state !== "available" || packetArtifactRow.verification_contract_version !== "verification.v1"
        || String(packetArtifactRow.producer_attempt_id) !== step.context.attemptId
        || (packetArtifactRow.mission_id ?? undefined) !== step.context.missionId) throw new Error("PACKET_NATIVE_REGISTRATION");
      const packetArtifact = handleFromRows(packetArtifactRow, packetMetadataRow);
      if (result.resultArtifact.artifactId !== packetArtifact.artifactId || !same(result.resultArtifact, packetArtifact)) throw new Error("RECEIPT_PACKET_ARTIFACT");
      return deepFreeze({ state: "succeeded" as const, result, packetArtifact, subject: row.subject_row as Row, run: row.source_run_row as Row, sourceOperationKind: String(row.source_operation_kind), sourceOperationStatus: String(row.source_operation_status), request: durable.input.request, context: durable.authenticatedContext, terminalFencingToken: fence, stepId: String(row.step_id), operationRequestSha256: String(row.request_sha256), stepInputSha256: String(row.input_sha256) });
    });
  }
}

function verifyPacketArtifact(snapshot: SucceededSnapshot, packet: VerificationAdjudicationPacket, bytes: Uint8Array): void {
  const artifact = snapshot.packetArtifact, parents = packetParents(packet).map(item => item.artifactId);
  const signature = digestCanonicalJson({ kind: "verification_adjudication_packet.v1", operationId: snapshot.result.operationId, subjectId: snapshot.result.output.subjectId, requestDigest: snapshot.result.requestDigest, parentArtifactIds: parents });
  if (artifact.digest !== sha256Digest(bytes) || artifact.mediaType !== "application/vnd.aiengineer.verification-adjudication-packet+json"
    || artifact.producerActivityId !== "verification-service:requestAdjudication" || artifact.producerVersion !== "verification-service.v1"
    || artifact.retentionClass !== "verification-audit" || artifact.dataClassification !== "restricted"
    || artifact.transformationSignature !== signature || !same(artifact.parentArtifactIds, parents)
    || snapshot.result.output.packetArtifact.artifactId !== artifact.artifactId || snapshot.result.output.packetArtifact.digest !== artifact.digest) throw new Error("PACKET_ARTIFACT_BINDING");
}

function verifySubject(snapshot: SucceededSnapshot, packet: VerificationAdjudicationPacket): void {
  const row = snapshot.subject, target = packet.requestBinding.target, gate = packet.sealedRun.reportGateArtifact;
  const targetId = target.kind === "assertion" ? target.assertionId : target.kind === "evidence" ? target.evidenceId : target.runId;
  const expected: Row = {
    id: snapshot.result.output.subjectId, tenant_id: packet.tenantId, request_operation_id: snapshot.result.operationId,
    request_step_id: snapshot.stepId, request_operation_sha256: snapshot.operationRequestSha256,
    request_step_input_sha256: snapshot.stepInputSha256, request_payload_sha256: hex(packet.requestBinding.requestDigest),
    target_kind: target.kind, target_id: targetId, target_object_sha256: hex(packet.requestBinding.targetObjectDigest), reason: packet.requestBinding.reason,
    requester_actor_id: packet.requestBinding.requesterActor.id, requester_actor_kind: packet.requestBinding.requesterActor.kind,
    requester_note: packet.requestBinding.requesterNote ?? null, eligible_reviewer_roles: packet.reviewRequirements.eligibleReviewerRoles,
    quorum_required: packet.reviewRequirements.quorumRequired, verification_run_id: packet.sealedRun.runId, run_kind: packet.sealedRun.runKind,
    run_manifest_artifact_id: packet.sealedRun.manifestArtifact.artifactId, run_manifest_sha256: hex(packet.sealedRun.manifestArtifact.digest), run_manifest_payload_sha256: hex(packet.auditProof.manifestDigest),
    bundle_artifact_id: packet.sealedRun.bundleArtifact.artifactId, bundle_sha256: hex(packet.sealedRun.bundleArtifact.digest), deterministic_result_artifact_id: packet.sealedRun.deterministicResultArtifact.artifactId,
    deterministic_result_sha256: hex(packet.sealedRun.deterministicResultArtifact.digest), policy_artifact_id: packet.sealedRun.policyArtifact.artifactId, policy_artifact_sha256: hex(packet.sealedRun.policyArtifact.digest),
    recorded_policy_inputs_artifact_id: packet.sealedRun.recordedPolicyInputsArtifact.artifactId, recorded_policy_inputs_sha256: hex(packet.sealedRun.recordedPolicyInputsArtifact.digest),
    policy_decision_artifact_id: packet.sealedRun.policyDecisionArtifact.artifactId, policy_decision_sha256: hex(packet.sealedRun.policyDecisionArtifact.digest), original_policy_outcome: packet.sealedRun.originalPolicyOutcome,
    audit_payload_sha256: hex(packet.auditProof.payloadDigest), report_gate_artifact_id: gate?.artifactId ?? null, report_gate_sha256: gate ? hex(gate.digest) : null,
    packet_artifact_id: snapshot.packetArtifact.artifactId, packet_sha256: hex(snapshot.packetArtifact.digest), expires_at: packet.reviewRequirements.expiresAt ?? null,
  };
  const creationFence = strictPositiveInteger(row.request_fencing_token);
  if (!UuidSchema.safeParse(row.request_lease_token).success || creationFence > snapshot.terminalFencingToken || String(row.request_step_id) === "") throw new Error("SUBJECT_CREATION_FENCE");
  for (const [key, value] of Object.entries(expected)) {
    const stored = row[key];
    if (Array.isArray(value) ? !same((stored as unknown[]).map(String), value)
      : key === "expires_at" ? (stored === null ? null : iso(stored)) !== (value === null ? null : iso(value))
      : (stored === null ? null : String(stored)) !== (value === null ? null : String(value))) throw new Error(`SUBJECT_FIELD:${key}`);
  }
  if (snapshot.result.output.originalPolicyOutcome !== packet.sealedRun.originalPolicyOutcome || snapshot.result.output.humanDecisionRecorded || snapshot.result.output.admissionChanged) throw new Error("SUBJECT_RESULT_STATE");
}

function verifyNativeRun(snapshot: SucceededSnapshot, packet: VerificationAdjudicationPacket): void {
  const row = snapshot.run, expectedKind = packet.sealedRun.runKind === "claims" ? "verification_claims" : "verification_report";
  if (String(row.id) !== packet.sealedRun.runId || String(row.tenant_id) !== packet.tenantId || row.contract_version !== "verification.v1"
    || !["succeeded", "failed", "review", "abstained"].includes(String(row.status)) || row.ended_at === null
    || snapshot.sourceOperationKind !== expectedKind || snapshot.sourceOperationStatus !== "succeeded"
    || String(row.run_manifest_artifact_id) !== packet.sealedRun.manifestArtifact.artifactId || String(row.manifest_sha256) !== hex(packet.sealedRun.manifestArtifact.digest)
    || String(row.bundle_artifact_id) !== packet.sealedRun.bundleArtifact.artifactId || String(row.deterministic_result_artifact_id) !== packet.sealedRun.deterministicResultArtifact.artifactId
    || String(row.policy_artifact_id) !== packet.sealedRun.policyArtifact.artifactId || String(row.policy_artifact_sha256) !== hex(packet.sealedRun.policyArtifact.digest)) throw new Error("SOURCE_RUN_BINDING");
}

function packetParents(packet: VerificationAdjudicationPacket): VerificationArtifactHandle[] {
  return [packet.sealedRun.manifestArtifact, packet.sealedRun.bundleArtifact, packet.sealedRun.deterministicResultArtifact, packet.sealedRun.policyArtifact, packet.sealedRun.recordedPolicyInputsArtifact, packet.sealedRun.policyDecisionArtifact, ...(packet.sealedRun.reportGateArtifact ? [packet.sealedRun.reportGateArtifact] : [])];
}
function handleFromRows(artifact: Row, metadata: Row): VerificationArtifactHandle {
  return VerificationArtifactHandleSchema.parse({ artifactId: String(artifact.id), tenantId: String(artifact.tenant_id), digest: `sha256:${String(artifact.sha256)}`, mediaType: String(artifact.media_type), byteLength: Number(artifact.size_bytes), objectKey: String(artifact.object_path), ...(metadata.content_encoding ? { contentEncoding: String(metadata.content_encoding) } : {}), createdAt: iso(artifact.created_at), producerActivityId: String(metadata.producer_activity_id), producerVersion: String(metadata.producer_version), encryptionClass: String(metadata.encryption_class), retentionClass: String(metadata.retention_class), dataClassification: metadata.data_classification, parentArtifactIds: (metadata.parent_artifact_ids as unknown[]).map(String), ...(metadata.transformation_signature ? { transformationSignature: `sha256:${String(metadata.transformation_signature)}` } : {}), ...(metadata.attestation_artifact_id ? { attestationArtifactId: String(metadata.attestation_artifact_id) } : {}) });
}
function hex(value: string): string { if (!/^sha256:[0-9a-f]{64}$/u.test(value)) throw new Error("DIGEST"); return value.slice(7); }
function iso(value: unknown): string { return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString(); }
function strictPositiveInteger(value: unknown): number {
  const parsed = typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 1) throw new Error("POSITIVE_INTEGER");
  return Number(parsed);
}
