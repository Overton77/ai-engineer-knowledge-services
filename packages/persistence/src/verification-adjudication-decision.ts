import { OperationContextSchema, VerificationAdjudicationDecisionRequestSchema, VerificationAdjudicationDecisionResultSchema } from "@aiengineer/knowledge-contracts";
import type { Database } from "@aiengineer/database-contract";
import { type VerificationAdjudicationDecisionCommitPort, type VerificationAdjudicationDecisionPreparationService } from "@aiengineer/knowledge-application";
import { canonicalizeJson, digestCanonicalJson, sha256Digest } from "@aiengineer/knowledge-verification";
import { z } from "zod";
import type { PostgresCanonicalRepository, TenantSqlClient } from "./postgres.js";
import type { PostgresVerificationRepository } from "./verification.js";

type Input = Parameters<VerificationAdjudicationDecisionCommitPort["commitDecision"]>[0];
const same = (a: unknown, b: unknown) => canonicalizeJson(a) === canonicalizeJson(b);
function fail(reason: string): never { throw new Error(`VERIFICATION_ADJUDICATION_DECISION_${reason}`); }
const operationInputSchema = z.strictObject({schemaVersion:z.literal("verification-service-request.v1"),useCase:z.literal("recordAdjudicationDecision"),request:VerificationAdjudicationDecisionRequestSchema});
const durableSchema = z.strictObject({schemaVersion:z.literal("knowledge-operation-request/v1"),kind:z.literal("verification_adjudication_decision"),input:operationInputSchema,expectedVersions:z.record(z.string(),z.string().min(1)),authenticatedContext:OperationContextSchema});
const stepSchema = z.strictObject({schemaVersion:z.literal("knowledge-operation-request/v1"),kind:z.literal("verification_adjudication_decision"),operationInput:operationInputSchema,expectedVersions:z.record(z.string(),z.string().min(1)),context:OperationContextSchema,step:z.strictObject({name:z.literal("record_packet_bound_decision"),ordinal:z.literal(0)})});

/** Uses the existing fenced CAS registrar. Decision insertion and recovery are
 * serialized by the durable lease and subject locks. This never changes admission. */
export class PostgresVerificationAdjudicationDecisionRepository implements VerificationAdjudicationDecisionCommitPort {
  constructor(
    private readonly database: Pick<PostgresCanonicalRepository,"transaction">,
    private readonly registrations: Pick<PostgresVerificationRepository,"registerFencedContentAddressedArtifact">,
    private readonly preparation: Pick<VerificationAdjudicationDecisionPreparationService,"prepare">,
  ) {}

