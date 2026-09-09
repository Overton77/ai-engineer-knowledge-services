import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { StructuredExtractionProfileAdmission, type StructuredExtractionRuntimeGrant } from "../packages/application/src/verification-structured-extraction-profile.js";
import { StructuredExtractionCapturedReplayService } from "../packages/application/src/verification-structured-extraction-replay.js";
import { VerificationAdmissionService } from "../packages/application/src/verification-admission.js";
import { AccountedVerificationProviderSink, VerificationProviderArtifactComposer } from "../packages/application/src/verification-provider.js";
import { PostgresVerificationProviderResponseCaptureStore } from "../packages/persistence/src/verification-provider-response-capture.js";
import { PostgresVerificationProviderAccounting } from "../packages/persistence/src/verification-provider-accounting.js";
import { PostgresCanonicalRepository, PostgresVerificationRepository } from "../packages/persistence/src/index.js";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { SandboxedVerificationParser, VERIFICATION_PARSER_LIMITS } from "@aiengineer/knowledge-conversion";
import { GatewayStructuredExtractionProvider, InterfazeStructuredExtractionProvider, canonicalizeJson } from "@aiengineer/knowledge-verification";

const pgUrl=process.env.POSTGRES_URL!,storageUrl=process.env.SUPABASE_URL!;
for(const [value,port]of [[pgUrl,"54322"],[storageUrl,"54321"]]){const url=new URL(value!);if(!["localhost","127.0.0.1"].includes(url.hostname)||url.port!==port)throw new Error("LOCAL_ONLY_PROOF_REQUIRED");}
const fixture=JSON.parse(await readFile(resolve("../internal/verification-structured-extraction-preparation-c6085a8a-8c56-4923-a9ed-dd09666d223d.json"),"utf8")) as {tenantId:string;createdAt:string;imageDigest:`sha256:${string}`;profiles:{providerId:string;grant:StructuredExtractionRuntimeGrant;request:unknown}[]};
const tenantId=fixture.tenantId,namespace=randomUUID(),operations:string[]=[],results:unknown[]=[],checks:Record<string,boolean>={};
const database=new PostgresCanonicalRepository({connectionString:pgUrl,localOnly:true});
const repository=new PostgresVerificationRepository(database,new SupabaseArtifactStore({projectUrl:storageUrl,serviceRoleKey:process.env.SUPABASE_SECRET_KEY!,bucket:"ai-engineer-cloud-bucket",maximumBytes:8_000_000}),{async authorize(v){assert.equal(v.tenantId,tenantId);assert.equal(v.purpose,"verification_admission");}});
const native=new VerificationAdmissionService(repository,new SandboxedVerificationParser(fixture.imageDigest),{parserVersion:"verification-native-parser.v1",imageDigest:fixture.imageDigest,limits:VERIFICATION_PARSER_LIMITS},{storageBucket:"ai-engineer-cloud-bucket",producerVersion:"structured-extraction-proof.v1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",now:()=>fixture.createdAt});
const captures=new PostgresVerificationProviderResponseCaptureStore(database);let initialSyntheticFetches=0;
try{
 for(const selected of fixture.profiles){
  const admission=new StructuredExtractionProfileAdmission([selected.grant],()=>repository.createTrustedArtifactResolver(),native),preparation=await admission.prepare({tenantId,request:selected.request});
  const replay=new StructuredExtractionCapturedReplayService(admission,()=>repository.createTrustedArtifactResolver());
  for(const scenario of ["success","schema_failure","http_failure","wire_drift"] as const){
   const operationId=randomUUID(),providerAttemptId=randomUUID();operations.push(operationId);
   await database.createOperation({id:operationId,tenantId,operationKind:"verification_structured_extraction",idempotencyKey:`${namespace}-${providerAttemptId}`,correlationId:namespace,actorIdentity:"structured-extraction-replay-proof",request:{scenario},steps:[{id:randomUUID(),key:"extract_and_register",kind:"extract_and_register",input:{scenario},maxAttempts:3}]});
   const lease=await database.claimOperation(tenantId,operationId,namespace,300_000);assert.ok(lease);
   const gateway=selected.providerId==="gateway-structured-extraction.v1";
   const composer=new VerificationProviderArtifactComposer(repository,{tenantId,storageBucket:"ai-engineer-cloud-bucket",producerActivityId:"structured-replay-provider",producerVersion:"v1",encryptionClass:"managed",retentionClass:"proof",now:()=>fixture.createdAt,externalProcessingGrant:{providerId:gateway?"gateway":"interfaze",dataClassification:"synthetic",modalities:["text"],...(gateway?{}:{zdrPolicy:"required" as const})},transportResponse:{binding:{tenantId,operationId,operationStepId:lease.id,providerAttemptId,profileArtifactId:selected.grant.producerProfile.artifactId,profileDigest:selected.grant.producerProfile.digest,dispatchFencingToken:lease.fencingToken},async record(input){await captures.store({lease,...input});}}});
   await composer.registerInput(new TextEncoder().encode(preparation.prompt),"text/plain");
   const accounting=new PostgresVerificationProviderAccounting(database,{lease,profileArtifactId:selected.grant.producerProfile.artifactId,profileDigest:selected.grant.producerProfile.digest as `sha256:${string}`});
   const sink=new AccountedVerificationProviderSink(composer,accounting,{tenantId,...preparation.producerProfile.budget},{attemptId:providerAttemptId,providerId:selected.providerId,model:preparation.provider.model,reservationCostMicros:100});
   const status=scenario==="http_failure"?503:200;
   const precontext=gateway?[]:[{name:"scraper",result:{selected:"Exact value 42"}}];
   const raw=JSON.stringify({model:preparation.provider.model,choices:[{message:{content:JSON.stringify((scenario==="success"||scenario==="wire_drift")?{value:"Exact value 42"}:{extra:true})}}],precontext,usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15,cost:0.00001}});
   const options={apiKey:"synthetic",artifactSink:sink,fetch:async()=>{initialSyntheticFetches++;return new Response(raw,{status});}};
   const adapter=gateway?new GatewayStructuredExtractionProvider(options):new InterfazeStructuredExtractionProvider(options);
   let expectedOutput:unknown,expectedFailure:string|undefined;
   try{expectedOutput=(await adapter.extract({prompt:preparation.prompt+(scenario==="wire_drift"?" Unexpected additional instruction.":""),schemaName:"structured_extraction",schema:preparation.schema.canonicalSchema,execution:{}})).output;assert.ok(scenario==="success"||scenario==="wire_drift");}catch(error){expectedFailure=(error as {code?:string}).code;assert.equal(expectedFailure,scenario==="schema_failure"?"PROVIDER_RESPONSE_SCHEMA_INVALID":"PROVIDER_HTTP_FAILURE");}
   await sink.settleOrRetain((scenario==="success"||scenario==="wire_drift")?{costMicros:10}:{});
   const capture=await captures.readForRecovery({lease,providerAttemptId});assert.ok(capture);
   const before=await database.transaction(tenantId,async c=>(await c.query("select state,actual_cost_micros,response_artifact_id from orchestration.verification_provider_attempt where tenant_id=$1 and id=$2",[tenantId,providerAttemptId])).rows[0]);
   if(scenario==="wire_drift"){
    await assert.rejects(replay.replay({tenantId,request:selected.request,preparation,capture}),/STRUCTURED_EXTRACTION_REPLAY_WIRE_DRIFT/);
    checks[`${selected.providerId}_wire_drift_before_memory_fetch`]=true;results.push({providerId:selected.providerId,scenario,capture,rejection:"STRUCTURED_EXTRACTION_REPLAY_WIRE_DRIFT"});continue;
   }
   const result=await replay.replay({tenantId,request:selected.request,preparation,capture});
   assert.equal(result.memoryFetches,1);assert.equal(result.externalRequests,0);
   if(result.kind==="accepted"){assert.equal(scenario,"success");assert.deepEqual(result.output,expectedOutput);assert.equal(result.outputVerification,"unverified_candidate");}else{assert.equal(result.code,expectedFailure);assert.equal(result.automaticRetry,false);}
   if(!gateway&&scenario==="success")assert.ok(result.precontextBytes?.byteLength);
   if(scenario!=="success")assert.equal(result.precontextBytes,null);
   assert.deepEqual(await database.transaction(tenantId,async c=>(await c.query("select state,actual_cost_micros,response_artifact_id from orchestration.verification_provider_attempt where tenant_id=$1 and id=$2",[tenantId,providerAttemptId])).rows[0]),before);
   checks[`${selected.providerId}_${scenario}_exact_replay`]=true;
   await assert.rejects(replay.replay({tenantId,request:selected.request,preparation,capture:{...capture,httpStatus:status===200?503:200}}),/TRANSPORT_BINDING/);
   await assert.rejects(replay.replay({tenantId,request:selected.request,preparation:structuredClone(preparation),capture}),/PREPARATION_UNTRUSTED/);
   const controller=new AbortController();controller.abort();await assert.rejects(replay.replay({tenantId,request:selected.request,preparation,capture,signal:controller.signal}),/REPLAY_CANCELLED/);
   const tampered=new StructuredExtractionCapturedReplayService(admission,()=>{const resolver=repository.createTrustedArtifactResolver();return{authorizeArtifact:resolver.authorizeArtifact,async hydrateRegisteredArtifact(v){const loaded=await resolver.hydrateRegisteredArtifact(v);if(v.artifactId===capture.responseEnvelopeArtifactId)return{...loaded,bytes:new TextEncoder().encode("{}")};return loaded;}};});
   await assert.rejects(tampered.replay({tenantId,request:selected.request,preparation,capture}),/REPLAY_ARTIFACT/);checks[`${selected.providerId}_${scenario}_custody_negatives`]=true;
   results.push({providerId:selected.providerId,scenario,capture,result:{...result,precontextBytes:undefined,precontextDigest:result.precontextBytes?createHash("sha256").update(result.precontextBytes).digest("hex"):null},expectedFailure});
  }
 }
 assert.equal(initialSyntheticFetches,8);
 const paths=["packages/application/src/verification-structured-extraction-profile.ts","packages/application/src/verification-structured-extraction-replay.ts","packages/application/src/verification-provider-transport.ts","scripts/prove-verification-structured-extraction-replay.ts"];
 const sources=await Promise.all(paths.map(async path=>({path,sha256:createHash("sha256").update(await readFile(path)).digest("hex")})));
 const output=resolve("../internal",`verification-structured-extraction-replay-${namespace}.json`);
 await writeFile(output,JSON.stringify({passed:true,scope:"real registered native projection/profile admission and actual Gateway/Interfaze captured-byte adapter replay; synthetic original transport; no supplier calls",tenantId,fixture:"verification-structured-extraction-preparation-c6085a8a-8c56-4923-a9ed-dd09666d223d.json",initialSyntheticFetches,externalProviderRequests:0,checks,results,sources},null,2),{flag:"wx"});console.log(JSON.stringify({passed:true,output,scenarios:results.length}));
}finally{for(const id of operations)await database.cancelOperation(tenantId,id,{actorIdentity:namespace,correlationId:namespace});await database.close();}
