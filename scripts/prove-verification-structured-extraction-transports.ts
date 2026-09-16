import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {spawn} from "node:child_process";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import {PostgresCanonicalRepository,PostgresKnowledgeOperationService} from "@aiengineer/knowledge-persistence";
import {KnowledgeClient} from "@aiengineer/knowledge-client";
import {AcceptedOperationSchema,OperationContextSchema,VerificationStructuredExtractionResourceSchema} from "@aiengineer/knowledge-contracts";
import {createStructuredExtractionRequestAdmission,parseVerificationStructuredExtractionRuntimeConfig} from "@aiengineer/knowledge-application";
import {buildServer} from "../apps/api/src/server.js";
import {createVerificationStructuredExtractionReads} from "../apps/api/src/verification-structured-extraction-reads-runtime.js";
import {createVerificationOwnershipResolver} from "../apps/api/src/verification-ownership.js";
import {dispatchCliCommand,resolveCommand} from "../apps/cli/src/commands.js";
import {buildKnowledgeMcpApp,createStructuredExtractionReadMcpExecutor,createVerificationMcpToolExecutor} from "../apps/mcp/src/index.js";

for(const[value,port]of [[process.env.POSTGRES_URL!,"54322"],[process.env.SUPABASE_URL!,"54321"]]){const url=new URL(value!);if(!["localhost","127.0.0.1"].includes(url.hostname)||url.port!==port)throw new Error("LOCAL_ONLY_PROOF_REQUIRED");}
const fixtureName="verification-structured-extraction-worker-97976363-5591-40f7-b4a8-9d00fa805123.json",fixture=JSON.parse(await readFile(resolve("../internal",fixtureName),"utf8"));
const tenantId:string=fixture.tenantId,namespace=randomUUID(),actor={kind:"human" as const,id:randomUUID()},otherActor={kind:"human" as const,id:randomUUID()};
const database=new PostgresCanonicalRepository({connectionString:process.env.POSTGRES_URL!,localOnly:true}),operations:string[]=[],checks:Record<string,boolean>={},publicResults:unknown[]=[];
const original=fixture.results[0],ownership=(await database.transaction(tenantId,c=>c.query<{attempt_id:string;mission_id:string;work_item_id:string;agent_deployment_id:string}>("select o.attempt_id,o.mission_id,o.work_item_id,a.agent_deployment_id from knowledge_service.operation o join orchestration.attempt a on a.tenant_id=o.tenant_id and a.id=o.attempt_id where o.tenant_id=$1 and o.id=$2",[tenantId,original.operationId]))).rows[0]!;
const grants=JSON.stringify([{tenantId,actor,missionId:ownership.mission_id,agentDeploymentId:ownership.agent_deployment_id,capabilityVersion:"verification-service.v1"}]);
const identity={actor,grants:[{tenantId,roles:["knowledge_operator" as const,"knowledge_reader" as const],scopes:[]}]};
const reads=createVerificationStructuredExtractionReads(database,{...process.env,VERIFICATION_STRUCTURED_EXTRACTION_READ_PUBLIC_KEYS_JSON:JSON.stringify([{keyId:"configured-extraction-proof",publicKeyPem:fixture.publicKeyPem}]),VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON:grants})!;
const config=parseVerificationStructuredExtractionRuntimeConfig(JSON.stringify({schemaVersion:"verification-structured-extraction-runtime.v1",tenantId,providerId:original.providerId,grants:[original.grant],runtime:original.manifest.execution.manifest.runtime,parserImageDigest:"sha256:1669a3f9674b2e0a70ba1c8686c1cb3647492b8268bdfa7a9a4452fb0530fb37",executionMode:"synthetic_transport",trustedPublicKeys:{"configured-extraction-proof":fixture.publicKeyPem}}));
const service=new PostgresKnowledgeOperationService(database,{admittedOperationKinds:["verification_structured_extraction"]});
const server=buildServer({resolveIdentity:token=>token==="valid"?identity:token==="ungranted"?{...identity,actor:otherActor}:undefined,
  verificationStructuredExtractionReads:reads,verificationOperationService:service,resolveVerificationContext:createVerificationOwnershipResolver(database,grants),isStructuredExtractionRequestAdmitted:createStructuredExtractionRequestAdmission(config)});
