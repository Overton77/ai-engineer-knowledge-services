import assert from "node:assert/strict";
import { randomUUID,createHash } from "node:crypto";
import { writeFile,readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { VerificationAdmissionService,VerificationServiceCatalog,VerificationOperationApplicationService } from "@aiengineer/knowledge-application";
import { SandboxedVerificationParser,VERIFICATION_PARSER_LIMITS } from "@aiengineer/knowledge-conversion";
import { PostgresCanonicalRepository,PostgresVerificationRepository,PostgresKnowledgeOperationService } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson } from "@aiengineer/knowledge-verification";
import { createVerificationOperationExecutor,verificationActivityHandlers } from "../apps/worker/src/verification-activities.js";
import { CanonicalActivityRegistry } from "../apps/worker/src/activity-registry.js";
import { CanonicalDurableKnowledgeWorker } from "../apps/worker/src/canonical-worker.js";
import { KnowledgeClient } from "../packages/client-typescript/src/client.js";
import { buildServer } from "../apps/api/src/server.js";
import { createVerificationOwnershipResolver } from "../apps/api/src/verification-ownership.js";
import { dispatchCliCommand,resolveCommand } from "../apps/cli/src/commands.js";
import { buildKnowledgeMcpApp } from "../apps/mcp/src/index.js";
import { spawn } from "node:child_process";

