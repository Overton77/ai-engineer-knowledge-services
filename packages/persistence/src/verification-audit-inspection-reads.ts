import {
  InspectAuditBundleRequestSchema,
  OperationContextSchema,
  UuidSchema,
  VerificationArtifactHandleSchema,
  VerificationAuditInspectionOperationResultSchema,
} from "@aiengineer/knowledge-contracts";
import { KNOWLEDGE_OPERATION_REQUEST_SCHEMA_VERSION, type VerifiedAuditInspectionReadPort } from "@aiengineer/knowledge-application";
import { deepFreeze } from "@aiengineer/knowledge-domain";
import { deterministicUuid } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, digestCanonicalJson, sha256Digest, type TrustedArtifactResolver } from "@aiengineer/knowledge-verification";
import { z } from "zod";
import type { PostgresCanonicalRepository } from "./postgres.js";

export class AuditInspectionReadError extends Error {
  constructor(readonly code: "INVALID" | "NOT_FOUND" | "INTEGRITY", cause?: unknown) { super(`AUDIT_INSPECTION_READ_${code}`, cause === undefined ? undefined : { cause }); }
}
type Row = Record<string, unknown>;
const same = (a: unknown, b: unknown) => canonicalizeJson(a) === canonicalizeJson(b);
const databaseUuid = (namespace: string, value: string) => UuidSchema.safeParse(value).success ? value : deterministicUuid(namespace, value);
const serviceInputSchema = z.strictObject({
  schemaVersion: z.literal("verification-service-request.v1"),
  useCase: z.literal("inspectAuditBundle"),
  request: InspectAuditBundleRequestSchema,
});
const durableRequestSchema = z.strictObject({
  schemaVersion: z.literal(KNOWLEDGE_OPERATION_REQUEST_SCHEMA_VERSION),
  kind: z.literal("verification_audit_bundle"),
  input: serviceInputSchema,
  expectedVersions: z.record(z.string(), z.string().min(1)),
  authenticatedContext: OperationContextSchema,
});
const durableStepInputSchema = z.strictObject({
  schemaVersion: z.literal(KNOWLEDGE_OPERATION_REQUEST_SCHEMA_VERSION),
  kind: z.literal("verification_audit_bundle"),
  operationInput: serviceInputSchema,
  expectedVersions: z.record(z.string(), z.string().min(1)),
  context: OperationContextSchema,
  step: z.strictObject({ name: z.literal("inspect_audit_bundle_and_register"), ordinal: z.literal(0) }),
});

/** Authenticates terminal state, receipt, fenced artifact registration, and original canonical bytes. */
export class PostgresAuditInspectionReadRepository implements VerifiedAuditInspectionReadPort {
  constructor(
    private readonly database: Pick<PostgresCanonicalRepository, "transaction">,
    private readonly createResolver: () => TrustedArtifactResolver,
  ) {}

