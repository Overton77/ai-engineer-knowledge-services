import {PostgresKnowledgeOperationService} from "@aiengineer/knowledge-persistence";
import {CanonicalActivityRegistry,createCanonicalActivityExecutor} from "../apps/worker/src/activity-registry.js";
import {CanonicalDurableKnowledgeWorker} from "../apps/worker/src/canonical-worker.js";
import {createVerificationAdjudicationDecisionHandler} from "../apps/worker/src/verification-adjudication-decision-runtime.js";
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {VerificationClaimsOperationResultSchema,VerificationReportOperationResultSchema,VerificationAdjudicationTerminalResourceSchema,type VerificationArtifactHandle} from "@aiengineer/knowledge-contracts";
import {VerificationAdmissionService,VerificationAuditInspectionGrantCatalog,VerificationClaimsProjectionGrantCatalog,VerificationAdjudicationReadService} from "@aiengineer/knowledge-application";
import {VERIFICATION_PARSER_LIMITS} from "@aiengineer/knowledge-conversion";
import {PostgresCanonicalRepository,PostgresVerificationRepository,PostgresVerificationAdjudicationReadRepository} from "@aiengineer/knowledge-persistence";
import {SupabaseArtifactStore} from "@aiengineer/knowledge-runtime";
import {canonicalizeJson,digestCanonicalJson} from "@aiengineer/knowledge-verification";
import {createVerificationAdjudicationRequestService} from "../apps/worker/src/verification-adjudication-runtime.js";
const proofPath=resolve(process.argv[2]??"../internal/verification-claims-report-worker-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json");
const proof=JSON.parse(await readFile(proofPath,"utf8")) as {namespace:string;tenantId:string;publicKeyPem:string;projection:{captureId:string;projectionArtifact:VerificationArtifactHandle;transformationArtifact:VerificationArtifactHandle};results:{claimsRecovery:{operationId:string;runId:string;manifestArtifact:VerificationArtifactHandle};reportRecovery:{operationId:string;runId:string;manifestArtifact:VerificationArtifactHandle}}};
const fixture=JSON.parse(await readFile(resolve("../internal/verification-frozen-source-registry-7a74a7a8-0dc4-4591-8bb1-5781ebddef42.json"),"utf8")) as {records:readonly{captureId:string;projections:readonly[{sourceArtifact:VerificationArtifactHandle;projectionArtifact:VerificationArtifactHandle;transformationArtifact:VerificationArtifactHandle;parserVersion:string;imageDigest:`sha256:${string}`}]}[]};
const nativeProjection=fixture.records.find(item=>item.captureId===proof.projection.captureId)?.projections[0];assert.ok(nativeProjection);assert.equal(digestCanonicalJson(nativeProjection.projectionArtifact),digestCanonicalJson(proof.projection.projectionArtifact));
// @ts-expect-error reviewed local-only helper intentionally lives outside the package graph.
const {loadVerifiedLocalDevelopmentConfig}=await import("../../internal/verification-local-direct-config.mjs") as {loadVerifiedLocalDevelopmentConfig():Promise<{DB_URL:string;API_URL:string;SECRET_KEY:string}>};
const local=await loadVerifiedLocalDevelopmentConfig();for(const [value,port] of [[local.DB_URL,"54322"],[local.API_URL,"54321"]] as const){const url=new URL(value);if(!["localhost","127.0.0.1"].includes(url.hostname)||url.port!==port)throw new Error("LOCAL_ONLY_AUDIT_PROOF_REQUIRED");}
const tenantId=proof.tenantId,bucket="ai-engineer-cloud-bucket",kinds=["claims","report"] as const;
const nativePath=resolve("../internal/verification-adjudication-worker-46b38b61-da1f-454d-8ca8-2be87b887f1b.json");
const native=JSON.parse(await readFile(nativePath,"utf8"));
const url=new URL(local.DB_URL);
const database=new PostgresCanonicalRepository({connectionString:url.toString(),localOnly:true});
try{
  const artifacts=new SupabaseArtifactStore({projectUrl:local.API_URL,serviceRoleKey:local.SECRET_KEY,bucket,maximumBytes:32_000_000});

  const repository=new PostgresVerificationRepository(database,artifacts,{async authorize(input){assert.equal(input.tenantId,tenantId);assert.ok(["verification_admission","verification_replay","policy_replay"].includes(input.purpose));}});
  const admission=new VerificationAdmissionService(repository,{async parse():Promise<never>{throw new Error("PARSER_FORBIDDEN_IN_AUDIT_PUBLIC_PROOF");}},{parserVersion:nativeProjection.parserVersion as "verification-native-parser.v1",imageDigest:nativeProjection.imageDigest,limits:VERIFICATION_PARSER_LIMITS},{storageBucket:bucket,producerVersion:"verification-admission.v1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",now:()=>new Date().toISOString()});
  async function sourceTerminal(kind:"claims"|"report"){const entry=kind==="claims"?proof.results.claimsRecovery:proof.results.reportRecovery,receipts=await database.listReceipts(tenantId,entry.operationId);assert.equal(receipts.length,1);const {eventId:_eventId,fencingToken:_fencingToken,...body}=receipts[0]!.body as Record<string,unknown>;return kind==="claims"?VerificationClaimsOperationResultSchema.parse(body):VerificationReportOperationResultSchema.parse(body);}
  const terminals={claims:await sourceTerminal("claims"),report:await sourceTerminal("report")};
  const projectionGrants=new VerificationClaimsProjectionGrantCatalog(kinds.map(kind=>({tenantId,assertions:{artifactId:terminals[kind].output.verified.assertionsArtifact.artifactId,digest:terminals[kind].output.verified.assertionsArtifact.digest},admissions:[{captureId:proof.projection.captureId,projectionArtifactId:nativeProjection.projectionArtifact.artifactId,transformationArtifactId:nativeProjection.transformationArtifact.artifactId}]})));
  const auditGrantValues=kinds.map(kind=>{const entry=kind==="claims"?proof.results.claimsRecovery:proof.results.reportRecovery;return{tenantId,auditArtifact:{artifactId:entry.manifestArtifact.artifactId,digest:entry.manifestArtifact.digest},runKind:kind};});
  const auditGrants=new VerificationAuditInspectionGrantCatalog(auditGrantValues);
  const dependencies={database,repository,admission,projectionGrants,auditGrants,trustedPublicKeys:{[`claims-report-proof-${proof.namespace}`]:proof.publicKeyPem},storageBucket:bucket,maximumInspectionMs:30_000,now:()=>new Date().toISOString(),subjects:{async commitPendingSubject():Promise<never>{throw new Error("WRITE_FORBIDDEN_IN_READ_PROOF");}}};
  const replay={async replayPacket(input:any){return createVerificationAdjudicationRequestService({...dependencies,reviewRequirements:input.reviewRequirements}).prepare(input.request,input.context,input.signal);}};

 const readRepository=new PostgresVerificationAdjudicationReadRepository(database,()=>repository.createTrustedArtifactResolver(),replay);
 const service=new VerificationAdjudicationReadService(readRepository);
 const resume=process.env.DECISION_RECOVERY_OPERATION_ID ? await database.getOperationRecord(tenantId,process.env.DECISION_RECOVERY_OPERATION_ID) : undefined; const resumeContext=(resume?.request as any)?.authenticatedContext; const namespace=resumeContext?.correlationId??randomUUID(),operationId=resumeContext?.operationId??randomUUID(),actor=resumeContext?.actor??{kind:"service" as const,id:randomUUID(),serviceIdentity:"human_reviewer" as const};
 const selected=await service.getPendingSubject({tenantId,operationId:native.results[0].operationId});
 const parent=await database.getOperationRecord(tenantId,selected.operationId);assert.ok(parent);
 const parentContext=(parent.request as any).authenticatedContext;
 const context={...parentContext,operationId,actor,idempotencyKey:`decision-recovery-${namespace}`,correlationId:namespace,reason:"Synthetic decision recovery engineering proof"};
 const request={verificationContractVersion:"verification.v1",subjectId:selected.output.subjectId,packetArtifact:selected.packetArtifact,decision:"affirm",rationale:"Synthetic engineering review only; not human gold or admission authority."};
 const journal=resolve("../internal",`verification-decision-recovery-start-${namespace}.json`);
 if(!resume) await writeFile(journal,JSON.stringify({namespace,tenantId,operationId,subjectId:request.subjectId,provenance:"synthetic_engineering",providerCalls:0})+"\n",{flag:"wx"});
 const handler=createVerificationAdjudicationDecisionHandler({database,registrations:repository,verifiedSubjects:service,storageBucket:bucket,now:()=>new Date().toISOString(),syntheticReviewerGrants:[{tenantId,actorId:actor.id,role:selected.output.reviewRequirements.eligibleReviewerRoles[0]!}]});
 const registry=new CanonicalActivityRegistry([handler]),executor=createCanonicalActivityExecutor(database,registry);
 const operations=new PostgresKnowledgeOperationService(database,{admittedOperationKinds:["verification_adjudication_decision"]});
 await operations.submit("verification_adjudication_decision",{context,input:{schemaVersion:"verification-service-request.v1",useCase:"recordAdjudicationDecision",request},expectedVersions:{verification:"verification.v1",service:"verification-service-request.v1"}},"http://127.0.0.1");
 let interrupted:any;
 const interruptedDatabase=new Proxy(database,{get(target,property){if(property==="completeStep")return async(_tenant:string,lease:any)=>{interrupted=lease;throw new Error("SIMULATED_POST_DECISION_STOP");};if(property==="failStep")return async()=>{throw new Error("SIMULATED_STOP_PREVENTS_CLEANUP");};const value=Reflect.get(target,property,target);return typeof value==="function"?value.bind(target):value;}});
 const first=new CanonicalDurableKnowledgeWorker(`decision-stop-${namespace}`,tenantId,interruptedDatabase,executor,30000,registry.operationKinds());
 await assert.rejects(first.runOperationOnce(operationId),/SIMULATED_POST_DECISION_STOP/);assert.ok(interrupted);
 const rows=()=>database.transaction(tenantId,async client=>(await client.query("select * from evidence.verification_adjudication_decision where tenant_id=$1 and decision_operation_id=$2",[tenantId,operationId])).rows);
 const before=await rows();assert.equal(before.length,1);assert.equal((await database.listReceipts(tenantId,operationId)).length,0);
 // Simulate lease abandonment, without changing its token or bypassing guards.
 await database.transaction(tenantId,client=>client.query("update knowledge_service.lease set released_at=clock_timestamp() where tenant_id=$1 and operation_step_id=$2 and lease_token=$3",[tenantId,interrupted.id,interrupted.leaseToken]));
 const worker=new CanonicalDurableKnowledgeWorker(`decision-recovery-${namespace}`,tenantId,database,executor,30000,registry.operationKinds());
 assert.ok(await worker.runOperationOnce(operationId));assert.equal((await database.getOperation(tenantId,operationId))?.status,"succeeded");
 assert.deepEqual(await rows(),before);
 const receipts=await database.listReceipts(tenantId,operationId);assert.equal(receipts.length,1);const body=receipts[0]!.body as any;assert.ok(body.fencingToken>interrupted.fencingToken);
 assert.equal(body.output.quorum.reached,false);assert.equal(body.output.admissionChanged,false);assert.equal(body.output.reviewerProvenance,"synthetic_engineering");
 const resolver=repository.createTrustedArtifactResolver();await resolver.authorizeArtifact({tenantId,artifactId:body.output.decisionArtifact.artifactId,purpose:"verification_replay"});
 const loaded=await resolver.hydrateRegisteredArtifact({tenantId,artifactId:body.output.decisionArtifact.artifactId});
 const decision=JSON.parse(new TextDecoder().decode(loaded.bytes));assert.equal(digestCanonicalJson(decision),body.output.decisionArtifact.digest);assert.deepEqual(decision.packetArtifact,request.packetArtifact);assert.equal(decision.reviewer.provenance,"synthetic_engineering");assert.equal(decision.humanGoldScoringEligible,false);
 const output=resolve("../internal",`verification-decision-recovery-${namespace}.json`);
 await writeFile(output,JSON.stringify({namespace,tenantId,operationId,subjectId:request.subjectId,decisionId:before[0]!.id,decisionArtifact:body.output.decisionArtifact,firstFence:interrupted.fencingToken,recoveredFence:body.fencingToken,unchangedDecisionRow:true,oneTerminalReceipt:true,signedSourceReplay:true,storageBytesVerified:true,providerCalls:0,provenance:"synthetic_engineering",limitations:["Injected interruption and lease abandonment; not an OS crash","Local worker only; transport and dashboard proofs remain"]},null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({output,operationId,passed:true}));
}finally{await database.close();}

