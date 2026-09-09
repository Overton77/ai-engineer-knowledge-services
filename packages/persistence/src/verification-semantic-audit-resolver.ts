import { SemanticBlindedInputSchema, SemanticProviderResponseObservationSchema, type VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { type SemanticJudgeProfileCatalog } from "@aiengineer/knowledge-application";
import { canonicalizeJson,sha256Digest } from "@aiengineer/knowledge-verification";
import type { PostgresCanonicalRepository } from "./postgres.js";
import type { PostgresVerificationRepository } from "./verification.js";
import type { VerificationAuditInspectionRuntimeDependencies } from "./verification-audit-runtime.js";

type Resolve = NonNullable<VerificationAuditInspectionRuntimeDependencies["resolveSemanticJudges"]>;
type Row = Record<string,unknown>;

export function createNativeSemanticAuditJudgeResolver(dependencies: {
  readonly database: PostgresCanonicalRepository;
  readonly repository: PostgresVerificationRepository;
  readonly profiles: SemanticJudgeProfileCatalog;
}): Resolve {
  return async input => {
    const { originalOperationId,signal } = input, audit = structuredClone(input.auditBundle), assertionId = input.assertionId;
    const active = () => { if (signal.aborted) throw signal.reason ?? new Error("SEMANTIC_AUDIT_CANCELLED"); };
    active();
    const operation = await dependencies.database.getOperationRecord(audit.tenantId,originalOperationId);
    if (!operation || operation.status !== "succeeded" || !["verification_claims","verification_report"].includes(operation.operationKind)) throw new Error("SEMANTIC_AUDIT_OPERATION_REQUIRED");
    const host = operation.operationKind === "verification_claims" ? "claims" : "report";
    const grants = dependencies.profiles.resolve(audit.tenantId,originalOperationId,host), indexed = new Map([...audit.manifest.inputArtifacts,...audit.manifest.outputArtifacts].map(handle => [handle.artifactId,handle]));
    const result: Awaited<ReturnType<Resolve>>[number][] = [];
    async function hydrate(handle: VerificationArtifactHandle, limit: number) {
      active();
      if (handle.byteLength > limit || canonicalizeJson(indexed.get(handle.artifactId) ?? null) !== canonicalizeJson(handle)) throw new Error("SEMANTIC_AUDIT_ARTIFACT_UNLISTED");
      const resolver = dependencies.repository.createTrustedArtifactResolver();
      await resolver.authorizeArtifact({tenantId:audit.tenantId,artifactId:handle.artifactId,purpose:"verification_admission"});active();
      const loaded = await resolver.hydrateRegisteredArtifact({tenantId:audit.tenantId,artifactId:handle.artifactId});active();
      if (canonicalizeJson(loaded.registration) !== canonicalizeJson(handle) || loaded.bytes.byteLength !== handle.byteLength || sha256Digest(loaded.bytes) !== handle.digest) throw new Error("SEMANTIC_AUDIT_ARTIFACT_INTEGRITY");
      return new TextDecoder("utf-8",{fatal:true}).decode(loaded.bytes);
    }
    for (const grant of grants) {
      active();
      const rows = await dependencies.database.transaction(audit.tenantId,async client => (await client.query<Row>(`select o.observation_artifact_id,o.observation_sha256,c.* from orchestration.verification_semantic_response_observation o
        join orchestration.verification_provider_response_capture c on c.tenant_id=o.tenant_id and c.provider_attempt_id=o.provider_attempt_id and c.operation_id=o.operation_id and c.operation_step_id=o.operation_step_id and c.profile_artifact_id=o.profile_artifact_id and c.profile_sha256=o.profile_sha256 and c.dispatch_fencing_token=o.dispatch_fencing_token and c.response_envelope_artifact_id=o.response_envelope_artifact_id
        where o.tenant_id=$1 and o.operation_id=$2 and o.profile_artifact_id=$3 and o.profile_sha256=$4 order by o.provider_attempt_id limit 513`,[audit.tenantId,originalOperationId,grant.profileArtifact.artifactId,grant.profileArtifact.digest.slice(7)])).rows);
      if (rows.length > 512) throw new Error("SEMANTIC_AUDIT_OBSERVATION_LIMIT");
      const matches: Awaited<ReturnType<Resolve>>[number][] = [];
      for (const row of rows) {
        const handle = indexed.get(String(row.observation_artifact_id));
        if (!handle) continue;
        if (handle.digest !== `sha256:${String(row.observation_sha256)}`) throw new Error("SEMANTIC_AUDIT_OBSERVATION_DRIFT");
        const observation = SemanticProviderResponseObservationSchema.parse({...JSON.parse(await hydrate(handle,96_000)),observationArtifact:handle});
        if (observation.context.operationId !== originalOperationId || observation.context.providerAttemptId !== String(row.provider_attempt_id) || observation.context.operationStepId !== String(row.operation_step_id) || observation.context.fencingToken !== Number(row.dispatch_fencing_token) || canonicalizeJson(observation.judgeIdentity) !== canonicalizeJson(grant.identity)) throw new Error("SEMANTIC_AUDIT_OBSERVATION_DRIFT");
        const blinded = SemanticBlindedInputSchema.parse(JSON.parse(await hydrate(observation.blindedInputArtifact,96_000)));
        if (blinded.assertionId !== assertionId) continue;
        matches.push({identity:grant.identity,profileArtifact:grant.profileArtifact,observationArtifact:handle,capture:{tenantId:audit.tenantId,providerAttemptId:String(row.provider_attempt_id),operationId:originalOperationId,operationStepId:String(row.operation_step_id),profileArtifactId:String(row.profile_artifact_id),profileDigest:`sha256:${String(row.profile_sha256)}`,dispatchFencingToken:Number(row.dispatch_fencing_token),httpStatus:Number(row.http_status),responseEnvelopeArtifactId:String(row.response_envelope_artifact_id),transportArtifactId:String(row.transport_artifact_id),transportDigest:`sha256:${String(row.transport_sha256)}`,capturedAt:row.captured_at instanceof Date ? row.captured_at.toISOString() : String(row.captured_at)}});
      }
      if (matches.length > 1 || (grant.role === "primary" && matches.length !== 1)) throw new Error("SEMANTIC_AUDIT_JUDGE_OBSERVATION_AMBIGUOUS");
      if (matches.length) { await dependencies.profiles.hydrate(grant,dependencies.repository.createTrustedArtifactResolver());active();result.push(matches[0]!); }
    }
    return result;
  };
}
