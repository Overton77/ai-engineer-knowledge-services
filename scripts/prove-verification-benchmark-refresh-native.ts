import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { VerificationAdmissionService, VerificationServiceCatalog, TrustedVerificationSourceAcquirer, VerificationSourceAcquisitionCatalog } from "@aiengineer/knowledge-application";
import { SandboxedVerificationParser, VERIFICATION_PARSER_LIMITS } from "@aiengineer/knowledge-conversion";
import { PostgresCanonicalRepository, PostgresVerificationRepository, PostgresKnowledgeOperationService } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { sha256Digest } from "@aiengineer/knowledge-verification";
import { createVerificationOperationExecutor, verificationActivityHandlers } from "../apps/worker/src/verification-activities.js";
import { CanonicalActivityRegistry } from "../apps/worker/src/activity-registry.js";
import { CanonicalDurableKnowledgeWorker } from "../apps/worker/src/canonical-worker.js";
import { createVerificationCaptureReads } from "../apps/api/src/verification-capture-reads-runtime.js";
import { createVerificationBenchmarkCaptureProfileResolver } from "../apps/api/src/verification-benchmark-capture-profile.js";
import { buildServer } from "../apps/api/src/server.js";

const connectionString=process.env.POSTGRES_URL!,projectUrl=process.env.SUPABASE_URL!,serviceRoleKey=process.env.SUPABASE_SECRET_KEY!;
assert.ok(connectionString&&projectUrl&&serviceRoleKey);
assert.ok(new URL(connectionString).pathname.startsWith("/verification_source_acquire_"));
assert.equal(new URL(projectUrl).hostname,"127.0.0.1");
const proofId=randomUUID(),tenantId=randomUUID(),missionId=randomUUID(),workItemId=randomUUID(),attemptId=randomUUID();
const outputPath=resolve("../internal",`verification-benchmark-refresh-native-${proofId}.json`);
const proposalDirectory=resolve("../internal",`verification-benchmark-refresh-proposal-${proofId}`,"diagnostics-companies-v2");
const database=new PostgresCanonicalRepository({connectionString,localOnly:true});
const bucket="ai-engineer-cloud-bucket",now=()=>new Date().toISOString();
const imageDigest="sha256:1669a3f9674b2e0a70ba1c8686c1cb3647492b8268bdfa7a9a4452fb0530fb37" as const;
const repository=new PostgresVerificationRepository(database,new SupabaseArtifactStore({projectUrl,serviceRoleKey,bucket,maximumBytes:8_000_000}),{async authorize(input){assert.equal(input.tenantId,tenantId);}});
let server:ReturnType<typeof buildServer>|undefined,stopping=false,workerTask:Promise<void>|undefined;
const operationIds=new Set<string>(),terminalOperations:unknown[]=[],acquisitionKeys:string[]=[],workerErrors:string[]=[];
try{
  const ledger=JSON.parse(await readFile("catalog/verification-benchmarks/diagnostics-companies-v1/source-ledger.json","utf8")) as {sources:{sourceKey:string;url:string}[]};
  assert.equal(ledger.sources.length,16);
  const sources=ledger.sources.map(row=>({sourceKey:row.sourceKey,source:{sourceId:randomUUID(),kind:row.sourceKey==="tru-sample-report"?"pdf" as const:"web_page" as const,canonicalUri:row.url,logicalIdentity:`diagnostics:${row.sourceKey}`}}));
  const catalog=new VerificationServiceCatalog({captureGrants:[],extractionProfileArtifacts:[],acquisitionGrants:sources.map(item=>({tenantId,...item}))});
  const acquirer=new TrustedVerificationSourceAcquirer(new VerificationSourceAcquisitionCatalog(sources.map(item=>({sourceKey:item.sourceKey,sourceUri:item.source.canonicalUri,redirectUris:[item.source.canonicalUri.endsWith("/")?item.source.canonicalUri.slice(0,-1):`${item.source.canonicalUri}/`],acceptedMediaTypes:[item.source.kind==="pdf"?"application/pdf":"text/html"],maximumBytes:item.source.kind==="pdf"?VERIFICATION_PARSER_LIMITS.inputBytes:2_000_000,timeoutMs:10_000}))),{resolve:async hostname=>(await lookup(hostname,{all:true,verbatim:true})).map(item=>item.address)},now);
  const config={storageBucket:bucket,producerVersion:"verification-service.v1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",now};
  const admission=new VerificationAdmissionService(repository,new SandboxedVerificationParser(imageDigest),{parserVersion:"verification-native-parser.v1",imageDigest,limits:VERIFICATION_PARSER_LIMITS},config);
  await database.transaction(tenantId,async client=>{
    await client.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,'Installed benchmark refresh proof')",[missionId,tenantId,`refresh-${proofId}`]);
    await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind) values($1,$2,$3,'verify_extraction')",[workItemId,tenantId,missionId]);
    await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,1,'benchmark-refresh-proof')",[attemptId,tenantId,workItemId]);
  });
  const actor={kind:"service" as const,id:attemptId,serviceIdentity:"knowledge_worker" as const},token=randomUUID();
  const grants=JSON.stringify([{tenantId,actor,missionId,agentDeploymentId:"benchmark-refresh-proof",capabilityVersion:"verification-service.v1"}]);
  const profile=createVerificationBenchmarkCaptureProfileResolver(database,JSON.stringify([{profileName:"diagnostics-companies",tenantId,actor,missionId,workItemId,attemptId}]),grants);
  const operations=new PostgresKnowledgeOperationService(database,{admittedOperationKinds:["verification_capture"]});
  const executor=createVerificationOperationExecutor({operations:database,repository,admission,catalog,config,sourceAcquirer:{acquire:input=>{acquisitionKeys.push(input.sourceKey);return acquirer.acquire(input);}}});
  const registry=new CanonicalActivityRegistry(verificationActivityHandlers(executor));
  const worker=new CanonicalDurableKnowledgeWorker(`refresh-${proofId}`,tenantId,database,async claim=>{const operation=await database.getOperationRecord(tenantId,claim.operationId);assert.ok(operation);return registry.execute(operation,claim);},60_000,registry.operationKinds());
  const captureReads=createVerificationCaptureReads(database,{VERIFICATION_CAPTURE_READS_ENABLED:"1",SUPABASE_URL:projectUrl,SUPABASE_SECRET_KEY:serviceRoleKey,VERIFICATION_PARSER_IMAGE_DIGEST:imageDigest,VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON:grants});
  server=buildServer({verificationOperationService:operations,verificationCaptureCatalog:catalog,verificationCaptureReads:captureReads,resolveVerificationBenchmarkCaptureProfile:async input=>{const context=await profile(input);if(context)operationIds.add(context.operationId);return context;},resolveIdentity:candidate=>candidate===token?{actor,grants:[{tenantId,roles:["knowledge_operator"],scopes:[]}]}:undefined});
  const address=await server.listen({host:"127.0.0.1",port:0});
  workerTask=(async()=>{const completed=new Set<string>();while(!stopping){for(const id of operationIds){if(completed.has(id))continue;try{const result=await worker.runOperationOnce(id);if(result?.operation&&["succeeded","failed","cancelled"].includes(result.operation.status)){completed.add(id);terminalOperations.push({operationId:id,status:result.operation.status,receipt:result.receipt});}}catch(error){workerErrors.push(error instanceof Error?error.name:"UNKNOWN");}}await delay(100);}})();
  const inherited=Object.fromEntries(Object.entries(process.env).filter(([name])=>/^(path|systemroot|windir|temp|tmp)$/iu.test(name)));
  const sourceSnapshot=await Promise.all(["apps/cli/dist/index.js","packages/application/dist/index.js","packages/persistence/dist/index.js","apps/api/src/server.ts","apps/api/src/verification-benchmark-capture-profile.ts","apps/api/src/verification-capture-reads-runtime.ts","scripts/prove-verification-benchmark-refresh-native.ts"].map(async path=>({path,digest:sha256Digest(await readFile(path))})));
  const snapshotDirectory=resolve(proposalDirectory,"..","executed-source");
  for(const item of sourceSnapshot){const bytes=await readFile(item.path);assert.equal(sha256Digest(bytes),item.digest);const target=resolve(snapshotDirectory,item.path);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes,{flag:"wx"});}
  await writeFile(resolve(snapshotDirectory,"manifest.json"),JSON.stringify(sourceSnapshot,null,2),{flag:"wx"});
  const cli=await new Promise<{exitCode:number|null;stdout:string;stderr:string}>((complete,reject)=>{
    const child=spawn(process.execPath,[resolve("apps/cli/dist/index.js"),"benchmark","capture","diagnostics-companies","--propose-version","diagnostics-companies-v2","--output",proposalDirectory,"--timeout-ms","20000"],{cwd:resolve("../internal"),env:{...inherited,KNOWLEDGE_API_URL:address,KNOWLEDGE_API_TOKEN:token},windowsHide:true});
    let stdout="",stderr="";const timeout=setTimeout(()=>child.kill(),360_000);
    child.stdout.on("data",bytes=>{stdout+=String(bytes);if(stdout.length>2_000_000)child.kill();});child.stderr.on("data",bytes=>{stderr+=String(bytes);if(stderr.length>2_000_000)child.kill();});
    child.once("error",reject);child.once("close",exitCode=>{clearTimeout(timeout);complete({exitCode,stdout,stderr});});
  });
  assert.ok(cli.exitCode===0||cli.exitCode===2,cli.stderr);
  await writeFile(resolve(proposalDirectory,"..","installed-cli-execution.json"),JSON.stringify({cli,sourceSnapshot},null,2),{flag:"wx"});
  const proposal=JSON.parse(await readFile(resolve(proposalDirectory,"proposal.json"),"utf8"));
  assert.equal(proposal.sourceDiff.length,16);assert.equal(proposal.tenantId,tenantId);assert.equal(proposal.review.humanApprovalGranted,false);
  const cliResult=JSON.parse(cli.stdout),unavailable=proposal.sourceDiff.filter((item:{status:string})=>item.status==="unavailable").length;
  assert.equal(cli.exitCode,unavailable?2:0);assert.equal(cliResult.exitCode,cli.exitCode);
  assert.equal(cliResult.status,unavailable?"refresh_incomplete":"proposed_review_required");
  assert.ok(proposal.sourceDiff.some((item:{status:string})=>item.status!=="unavailable"));
  stopping=true;await workerTask;
  const operationReceipts=await database.transaction(tenantId,async client=>(await client.query("select o.id operation_id,o.status,r.receipt_kind,r.outcome,r.body from knowledge_service.operation o left join knowledge_service.receipt r on r.tenant_id=o.tenant_id and r.operation_id=o.id where o.tenant_id=$1 order by o.id,r.id",[tenantId])).rows);
  await writeFile(resolve(proposalDirectory,"..","native-operation-receipts.json"),JSON.stringify(operationReceipts,null,2),{flag:"wx"});
  const artifacts=await database.transaction(tenantId,async client=>(await client.query("select id from orchestration.artifact where tenant_id=$1 order by id",[tenantId])).rows);
  const handles=[];
  for(const row of artifacts){const resolver=repository.createTrustedArtifactResolver();await resolver.authorizeArtifact({tenantId,artifactId:row.id,purpose:"verification_admission"});const item=await resolver.hydrateRegisteredArtifact({tenantId,artifactId:row.id});assert.equal(sha256Digest(item.bytes),item.registration.digest);assert.equal(item.bytes.byteLength,item.registration.byteLength);handles.push(item.registration);}
  const ids=new Set(handles.map(item=>item.artifactId));assert.ok(handles.every(item=>item.parentArtifactIds.every(parent=>ids.has(parent))));
  await writeFile(outputPath,JSON.stringify({passed:true,proofId,tenantId,proposalDirectory,cli,operationIds:[...operationIds],terminalOperations,acquisitionKeys,workerErrors,artifacts:handles,proposalDigest:proposal.proposalDigest,sourceOutcomes:proposal.sourceDiff.map((item:{sourceKey:string;status:string;unavailableCode?:string})=>({sourceKey:item.sourceKey,status:item.status,...(item.unavailableCode?{unavailableCode:item.unavailableCode}:{})})),scope:"Installed live sixteen-source refresh attempt through listening API, canonical worker and actual source transport; unavailable sources remain failures and no human approval/frozen dataset created"},null,2),{flag:"wx"});
  console.log(JSON.stringify({outputPath,passed:true}));
}catch(error){await writeFile(outputPath,JSON.stringify({passed:false,proofId,tenantId,proposalDirectory,operationIds:[...operationIds],terminalOperations,acquisitionKeys,workerErrors,error:error instanceof Error?error.message:"UNKNOWN"},null,2),{flag:"wx"});console.log(JSON.stringify({outputPath,passed:false}));process.exitCode=1;}
finally{stopping=true;await workerTask;await server?.close();await database.close();}