const connectionString=process.env.POSTGRES_URL,projectUrl=process.env.SUPABASE_URL,serviceRoleKey=process.env.SUPABASE_SECRET_KEY;
if(!connectionString||!projectUrl||!serviceRoleKey)throw new Error("LOCAL_CONFIGURATION_REQUIRED");
const storageTarget=new URL(projectUrl);
if(!["localhost","127.0.0.1"].includes(storageTarget.hostname)||storageTarget.port!=="54321")throw new Error("LOCAL_STORAGE_REQUIRED");
const database=new PostgresCanonicalRepository({connectionString,localOnly:true});
const namespace=`verification-service-worker-${randomUUID()}`,tenantId=randomUUID(),missionId=randomUUID(),workItemId=randomUUID(),attemptId=randomUUID(),sourceId=randomUUID();
const bucket="ai-engineer-cloud-bucket",now=()=>new Date().toISOString(),createdAt=now();
const imageDigest="sha256:1669a3f9674b2e0a70ba1c8686c1cb3647492b8268bdfa7a9a4452fb0530fb37" as const;
const repository=new PostgresVerificationRepository(database,new SupabaseArtifactStore({projectUrl,serviceRoleKey,bucket,maximumBytes:8_000_000}),{async authorize(input){if(input.tenantId!==tenantId)throw new Error("TENANT_DENIED");}});
const config={storageBucket:bucket,producerVersion:"verification-service.v1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",now};
const admission=new VerificationAdmissionService(repository,new SandboxedVerificationParser(imageDigest),{parserVersion:"verification-native-parser.v1",imageDigest,limits:VERIFICATION_PARSER_LIMITS},config);
const operations=new PostgresKnowledgeOperationService(database,{admittedOperationKinds:["verification_capture","verification_extraction","verification_replay"]});
const application=new VerificationOperationApplicationService(operations,"http://localhost");
const context=()=>({tenantId,missionId,workItemId,attemptId,operationId:randomUUID(),correlationId:randomUUID(),actor:{kind:"service" as const,id:attemptId,serviceIdentity:"knowledge_worker" as const},capabilityVersion:"verification-service.v1",idempotencyKey:`${namespace}:${randomUUID()}`,reason:"real local worker proof",contractVersion:"v1" as const});
const register=(value:unknown,type:string,mediaType="application/json")=>repository.registerContentAddressedArtifact({tenantId,bytes:new TextEncoder().encode(typeof value==="string"?value:canonicalizeJson(value)),mediaType,createdAt,producerActivityId:"service-worker-proof",producerVersion:"1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:"restricted",artifactType:type,bucketClass:"ledger",storageBucket:bucket,producerAttemptId:attemptId,missionId});
const checks:Record<string,boolean>={};
async function execute(operationId:string,catalog:VerificationServiceCatalog){
  const executor=createVerificationOperationExecutor({operations:database,repository,admission,catalog,config});
  const registry=new CanonicalActivityRegistry(verificationActivityHandlers(executor));
  const worker=new CanonicalDurableKnowledgeWorker(namespace,tenantId,database,async claim=>{
    const operation=await database.getOperationRecord(tenantId,claim.operationId);assert.ok(operation);return registry.execute(operation,claim);
  },30_000,registry.operationKinds());
  const result=await worker.runOperationOnce(operationId);assert.ok(result);assert.equal(result.operation?.status,"succeeded");
  return result.receipt.body as any;
}
try {
  await database.transaction(tenantId,async client=>{
    await client.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,'Real verification worker proof')",[missionId,tenantId,namespace]);
    await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind) values($1,$2,$3,'verify_extraction')",[workItemId,tenantId,missionId]);
    await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,1,'verification-service-worker-proof')",[attemptId,tenantId,workItemId]);
  });
  const sourceArtifact=await register("<html><body><p>Exact value 42</p></body></html>","source_capture","text/html");
  const source={sourceId,kind:"web_page" as const,canonicalUri:"https://example.test/verification-worker-fixture",logicalIdentity:namespace};
  const captureCatalog=new VerificationServiceCatalog({captureGrants:[{source,contentArtifact:{artifactId:sourceArtifact.artifactId,digest:sourceArtifact.digest},capturedAt:createdAt,captureMethod:"registered_artifact",captureMethodVersion:"1",parserKind:"html",projectionKinds:["html_dom"]}],extractionProfileArtifacts:[]});
  const capture=await application.submitCaptureSource({verificationContractVersion:"verification.v1",source:{mode:"register",sourceKind:"web_page",sourceId,contentArtifact:{artifactId:sourceArtifact.artifactId,digest:sourceArtifact.digest}},requestedProjectionKinds:["html_dom"]},context());
  const captured=await execute(capture.operationId,captureCatalog);
  assert.ok(captured.resultArtifact);checks.captureWorkerSucceeded=true;
  const registeredOwner=await database.transaction(tenantId,async client=>(await client.query("select producer_attempt_id,mission_id from orchestration.artifact where tenant_id=$1 and id=$2",[tenantId,captured.resultArtifact.artifactId])).rows[0]);
  assert.equal(registeredOwner?.producer_attempt_id,attemptId);assert.equal(registeredOwner?.mission_id,missionId);checks.resultArtifactOwnershipPersisted=true;
  const projection=captured.output.projections[0];
  assert.deepEqual(projection.projectionArtifact.parentArtifactIds,[]);checks.nativeProjectionParentless=true;
  const profile={schemaVersion:"verification-extraction-profile.v1",sourceArtifact:{artifactId:sourceArtifact.artifactId,digest:sourceArtifact.digest},extractionSchema:{schemaId:"worker-fixture",schemaVersion:"1",schema:{type:"object",description:"Worker fixture",properties:{value:{type:"string",description:"Exact value",maxLength:32}},required:["value"],additionalProperties:false}},fields:[{path:"/value",comparison:"exact"}],evidence:[{path:"/value",captureId:captured.output.capture.captureId,projectionArtifactId:projection.projectionArtifact.artifactId,transformationArtifactId:projection.transformationArtifact.artifactId,selector:{kind:"html",domPath:"1/0"}}],normalizations:[],duplicates:[],totals:[]};
  const profileArtifact=await register(profile,"verification_bundle"),candidate=await register({value:"Exact value 42"},"evaluation_case_input");
  const catalog=new VerificationServiceCatalog({captureGrants:[],extractionProfileArtifacts:[{artifactId:profileArtifact.artifactId,digest:profileArtifact.digest}]});
  const verified=await application.submitVerifyExtraction({verificationContractVersion:"verification.v1",captureIds:[captured.output.capture.captureId],extractionSchema:{artifactId:profileArtifact.artifactId,digest:profileArtifact.digest},extractionOutput:{artifactId:candidate.artifactId,digest:candidate.digest}},context());
  const verification=await execute(verified.operationId,catalog);assert.equal(verification.output.result.valid,true,JSON.stringify(verification.output.result));checks.verificationWorkerSucceeded=true;
  const replay=await application.submitReplayRun({verificationContractVersion:"verification.v1",runId:verified.operationId,replayMode:"deterministic_only"},context());
  const replayed=await execute(replay.operationId,catalog);assert.equal(replayed.output.replayMatched,true);checks.replayWorkerSucceeded=true;
  const mutated=await register({value:"Exact value 43"},"evaluation_case_input");
  const verificationRequest={verificationContractVersion:"verification.v1",captureIds:[captured.output.capture.captureId],extractionSchema:{artifactId:profileArtifact.artifactId,digest:profileArtifact.digest},extractionOutput:{artifactId:mutated.artifactId,digest:mutated.digest}};
  const rejected=await application.submitVerifyExtraction(verificationRequest,context());
  const rejection=await execute(rejected.operationId,catalog);assert.equal(rejection.output.result.valid,false);checks.qualityRejectionIsCompletedResult=true;
  const abandoned=await application.submitVerifyExtraction(verificationRequest,context());
  const child=spawn(process.execPath,["--import","tsx",resolve("scripts/verification-abandoned-lease-fixture.ts")],{windowsHide:true,
    env:{SYSTEMROOT:process.env.SYSTEMROOT,WINDIR:process.env.WINDIR,POSTGRES_URL:connectionString,PROOF_TENANT_ID:tenantId,PROOF_OPERATION_ID:abandoned.operationId},stdio:["ignore","ignore","pipe","ipc"]});
  const exited=new Promise<void>(resolveExit=>child.once("exit",()=>resolveExit()));
  let abandonedClaim:any;
  try {
    abandonedClaim=await new Promise<any>((resolveClaim,reject)=>{
      const timer=setTimeout(()=>reject(new Error("CHILD_CLAIM_TIMEOUT")),5000);
      child.once("error",error=>{clearTimeout(timer);reject(error);});
      child.once("message",message=>{clearTimeout(timer);resolveClaim((message as any).claim);});
      child.once("exit",()=>{clearTimeout(timer);reject(new Error("CHILD_EXITED_BEFORE_CLAIM"));});
    });
    assert.equal((await database.getOperation(tenantId,abandoned.operationId))?.status,"running");checks.childHeldDurableRunningLease=true;
  } finally {child.kill("SIGKILL");await exited;}
  await new Promise(resolveExpiry=>setTimeout(resolveExpiry,Math.max(0,new Date(abandonedClaim.expiresAt).getTime()-Date.now())+100));
  const recovered=await execute(abandoned.operationId,catalog);assert.equal(recovered.output.result.valid,false);checks.killedWorkerLeaseRecovered=true;
  await assert.rejects(database.heartbeat(tenantId,abandonedClaim),/LEASE|FENC|STALE/);checks.deadWorkerLeaseFenced=true;
  assert.equal((await database.listReceipts(tenantId,abandoned.operationId)).filter(item=>item.outcome==="succeeded").length,1);checks.recoveredWorkSingleSuccessReceipt=true;
  const beforeReceipts=await database.listReceipts(tenantId,rejected.operationId);
  const freshDatabase=new PostgresCanonicalRepository({connectionString,localOnly:true});
  try {
    const freshWorker=new CanonicalDurableKnowledgeWorker(`${namespace}-fresh`,tenantId,freshDatabase,()=>{throw new Error("TERMINAL_WORK_MUST_NOT_EXECUTE");});
    assert.equal(await freshWorker.runOperationOnce(rejected.operationId),undefined);checks.freshWorkerDoesNotRetryQualityRejection=true;
    const cancelContext=context(),cancelled=await application.submitVerifyExtraction(verificationRequest,cancelContext);
    await operations.cancel(cancelled.operationId,tenantId,cancelContext);
    assert.equal(await freshWorker.runOperationOnce(cancelled.operationId),undefined);checks.cancelledWorkCannotBeClaimed=true;
    assert.equal((await database.getOperation(tenantId,cancelled.operationId))?.status,"cancelled");
    assert.equal((await database.listReceipts(tenantId,cancelled.operationId)).filter(item=>item.outcome==="succeeded").length,0);checks.cancelledWorkHasNoSuccessReceipt=true;
  } finally {await freshDatabase.close();}
  assert.equal((await database.listReceipts(tenantId,rejected.operationId)).length,beforeReceipts.length);checks.noDuplicateTerminalReceipt=true;
  const publicContext=context(),token=`proof-${randomUUID()}`;
  const resolver=createVerificationOwnershipResolver(database,JSON.stringify([{tenantId,actor:publicContext.actor,missionId,agentDeploymentId:"verification-service-worker-proof",capabilityVersion:"verification-service.v1"}]));
  const api=buildServer({operationService:operations,verificationOperationService:operations,resourceReader:database,resolveVerificationContext:resolver,
    resolveIdentity:value=>value===token?{actor:publicContext.actor,grants:[{tenantId,roles:["knowledge_operator"],scopes:[]}]}:undefined});
  const observedQueuedReads=new Set<string>();
  api.addHook("onSend",async(request,_reply,payload)=>{
    if(request.method==="GET"&&request.url.startsWith("/v1/verification/operations/")&&typeof payload==="string"){
      const body=JSON.parse(payload) as {operationId?:string;state?:string};
      if(body.state==="queued"&&body.operationId)observedQueuedReads.add(body.operationId);
    }
    return payload;
  });
  try {
    const baseUrl=await api.listen({host:"127.0.0.1",port:0});
    const client=new KnowledgeClient({baseUrl,getAccessToken:()=>token});
    const validRequest={...verificationRequest,extractionOutput:{artifactId:candidate.artifactId,digest:candidate.digest}};
    const clientOperation=await client.verifyExtraction(validRequest as any,publicContext);
    const clientResult=await execute(clientOperation.operationId,catalog);
    assert.deepEqual(clientResult.output.result,verification.output.result);checks.publicClientWorkerResultMatches=true;
    assert.equal((await client.getVerificationOperation(clientOperation.operationId,publicContext)).state,"succeeded");checks.publicClientReadsDurableStatus=true;
    const cliContext={...publicContext,idempotencyKey:`${namespace}-cli`};
    const cliOperation=await dispatchCliCommand(client,resolveCommand("verify","extract")!,validRequest,cliContext) as {operationId:string};
    const cliResult=await execute(cliOperation.operationId,catalog);
    assert.deepEqual(cliResult.output.result,verification.output.result);checks.cliDispatcherWorkerResultMatches=true;
    const repeated=await dispatchCliCommand(client,resolveCommand("verify","extract")!,validRequest,cliContext) as {operationId:string};
    assert.equal(repeated.operationId,cliOperation.operationId);checks.cliExactRetryUsesSameOperation=true;
    const runCli=(request:unknown,ctx:ReturnType<typeof context>,accessToken=token)=>new Promise<{code:number|null;stdout:string;stderr:string}>((resolveChild,reject)=>{
      const child=spawn(process.execPath,[resolve("apps/cli/dist/index.js"),"verify","extract","--base-url",baseUrl,"--context",JSON.stringify(ctx),"--input",JSON.stringify(request),"--wait","--timeout-ms","5000"],{windowsHide:true,env:{SYSTEMROOT:process.env.SYSTEMROOT,WINDIR:process.env.WINDIR,KNOWLEDGE_API_TOKEN:accessToken},stdio:["ignore","pipe","pipe"]});
      let stdout="",stderr="";child.stdout.on("data",chunk=>{stdout+=chunk;});child.stderr.on("data",chunk=>{stderr+=chunk;});child.on("error",reject);child.on("close",code=>resolveChild({code,stdout,stderr}));
    });
    const cliSuccess=await runCli(validRequest,cliContext);assert.equal(cliSuccess.code,0,cliSuccess.stderr);assert.equal(JSON.parse(cliSuccess.stdout).qualityPassed,true);checks.cliExecutablePassExitZero=true;
    const rejectionContext={...publicContext,idempotencyKey:`${namespace}-cli-quality`};
    const rejectionOperation=await client.verifyExtraction(verificationRequest as any,rejectionContext);await execute(rejectionOperation.operationId,catalog);
    const cliQuality=await runCli(verificationRequest,rejectionContext);assert.equal(cliQuality.code,1,cliQuality.stderr);assert.equal(JSON.parse(cliQuality.stdout).qualityPassed,false);checks.cliExecutableQualityExitOne=true;
    const cliFailure=await runCli(validRequest,cliContext,"invalid-local-token");assert.equal(cliFailure.code,2);checks.cliExecutableRequestFailureExitTwo=true;
    const waitingContext={...publicContext,idempotencyKey:`${namespace}-cli-waiting`};
    const waitingOperation=await client.verifyExtraction(validRequest as any,waitingContext);
    const waitingChild=runCli(validRequest,waitingContext);
    // Require the child itself to read queued state before allowing execution.
    const observationDeadline=Date.now()+4000;
    while(!observedQueuedReads.has(waitingOperation.operationId)&&Date.now()<observationDeadline)await new Promise(resolveWait=>setTimeout(resolveWait,20));
    assert.ok(observedQueuedReads.has(waitingOperation.operationId),"CLI_DID_NOT_OBSERVE_QUEUED_STATE");
    assert.equal((await database.getOperation(tenantId,waitingOperation.operationId))?.status,"queued");
    await execute(waitingOperation.operationId,catalog);
    const waited=await waitingChild;assert.equal(waited.code,0,waited.stderr);checks.cliWaitsForWorkerCompletion=true;
    const timeoutContext={...publicContext,idempotencyKey:`${namespace}-cli-timeout`};
    const timeoutOperation=await client.verifyExtraction(validRequest as any,timeoutContext);
    const timedOut=await runCli(validRequest,timeoutContext);assert.equal(timedOut.code,2);assert.equal((await database.getOperation(tenantId,timeoutOperation.operationId))?.status,"queued");checks.cliTimeoutDoesNotInventCompletion=true;
    await operations.cancel(timeoutOperation.operationId,tenantId,timeoutContext);
    const mcp=buildKnowledgeMcpApp({operationService:operations,apiOrigin:baseUrl,
      resolveIdentity:value=>value===token?{actor:publicContext.actor,grants:[{tenantId,roles:["knowledge_operator"],scopes:[]}]}:undefined,
      createApiClient:accessToken=>new KnowledgeClient({baseUrl,getAccessToken:()=>accessToken})});
    try {
      const mcpUrl=await mcp.listen({host:"127.0.0.1",port:0});
      const mcpContext={tenantId,missionId,workItemId,attemptId,correlationId:publicContext.correlationId,idempotencyKey:`${namespace}-mcp`};
      const response=await fetch(`${mcpUrl}/mcp`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json",accept:"application/json, text/event-stream","mcp-protocol-version":"2025-03-26"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"knowledge_verify_extraction",arguments:{context:mcpContext,request:validRequest}}})});
      assert.equal(response.status,200);const rpc=await response.json() as any;
      assert.ok(!rpc.error&&!rpc.result?.isError,JSON.stringify(rpc));
      const mcpOperation=rpc.result.structuredContent??JSON.parse(rpc.result.content[0].text);
      const mcpResult=await execute(mcpOperation.operationId,catalog);
      assert.deepEqual(mcpResult.output.result,verification.output.result);checks.mcpHttpWorkerResultMatches=true;
    } finally {await mcp.close();}
  } finally {await api.close();}
  const sourceHashes:Record<string,string>={};
  for(const file of ["scripts/prove-verification-service-worker.ts","apps/worker/src/activity-registry.ts","apps/worker/src/verification-activities.ts","packages/application/src/verification/operations/verification-service.ts","packages/client-typescript/src/client.ts","apps/cli/src/commands.ts","apps/cli/src/index.ts","apps/cli/src/verification-completion.ts","apps/api/src/verification-ownership.ts","apps/mcp/src/index.ts"])
    sourceHashes[file]=createHash("sha256").update(await readFile(file)).digest("hex");
  const receipt=resolve("..","internal",`${namespace}.json`);
  await writeFile(receipt,JSON.stringify({capturedAt:now(),tenantId,missionId,attemptId,imageDigest,operations:[capture.operationId,verified.operationId,replay.operationId,rejected.operationId],sourceHashes,checks,providerDispatches:0,passed:true},null,2),{flag:"wx"});
  console.log(JSON.stringify({receipt,checks,passed:true}));
} finally {await database.close();}
