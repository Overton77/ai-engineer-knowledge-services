import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { PostgresCanonicalRepository, PostgresKnowledgeOperationService } from "@aiengineer/knowledge-persistence";
import { deterministicUuid, parseEveRuntimeAttestation } from "@aiengineer/knowledge-runtime";
import { sha256Digest } from "@aiengineer/knowledge-domain";
import { buildServer } from "../apps/api/src/server.js";
import { createVerificationOwnershipResolver } from "../apps/api/src/verification-ownership.js";

// Actual Eve runtime -> HTTP API -> canonical SQL admission. All SQL is observed
// inside one intentionally rolled-back transaction: this is not a durability,
// concurrency, worker, seal, source-validity, or live-model quality proof.
const root=resolve(import.meta.dirname,"../.."), eveRoot=resolve(root,"research_ingestion_systems_agent/agents/verification");
const proofId=randomUUID(), output=resolve(root,"internal",`verification-eve-native-admission-${proofId}.json`);
const fixtureRoot=resolve(dirname(eveRoot),`.verification-native-fixture-${proofId}`);
const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
const tenantId=JSON.parse(await readFile(resolve(root,"internal/verification-frozen-source-registry-7a74a7a8-0dc4-4591-8bb1-5781ebddef42.json"),"utf8")).tenantId as string;
const missionId=randomUUID(),workItemId=randomUUID(),attemptId=randomUUID();
const actor={kind:"service" as const,id:randomUUID(),serviceIdentity:"mission_control_client" as const};
const idempotencyKey=`eve-native-${proofId}`,operationId=deterministicUuid("verification-http-operation",`${tenantId}:verifyClaims:${idempotencyKey}`);
const request={verificationContractVersion:"verification.v1",captureIds:["synthetic-native-admission"],assertions:{artifactId:randomUUID(),digest:`sha256:${"a".repeat(64)}`}};
const requestDigest=sha256Digest(request),issuer=`native-proof-${proofId}`,keyId="ephemeral-ed25519",grantId="native-admission";
const deploymentId="eve-native-admission-proof",capabilityVersion="verification.v1";
const keys=generateKeyPairSync("ed25519"),publicKeyPem=keys.publicKey.export({type:"spki",format:"pem"}).toString();
const token=randomUUID();
const calls:Array<{headers:Record<string,string|string[]|undefined>;body:unknown;status?:number;responseBody?:unknown}>=[];
const commandReceipts:Array<{command:string;exitCode:number|null;stdoutSha256:string;stderrSha256:string;failureDiagnostic?:string}>=[];
const rollback=new Error("EVE_NATIVE_PROOF_INTENTIONAL_ROLLBACK");
let api:ReturnType<typeof buildServer>|undefined,fixtureCreated=false,passed=false,rolledBack=false;
let observed:unknown, failureCode:string|undefined;
// @ts-expect-error local read-only config helper is outside the package graph.
const {loadVerifiedLocalDevelopmentConfig}=await import("../../internal/verification-local-direct-config.mjs");
const local=await loadVerifiedLocalDevelopmentConfig();
const dbUrl=new URL(local.DB_URL);
assert.ok(["localhost","127.0.0.1"].includes(dbUrl.hostname)&&dbUrl.port==="54322"&&dbUrl.pathname==="/postgres");
const database=new PostgresCanonicalRepository({connectionString:dbUrl.toString(),localOnly:true});
const scoped=new PostgresCanonicalRepository({connectionString:dbUrl.toString(),localOnly:true});
const executable=resolve(eveRoot,"node_modules/eve/bin/eve.js");
async function command(args:string[],environment:NodeJS.ProcessEnv){
  const result=await new Promise<{code:number|null;stdout:string;stderr:string}>((done,reject)=>{
    const child=spawn(process.execPath,[executable,...args],{cwd:fixtureRoot,env:environment,windowsHide:true,stdio:["ignore","pipe","pipe"]});
    let stdout="",stderr="";
    const timer=setTimeout(()=>child.kill(),90_000);
    child.stdout.on("data",chunk=>{stdout=(stdout+chunk).slice(-128_000);});
    child.stderr.on("data",chunk=>{stderr=(stderr+chunk).slice(-128_000);});
    child.once("error",error=>{clearTimeout(timer);reject(error);});
    child.once("close",code=>{clearTimeout(timer);done({code,stdout,stderr});});
  });
  const diagnostic=(result.stderr+"\n"+result.stdout).replaceAll(token,"[redacted-token]").replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gu,"[redacted-private-key]").replace(/(?:postgres(?:ql)?:\/\/|https?:\/\/)[^\s]+/giu,"[redacted-url]").slice(-4000);
  commandReceipts.push({command:args.join(" "),exitCode:result.code,stdoutSha256:sha(result.stdout),stderrSha256:sha(result.stderr),...(result.code===0?{}:{failureDiagnostic:diagnostic})});
  assert.equal(result.code,0,`EVE_NATIVE_${args[0]!.toUpperCase()}_FAILED`);
  if(args[0]==="eval")assert.ok(result.stdout.split(/\r?\n/u).some(line=>line.startsWith("EVE_NATIVE_TOOL_RECEIPT=")),"EVE_NATIVE_TOOL_RECEIPT_MARKER_NOT_FORWARDED");
}
try {
  await cp(eveRoot,fixtureRoot,{recursive:true,filter:source=>![".eve",".output","node_modules"].includes(source.split(/[\\/]/).at(-1)??"")});fixtureCreated=true;
  await symlink(resolve(eveRoot,"node_modules"),resolve(fixtureRoot,"node_modules"),process.platform==="win32"?"junction":"dir");
  await writeFile(resolve(fixtureRoot,"evals/native-admission.eval.ts"),`import {defineEval} from "eve/evals"; import {equals} from "eve/evals/expect";
export default defineEval({description:"Native SQL admission only; mocked model; no verification result claimed",async test(t){
const turn=await t.send("Submit the configured verification request.");t.succeeded();turn.calledTool("verify_evidence_bundle",{count:1});
const message=turn.events.filter(e=>e.type==="message.completed").at(-1)?.data?.message??turn.data;
const value=typeof message==="string"?JSON.parse(message):message;
t.check(value?.status,equals("accepted"));t.check(value?.operationId,equals(process.env.EVE_VERIFICATION_FIXTURE_OPERATION_ID));console.log("EVE_NATIVE_TOOL_RECEIPT="+JSON.stringify(value));}});\n`);
  const portServer=createServer();await new Promise<void>(done=>portServer.listen(0,"127.0.0.1",done));const evePort=(portServer.address() as {port:number}).port;await new Promise<void>((done,reject)=>portServer.close(error=>error?reject(error):done()));
  const environment:NodeJS.ProcessEnv=Object.fromEntries(["APPDATA","ComSpec","HOMEDRIVE","HOMEPATH","LOCALAPPDATA","PATH","PATHEXT","SystemRoot","TEMP","TMP","USERPROFILE"].flatMap(name=>process.env[name]===undefined?[]:[[name,process.env[name]]]));
  Object.assign(environment,{PORT:String(evePort),EVE_VERIFICATION_TRANSPORT_FIXTURE:"1",EVE_VERIFICATION_FIXTURE_TOOL_INPUT_JSON:JSON.stringify({action:"submit",host:"claims",intent:"verify_claims",...request}),EVE_VERIFICATION_FIXTURE_OPERATION_ID:operationId,KNOWLEDGE_API_TOKEN:token,
    EVE_VERIFICATION_SIGNING_PRIVATE_KEY_PEM:keys.privateKey.export({type:"pkcs8",format:"pem"}).toString(),
    EVE_VERIFICATION_GRANTS_JSON:JSON.stringify({schemaVersion:"eve-verification-grants.v1",grants:[{grantId,tenantId,principal:actor,missionId,workItemId,attemptId,operationId,idempotencyKey,capabilityVersion,host:"claims",requestDigest,runtimeAttestation:{issuer,keyId,agentDeploymentId:deploymentId},lifecycle:{allowRead:false,allowCancellation:false,maxPollAttempts:0,pollIntervalMs:0}}]})});
  await command(["build"],environment);
  try {await database.transaction(tenantId,async client=>{
    await client.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,$4)",[missionId,tenantId,`eve-native-${proofId}`,"Synthetic Eve native admission proof; rollback required"]);
    await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind,spec) values($1,$2,$3,'verify_extraction','{}')",[workItemId,tenantId,missionId]);
    await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id,started_at) values($1,$2,$3,1,$4,clock_timestamp())",[attemptId,tenantId,workItemId,deploymentId]);
    // Bind repository methods to the actual client held by this rollback-only
    // transaction. No fake query results or verification service are installed.
    scoped.transaction=async(tenant,work)=>{assert.equal(tenant,tenantId);return work(client);};
    api=buildServer({resolveIdentity:candidate=>candidate===token?{actor,grants:[{tenantId,roles:["knowledge_operator"],scopes:[]}]}:undefined,
      verificationOperationService:new PostgresKnowledgeOperationService(scoped,{admittedOperationKinds:["verification_claims"]}),
      isClaimsRequestAdmitted:(tenant,input)=>tenant===tenantId&&sha256Digest(input)===requestDigest,
      resolveVerificationContext:createVerificationOwnershipResolver(scoped,JSON.stringify([{tenantId,actor,missionId,agentDeploymentId:deploymentId,capabilityVersion,eveRuntimeAuthority:{grantId,issuer,keyIds:[keyId]}}]),{eveRuntimeAttestationKeysJson:JSON.stringify([{issuer,keyId,publicKeyPem}])})});
    api.addHook("preHandler",async req=>{if(req.url==="/v1/verification/claims:verify")calls.push({headers:Object.fromEntries(Object.entries(req.headers).filter(([name])=>name!=="authorization")),body:req.body});});
    api.addHook("onResponse",async(req,reply)=>{if(req.url==="/v1/verification/claims:verify")calls.at(-1)!.status=reply.statusCode;});
    api.addHook("onSend",async(req,_reply,payload)=>{if(req.url==="/v1/verification/claims:verify"&&typeof payload==="string"){try{calls.at(-1)!.responseBody=JSON.parse(payload);}catch{/* non-JSON response is not evidence */}}return payload;});
    const origin=await api.listen({host:"127.0.0.1",port:0});environment.KNOWLEDGE_API_BASE_URL=origin;
    await command(["eval","native-admission","--strict","--json","--skip-report"],environment);
    await command(["eval","native-admission","--strict","--json","--skip-report"],environment);
    assert.equal(calls.length,2);assert.deepEqual(calls.map(call=>call.status),[202,202]);
    const envelopes=calls.map(call=>parseEveRuntimeAttestation(String(call.headers["x-eve-runtime-attestation"])));
    assert.notDeepEqual(envelopes[0]!.payload.externalExecution,envelopes[1]!.payload.externalExecution);
    const rows=await client.query("select request,request_sha256 from knowledge_service.operation where tenant_id=$1 and id=$2",[tenantId,operationId]);assert.equal(rows.rows.length,1);
    const stored=rows.rows[0] as {request:{authenticatedContext:{externalExecution:unknown}};request_sha256:string};
    assert.deepEqual(stored.request.authenticatedContext.externalExecution,envelopes[0]!.payload.externalExecution);
    const invocations=await client.query("select envelope from knowledge_service.eve_operation_invocation where tenant_id=$1 and operation_id=$2 order by accepted_at",[tenantId,operationId]);assert.equal(invocations.rows.length,2);
    observed={operationId,requestSha256:stored.request_sha256,invocations:invocations.rows,originalLineagePreserved:true,canonicalSessionCorroboration:"absent; explicitly trusted issuer is authoritative"};
    await api.close();api=undefined;
    throw rollback;
  });}catch(error){if(error!==rollback)throw error;rolledBack=true;}
  const remaining=await database.transaction(tenantId,client=>client.query("select id from orchestration.mission where id=$1",[missionId]));assert.equal(remaining.rows.length,0);passed=true;
}catch(error){failureCode=error instanceof Error?error.message.replace(/(?:postgres(?:ql)?:\/\/|https?:\/\/)[^\s]+/giu,"[redacted-url]").slice(0,300):"UNKNOWN";}
finally {
  await api?.close();await scoped.close();await database.close();
  if(fixtureCreated){assert.equal(dirname(fixtureRoot),dirname(eveRoot));assert.match(fixtureRoot.split(/[\\/]/).at(-1)!,/^\.verification-native-fixture-[0-9a-f-]{36}$/u);await rm(fixtureRoot,{recursive:true,force:true});}
  const sourceFiles=["ai-engineer-knowledge-services/scripts/prove-eve-native-admission.ts","ai-engineer-knowledge-services/apps/api/src/verification-ownership.ts","ai-engineer-knowledge-services/apps/api/src/server.ts","ai-engineer-knowledge-services/packages/persistence/src/eve-verification-binding.ts","research_ingestion_systems_agent/agents/verification/agent/lib/verification-ks-runtime.ts"];
  const sourceHashes=await Promise.all(sourceFiles.map(async path=>({path,sha256:sha(await readFile(resolve(root,path),"utf8"))})));
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify({schemaVersion:"verification-eve-native-admission.v1",passed,rolledBack,proofId,observed,calls,commandReceipts,sourceHashes,failureCode,publicKeyPem,providerCalls:0,limitations:["Rollback-only SQL admission evidence; no committed durability or concurrency proof.","Synthetic request handles are exactly admitted for transport; no worker, artifact validation, signed verification result, Storage, Temporal, or live model executed."],createdAt:new Date().toISOString()},null,2)+"\n",{flag:"wx"});
}
process.stdout.write(JSON.stringify({output,passed,rolledBack,failureCode})+"\n");process.exitCode=passed?0:1;
