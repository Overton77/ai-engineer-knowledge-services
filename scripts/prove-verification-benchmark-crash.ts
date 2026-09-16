import assert from "node:assert/strict";
import { randomUUID,generateKeyPairSync } from "node:crypto";
import { readFile,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn,type ChildProcess } from "node:child_process";
import { VerificationOperationApplicationService,parseVerificationBenchmarkRuntimeConfig } from "@aiengineer/knowledge-application";
import { PostgresCanonicalRepository,PostgresKnowledgeOperationService,PostgresVerificationRepository,type LeasedStep } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore,deterministicUuid } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson,sha256Digest } from "@aiengineer/knowledge-verification";

const postgres=process.env.POSTGRES_URL!,storage=process.env.SUPABASE_URL!,key=process.env.SUPABASE_SECRET_KEY!;
for(const [raw,port] of [[postgres,"54322"],[storage,"54321"]]){const url=new URL(raw!);if(!["localhost","127.0.0.1"].includes(url.hostname)||url.port!==port)throw new Error("BENCHMARK_CRASH_LOCAL_ONLY");}
const configPath=process.env.BENCHMARK_PROOF_CONFIG_FILE;if(!configPath)throw new Error("BENCHMARK_CRASH_CONFIG_FILE_REQUIRED");
const retained=JSON.parse(await readFile(configPath,"utf8")),baseConfig=retained.config??retained,checked=parseVerificationBenchmarkRuntimeConfig(JSON.stringify(baseConfig));
const tenantId=checked.tenantId,namespace=randomUUID(),internal=resolve("../internal"),bucket="ai-engineer-cloud-bucket";
const database=new PostgresCanonicalRepository({connectionString:postgres,localOnly:true});
const repository=new PostgresVerificationRepository(database,new SupabaseArtifactStore({projectUrl:storage,serviceRoleKey:key,bucket,maximumBytes:8*1024*1024}),{async authorize(input){assert.equal(input.tenantId,tenantId);}});
const application=new VerificationOperationApplicationService(new PostgresKnowledgeOperationService(database,{admittedOperationKinds:["verification_benchmark"]}),"http://localhost");
const pair=baseConfig.inputs[0],request={verificationContractVersion:"verification.v1",dataset:pair.dataset,experimentDefinition:pair.experiment,executionMode:"offline_recorded"};
const keyPair=generateKeyPairSync("ed25519"),privateKey=keyPair.privateKey.export({format:"pem",type:"pkcs8"}).toString(),publicKey=keyPair.publicKey.export({format:"pem",type:"spki"}).toString(),keyId=`crash-${namespace}`;
const children=new Set<ChildProcess>(),operations:string[]=[],scenarios:unknown[]=[];
type Message={kind:string;claim?:LeasedStep;runId?:string;publicationManifest?:{artifactId:string;digest:string};result?:{operation?:{status:string}};code?:string};
function child(operationId:string,publicConfigFile:string,crashPoint:string){
  const processChild=spawn(process.execPath,["--import","tsx",resolve("scripts/verification-benchmark-crash-child.ts")],{windowsHide:true,env:{SYSTEMROOT:process.env.SYSTEMROOT,WINDIR:process.env.WINDIR,POSTGRES_URL:postgres,SUPABASE_URL:storage,SUPABASE_SECRET_KEY:key,BENCHMARK_PROOF_OPERATION_ID:operationId,BENCHMARK_PROOF_CONFIG_FILE:publicConfigFile,BENCHMARK_PROOF_CRASH_POINT:crashPoint,VERIFICATION_BENCHMARK_SIGNING_PRIVATE_KEY_PEM:privateKey,VERIFICATION_BENCHMARK_SIGNING_KEY_ID:keyId},stdio:["ignore","ignore","pipe","ipc"]});
  children.add(processChild);let stderr="";processChild.stderr!.on("data",data=>{stderr=(stderr+data.toString()).slice(-8000);});
  const exit=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(done=>processChild.once("exit",(code,signal)=>{children.delete(processChild);done({code,signal});}));
  const message=new Promise<Message>((done,reject)=>{
    const timeout=setTimeout(()=>{processChild.kill("SIGKILL");reject(new Error("BENCHMARK_CHILD_TIMEOUT"));},60_000);
    processChild.once("error",error=>{clearTimeout(timeout);reject(error);});
    processChild.once("exit",()=>{clearTimeout(timeout);reject(new Error(`BENCHMARK_CHILD_PREMATURE_EXIT:${stderr}`));});
    processChild.once("message",raw=>{clearTimeout(timeout);const value=raw as Message;if(value.kind==="error")reject(new Error(value.code));else done(value);});
  });
  return {process:processChild,exit,message};
}
try{
  for(const crashPoint of ["checkpoint5","sealed"]){
    const missionId=randomUUID(),workItemId=randomUUID(),attemptId=randomUUID(),operationId=randomUUID();operations.push(operationId);
    await database.transaction(tenantId,async client=>{
      await client.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,'Real benchmark worker process recovery')",[missionId,tenantId,`benchmark-crash-${namespace}-${crashPoint}`]);
      await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind) values($1,$2,$3,'review_task')",[workItemId,tenantId,missionId]);
      await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,1,'benchmark-crash-proof')",[attemptId,tenantId,workItemId]);
    });
    const sourcePaths=["scripts/prove-verification-benchmark-crash.ts","scripts/verification-benchmark-crash-child.ts","apps/worker/src/verification-benchmark-activity.ts","apps/worker/src/verification-benchmark-runtime.ts","packages/application/src/verification/benchmark/verification-benchmark-runtime-config.ts","packages/application/src/verification/benchmark/verification-benchmark-publication.ts","packages/evaluation/src/verification-benchmark.ts","packages/persistence/src/verification-benchmark-run.ts","packages/persistence/src/verification-benchmark-publication.ts"];
    const files=[];for(const path of sourcePaths){const bytes=await readFile(path);files.push({path,digest:sha256Digest(bytes),bytesBase64:bytes.toString("base64")});}
    const snapshot=await repository.registerContentAddressedArtifact({tenantId,producerAttemptId:attemptId,missionId,bytes:new TextEncoder().encode(canonicalizeJson({schemaVersion:"verification-benchmark-crash-source-snapshot.v1",scope:"Scoped crash fixture and execution sources; not a complete dependency image",files})),mediaType:"application/json",createdAt:new Date().toISOString(),producerActivityId:"benchmark-crash-proof",producerVersion:"1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:"restricted",artifactType:"verification_benchmark_provenance",bucketClass:"ledger",storageBucket:bucket,parentArtifactIds:[]});
    const config={...baseConfig,runtime:{...baseConfig.runtime,deploymentId:"benchmark-crash-proof",targetCodeRef:`uncommitted:${snapshot.digest}`,gitSha:"uncommitted",dirty:true,dirtyStateArtifact:snapshot}};
    const publicConfigFile=resolve(internal,`verification-benchmark-crash-config-${namespace}-${crashPoint}.json`);await writeFile(publicConfigFile,JSON.stringify(config,null,2),{flag:"wx"});
    await application.submitRunBenchmark(request,{tenantId,missionId,workItemId,attemptId,operationId,actor:{kind:"service",id:attemptId,serviceIdentity:"evaluation_executor"},correlationId:namespace,capabilityVersion:"verification-service.v1",idempotencyKey:`crash-${namespace}-${crashPoint}`,reason:"actual process kill and replacement proof",contractVersion:"v1"});
    const runId=deterministicUuid("verification-benchmark-run",`${tenantId}:${operationId}`);
    const before=child(operationId,publicConfigFile,crashPoint),interrupted=await before.message;assert.equal(interrupted.kind,crashPoint);assert.ok(interrupted.claim);
    const snapshotRow=()=>database.transaction(tenantId,async client=>(await client.query<{status:string;started_at:string;completed_at:string|null;run_manifest_artifact_id:string|null;checkpoints:number}>("select status,started_at::text,completed_at::text,run_manifest_artifact_id,(select count(*)::int from evaluation.verification_benchmark_checkpoint c where c.tenant_id=r.tenant_id and c.benchmark_run_id=r.id) checkpoints from evaluation.verification_benchmark_run r where tenant_id=$1 and id=$2",[tenantId,runId])).rows[0]!);
    const original=await snapshotRow();assert.equal(original.checkpoints,crashPoint==="checkpoint5"?5:172);assert.equal((await database.listReceipts(tenantId,operationId)).filter(item=>item.outcome==="succeeded").length,0);
    assert.equal(before.process.kill("SIGKILL"),true);const termination=await before.exit;
    const expiryDeadline=Date.now()+45_000;let expired=false;
    while(Date.now()<expiryDeadline){expired=await database.transaction(tenantId,async client=>(await client.query<{expired:boolean}>("select expires_at<=clock_timestamp() expired from knowledge_service.lease where tenant_id=$1 and lease_token=$2",[tenantId,interrupted.claim!.leaseToken])).rows[0]!.expired);if(expired)break;await new Promise(done=>setTimeout(done,50));}
    assert.equal(expired,true);
    const after=child(operationId,publicConfigFile,"none"),completed=await after.message;assert.equal(completed.kind,"completed");assert.equal(completed.result?.operation?.status,"succeeded");assert.ok(completed.claim&&completed.claim.fencingToken>interrupted.claim.fencingToken);assert.equal((await after.exit).code,0);
    const final=await snapshotRow();assert.equal(final.started_at,original.started_at);assert.equal(final.status,"sealed");assert.equal(final.checkpoints,172);
    if(crashPoint==="sealed"){assert.equal(final.completed_at,original.completed_at);assert.equal(final.run_manifest_artifact_id,original.run_manifest_artifact_id);}
    await assert.rejects(database.completeStep(tenantId,interrupted.claim,{id:randomUUID(),idempotencyKey:`stale-${randomUUID()}`,receiptKind:"stale-proof",executorIdentity:"dead-benchmark-worker",output:{stale:true}}),/STALE_LEASE/);
    const receipts=await database.listReceipts(tenantId,operationId);assert.equal(receipts.filter(item=>item.outcome==="succeeded").length,1);
    const arms=await database.transaction(tenantId,async client=>(await client.query<{count:number}>("select count(*)::int count from evaluation.verification_benchmark_arm_publication where tenant_id=$1 and benchmark_run_id=$2",[tenantId,runId])).rows[0]!.count);assert.equal(arms,4);
    scenarios.push({crashPoint,operationId,runId,publicConfigFile,childPid:before.process.pid,replacementPid:after.process.pid,termination,originalFence:interrupted.claim.fencingToken,replacementFence:completed.claim!.fencingToken,original,final,checks:{actualProcessKilledAfterCommittedBoundary:true,naturalLeaseExpiry:true,replacementHigherFence:true,originalStartPreserved:true,singleTerminalReceipt:true,fourCanonicalArms:true,deadWorkerCompletionRejected:true,...(crashPoint==="sealed"?{sealedManifestAndCompletionReused:true}:{})}});
  }
  const output=resolve(internal,`verification-benchmark-crash-${namespace}.json`);await writeFile(output,JSON.stringify({status:"passed",scope:"Actual OS process termination of configured canonical worker after committed checkpoint or publication; offline retained engineering observations only",tenantId,namespace,publicKey,keyId,scenarios,externalProviderRequests:0},null,2),{flag:"wx"});console.log(JSON.stringify({status:"passed",output,scenarios}));
}finally{
  for(const processChild of children)processChild.kill("SIGKILL");
  for(const operationId of operations){const op=await database.getOperationRecord(tenantId,operationId);if(op&&["queued","running","retry_wait"].includes(op.status))await database.cancelOperation(tenantId,operationId,{actorIdentity:"benchmark-crash-cleanup",correlationId:namespace});}
  await database.close();
}
