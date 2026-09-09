import {OperationContextSchema,UuidSchema,VerificationAdjudicationDecisionRequestSchema,VerificationAdjudicationDecisionResultSchema,VerificationAdjudicationDecisionTerminalResourceSchema,VerificationArtifactHandleSchema} from "@aiengineer/knowledge-contracts";
import type {VerificationAdjudicationReadService} from "@aiengineer/knowledge-application";
import {canonicalizeJson,digestCanonicalJson,sha256Digest,type TrustedArtifactResolver} from "@aiengineer/knowledge-verification";
import {deterministicUuid} from "@aiengineer/knowledge-runtime";
import {z} from "zod";
import type {PostgresCanonicalRepository} from "./postgres.js";
type Row=Record<string,any>;
const same=(a:unknown,b:unknown)=>canonicalizeJson(a)===canonicalizeJson(b);
const inputSchema=z.strictObject({schemaVersion:z.literal("verification-service-request.v1"),useCase:z.literal("recordAdjudicationDecision"),request:VerificationAdjudicationDecisionRequestSchema});
const durableSchema=z.strictObject({schemaVersion:z.literal("knowledge-operation-request/v1"),kind:z.literal("verification_adjudication_decision"),input:inputSchema,expectedVersions:z.record(z.string(),z.string()),authenticatedContext:OperationContextSchema});
const stepSchema=z.strictObject({schemaVersion:z.literal("knowledge-operation-request/v1"),kind:z.literal("verification_adjudication_decision"),operationInput:inputSchema,expectedVersions:z.record(z.string(),z.string()),context:OperationContextSchema,step:z.strictObject({name:z.literal("record_packet_bound_decision"),ordinal:z.literal(0)})});
const resultSchema=z.strictObject({schemaVersion:z.literal("verification-operation-result.v1"),operationId:UuidSchema,useCase:z.literal("recordAdjudicationDecision"),requestDigest:z.string(),output:VerificationAdjudicationDecisionResultSchema});
export class VerificationDecisionReadError extends Error {
 constructor(readonly code:"NOT_FOUND"|"PENDING"|"FAILED"|"CANCELLED"|"INTEGRITY",cause?:unknown){super(`VERIFICATION_DECISION_READ_${code}`,{cause});}
}
const check=(condition:unknown)=>{if(!condition)throw new VerificationDecisionReadError("INTEGRITY");};

/** Historical reads authenticate immutable evidence without requiring that a
 * reviewer grant remains live today. Caller authorization belongs outside this port. */
