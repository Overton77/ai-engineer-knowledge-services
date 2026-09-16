import assert from "node:assert/strict";
import {createHash,generateKeyPairSync,randomUUID} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {VerificationOperationApplicationService} from "@aiengineer/knowledge-application";
import {VerificationBenchmarkOperationResultSchema} from "@aiengineer/knowledge-contracts";
import {PostgresCanonicalRepository,PostgresKnowledgeOperationService,PostgresVerificationRepository} from "@aiengineer/knowledge-persistence";
import {SupabaseArtifactStore} from "@aiengineer/knowledge-runtime";
import {canonicalizeJson,createEd25519Verifier,digestCanonicalJson,verifyVerificationBenchmarkPublication} from "@aiengineer/knowledge-verification";
import {createConfiguredVerificationBenchmarkHandler} from "../apps/worker/src/verification-benchmark-runtime.js";
import {CanonicalActivityRegistry,createCanonicalActivityExecutor} from "../apps/worker/src/activity-registry.js";
import {CanonicalDurableKnowledgeWorker} from "../apps/worker/src/canonical-worker.js";

const postgres=process.env.POSTGRES_URL!,projectUrl=process.env.SUPABASE_URL!,key=process.env.SUPABASE_SECRET_KEY!;
for(const [value,port] of [[postgres,"54322"],[projectUrl,"54321"]]){const url=new URL(value!);assert.ok(["localhost","127.0.0.1"].includes(url.hostname)&&url.port===port,"LOCAL_SERVICES_REQUIRED");}
assert.ok(key);
const originalFetch=globalThis.fetch;let attemptedExternalRequests=0;
globalThis.fetch=async(input,init)=>{const target=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);if(!["localhost","127.0.0.1"].includes(target.hostname)){attemptedExternalRequests++;throw new Error("FULL_REPLAY_EXTERNAL_FETCH_DENIED");}return originalFetch(input,init);};
const internal=resolve("../internal"),preparationName="verification-full-retained-replay-preparation-7156f117-fc95-4270-9b96-ad9574d3b3f7.json";
const fixture=JSON.parse(await readFile(resolve(internal,preparationName),"utf8")),priorPublication=JSON.parse(await readFile(resolve(internal,"verification-benchmark-publication-df378d7d-9e83-4abc-986c-8d66919e8cd3.json"),"utf8"));
const namespace=randomUUID(),tenantId=fixture.tenantId as string,missionId=randomUUID(),workItemId=randomUUID(),attemptId=randomUUID(),operationId=randomUUID(),bucket="ai-engineer-cloud-bucket";
const database=new PostgresCanonicalRepository({connectionString:postgres,localOnly:true}),operations=new PostgresKnowledgeOperationService(database,{admittedOperationKinds:["verification_benchmark"]});
const artifacts=new PostgresVerificationRepository(database,new SupabaseArtifactStore({projectUrl,serviceRoleKey:key,bucket,maximumBytes:8*1024*1024}),{async authorize(input){assert.equal(input.tenantId,tenantId);assert.ok(["verification_admission","verification_replay"].includes(input.purpose));}});
const compact=(value:{artifactId:string;digest:string})=>({artifactId:value.artifactId,digest:value.digest});
const keys=generateKeyPairSync("ed25519"),privateKey=keys.privateKey.export({type:"pkcs8",format:"pem"}).toString(),publicKey=keys.publicKey.export({type:"spki",format:"pem"}).toString(),keyId=`full-retained-replay-${namespace}`;
async function providerLedgerDigest(){return database.transaction(tenantId,async sql=>{const row=(await sql.query<{snapshot:unknown}>("select jsonb_build_object('attempts',(select jsonb_agg(to_jsonb(p) order by p.id) from orchestration.verification_provider_attempt p where p.tenant_id=$1),'budgets',(select jsonb_agg(to_jsonb(b) order by b.id) from orchestration.verification_provider_budget b where b.tenant_id=$1)) snapshot",[tenantId])).rows[0]!;return digestCanonicalJson(row.snapshot);});}
async function hydrate(handle:{artifactId:string;digest:string}){
  const resolver=artifacts.createTrustedArtifactResolver();await resolver.authorizeArtifact({tenantId,artifactId:handle.artifactId,purpose:"verification_replay"});
  const value=await resolver.hydrateRegisteredArtifact({tenantId,artifactId:handle.artifactId});assert.equal(value.registration.digest,handle.digest);assert.equal(`sha256:${createHash("sha256").update(value.bytes).digest("hex")}`,handle.digest);
  return {handle:value.registration,value:JSON.parse(new TextDecoder("utf8",{fatal:true}).decode(value.bytes))};
}
try{
  const providerLedgerBefore=await providerLedgerDigest();
  await database.transaction(tenantId,async sql=>{
    await sql.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,'Full registered historical replay proof')",[missionId,tenantId,`full-replay-${namespace}`]);
    await sql.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind) values($1,$2,$3,'review_task')",[workItemId,tenantId,missionId]);
    await sql.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,1,'full-retained-replay-proof')",[attemptId,tenantId,workItemId]);
  });
  const files=["scripts/prove-verification-full-retained-replay.ts","apps/worker/src/verification-benchmark-runtime.ts","apps/worker/src/verification-benchmark-activity.ts","packages/application/src/verification/benchmark/verification-benchmark-registered-replay.ts","packages/application/src/verification/benchmark/verification-benchmark-offline-executor.ts","packages/application/src/verification/benchmark/verification-benchmark-publication.ts","packages/evaluation/src/verification-benchmark.ts","packages/persistence/src/verification-benchmark-run.ts","packages/persistence/src/verification-benchmark-publication.ts"];
  const sources=await Promise.all(files.map(async path=>{const bytes=await readFile(path);return {path,digest:`sha256:${createHash("sha256").update(bytes).digest("hex")}`,bytesBase64:bytes.toString("base64")};}));
  const snapshot=await artifacts.registerContentAddressedArtifact({tenantId,producerAttemptId:attemptId,missionId,bytes:new TextEncoder().encode(canonicalizeJson({schemaVersion:"verification-full-retained-replay-source.v1",sources})),mediaType:"application/json",createdAt:new Date().toISOString(),producerActivityId:"full-retained-replay-proof",producerVersion:"1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:"restricted",artifactType:"verification_benchmark_provenance",bucketClass:"ledger",storageBucket:bucket,parentArtifactIds:[]});
  const source=fixture.sourceImportEvidence.offlineExecution.provenance,pair={tenantId,dataset:compact(fixture.dataset),experiment:compact(fixture.experiment)};
  const config={schemaVersion:"verification-benchmark-runtime.v1",tenantId,inputs:[{...pair,runnerVersion:"verification-benchmark-runner.v1"}],profiles:[{...pair,profileFiles:source.profileFiles}],sources:[{...pair,manifest:compact(source.sourceImport),copies:source.sourceMappings}],replays:[{...pair,checkpoints:fixture.checkpointRefs}],policies:[{tenantId,policyVersion:"diagnostics-policy.v1",policyArtifact:compact(priorPublication.manifest.arms[0].policyArtifact)}],runtime:{deploymentId:"full-retained-replay-proof",capabilityVersion:"verification-service.v1",targetCodeRef:`uncommitted:${snapshot.digest}`,gitSha:"uncommitted",dirty:true,dirtyStateArtifact:snapshot}};
  const handler=createConfiguredVerificationBenchmarkHandler({database,tenantId,projectUrl,serviceRoleKey:key,maximumArtifactBytes:8*1024*1024,environment:{VERIFICATION_BENCHMARK_CONFIG_JSON:JSON.stringify(config),VERIFICATION_BENCHMARK_SIGNING_PRIVATE_KEY_PEM:privateKey,VERIFICATION_BENCHMARK_SIGNING_KEY_ID:keyId,VERIFICATION_STORAGE_BUCKET:bucket}});assert.ok(handler);
  const registry=new CanonicalActivityRegistry([handler]),worker=new CanonicalDurableKnowledgeWorker(`full-replay-${namespace}`,tenantId,database,createCanonicalActivityExecutor(database,registry),30_000,registry.operationKinds());
  const application=new VerificationOperationApplicationService(operations,"http://localhost"),request={verificationContractVersion:"verification.v1" as const,dataset:pair.dataset,experimentDefinition:pair.experiment,executionMode:"offline_recorded" as const};
  const context={tenantId,missionId,workItemId,attemptId,operationId,actor:{kind:"service" as const,id:attemptId,serviceIdentity:"evaluation_executor" as const},correlationId:namespace,capabilityVersion:"verification-service.v1",idempotencyKey:`full-replay-${namespace}`,reason:"Replay complete retained pilot without provider dispatch",contractVersion:"v1" as const};
  const accepted=await application.submitRunBenchmark(request,context);assert.equal((await application.submitRunBenchmark(request,context)).operationId,accepted.operationId);
  const completed=await worker.runOperationOnce(operationId);assert.equal(completed?.operation?.status,"succeeded");
  const receipts=await database.listReceipts(tenantId,operationId);assert.equal(receipts.length,1);const receipt=receipts[0]!,body=receipt.body as {output:unknown;resultArtifact:{artifactId:string;digest:string}};
  assert.equal(receipt.outcome,"succeeded");const output=VerificationBenchmarkOperationResultSchema.parse(body.output),publication=await hydrate(body.resultArtifact);
  const verified=await verifyVerificationBenchmarkPublication(publication.value,{verifier:createEd25519Verifier({[keyId]:publicKey}),requireSignature:true});assert.equal(verified.signatureStatus,"verified");assert.equal(verified.manifest.runId,output.benchmarkRunId);
  const provenanceArtifact=await hydrate(verified.manifest.provenanceArtifact),provenance=provenanceArtifact.value.provenance;
  assert.equal(provenance.checkpoints.length,117);assert.equal(provenance.replayedObservationCount,110);assert.equal(provenance.replayedFailureCount,7);assert.equal(provenance.failedCheckpoints.length,7);assert.equal(provenance.externalProviderRequests,0);
  assert.deepEqual(provenance.checkpoints.map((item:any)=>compact(item)).sort((a:any,b:any)=>a.artifactId.localeCompare(b.artifactId)),fixture.checkpointRefs.map(compact).sort((a:any,b:any)=>a.artifactId.localeCompare(b.artifactId)));
  for(const failed of provenance.failedCheckpoints){
    const reference=fixture.records.find((item:any)=>item.outcome==="failed"&&item.caseId===failed.caseId&&item.role===failed.role);assert.ok(reference);
    const retained=await hydrate(reference),original=retained.value;
    assert.equal(failed.checkpoint.checkpointDigest,original.checkpointDigest);assert.equal(failed.failure.failureCode,original.failureCode);assert.equal(failed.failure.adapterFailureCode,original.adapterFailureCode);assert.equal(failed.failure.providerHttpStatus,original.providerHttpStatus);assert.equal(failed.failure.automaticRetry,false);assert.deepEqual(failed.historical.accounting,original.accounting);assert.deepEqual(failed.replay,{memoryFetches:1,externalRequests:0});
    assert.ok(provenanceArtifact.handle.parentArtifactIds.includes(reference.artifactId));
  }
  const runner=await hydrate(verified.manifest.runnerPayload);assert.equal(runner.value.results.length,172);const {manifestDigest,...runMaterial}=runner.value;assert.equal(digestCanonicalJson(runMaterial),manifestDigest);assert.equal(manifestDigest,verified.manifest.runnerManifestDigest);
  assert.deepEqual(output.qualityClaims,{humanGoldValidated:false,sourceAuthorityAssessed:false,calibrated:false});
  const counts=await database.transaction(tenantId,async sql=>(await sql.query<{checkpoints:number;arms:number}>("select (select count(*)::int from evaluation.verification_benchmark_checkpoint where tenant_id=$1 and benchmark_run_id=$2) checkpoints,(select count(*)::int from evaluation.verification_benchmark_arm_publication where tenant_id=$1 and operation_id=$3) arms",[tenantId,output.benchmarkRunId,operationId])).rows[0]);assert.deepEqual(counts,{checkpoints:172,arms:4});
  const providerLedgerAfter=await providerLedgerDigest();assert.equal(providerLedgerAfter,providerLedgerBefore);assert.equal(attemptedExternalRequests,0);
  const path=resolve(internal,`verification-full-retained-replay-worker-${namespace}.json`);await writeFile(path,JSON.stringify({status:"passed",scope:"Configured canonical worker over all117 retained pilot calls; preserved captured failures; offline engineering observations only",tenantId,operationId,receiptId:receipt.id,preparation:preparationName,output,publicationArtifact:publication.handle,publication:verified.manifest,provenanceArtifact:provenanceArtifact.handle,provenance,counts,sources,publicKey:{keyId,pem:publicKey},providerLedgerBefore,providerLedgerAfter,externalProviderRequests:0},null,2),{flag:"wx"});console.log(JSON.stringify({status:"passed",path,operationId,calls:117,observations:110,failures:7}));
}finally{
  globalThis.fetch=originalFetch;
  const operation=await database.getOperation(tenantId,operationId).catch(()=>undefined);if(operation?.status==="queued"||operation?.status==="running")await database.cancelOperation(tenantId,operationId,{actorIdentity:"full-retained-replay-proof-cleanup",correlationId:namespace});
  await database.close();
}
