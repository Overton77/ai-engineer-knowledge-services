import {PostgresVerificationAdjudicationDecisionReadRepository} from "../packages/persistence/src/verification-adjudication-decision-reads.js";
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
const url=new URL(local.DB_URL);url.searchParams.set("options","-c default_transaction_read_only=on");
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

 const operationId="255bfea1-57f2-4798-8705-7bb5dd1d6aa3";
 const reader=new PostgresVerificationAdjudicationDecisionReadRepository(database,()=>repository.createTrustedArtifactResolver(),service);
 const result=await reader.getDecision({tenantId,operationId});assert.equal(result.terminalFencingToken,839);assert.equal(result.output.reviewerProvenance,"synthetic_engineering");
 for(const forbidden of ["objectKey","storageBucket","rationale","reviewer_actor_id"]){assert.equal(JSON.stringify(result).includes(forbidden),false);}
 const hostile=[];
 for(const [name,mutate] of [
  ["future_decision_fence",(r:any)=>{r.d.decision_fencing_token=999999;}],
  ["changed_actor",(r:any)=>{r.d.reviewer_actor_id=randomUUID();}],
  ["wrong_receipt_event",(r:any)=>{r.e.operation_id=randomUUID();}],
  ["wrong_input_digest",(r:any)=>{r.s.input_sha256="0".repeat(64);} ],
  ["wrong_packet_parent",(r:any)=>{r.m.parent_artifact_ids=[randomUUID()];}],
  ["wrong_artifact_type",(r:any)=>{r.a.artifact_type="verification_adjudication_packet";}],
 ] as const){
  const proxy={async transaction(tenant:string,fn:any){return database.transaction(tenant,async(client:any)=>fn({async query(sql:string,args:any){const result=await client.query(sql,args);if(sql.includes("to_jsonb(o) o"))for(const row of result.rows)mutate(row);return result;}}));}};
  const bad=new PostgresVerificationAdjudicationDecisionReadRepository(proxy as any,()=>repository.createTrustedArtifactResolver(),service);
  await assert.rejects(bad.getDecision({tenantId,operationId}),{code:"INTEGRITY"});hostile.push(name);
 }
 await assert.rejects(reader.getDecision({tenantId:randomUUID(),operationId}),{code:"NOT_FOUND"});
 const output=resolve("../internal",`verification-decision-native-read-${randomUUID()}.json`);
 await writeFile(output,JSON.stringify({operationId,tenantId,result,hostile,readOnly:true,providerCalls:0,limitations:["Internal verified reader; public authorization/GET route remains"]},null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({output,passed:true,hostileChecks:hostile.length}));
}finally{await database.close();}
