import { SemanticProviderResponseObservationSchema, VerificationArtifactHandleSchema, type VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { canonicalizeJson } from "@aiengineer/knowledge-verification";
import { deepFreeze } from "@aiengineer/knowledge-domain";
import type { PostgresCanonicalRepository, TenantSqlClient } from "./postgres.js";
import { mapSemanticObservation, type SemanticObservationRow } from "./verification-semantic-observation.js";
import type { LeasedStep } from "./types.js";
type Row = Record<string, unknown>;
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : String(value);
const column = (key: string) => key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);

/** Consumes already registered canonical artifacts. Does not create artifacts or dispatch providers. */
export class PostgresVerificationSemanticObservationStore {
  constructor(private readonly database: PostgresCanonicalRepository) {}

  async store(value: unknown, recoveryLease?: LeasedStep): Promise<Readonly<SemanticObservationRow>> {
    const observation = deepFreeze(SemanticProviderResponseObservationSchema.parse(value));
    const mapped = mapSemanticObservation(observation), context = observation.context;
    const active = recoveryLease ? structuredClone(recoveryLease) : { tenantId:context.tenantId,operationId:context.operationId,id:context.operationStepId,stepKey:context.host.stepKey,stepKind:context.host.stepKey,leaseToken:context.leaseToken,fencingToken:context.fencingToken,holderIdentity:context.holderIdentity };
    if(active.tenantId!==context.tenantId || active.operationId!==context.operationId || active.id!==context.operationStepId
      || active.stepKey!==context.host.stepKey || active.stepKind!==context.host.stepKey || !Number.isSafeInteger(active.fencingToken)
      || active.fencingToken<context.fencingToken || !active.leaseToken || !active.holderIdentity
      || (active.fencingToken===context.fencingToken && (active.leaseToken!==context.leaseToken || active.holderIdentity!==context.holderIdentity))) throw new Error("SEMANTIC_OBSERVATION_RECOVERY_LEASE_MISMATCH");
    const entries = Object.entries(mapped), columns = entries.map(([key]) => column(key));
    return this.database.transaction(context.tenantId, async client => {
      const claim = JSON.stringify({stepId:context.operationStepId,leaseToken:active.leaseToken,fencingToken:active.fencingToken,holderIdentity:active.holderIdentity});
      await client.query("select set_config('verification.provider_claim',$1,true)", [claim]);
      const scope = (await client.query<Row>(`select orchestration.verification_provider_scope_tuple_is_live($1,$2,$3,$4,$5,$6::jsonb) live`, [context.tenantId,context.operationId,context.operationStepId,mapped.profileArtifactId,mapped.profileSha256,claim])).rows[0];
      if (scope?.live !== true) throw new Error("SEMANTIC_OBSERVATION_STALE_LEASE");
      const host = (await client.query<Row>(`select o.id from knowledge_service.operation o join knowledge_service.operation_step s on s.tenant_id=o.tenant_id and s.operation_id=o.id where o.tenant_id=$1 and o.id=$2 and o.attempt_id=$3 and o.operation_kind=$4 and s.id=$5 and s.step_key=$6 and s.step_kind=$6 and o.status='running' and s.status='running' for update of o,s`, [context.tenantId,context.operationId,context.producerAttemptId,context.host.operationKind,context.operationStepId,context.host.stepKey])).rows[0];
      if (!host) throw new Error("SEMANTIC_OBSERVATION_HOST_BINDING_MISMATCH");
      const artifacts: readonly (readonly [VerificationArtifactHandle,string])[] = [
        [observation.profileArtifact,"verification_semantic_judge_profile"],
        [observation.blindedInputArtifact,"verification_semantic_blinded_input"],
        [observation.requestArtifact,"verification_provider_request"],
        [observation.rawResponseArtifact,"verification_provider_raw_response"],
        [observation.responseEnvelopeArtifact,"verification_provider_response_envelope"],
        [observation.observationArtifact,"verification_semantic_response_observation"],
      ];
      for (const [expected,type] of artifacts) {
        const actual = await readArtifact(client,context.tenantId,expected.artifactId);
        if (!actual || actual.storageState !== "available" || actual.artifactType !== type || canonicalizeJson(actual.handle)!==canonicalizeJson(expected)
          || (type === "verification_semantic_response_observation" && (actual.producerAttemptId!==context.producerAttemptId || actual.bucketClass!=="ledger"))) throw new Error("SEMANTIC_OBSERVATION_ARTIFACT_BINDING_MISMATCH");
      }
      const prior = (await client.query<Row>("select * from orchestration.verification_semantic_response_observation where tenant_id=$1 and provider_attempt_id=$2",[context.tenantId,context.providerAttemptId])).rows[0];
      if (prior) {
        assertRow(prior,entries);
        // Artifact and replay-row reads can wait until after the lease expires.
        const replayScope = (await client.query<Row>("select orchestration.verification_provider_scope_tuple_is_live($1,$2,$3,$4,$5,$6::jsonb) live", [context.tenantId,context.operationId,context.operationStepId,mapped.profileArtifactId,mapped.profileSha256,claim])).rows[0];
        if (replayScope?.live !== true) throw new Error("SEMANTIC_OBSERVATION_STALE_LEASE");
        return deepFreeze(mapped);
      }
      const inserted = (await client.query<Row>(`insert into orchestration.verification_semantic_response_observation(${columns.join(",")}) values(${entries.map((_,index)=>`$${index+1}`).join(",")}) returning *`,entries.map(([,value])=>value))).rows[0];
      if (!inserted) throw new Error("SEMANTIC_OBSERVATION_INSERT_MISSING");
      assertRow(inserted,entries);
      return deepFreeze(mapped);
    });
  }
}
function assertRow(row: Row, entries: readonly [string,unknown][]): void {
  for (const [key,expected] of entries) {
    const actual=row[column(key)];
    if (typeof expected === "number" ? actual===null || !Number.isSafeInteger(Number(actual)) || Number(actual)!==expected : actual!==expected) throw new Error("SEMANTIC_OBSERVATION_REPLAY_DRIFT");
  }
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
