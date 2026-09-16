import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgresCanonicalRepository, PostgresVerificationRepository } from "../packages/persistence/src/index.js";
import { PostgresVerificationProviderAccounting } from "../packages/persistence/src/verification-provider-accounting.js";
import { PostgresVerificationProviderResponseCaptureStore } from "../packages/persistence/src/verification-provider-response-capture.js";
import { SupabaseArtifactStore } from "../packages/runtime/src/artifacts.js";
import { AccountedVerificationProviderSink, VerificationProviderArtifactComposer } from "../packages/application/src/verification/operations/verification-provider.js";
import { GatewayStructuredExtractionProvider } from "../packages/verification/src/providers/gateway.js";
import { canonicalizeJson } from "../packages/verification/src/index.js";
import type { VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import type { VerificationProviderTransportResponse } from "../packages/application/src/verification/operations/verification-provider-transport.js";

const pgUrl=process.env.POSTGRES_URL!,storageUrl=process.env.SUPABASE_URL!;
for(const [value,port]of [[pgUrl,"54322"],[storageUrl,"54321"]]){const url=new URL(value!);if(!["localhost","127.0.0.1"].includes(url.hostname)||url.port!==port)throw new Error("LOCAL_ONLY_PROOF_REQUIRED");}
const tenantId=randomUUID(),namespace=randomUUID(),actorIdentity="provider-response-capture-proof",now=new Date().toISOString(),operations:string[]=[],checks:Record<string,boolean>={};
const database=new PostgresCanonicalRepository({connectionString:pgUrl,localOnly:true});
const repository=new PostgresVerificationRepository(database,new SupabaseArtifactStore({projectUrl:storageUrl,serviceRoleKey:process.env.SUPABASE_SECRET_KEY!,bucket:"ai-engineer-cloud-bucket",maximumBytes:200_000}),{async authorize(input){assert.equal(input.tenantId,tenantId);}});
const store=new PostgresVerificationProviderResponseCaptureStore(database),encode=(value:unknown)=>new TextEncoder().encode(canonicalizeJson(value));
const results:unknown[]=[],budgetId=randomUUID();let syntheticFetches=0;
try{
 const profile=await repository.registerContentAddressedArtifact({tenantId,bytes:encode({namespace,scope:"synthetic transport proof profile, not production extraction admission"}),mediaType:"application/json",artifactType:"verification_structured_extraction_profile",bucketClass:"ledger",storageBucket:"ai-engineer-cloud-bucket",createdAt:now,producerActivityId:actorIdentity,producerVersion:"v1",encryptionClass:"managed",retentionClass:"proof",dataClassification:"restricted"});
 for(const scenario of ["success","schema_rejection","http_failure"] as const){
  const operationId=randomUUID(),providerAttemptId=randomUUID();operations.push(operationId);
  await database.createOperation({id:operationId,tenantId,operationKind:"verification_structured_extraction",idempotencyKey:`${namespace}-${scenario}`,correlationId:namespace,actorIdentity,request:{scenario,namespace},steps:[{id:randomUUID(),key:"extract_and_register",kind:"extract_and_register",input:{scenario},maxAttempts:4}]});
  const lease=await database.claimOperation(tenantId,operationId,actorIdentity,300_000);assert.ok(lease);
  let recorded:{response:VerificationProviderTransportResponse;artifact:VerificationArtifactHandle}|undefined;
  const composer=new VerificationProviderArtifactComposer(repository,{tenantId,storageBucket:"ai-engineer-cloud-bucket",producerActivityId:actorIdentity,producerVersion:"v1",encryptionClass:"managed",retentionClass:"proof",now:()=>now,externalProcessingGrant:{providerId:"gateway",dataClassification:"synthetic",modalities:["text"]},transportResponse:{binding:{tenantId,operationId,operationStepId:lease.id,providerAttemptId,profileArtifactId:profile.artifactId,profileDigest:profile.digest,dispatchFencingToken:lease.fencingToken},async record(input){
   await assert.rejects(database.transaction(tenantId,async c=>{
    await c.query("select set_config('verification.provider_claim',$1,true)",[JSON.stringify({stepId:lease.id,leaseToken:lease.leaseToken,fencingToken:lease.fencingToken,holderIdentity:lease.holderIdentity})]);
    return c.query("insert into orchestration.verification_provider_response_capture(tenant_id,provider_attempt_id,operation_id,operation_step_id,profile_artifact_id,profile_sha256,dispatch_fencing_token,http_status,response_envelope_artifact_id,transport_artifact_id,transport_sha256) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",[tenantId,providerAttemptId,operationId,lease.id,profile.artifactId,profile.digest.slice(7),lease.fencingToken,input.response.httpStatus===200?503:200,input.response.responseEnvelope.artifactId,input.artifact.artifactId,input.artifact.digest.slice(7)]);
   }),/semantic binding mismatch/);
   checks[`${scenario}_sql_status_substitution_rejected`]=true;
   await store.store({lease,...input});recorded=input;
  }}});
  await composer.registerInput(encode({namespace,synthetic:true}),"application/json");
  const accounting=new PostgresVerificationProviderAccounting(database,{lease,profileArtifactId:profile.artifactId,profileDigest:profile.digest as `sha256:${string}`});
  const sink=new AccountedVerificationProviderSink(composer,accounting,{tenantId,budgetId,budgetKey:"response-capture-proof",ceilingCostMicros:1000},{attemptId:providerAttemptId,providerId:"gateway-structured-extraction.v1",model:"openai/gpt-5.6-luna",reservationCostMicros:100});
  const schema={type:"object",description:"Synthetic field.",properties:{value:{type:"string",description:"Exact field.",maxLength:20}},required:["value"],additionalProperties:false};
  const status=scenario==="http_failure"?503:200;
  const raw=JSON.stringify({model:"openai/gpt-5.6-luna",choices:[{message:{content:JSON.stringify(scenario==="success"?{value:"synthetic"}:{wrong:"field"})}}],usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13,cost:0.00001},status:200});
  const provider=new GatewayStructuredExtractionProvider({apiKey:"synthetic-proof-key",artifactSink:sink,fetch:async()=>{syntheticFetches++;return new Response(raw,{status});}});
  let output:unknown,failureCode:string|undefined;
  try{output=(await provider.extract({prompt:"Extract the synthetic field.",schemaName:"synthetic",schema,execution:{}})).output;assert.equal(scenario,"success");}catch(error){failureCode=(error as {code?:string}).code;assert.equal(failureCode,scenario==="schema_rejection"?"PROVIDER_RESPONSE_SCHEMA_INVALID":"PROVIDER_HTTP_FAILURE");}
  assert.ok(recorded);assert.equal(recorded.response.httpStatus,status);
  const capture=await store.readForRecovery({lease,providerAttemptId});assert.ok(capture);assert.equal(capture.httpStatus,status);
  const retry=await store.store({lease,...recorded});assert.deepEqual(retry,capture);checks[`${scenario}_retained_before_interpretation`]=true;
  await assert.rejects(store.store({lease,...recorded,response:{...recorded.response,httpStatus:status===200?503:200}}),/TRANSPORT_ARTIFACT/);checks[`${scenario}_changed_status_rejected`]=true;
  await assert.rejects(store.readForRecovery({lease:{...lease,leaseToken:randomUUID()},providerAttemptId}),/STALE_LEASE/);
  await sink.settleOrRetain(scenario==="success"?{costMicros:10}:{});
  assert.equal((await accounting.claimDispatch({tenantId,attemptId:providerAttemptId,dispatchFence:randomUUID()})).claimed,false);
  // Shorten only through the production heartbeat, then wait for natural expiry.
  const expiring=await database.heartbeat(tenantId,lease,600);
  await new Promise(resolve=>setTimeout(resolve,800));
  const replacement=await database.claimOperation(tenantId,operationId,`${actorIdentity}-replacement`,300_000);assert.ok(replacement);assert.ok(replacement.fencingToken>expiring.fencingToken);
  assert.deepEqual(await store.readForRecovery({lease:replacement,providerAttemptId}),capture);
  assert.deepEqual(await store.store({lease:replacement,...recorded}),capture);checks[`${scenario}_replacement_retains_capture`]=true;
  await assert.rejects(store.readForRecovery({lease,providerAttemptId}),/STALE_LEASE/);
  await assert.rejects(database.transaction(tenantId,c=>c.query("update orchestration.verification_provider_response_capture set http_status=418 where tenant_id=$1 and provider_attempt_id=$2",[tenantId,providerAttemptId])),/append-only/);
  await assert.rejects(database.transaction(tenantId,c=>c.query("delete from orchestration.verification_provider_response_capture where tenant_id=$1 and provider_attempt_id=$2",[tenantId,providerAttemptId])),/append-only/);
  results.push({scenario,operationId,providerAttemptId,httpStatus:status,failureCode,output,outputVerification:"unverified synthetic candidate",capture,transportArtifact:recorded.artifact,response:recorded.response,originalFence:lease.fencingToken,replacementFence:replacement.fencingToken});
 }
 assert.equal(syntheticFetches,3);checks.no_adapter_redispatch_on_recovery=true;
 const rows=await database.transaction(tenantId,async c=>({captures:(await c.query("select * from orchestration.verification_provider_response_capture where tenant_id=$1 order by provider_attempt_id",[tenantId])).rows,budget:(await c.query("select reserved_cost_micros,settled_cost_micros from orchestration.verification_provider_budget where tenant_id=$1 and id=$2",[tenantId,budgetId])).rows[0]}));
 assert.equal(rows.captures.length,3);assert.equal(Number(rows.budget!.reserved_cost_micros),200);assert.equal(Number(rows.budget!.settled_cost_micros),10);
 const paths=["packages/application/src/verification/operations/verification-provider.ts","packages/application/src/verification/operations/verification-provider-transport.ts","packages/persistence/src/verification-provider-response-capture.ts","packages/verification/src/providers/gateway.ts","packages/verification/src/providers/interfaze.ts","../ai-engineer-db-contract/supabase/migrations/20260906031400_verification_provider_response_capture.sql","scripts/prove-verification-provider-response-capture.ts"];
 const sources=await Promise.all(paths.map(async path=>({path,sha256:createHash("sha256").update(await readFile(path)).digest("hex")})));
 const output=resolve("../internal",`verification-provider-response-capture-${namespace}.json`);
 await writeFile(output,JSON.stringify({passed:true,schemaVersion:"verification-provider-response-capture-proof.v1",scope:"actual Gateway adapter and local canonical PostgreSQL/Storage; injected synthetic HTTP responses; no supplier calls or charges",tenantId,budgetId,syntheticFetches,externalProviderRequests:0,checks,results,rows,sources},null,2),{flag:"wx"});console.log(JSON.stringify({passed:true,output,scenarios:results.length,checks:Object.keys(checks).length}));
}finally{for(const id of operations)await database.cancelOperation(tenantId,id,{actorIdentity,correlationId:namespace});await database.close();}