  async commitDecision(value: Input) {
    // Snapshot mutable caller buffers before any I/O, then independently recreate
    // the canonical payload with server-owned authority and verified packet reads.
    const input = structuredClone(value);
    const prepared = await this.preparation.prepare({request:input.prepared.request,context:input.prepared.context,signal:new AbortController().signal});
    const {decisionBytes: suppliedBytes, ...supplied} = input.prepared;
    const {decisionBytes, ...verified} = prepared;
    if (!same(supplied,verified) || sha256Digest(suppliedBytes)!==prepared.decisionDigest
      || suppliedBytes.length!==decisionBytes.length || !suppliedBytes.every((b,i)=>b===decisionBytes[i])) fail("PREPARATION_DRIFT");
    const {context,request,authority}=prepared;
    if (input.lease.operationId!==context.operationId || input.registration.producerAttemptId!==context.attemptId
      || input.registration.missionId!==context.missionId) fail("REGISTRATION_BINDING");
    // Validate durable request before registration as well as immediately before insert.
    await this.database.transaction(context.tenantId, client=>this.lockRequest(client,input));
    const artifact=await this.registrations.registerFencedContentAddressedArtifact({
      artifact:{tenantId:context.tenantId,bytes:decisionBytes,mediaType:"application/vnd.aiengineer.verification-adjudication-decision+json",
        createdAt:input.registration.createdAt,producerActivityId:input.registration.producerActivityId,producerVersion:input.registration.producerVersion,
        encryptionClass:input.registration.encryptionClass,retentionClass:input.registration.retentionClass,dataClassification:"restricted",
        parentArtifactIds:[...prepared.parentArtifactIds],transformationSignature:digestCanonicalJson({kind:"verification_adjudication_decision.v1",operationId:context.operationId,decisionId:prepared.decisionId,requestDigest:prepared.requestDigest,parentArtifactIds:prepared.parentArtifactIds}),
        artifactType:"verification_adjudication_decision",bucketClass:"ledger",storageBucket:input.registration.storageBucket,
        producerAttemptId:input.registration.producerAttemptId,...(input.registration.missionId?{missionId:input.registration.missionId}:{})},
      lease:{stepId:input.lease.stepId,leaseToken:input.lease.leaseToken,fencingToken:input.lease.fencingToken,holderIdentity:input.lease.holderIdentity},
    });
    if(artifact.tenantId!==context.tenantId || artifact.digest!==prepared.decisionDigest || artifact.byteLength!==decisionBytes.length
      || !same(artifact.parentArtifactIds,prepared.parentArtifactIds)) fail("ARTIFACT_BINDING");
    return this.database.transaction(context.tenantId,async client=>{
      await this.lockRequest(client,input);
      const subject=(await client.query(`select *, (expires_at is null or expires_at>clock_timestamp()) as unexpired
        from evidence.verification_adjudication_subject where tenant_id=$1 and id=$2 for update`,[context.tenantId,request.subjectId])).rows[0];
      if(!subject || subject.unexpired!==true || subject.request_operation_id!==prepared.sourceOperationId
        || subject.packet_artifact_id!==request.packetArtifact.artifactId || `sha256:${subject.packet_sha256}`!==request.packetArtifact.digest
        || !Array.isArray(subject.eligible_reviewer_roles) || !subject.eligible_reviewer_roles.includes(authority.role)) fail("SUBJECT_BINDING");
      if(authority.provenance==="human_origin"){
        const grant=(await client.query(`select id from evidence.verification_adjudication_reviewer_grant
          where tenant_id=$1 and id=$2 and subject_id=$3 and reviewer_actor_id=$4 and reviewer_role=$5
          and (expires_at is null or expires_at>clock_timestamp()) for share`,[context.tenantId,authority.grantId,request.subjectId,context.actor.id,authority.role])).rows[0];
        if(!grant) fail("AUTHORITY_EXPIRED");
      }
      const expected={id:prepared.decisionId,tenant_id:context.tenantId,subject_id:request.subjectId,decision_operation_id:context.operationId,
        decision_step_id:input.lease.stepId,packet_artifact_id:request.packetArtifact.artifactId,packet_sha256:request.packetArtifact.digest.slice(7),
        decision_artifact_id:artifact.artifactId,decision_sha256:prepared.decisionDigest.slice(7),decision:request.decision,
        rationale_sha256:prepared.rationaleDigest.slice(7),reviewer_actor_id:context.actor.id,reviewer_actor_kind:context.actor.kind,
        reviewer_service_identity:context.actor.kind==="service"?context.actor.serviceIdentity:null,reviewer_role:authority.role,reviewer_provenance:authority.provenance};
      const existing=(await client.query("select * from evidence.verification_adjudication_decision where tenant_id=$1 and decision_operation_id=$2",[context.tenantId,context.operationId])).rows[0];
      if(existing){
        for(const [key,expectedValue] of Object.entries(expected)) if(existing[key]!==expectedValue) fail("RECOVERY_DRIFT");
      }else{
        const row={...expected,decision_lease_token:input.lease.leaseToken,decision_fencing_token:input.lease.fencingToken} satisfies Database["evidence"]["Tables"]["verification_adjudication_decision"]["Insert"];
        // Columns are code-owned literals, never caller-controlled identifiers.
        const columns=Object.keys(row), values=Object.values(row);
        await client.query(`insert into evidence.verification_adjudication_decision (${columns.join(",")}) values (${columns.map((_,i)=>`$${i+1}`).join(",")})`,values);
      }
      const state=(await client.query(`select v.*, (select count(*) from evidence.verification_adjudication_decision d
        where d.tenant_id=v.tenant_id and d.subject_id=v.subject_id and d.reviewer_provenance='synthetic_engineering' and d.decision='affirm') synthetic_affirmed
        from evidence.verification_adjudication_review_state v where v.tenant_id=$1 and v.subject_id=$2`,[context.tenantId,request.subjectId])).rows[0];
      if(!state) fail("STATE_MISSING");
      return VerificationAdjudicationDecisionResultSchema.parse({schemaVersion:"verification-adjudication-decision-result.v1",subjectId:request.subjectId,
        packetArtifact:request.packetArtifact,decisionArtifact:{artifactId:artifact.artifactId,digest:artifact.digest},decision:request.decision,reviewerProvenance:authority.provenance,
        quorum:{required:Number(state.quorum_required),humanAffirmRecorded:Number(state.human_affirmed),humanRejectRecorded:Number(state.human_rejected),humanDeferRecorded:Number(state.human_deferred),syntheticAffirmRecorded:Number(state.synthetic_affirmed),reached:state.quorum_reached},admissionChanged:false,humanGoldScoringEligible:false});
    });
  }

  private async lockRequest(client:TenantSqlClient,input:Input){
    const {context,request}=input.prepared, {lease,registration}=input;
    const row=(await client.query(`select o.request,o.request_sha256,o.actor_identity,o.attempt_id,o.mission_id,s.input,s.input_sha256
      from knowledge_service.operation o join knowledge_service.operation_step s on s.tenant_id=o.tenant_id and s.operation_id=o.id
      join knowledge_service.lease l on l.tenant_id=s.tenant_id and l.operation_step_id=s.id
      where o.tenant_id=$1 and o.id=$2 and o.operation_kind='verification_adjudication_decision' and o.status='running'
      and s.id=$3 and s.step_key='record_packet_bound_decision' and s.step_kind='record_packet_bound_decision' and s.status='running'
      and l.lease_token=$4 and l.fencing_token=$5 and l.holder_identity=$6 and l.released_at is null and l.expires_at>clock_timestamp()
      for update of o,s,l`,[context.tenantId,lease.operationId,lease.stepId,lease.leaseToken,lease.fencingToken,lease.holderIdentity])).rows[0];
    if(!row) fail("STALE_LEASE");
    const durable=durableSchema.parse(row.request), step=stepSchema.parse(row.input);
    if(digestCanonicalJson(durable)!==`sha256:${row.request_sha256}` || digestCanonicalJson(step)!==`sha256:${row.input_sha256}`
      || row.input_sha256!==lease.inputSha256 || !same(durable.input,step.operationInput) || !same(durable.expectedVersions,step.expectedVersions)
      || !same(durable.authenticatedContext,step.context) || !same(durable.authenticatedContext,context) || !same(durable.input.request,request)
      || row.actor_identity!==`${context.actor.kind}:${context.actor.id}` || row.attempt_id!==registration.producerAttemptId
      || (row.mission_id??undefined)!==registration.missionId) fail("DURABLE_BINDING");
  }
}
