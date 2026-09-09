import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { StructuredExtractionProfileAdmission, type StructuredExtractionRuntimeGrant } from "../packages/application/src/verification-structured-extraction-profile.js";
import { StructuredExtractionCapturedReplayService, type StructuredExtractionReplayCapture } from "../packages/application/src/verification-structured-extraction-replay.js";
import { StructuredExtractionCandidateBuilder } from "../packages/application/src/verification-structured-extraction-candidate.js";
import { VerificationAdmissionService } from "../packages/application/src/verification-admission.js";
import { PostgresCanonicalRepository, PostgresVerificationRepository } from "../packages/persistence/src/index.js";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { SandboxedVerificationParser, VERIFICATION_PARSER_LIMITS } from "@aiengineer/knowledge-conversion";

const pgUrl=process.env.POSTGRES_URL!,storageUrl=process.env.SUPABASE_URL!;
for(const [value,port]of [[pgUrl,"54322"],[storageUrl,"54321"]]){const url=new URL(value!);if(!["localhost","127.0.0.1"].includes(url.hostname)||url.port!==port)throw new Error("LOCAL_ONLY_PROOF_REQUIRED");}
const fixtureName="verification-structured-extraction-preparation-c6085a8a-8c56-4923-a9ed-dd09666d223d.json",sourceProof="verification-structured-extraction-replay-a465e3f1-7006-45c1-af65-ca90e2dc11d2.json";
const fixture=JSON.parse(await readFile(resolve("../internal",fixtureName),"utf8")) as {tenantId:string;attemptId:string;createdAt:string;imageDigest:`sha256:${string}`;profiles:{providerId:string;grant:StructuredExtractionRuntimeGrant;request:unknown}[]};
const recorded=JSON.parse(await readFile(resolve("../internal",sourceProof),"utf8")) as {results:{providerId:string;scenario:string;capture:StructuredExtractionReplayCapture}[]};
const tenantId=fixture.tenantId,namespace=randomUUID(),createdAt=new Date().toISOString(),checks:Record<string,boolean>={},results:unknown[]=[];
const database=new PostgresCanonicalRepository({connectionString:pgUrl,localOnly:true});
const repository=new PostgresVerificationRepository(database,new SupabaseArtifactStore({projectUrl:storageUrl,serviceRoleKey:process.env.SUPABASE_SECRET_KEY!,bucket:"ai-engineer-cloud-bucket",maximumBytes:8_000_000}),{async authorize(v){assert.equal(v.tenantId,tenantId);assert.equal(v.purpose,"verification_admission");}});
const native=new VerificationAdmissionService(repository,new SandboxedVerificationParser(fixture.imageDigest),{parserVersion:"verification-native-parser.v1",imageDigest:fixture.imageDigest,limits:VERIFICATION_PARSER_LIMITS},{storageBucket:"ai-engineer-cloud-bucket",producerVersion:"structured-extraction-proof.v1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",now:()=>fixture.createdAt});
const operationId=randomUUID();let createdOperation=false,writes=0,memoryFetches=0;
try{
 for(const selected of fixture.profiles){
  const admission=new StructuredExtractionProfileAdmission([selected.grant],()=>repository.createTrustedArtifactResolver(),native),preparation=await admission.prepare({tenantId,request:selected.request});
  const replayService=new StructuredExtractionCapturedReplayService(admission,()=>repository.createTrustedArtifactResolver());
  const builder=new StructuredExtractionCandidateBuilder(replayService,{async register(input){writes++;return repository.registerContentAddressedArtifact({...input,producerActivityId:"structured-candidate-offline-proof",producerVersion:"v1",mediaType:"application/json",encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:"restricted",bucketClass:"candidate",storageBucket:"ai-engineer-cloud-bucket"});}});
  for(const retained of recorded.results.filter(r=>r.providerId===selected.providerId&&r.scenario!=="wire_drift")){
   const capture=retained.capture;
   const before=await database.transaction(tenantId,async c=>(await c.query("select p.state,p.actual_cost_micros,p.response_artifact_id,o.status from orchestration.verification_provider_attempt p join knowledge_service.operation o on o.tenant_id=p.tenant_id and o.id=p.operation_id where p.tenant_id=$1 and p.id=$2",[tenantId,capture.providerAttemptId])).rows[0]);assert.equal(before?.status,"cancelled");
   const replay=await replayService.replay({tenantId,request:selected.request,preparation,capture});memoryFetches+=replay.memoryFetches;
   const input={tenantId,operationId:capture.operationId,providerAttemptId:capture.providerAttemptId,producerAttemptId:fixture.attemptId,createdAt:new Date(Date.parse(capture.capturedAt)+1000).toISOString(),preparation,replay};
   const priorWrites=writes;
   if(replay.kind==="failed"){
    await assert.rejects(builder.retain(input),/CANDIDATE_REPLAY_FAILED/);assert.equal(writes,priorWrites);checks[`${selected.providerId}_${retained.scenario}_no_candidate_write`]=true;
    results.push({providerId:selected.providerId,scenario:retained.scenario,code:replay.code,capture});
   }else{
    await assert.rejects(builder.retain({...input,replay:structuredClone(replay)}),/REPLAY_RESULT_UNTRUSTED/);
    await assert.rejects(builder.retain({...input,operationId:randomUUID()}),/REPLAY_RESULT_UNTRUSTED/);assert.equal(writes,priorWrites);
    const result=await builder.retain(input),again=await builder.retain(input);assert.deepEqual(again,result);assert.equal(result.status,"unverified_candidate");
    assert.equal(Boolean(result.precontextArtifact),selected.providerId==="interfaze-extraction.v1");
    checks[`${selected.providerId}_registered_candidate_exact_reuse`]=true;checks[`${selected.providerId}_untrusted_scope_rejected_before_write`]=true;
    results.push({providerId:selected.providerId,scenario:retained.scenario,capture,result});
   }
   assert.deepEqual(await database.transaction(tenantId,async c=>(await c.query("select p.state,p.actual_cost_micros,p.response_artifact_id,o.status from orchestration.verification_provider_attempt p join knowledge_service.operation o on o.tenant_id=p.tenant_id and o.id=p.operation_id where p.tenant_id=$1 and p.id=$2",[tenantId,capture.providerAttemptId])).rows[0]),before);
  }
 }
 await database.createOperation({id:operationId,tenantId,operationKind:"verification_structured_extraction",idempotencyKey:namespace,correlationId:namespace,actorIdentity:"candidate-terminal-guard-proof",request:{proof:namespace},steps:[{id:randomUUID(),key:"extract_and_register",kind:"extract_and_register",input:{proof:namespace},maxAttempts:1}]});createdOperation=true;
 const lease=await database.claimOperation(tenantId,operationId,namespace,60_000);assert.ok(lease);
 await assert.rejects(database.transaction(tenantId,async c=>{await c.query("update knowledge_service.operation_step set status='succeeded' where tenant_id=$1 and id=$2",[tenantId,lease.id]);}),/structured extraction terminal lifecycle not configured/);
 await assert.rejects(database.transaction(tenantId,async c=>{await c.query("update knowledge_service.operation set status='succeeded' where tenant_id=$1 and id=$2",[tenantId,operationId]);}),/structured extraction terminal lifecycle not configured/);
 checks.unconfigured_terminal_step_and_operation_denied=true;
 await database.cancelOperation(tenantId,operationId,{actorIdentity:namespace,correlationId:namespace});createdOperation=false;
 const paths=["packages/application/src/verification-structured-extraction-profile.ts","packages/application/src/verification-structured-extraction-replay.ts","packages/application/src/verification-structured-extraction-candidate.ts","scripts/prove-verification-structured-extraction-candidate.ts"];
 const sources=await Promise.all(paths.map(async path=>({path,sha256:createHash("sha256").update(await readFile(path)).digest("hex")})));
 const output=resolve("../internal",`verification-structured-extraction-candidate-${namespace}.json`);
 await writeFile(output,JSON.stringify({passed:true,scope:"offline candidate retention from previously cancelled synthetic-provider captures; actual local PostgreSQL and Storage; not canonical extraction completion",tenantId,fixture:fixtureName,sourceProof,createdAt,memoryFetches,externalProviderRequests:0,terminalGuardOperationId:operationId,checks,results,sources},null,2),{flag:"wx"});console.log(JSON.stringify({passed:true,output,checks:Object.keys(checks).length,memoryFetches}));
}finally{if(createdOperation)await database.cancelOperation(tenantId,operationId,{actorIdentity:namespace,correlationId:namespace});await database.close();}
