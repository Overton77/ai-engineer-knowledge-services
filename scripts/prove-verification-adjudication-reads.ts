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
const nativePath=resolve("../internal/verification-adjudication-worker-ad8630a5-5fce-4041-8218-42a581215198.json");
const native=JSON.parse(await readFile(nativePath,"utf8"));
assert.equal(createHash("sha256").update(await readFile(nativePath)).digest("hex"),"ac0107dcb3226f2b3f603711c19e05651cfc4f4ef3495fbcd9644b176a1a4894");
const url=new URL(local.DB_URL);url.searchParams.set("options","-c default_transaction_read_only=on");
const database=new PostgresCanonicalRepository({connectionString:url.toString(),localOnly:true});
const counts=()=>database.transaction(tenantId,async client=>{assert.equal((await client.query<any>("show transaction_read_only")).rows[0].transaction_read_only,"on");return(await client.query<any>("select (select count(*)::int from knowledge_service.operation where tenant_id=$1) operations,(select count(*)::int from orchestration.artifact where tenant_id=$1) artifacts,(select count(*)::int from evidence.verification_adjudication_subject where tenant_id=$1) subjects",[tenantId])).rows[0];});
try{const before=await counts();
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
 const results=[];
 for(const item of native.results){
   const result=VerificationAdjudicationTerminalResourceSchema.parse(await service.getPendingSubject({tenantId,operationId:item.operationId}));
   assert.equal(result.output.status,"pending_human_adjudication");assert.equal(result.output.humanDecisionRecorded,false);assert.equal(result.output.admissionChanged,false);assert.equal(result.output.source.runKind,item.kind);
   for(const forbidden of ["objectKey","requesterActor","requesterNote","BEGIN PUBLIC KEY","storageBucket"]){assert.equal(JSON.stringify(result).includes(forbidden),false);}
   results.push({operationId:item.operationId,kind:item.kind,subjectId:result.output.subjectId,packetArtifact:result.packetArtifact,fence:result.output.proof.terminalFencingToken});
 }
 await assert.rejects(service.getPendingSubject({tenantId,operationId:native.cancelledOperationId}),{code:"CANCELLED"});
 await assert.rejects(service.getPendingSubject({tenantId,operationId:native.deniedOperationId}),{code:"NOT_FOUND"});
 await assert.rejects(service.getPendingSubject({tenantId:randomUUID(),operationId:native.results[0].operationId}),{code:"NOT_FOUND"});
 const hostileChecks=[];
 const mutations=[
  ["subject_future_fence",(r:any)=>{r.subject_row.request_fencing_token=Number(r.body.fencingToken)+1;}],
  ["subject_reason_drift",(r:any)=>{r.subject_row.reason="tampered";}],
  ["native_ownership_drift",(r:any)=>{r.ownership_chain_valid=false;}],
  ["packet_metadata_drift",(r:any)=>{r.packet_metadata_row.encryption_class="tampered";}],
  ["event_fence_drift",(r:any)=>{r.event_payload.fencingToken="999999";}],
 ] as const;
 for(const [name,mutate] of mutations){
  const proxy={async transaction(tenant:string,fn:any){return database.transaction(tenant,async(client:any)=>fn({async query(sql:string,args:any){const result=await client.query(sql,args);if(sql.includes("subject_row")){for(const r of result.rows)mutate(r);}return result;}}));}};
  const hostile=new PostgresVerificationAdjudicationReadRepository(proxy as any,()=>repository.createTrustedArtifactResolver(),replay);
  await assert.rejects(hostile.loadVerifiedAdjudication(tenantId,native.results[0].operationId),{code:"INTEGRITY"});hostileChecks.push(name);
 }
 const hung=new PostgresVerificationAdjudicationReadRepository(database,()=>repository.createTrustedArtifactResolver(),{replayPacket:()=>new Promise(()=>{})},{maximumReplayMs:100});
 const begun=Date.now();await assert.rejects(hung.loadVerifiedAdjudication(tenantId,native.results[0].operationId),{code:"INTEGRITY"});assert.ok(Date.now()-begun<5000);hostileChecks.push("noncooperative_replay_deadline");
 const after=await counts();assert.deepEqual(after,before);
 const paths=["packages/contracts/src/verification/adjudication-reads.ts","packages/application/src/verification-adjudication-reads.ts","packages/persistence/src/verification-adjudication-reads.ts","scripts/prove-verification-adjudication-reads.ts"];
 const sourceFiles=await Promise.all(paths.map(async path=>({path,sha256:createHash("sha256").update(await readFile(path)).digest("hex")})));
 const out=resolve("../internal",`verification-adjudication-native-reads-${randomUUID()}.json`);
 const receipt={schemaVersion:"verification-adjudication-native-reads-proof.v1",nativeProof:{path:nativePath,sha256:createHash("sha256").update(await readFile(nativePath)).digest("hex")},readOnly:true,results,hostileChecks,unchangedCounts:after,sourceFiles,limitations:["Repository and sanitized service only; public actor-authorized transport tested separately","Existing retained run targets; no human decision or admission mutation"]};
 await writeFile(out,JSON.stringify(receipt,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({out,sha256:createHash("sha256").update(await readFile(out)).digest("hex"),results:results.length,hostileChecks:hostileChecks.length}));
}finally{await database.close();}