  async loadVerifiedInspection(tenantId: string, operationId: string) {
    if (!UuidSchema.safeParse(tenantId).success || !UuidSchema.safeParse(operationId).success) throw new AuditInspectionReadError("INVALID");
    try {
      const snapshot = await this.#snapshot(tenantId, operationId);
      if (snapshot.state !== "succeeded") return snapshot;
      const result = VerificationAuditInspectionOperationResultSchema.parse(snapshot.result);
      const artifact = result.resultArtifact;
      if (artifact.tenantId !== tenantId || artifact.artifactId !== snapshot.artifactId || artifact.byteLength > 1_000_000
        || artifact.mediaType !== "application/vnd.aiengineer.verification-audit-inspection-result+json"
        || artifact.parentArtifactIds.length !== 1 || artifact.parentArtifactIds[0] !== snapshot.auditArtifactId
        || artifact.producerActivityId !== "verification-service:inspectAuditBundle"
        || artifact.producerVersion !== "verification-service.v1"
        || artifact.retentionClass !== "verification-audit" || artifact.dataClassification !== "restricted"
        || artifact.transformationSignature !== digestCanonicalJson({ kind: "verification_audit_inspection_result.v1", operationId, requestDigest: result.requestDigest, auditArtifact: snapshot.auditArtifact })) {
        throw new Error("RESULT_ARTIFACT_BINDING");
      }
      const resolver = this.createResolver();
      await resolver.authorizeArtifact({ tenantId, artifactId: artifact.artifactId, purpose: "verification_replay" });
      const loaded = await resolver.hydrateRegisteredArtifact({ tenantId, artifactId: artifact.artifactId });
      const registration = VerificationArtifactHandleSchema.parse(loaded.registration), bytes = loaded.bytes.slice();
      if (!same(registration, artifact) || bytes.byteLength !== artifact.byteLength || sha256Digest(bytes) !== artifact.digest) throw new Error("RESULT_BYTES");
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes), decoded: unknown = JSON.parse(raw);
      if (canonicalizeJson(decoded) !== raw) throw new Error("RESULT_CANONICAL_BYTES");
      const { resultArtifact: _resultArtifact, ...artifactBody } = result;
      if (!same(decoded, artifactBody)) throw new Error("RESULT_BODY_BINDING");
      const after = await this.#snapshot(tenantId, operationId);
      if (!same(after, snapshot)) throw new Error("TERMINAL_DRIFT");
      return deepFreeze({ state: "succeeded" as const, result });
    } catch (error) {
      if (error instanceof AuditInspectionReadError) throw error;
      throw new AuditInspectionReadError("INTEGRITY", error);
    }
  }

  async #snapshot(tenantId: string, operationId: string) {
    return this.database.transaction(tenantId, async client => {
      const rows = (await client.query<Row>(`select o.status,o.request,o.request_sha256,o.idempotency_key,o.actor_identity,o.attempt_id,o.mission_id,o.work_item_id,o.correlation_id,o.causation_id,o.ownership_mode,o.external_run_id,
        s.id step_id,s.status step_status,s.step_key,s.step_kind,s.input,s.input_sha256,
        r.id receipt_id,r.receipt_kind,r.outcome,r.input_sha256 receipt_input_sha256,r.output_sha256,r.body,
        a.id artifact_id,a.artifact_type,a.bucket_class,
        e.id event_id,e.operation_id event_operation_id,e.step_id event_step_id,e.event_kind,e.from_state event_from_state,e.to_state event_to_state,e.guarded_sha256 event_guarded_sha256,e.payload event_payload
        from knowledge_service.operation o
        left join knowledge_service.operation_step s on s.tenant_id=o.tenant_id and s.operation_id=o.id
        left join knowledge_service.receipt r on r.tenant_id=o.tenant_id and r.operation_id=o.id and r.step_id=s.id
        left join orchestration.artifact a on a.tenant_id=o.tenant_id and a.id=(r.body->'resultArtifact'->>'artifactId')::uuid
        left join knowledge_service.operation_event e on e.tenant_id=o.tenant_id and e.id=(r.body->>'eventId')::uuid
        where o.tenant_id=$1 and o.id=$2 and o.operation_kind='verification_audit_bundle'`, [tenantId, operationId])).rows;
      if (rows.length === 0) throw new AuditInspectionReadError("NOT_FOUND");
      if (rows.length !== 1) throw new Error("TERMINAL_COUNT");
      const row = rows[0]!, status = String(row.status);
      if (["queued", "running", "needs_review", "quarantined"].includes(status)) return deepFreeze({ state: "pending" as const });
      if (status === "failed") return deepFreeze({ state: "failed" as const });
      if (status === "cancelled") return deepFreeze({ state: "cancelled" as const });
      if (status !== "succeeded") throw new Error("OPERATION_STATUS");
      const durable = durableRequestSchema.parse(row.request), step = durableStepInputSchema.parse(row.input);
      if (!same(durable.input, step.operationInput) || !same(durable.expectedVersions, step.expectedVersions)
        || !same(durable.authenticatedContext, step.context) || digestCanonicalJson(step) !== `sha256:${String(row.input_sha256)}`
        || step.context.tenantId !== tenantId || step.context.operationId !== operationId
        || row.idempotency_key !== step.context.idempotencyKey || row.actor_identity !== `${step.context.actor.kind}:${step.context.actor.id}`
        || row.attempt_id !== step.context.attemptId || (row.mission_id ?? undefined) !== step.context.missionId || (row.work_item_id ?? undefined) !== step.context.workItemId
        || row.correlation_id !== databaseUuid("correlation", step.context.correlationId) || (row.causation_id ?? undefined) !== (step.context.causationId ? databaseUuid("causation", step.context.causationId) : undefined)
        || row.ownership_mode !== (step.context.externalExecution?.runtime === "eve" ? "eve" : step.context.externalExecution?.runtime === "mission_control" ? "mission_control" : "standalone")
        || (row.external_run_id ?? undefined) !== step.context.externalExecution?.runId
        || digestCanonicalJson(durable) !== `sha256:${String(row.request_sha256)}`
        || row.step_status !== "succeeded" || row.step_key !== "inspect_audit_bundle_and_register" || row.step_kind !== "inspect_audit_bundle_and_register"
        || row.receipt_kind !== "inspect_audit_bundle_and_register.succeeded" || row.outcome !== "succeeded"
        || !UuidSchema.safeParse(row.step_id).success || !UuidSchema.safeParse(row.receipt_id).success
        || row.receipt_input_sha256 !== row.input_sha256 || row.artifact_type !== "verification_audit_inspection_result" || row.bucket_class !== "ledger") {
        throw new Error("TERMINAL_BINDING");
      }
      if (!row.body || typeof row.body !== "object" || Array.isArray(row.body)) throw new Error("RECEIPT_BODY");
      const { eventId, fencingToken, ...body } = row.body as Row;
      const result = VerificationAuditInspectionOperationResultSchema.parse(body);
      const requestDigest = digestCanonicalJson(durable.input.request);
      if (!UuidSchema.safeParse(eventId).success || !Number.isSafeInteger(fencingToken) || Number(fencingToken) < 1) throw new Error("RECEIPT_FENCE_SHAPE");
      if (row.event_id !== eventId || row.event_operation_id !== operationId || row.event_step_id !== row.step_id
        || row.event_kind !== "step.succeeded" || row.event_from_state !== "running" || row.event_to_state !== "succeeded") throw new Error("RECEIPT_EVENT_IDENTITY");
      // PostgreSQL bigint values are serialized as decimal strings in event JSON.
      if (row.event_guarded_sha256 !== row.output_sha256 || !same(row.event_payload, { outputSha256: row.output_sha256, fencingToken: String(fencingToken) })) throw new Error("RECEIPT_EVENT_GUARD");
      if (result.operationId !== operationId || result.requestDigest !== requestDigest) throw new Error("RECEIPT_REQUEST_BINDING");
      if (result.output.auditArtifact.artifactId !== durable.input.request.auditBundle.artifactId
        || result.output.auditArtifact.digest !== durable.input.request.auditBundle.digest) throw new Error("RECEIPT_AUDIT_BINDING");
      if (result.resultArtifact.artifactId !== row.artifact_id) throw new Error("RECEIPT_ARTIFACT_BINDING");
      if (digestCanonicalJson(result) !== `sha256:${String(row.output_sha256)}`) throw new Error("RECEIPT_OUTPUT_DIGEST");
      return deepFreeze({
        state: "succeeded" as const,
        result,
        artifactId: String(row.artifact_id),
        auditArtifactId: durable.input.request.auditBundle.artifactId,
        auditArtifact: durable.input.request.auditBundle,
      });
    });
  }
}