export class PostgresVerificationAdjudicationDecisionReadRepository {
 constructor(private readonly database:Pick<PostgresCanonicalRepository,"transaction">,private readonly resolver:()=>TrustedArtifactResolver,private readonly subjects:Pick<VerificationAdjudicationReadService,"getPendingSubject">){}
 async getDecision(input:{tenantId:string;operationId:string}){
  try{
   const tenant=UuidSchema.parse(input.tenantId),operationId=UuidSchema.parse(input.operationId);
   const snapshot=await this.snapshot(tenant,operationId);
   const {o,s,r,e,d,a,m}=snapshot;
   if(o.status!=="succeeded")throw new VerificationDecisionReadError(o.status==="failed"?"FAILED":o.status==="cancelled"?"CANCELLED":"PENDING");
   const durable=durableSchema.parse(o.request),step=stepSchema.parse(s?.input),context=durable.authenticatedContext,request=durable.input.request;
   check(s&&r&&e&&d&&a&&m);
   check(s.status==="succeeded"&&s.step_key==="record_packet_bound_decision"&&s.step_kind===s.step_key&&r.receipt_kind===`${s.step_key}.succeeded`&&r.outcome==="succeeded");
   check(s.operation_id===operationId&&r.operation_id===operationId&&r.step_id===s.id&&r.input_sha256===s.input_sha256);
   check(digestCanonicalJson(durable)===`sha256:${o.request_sha256}`&&digestCanonicalJson(step)===`sha256:${s.input_sha256}`&&same(durable.input,step.operationInput)&&same(durable.expectedVersions,step.expectedVersions)&&same(context,step.context));
   check(context.tenantId===tenant&&context.operationId===operationId&&o.actor_identity===`${context.actor.kind}:${context.actor.id}`&&o.attempt_id===context.attemptId&&(o.mission_id??undefined)===context.missionId&&(o.work_item_id??undefined)===context.workItemId&&o.idempotency_key===context.idempotencyKey);
   const dbUuid=(kind:string,value:string)=>UuidSchema.safeParse(value).success?value:deterministicUuid(kind,value);
   check(o.correlation_id===dbUuid("correlation",context.correlationId)&&(o.causation_id??undefined)===(context.causationId?dbUuid("causation",context.causationId):undefined));
   check(o.ownership_mode===(context.externalExecution?.runtime==="eve"?"eve":context.externalExecution?.runtime==="mission_control"?"mission_control":"standalone")&&(o.external_run_id??undefined)===context.externalExecution?.runId);
   check(snapshot.ownership_chain_valid===Boolean(context.workItemId&&context.missionId));
   const {eventId,fencingToken,...raw}=r.body??{},result=resultSchema.parse(raw),fence=Number(fencingToken);
   check(Number.isSafeInteger(fence)&&fence>0&&e.id===eventId&&e.operation_id===operationId&&e.step_id===s.id&&e.event_kind==="step.succeeded"&&e.from_state==="running"&&e.to_state==="succeeded"&&e.guarded_sha256===r.output_sha256&&same(e.payload,{outputSha256:r.output_sha256,fencingToken:String(fence)}));
   check(digestCanonicalJson(result)===`sha256:${r.output_sha256}`&&result.operationId===operationId&&result.requestDigest===digestCanonicalJson(request));
   const subject=await this.subjects.getPendingSubject({tenantId:tenant,operationId:snapshot.source_operation_id});
   check(subject.tenantId===tenant&&subject.output.subjectId===request.subjectId&&same(subject.packetArtifact,request.packetArtifact));
   const output=result.output;
   check(output.quorum.required===subject.output.reviewRequirements.quorumRequired);
   const createdAt=Date.parse(d.created_at);
   check(Number.isFinite(createdAt)&&(!subject.output.reviewRequirements.expiresAt||createdAt<Date.parse(subject.output.reviewRequirements.expiresAt)));
   check(output.subjectId===request.subjectId&&same(output.packetArtifact,request.packetArtifact)&&output.decision===request.decision);
   const expected={tenant_id:tenant,id:deterministicUuid("verification-adjudication-decision",`${operationId}:${request.subjectId}:${context.actor.id}`),subject_id:request.subjectId,decision_operation_id:operationId,decision_step_id:s.id,packet_artifact_id:request.packetArtifact.artifactId,packet_sha256:request.packetArtifact.digest.slice(7),decision_artifact_id:output.decisionArtifact.artifactId,decision_sha256:output.decisionArtifact.digest.slice(7),decision:request.decision,rationale_sha256:sha256Digest(request.rationale).slice(7),reviewer_actor_id:context.actor.id,reviewer_actor_kind:context.actor.kind,reviewer_service_identity:context.actor.kind==="service"?context.actor.serviceIdentity:null,reviewer_provenance:output.reviewerProvenance};
   for(const [key,value] of Object.entries(expected))check(d[key]===value);
   check(Number.isSafeInteger(Number(d.decision_fencing_token))&&Number(d.decision_fencing_token)>0&&Number(d.decision_fencing_token)<=fence&&UuidSchema.safeParse(d.decision_lease_token).success&&subject.output.reviewRequirements.eligibleReviewerRoles.includes(d.reviewer_role));
   check(a.id===d.decision_artifact_id&&a.sha256===d.decision_sha256&&a.artifact_type==="verification_adjudication_decision"&&a.storage_state==="available"&&a.verification_contract_version==="verification.v1"&&a.bucket_class==="ledger"&&a.producer_attempt_id===context.attemptId&&(a.mission_id??undefined)===context.missionId);
   const resolver=this.resolver();await resolver.authorizeArtifact({tenantId:tenant,artifactId:a.id,purpose:"verification_replay"});
   const loaded=await resolver.hydrateRegisteredArtifact({tenantId:tenant,artifactId:a.id}),handle=VerificationArtifactHandleSchema.parse(loaded.registration);
   const text=new TextDecoder("utf-8",{fatal:true}).decode(loaded.bytes),payload=JSON.parse(text);
   check(canonicalizeJson(payload)===text&&sha256Digest(loaded.bytes)===output.decisionArtifact.digest&&handle.artifactId===a.id&&handle.tenantId===tenant&&handle.digest===output.decisionArtifact.digest&&handle.byteLength===loaded.bytes.length&&Number(a.size_bytes)===loaded.bytes.length&&handle.objectKey===a.object_path&&handle.mediaType===a.media_type);
   const parents=[request.packetArtifact.artifactId],signature=digestCanonicalJson({kind:"verification_adjudication_decision.v1",operationId,decisionId:d.id,requestDigest:result.requestDigest,parentArtifactIds:parents});
   check(handle.mediaType==="application/vnd.aiengineer.verification-adjudication-decision+json"&&handle.producerActivityId==="verification-service:recordAdjudicationDecision"&&handle.producerVersion==="verification-service.v1"&&handle.dataClassification==="restricted"&&handle.transformationSignature===signature&&same(handle.parentArtifactIds,parents)&&same(m.parent_artifact_ids,parents));
   const human=output.reviewerProvenance==="human_origin";
   check(human?context.actor.kind==="human":context.actor.kind==="service"&&context.actor.serviceIdentity==="human_reviewer");
   const grantId=human?UuidSchema.parse(payload.reviewer?.grantId):undefined;
   if(human){const grants=await this.database.transaction(tenant,async client=>(await client.query("select id from evidence.verification_adjudication_reviewer_grant where tenant_id=$1 and id=$2 and subject_id=$3 and reviewer_actor_id=$4 and reviewer_role=$5 and created_at<=$6 and (expires_at is null or expires_at>$6)",[tenant,grantId,request.subjectId,context.actor.id,d.reviewer_role,d.created_at])).rows);check(grants.length===1);}
   check(same(payload,{schemaVersion:"verification-adjudication-decision.v1",verificationContractVersion:"verification.v1",decisionId:d.id,tenantId:tenant,operationId,sourceOperationId:subject.operationId,subjectId:request.subjectId,requestDigest:result.requestDigest,packetArtifact:request.packetArtifact,decision:request.decision,rationale:request.rationale,reviewer:{actorId:context.actor.id,actorKind:context.actor.kind,...(context.actor.kind==="service"?{serviceIdentity:context.actor.serviceIdentity}:{}),role:d.reviewer_role,provenance:output.reviewerProvenance,...(human?{grantId}:{})},originalPolicyOutcome:subject.output.originalPolicyOutcome,admissionChanged:false,humanGoldScoringEligible:false}));
   check(same(await this.snapshot(tenant,operationId),snapshot));
   return VerificationAdjudicationDecisionTerminalResourceSchema.parse({verificationContractVersion:"verification.v1",tenantId:tenant,operationId,requestDigest:result.requestDigest,output,terminalFencingToken:fence});
  }catch(error){if(error instanceof VerificationDecisionReadError)throw error;throw new VerificationDecisionReadError("INTEGRITY",error);}
 }
 private async snapshot(tenant:string,operationId:string):Promise<Row>{
  return this.database.transaction(tenant,async client=>{
   const rows=(await client.query<Row>(`select to_jsonb(o) o,to_jsonb(s) s,to_jsonb(r) r,to_jsonb(e) e,to_jsonb(d) d,to_jsonb(a) a,to_jsonb(m) m,subject.request_operation_id source_operation_id,
    exists(select 1 from orchestration.attempt owned_attempt join orchestration.work_item owned_work on owned_work.tenant_id=owned_attempt.tenant_id and owned_work.id=owned_attempt.work_item_id join orchestration.mission owned_mission on owned_mission.tenant_id=owned_work.tenant_id and owned_mission.id=owned_work.mission_id where owned_attempt.tenant_id=o.tenant_id and owned_attempt.id=o.attempt_id and owned_work.id=o.work_item_id and owned_mission.id=o.mission_id) ownership_chain_valid
    from knowledge_service.operation o
    left join knowledge_service.operation_step s on s.tenant_id=o.tenant_id and s.operation_id=o.id
    left join knowledge_service.receipt r on r.tenant_id=o.tenant_id and r.operation_id=o.id and r.step_id=s.id
    left join knowledge_service.operation_event e on e.tenant_id=o.tenant_id and e.id=(r.body->>'eventId')::uuid
    left join evidence.verification_adjudication_decision d on d.tenant_id=o.tenant_id and d.decision_operation_id=o.id
    left join evidence.verification_adjudication_subject subject on subject.tenant_id=d.tenant_id and subject.id=d.subject_id
    left join orchestration.artifact a on a.tenant_id=d.tenant_id and a.id=d.decision_artifact_id
    left join orchestration.verification_artifact_metadata m on m.tenant_id=a.tenant_id and m.artifact_id=a.id
    where o.tenant_id=$1 and o.id=$2 and o.operation_kind='verification_adjudication_decision'`,[tenant,operationId])).rows;
   if(rows.length===0)throw new VerificationDecisionReadError("NOT_FOUND");check(rows.length===1);return rows[0]!;
  });
 }
}
