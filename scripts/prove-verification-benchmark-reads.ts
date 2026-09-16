import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {randomUUID,generateKeyPairSync,createHash} from "node:crypto";
import {spawn} from "node:child_process";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import {resolve} from "node:path";
import {buildServer} from "../apps/api/src/server.js";
import {createVerificationBenchmarkReads} from "../apps/api/src/verification-benchmark-reads-runtime.js";
import {buildKnowledgeMcpApp} from "../apps/mcp/src/index.js";
import {PostgresCanonicalRepository,PostgresKnowledgeOperationService} from "@aiengineer/knowledge-persistence";
import {KnowledgeClient} from "@aiengineer/knowledge-client";
import {VerificationBenchmarkRunSummaryResourceSchema,VerificationBenchmarkRunManifestResourceSchema} from "@aiengineer/knowledge-contracts";

const postgres=process.env.POSTGRES_URL,storage=process.env.SUPABASE_URL;
if(!postgres||!/^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:127\.0\.0\.1|localhost):54322\//u.test(postgres))throw new Error("LOCAL_DB_REQUIRED");
if(!storage||!["localhost","127.0.0.1"].includes(new URL(storage).hostname)||new URL(storage).port!=="54321")throw new Error("LOCAL_STORAGE_REQUIRED");
const internal=resolve("../internal"),fixture=JSON.parse(await readFile(resolve(internal,"verification-benchmark-worker-62c9b30e-fb46-478c-9e8c-3da5701fce3a.json"),"utf8")) as {tenantId:string;benchmarkRunId:string;publicKey:{keyId:string;pem:string};attemptId:string;missionId:string;workItemId:string};
const recovery=JSON.parse(await readFile(resolve(internal,"verification-benchmark-crash-5b42b488-405c-4b02-b28b-44eeaacc1bcd.json"),"utf8")) as {keyId:string;publicKey:string;scenarios:{runId:string}[]};
const database=new PostgresCanonicalRepository({connectionString:postgres,localOnly:true}),tenantId=fixture.tenantId,namespace=randomUUID(),token=`benchmark-read-${namespace}`,foreignTenant=randomUUID();
const publicKeys=[{keyId:fixture.publicKey.keyId,publicKeyPem:fixture.publicKey.pem},{keyId:recovery.keyId,publicKeyPem:recovery.publicKey}];
const reads=createVerificationBenchmarkReads(database,{...process.env,VERIFICATION_BENCHMARK_READ_PUBLIC_KEYS_JSON:JSON.stringify(publicKeys)})!;
const identity={actor:{kind:"human" as const,id:randomUUID()},grants:[{tenantId,roles:["knowledge_reader" as const],scopes:[]},{tenantId:foreignTenant,roles:["knowledge_reader" as const],scopes:[]}]};
const api=buildServer({verificationBenchmarkReads:reads,resolveIdentity:value=>value===token?identity:undefined});
const checks:Record<string,boolean>={},context={tenantId,correlationId:namespace};
let mcp:ReturnType<typeof buildKnowledgeMcpApp>|undefined;
function cli(baseUrl:string,action:string){return new Promise<{code:number|null;stdout:string;stderr:string}>((done,reject)=>{
 const child=spawn(process.execPath,[resolve("apps/cli/dist/index.js"),"benchmark",action,"--base-url",baseUrl,"--context",JSON.stringify({...context,operationId:randomUUID(),attemptId:fixture.attemptId,missionId:fixture.missionId,workItemId:fixture.workItemId,actor:identity.actor,capabilityVersion:"benchmark-read-proof",idempotencyKey:`read-${namespace}`,reason:"Read completed benchmark",contractVersion:"v1"}),"--input",JSON.stringify({runId:fixture.benchmarkRunId})],{windowsHide:true,env:{SYSTEMROOT:process.env.SYSTEMROOT,WINDIR:process.env.WINDIR,KNOWLEDGE_API_TOKEN:token},stdio:["ignore","pipe","pipe"]});
 const timer=setTimeout(()=>child.kill("SIGKILL"),20_000);let stdout="",stderr="";child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);child.on("error",error=>{clearTimeout(timer);reject(error);});child.on("close",code=>{clearTimeout(timer);done({code,stdout,stderr});});
});}
try{
 const origin=await api.listen({host:"127.0.0.1",port:0}),client=new KnowledgeClient({baseUrl:origin,getAccessToken:()=>token});
 const summaries=await Promise.all([fixture.benchmarkRunId,...recovery.scenarios.map(s=>s.runId)].map(id=>client.getBenchmarkRun(id,context)));
 assert.equal(summaries.length,3);for(const summary of summaries){assert.equal(summary.tenantId,tenantId);assert.equal(summary.arms.length,4);assert.equal(summary.qualityClaims.humanGoldValidated,false);}checks.concurrentActualCompletedReads=true;
 const manifest=await client.getBenchmarkRunManifest(fixture.benchmarkRunId,context);assert.equal(manifest.runId,fixture.benchmarkRunId);checks.signedManifestProjection=true;
 const serialized=JSON.stringify({summaries,manifest});for(const privateField of ['"objectKey"','"signatureBase64"','"publicKeyPem"','"results"','"bytesBase64"'])assert(!serialized.includes(privateField));checks.noPrivatePayloadFields=true;
 const headers={authorization:`Bearer ${token}`,"x-tenant-id":tenantId};
 assert.equal((await api.inject({url:`/v1/verification/benchmarks/${fixture.benchmarkRunId}`})).statusCode,401);checks.noCredentialDenied=true;
 assert.equal((await api.inject({url:`/v1/verification/benchmarks/${fixture.benchmarkRunId}`,headers:{...headers,"x-tenant-id":foreignTenant}})).statusCode,404);checks.authorizedForeignTenantHidden=true;
 assert.equal((await api.inject({url:`/v1/verification/benchmarks/${randomUUID()}`,headers})).statusCode,404);checks.missingRunHidden=true;
 assert.equal((await api.inject({url:"/v1/verification/benchmarks/df378d7d-9e83-4abc-986c-8d66919e8cd3",headers})).statusCode,404);checks.cancelledInternalPublicationHidden=true;
 const wrongKey=generateKeyPairSync("ed25519").publicKey.export({format:"pem",type:"spki"}).toString();
 const wrongReads=createVerificationBenchmarkReads(database,{...process.env,VERIFICATION_BENCHMARK_READ_PUBLIC_KEYS_JSON:JSON.stringify([{keyId:fixture.publicKey.keyId,publicKeyPem:wrongKey}])})!;
 await assert.rejects(()=>wrongReads.getRun({tenantId,runId:fixture.benchmarkRunId}),error=>error instanceof Error&&"code" in error&&error.code==="INTEGRITY");checks.wrongTrustedKeyRejected=true;
 const unknownReads=createVerificationBenchmarkReads(database,{...process.env,VERIFICATION_BENCHMARK_READ_PUBLIC_KEYS_JSON:JSON.stringify([{keyId:"untrusted-other",publicKeyPem:fixture.publicKey.pem}])})!;
 await assert.rejects(()=>unknownReads.getRun({tenantId,runId:fixture.benchmarkRunId}),error=>error instanceof Error&&"code" in error&&error.code==="INTEGRITY");checks.unknownSigningKeyRejected=true;
 for(const action of ["show","manifest"]){const result=await cli(origin,action);assert.equal(result.code,0,result.stderr);const value=JSON.parse(result.stdout);(action==="show"?VerificationBenchmarkRunSummaryResourceSchema:VerificationBenchmarkRunManifestResourceSchema).parse(value);}checks.builtCliReads=true;
 mcp=buildKnowledgeMcpApp({operationService:new PostgresKnowledgeOperationService(database),apiOrigin:origin,resolveIdentity:value=>value===token?identity:undefined,createApiClient:accessToken=>new KnowledgeClient({baseUrl:origin,getAccessToken:()=>accessToken})});
 const mcpOrigin=await mcp.listen({host:"127.0.0.1",port:0}),require=createRequire(resolve("apps/mcp/package.json"));
 const {Client}=await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js")).href),{StreamableHTTPClientTransport}=await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/streamableHttp.js")).href);
 const protocolClient=new Client({name:"benchmark-read-proof",version:"1"});
 try{await protocolClient.connect(new StreamableHTTPClientTransport(new URL(`${mcpOrigin}/mcp`),{requestInit:{headers:{authorization:`Bearer ${token}`}}}));
  for(const name of ["knowledge_get_benchmark_run","knowledge_get_benchmark_manifest"]){const result=await protocolClient.callTool({name,arguments:{context,runId:fixture.benchmarkRunId}});assert.notEqual(result.isError,true);assert.equal(result.structuredContent.runId,fixture.benchmarkRunId);}
 }finally{await protocolClient.close();}checks.actualMcpHttpReads=true;
 const sourcePaths=["packages/persistence/src/verification-benchmark-reads.ts","packages/application/src/verification/benchmark/verification-benchmark-reads.ts","packages/contracts/src/verification/benchmark-reads.ts","apps/api/src/verification-benchmark-reads-runtime.ts","apps/api/src/server.ts","packages/client-typescript/src/client.ts","apps/cli/src/commands.ts","apps/mcp/src/index.ts","scripts/prove-verification-benchmark-reads.ts"];
 const sources=await Promise.all(sourcePaths.map(async path=>{const bytes=await readFile(path);return {path,digest:`sha256:${createHash("sha256").update(bytes).digest("hex")}`,bytesBase64:bytes.toString("base64")};}));
 const output=resolve(internal,`verification-benchmark-reads-${namespace}.json`);await writeFile(output,JSON.stringify({status:"passed",scope:"Read-only local completed benchmark SQL/Storage custody through configured HTTP, built CLI and actual MCP HTTP transport; no new benchmark execution",tenantId,checks,summaries,manifest,sources,externalProviderRequests:0},null,2));console.log(JSON.stringify({status:"passed",output,checks}));
}finally{await mcp?.close();await api.close();await database.close();}