try{
  const origin=await server.listen({host:"127.0.0.1",port:0});
  const client=new KnowledgeClient({baseUrl:origin,getAccessToken:()=>"valid"});
  const context=OperationContextSchema.parse({tenantId,operationId:randomUUID(),attemptId:ownership.attempt_id,workItemId:ownership.work_item_id,missionId:ownership.mission_id,actor,correlationId:namespace,idempotencyKey:`extract-${namespace}`,capabilityVersion:"verification-service.v1",reason:"Local transport admission proof",contractVersion:"v1"});
  const options={operationService:service,apiOrigin:origin,identity,apiClient:client};
  for(const item of fixture.results){
    const http=await client.getStructuredExtraction(item.operationId,context);
    assert.equal(http.output.status,item.scenario==="accepted"?"unverified_candidate":"failed");
    assert.deepEqual(http.output,item.result.receipt.body.output);
    assert.equal(http.publication.purpose,"artifact_custody_only");
    assert.ok(!JSON.stringify(http).includes("objectKey"));assert.ok(!JSON.stringify(http).includes("signatureBase64"));
    const cli=await dispatchCliCommand(client,resolveCommand("extraction","show")!,{operationId:item.operationId},context);
    const mcp=await createStructuredExtractionReadMcpExecutor(options)({context:{tenantId,correlationId:namespace},operationId:item.operationId});
    assert.deepEqual(cli,http);assert.ok("structuredContent" in mcp);assert.deepEqual(mcp.structuredContent,http);
    publicResults.push(http);checks[`${item.providerId}_${item.scenario}_http_cli_mcp_read`]=true;
  }
  const url=`${origin}/v1/verification/extractions/${original.operationId}`,headers={authorization:"Bearer valid","x-tenant-id":tenantId};
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url,{headers:{...headers,"x-tenant-id":randomUUID()}})).status,403);
  assert.equal((await fetch(url,{headers:{...headers,authorization:"Bearer ungranted"}})).status,404);
  assert.equal((await fetch(`${url}?publicKeyPem=caller`,{headers})).status,400);
  checks.public_read_identity_tenant_owner_and_no_caller_trust=true;
  await assert.rejects(client.extractStructuredData({...original.request,representation:{...original.request.representation,digest:`sha256:${"0".repeat(64)}`}},context));
  await assert.rejects(client.extractStructuredData(original.request,{...context,attemptId:randomUUID()}));
  checks.mutation_ungranted_input_and_attempt_rejected=true;
  const accepted=await client.extractStructuredData(original.request,context);operations.push(accepted.operationId);
  assert.equal((await client.extractStructuredData(original.request,context)).operationId,accepted.operationId);
  const cliAccepted=AcceptedOperationSchema.parse(await dispatchCliCommand(client,resolveCommand("extraction","run")!,original.request,{...context,idempotencyKey:`cli-${namespace}`}));operations.push(cliAccepted.operationId);
  const mcpAccepted=await createVerificationMcpToolExecutor(options)("knowledge_extract_structured_data",{context:{tenantId,correlationId:namespace,idempotencyKey:`mcp-${namespace}`,attemptId:ownership.attempt_id,workItemId:ownership.work_item_id,missionId:ownership.mission_id},request:original.request});
  assert.ok("structuredContent" in mcpAccepted);operations.push(AcceptedOperationSchema.parse(mcpAccepted.structuredContent).operationId);
  const runCli=(action:string,input:unknown)=>new Promise<unknown>((done,reject)=>{
    const child=spawn(process.execPath,[resolve("apps/cli/dist/index.js"),"extraction",action,"--base-url",origin,"--context",JSON.stringify({...context,idempotencyKey:`cli-process-${namespace}`}),"--input",JSON.stringify(input)],
      {windowsHide:true,env:{SYSTEMROOT:process.env.SYSTEMROOT,WINDIR:process.env.WINDIR,KNOWLEDGE_API_TOKEN:"valid"},stdio:["ignore","pipe","pipe"]});
    let stdout="",stderr="";const timer=setTimeout(()=>child.kill("SIGKILL"),30_000);
    child.stdout.on("data",value=>{stdout+=value;});child.stderr.on("data",value=>{stderr+=value;});
    child.on("error",error=>{clearTimeout(timer);reject(error);});
    child.on("close",code=>{clearTimeout(timer);try{assert.equal(code,0,stderr);done(JSON.parse(stdout));}catch(error){reject(error);}});
  });
  assert.deepEqual(await runCli("show",{operationId:original.operationId}),publicResults[0]);
  operations.push(AcceptedOperationSchema.parse(await runCli("run",original.request)).operationId);checks.built_cli_process_read_and_submission=true;
  const mcpApp=buildKnowledgeMcpApp({operationService:service,apiOrigin:origin,resolveIdentity:token=>token==="valid"?identity:undefined,createApiClient:token=>new KnowledgeClient({baseUrl:origin,getAccessToken:()=>token})});
  try{
    const mcpOrigin=await mcpApp.listen({host:"127.0.0.1",port:0}),require=createRequire(resolve("apps/mcp/package.json"));
    const {Client}=await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js")).href);
    const {StreamableHTTPClientTransport}=await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/streamableHttp.js")).href);
    const protocolClient=new Client({name:"extraction-transports-proof",version:"1"});
    try{
      await protocolClient.connect(new StreamableHTTPClientTransport(new URL(`${mcpOrigin}/mcp`),{requestInit:{headers:{authorization:"Bearer valid"}}}));
      const result=await protocolClient.callTool({name:"knowledge_get_structured_extraction",arguments:{context:{tenantId,correlationId:namespace},operationId:original.operationId}});
      assert.notEqual(result.isError,true);assert.deepEqual(result.structuredContent,publicResults[0]);
      const admitted=await protocolClient.callTool({name:"knowledge_extract_structured_data",arguments:{context:{tenantId,correlationId:namespace,idempotencyKey:`mcp-wire-${namespace}`,attemptId:ownership.attempt_id,workItemId:ownership.work_item_id,missionId:ownership.mission_id},request:original.request}});
      assert.notEqual(admitted.isError,true);operations.push(AcceptedOperationSchema.parse(admitted.structuredContent).operationId);
    }finally{await protocolClient.close();}
  }finally{await mcpApp.close();}
  checks.actual_mcp_streamable_http_read_and_submission=true;
  for(const operationId of operations){const op=await database.getOperation(tenantId,operationId);assert.equal(op?.status,"queued");assert.equal(op?.operationKind,"verification_structured_extraction");
    const rows=(await database.transaction(tenantId,c=>c.query("select count(*)::int count from orchestration.verification_provider_attempt where tenant_id=$1 and operation_id=$2",[tenantId,operationId]))).rows;assert.equal(rows[0]!.count,0);
  }
  checks.http_cli_mcp_canonical_admission_and_idempotency=true;
  assert.throws(()=>VerificationStructuredExtractionResourceSchema.parse({...publicResults[0] as object,objectKey:"private"}));checks.public_contract_rejects_private_extensions=true;
  const sourcePaths=["packages/contracts/src/verification/structured-extraction-reads.ts","packages/application/src/verification/operations/verification-structured-extraction-reads.ts","packages/application/src/verification/operations/verification-structured-extraction-runtime.ts","apps/api/src/verification-structured-extraction-reads-runtime.ts","apps/api/src/verification-ownership.ts","apps/api/src/server.ts","apps/api/src/index.ts","packages/client-typescript/src/client.ts","apps/cli/src/commands.ts","apps/mcp/src/index.ts","scripts/prove-verification-structured-extraction-transports.ts"];
  const sourceFiles=await Promise.all(sourcePaths.map(async path=>({path,sha256:createHash("sha256").update(await readFile(path)).digest("hex")})));
  for(const operationId of operations)await database.cancelOperation(tenantId,operationId,{actorIdentity:namespace,correlationId:namespace});
  const report={schemaVersion:"verification-structured-extraction-transports-proof.v1",createdAt:new Date().toISOString(),fixtureName,tenantId,checks,publicResults,admittedThenCancelledOperationIds:operations,sourceFiles,supplierRequests:0,
    limitations:["Real loopback HTTP, canonical database submission and original Storage publications","Five mutation operations deliberately cancelled while queued; no new provider execution or worker completion","Six-case CLI/MCP dispatchers plus one actual built CLI process and MCP Streamable HTTP read/submission each","Synthetic grant admitted through explicit buildServer test configuration; production API configuration requires live_provider mode","Owner denial uses actual attempt/work-item/mission grant query; no production authentication or remote deployment claim"]};
  const path=resolve("../internal/verification-structured-extraction-transports-20260906.json");await writeFile(path,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify({path,checks}));
}finally{await server.close();for(const operationId of operations){const op=await database.getOperation(tenantId,operationId);if(op&&!['cancelled','succeeded','failed'].includes(op.status))await database.cancelOperation(tenantId,operationId,{actorIdentity:namespace,correlationId:namespace});}await database.close();}
