import assert from "node:assert/strict";
import { createHash,randomUUID } from "node:crypto";
import { readFile,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { VerificationClaimsTerminalResourceSchema,VerificationReportTerminalResourceSchema,type Actor,type OperationContext,type VerificationClaimsTerminalResource,type VerificationReportTerminalResource } from "@aiengineer/knowledge-contracts";
import { PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import { KnowledgeClient } from "@aiengineer/knowledge-client";
import { canonicalizeJson } from "@aiengineer/knowledge-verification";
import { buildServer } from "../apps/api/src/server.js";
import { createVerificationClaimsReportReads } from "../apps/api/src/verification-claims-report-reads-runtime.js";
import { dispatchCliCommand,resolveCommand } from "../apps/cli/src/commands.js";
import { createClaimsReportReadMcpExecutor } from "../apps/mcp/src/index.js";

type Proof={namespace:string;tenantId:string;publicKeyPem:string;results:{claimsRecovery:{operationId:string};reportRecovery:{operationId:string}}};
type OwnershipRow={id:string;mission_id:string;agent_deployment_id:string;capability_version:string;actor:Actor;external_execution:unknown};
const sourceProofPath=resolve(process.argv[2]??"../internal/verification-claims-report-worker-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json");
const proof=JSON.parse(await readFile(sourceProofPath,"utf8")) as Proof;
const outputPath=resolve(process.argv[3]??`../internal/verification-claims-report-read-transports-${randomUUID()}.json`);
// @ts-expect-error reviewed local-only helper intentionally lives outside the package graph.
const {loadVerifiedLocalDevelopmentConfig}=await import("../../internal/verification-local-direct-config.mjs") as {loadVerifiedLocalDevelopmentConfig():Promise<{DB_URL:string;API_URL:string;SECRET_KEY:string}>};
const local=await loadVerifiedLocalDevelopmentConfig();
for(const [value,port] of [[local.DB_URL,"54322"],[local.API_URL,"54321"]] as const){const url=new URL(value);assert.ok(["localhost","127.0.0.1"].includes(url.hostname));assert.equal(url.port,port);}
const readOnlyUrl=new URL(local.DB_URL);readOnlyUrl.searchParams.set("options","-c default_transaction_read_only=on");
const database=new PostgresCanonicalRepository({connectionString:readOnlyUrl.toString(),localOnly:true});
let server:ReturnType<typeof buildServer>|undefined;

try{
  const operationIds=[proof.results.claimsRecovery.operationId,proof.results.reportRecovery.operationId];
  const {readOnly,rows,before}=await database.transaction(proof.tenantId,async client=>{
    const readOnly=(await client.query<{transaction_read_only:string}>("show transaction_read_only")).rows[0]!.transaction_read_only;
    const rows=(await client.query<OwnershipRow>(`select o.id,o.mission_id,a.agent_deployment_id,
      o.request->'authenticatedContext'->>'capabilityVersion' capability_version,
      o.request->'authenticatedContext'->'actor' actor,
      o.request->'authenticatedContext'->'externalExecution' external_execution
      from knowledge_service.operation o join orchestration.attempt a on a.tenant_id=o.tenant_id and a.id=o.attempt_id
      where o.tenant_id=$1 and o.id=any($2::uuid[]) order by o.id`,[proof.tenantId,operationIds])).rows;
    const before=(await client.query<{operations:number;artifacts:number}>(`select
      (select count(*)::int from knowledge_service.operation where tenant_id=$1) operations,
      (select count(*)::int from orchestration.artifact where tenant_id=$1) artifacts`,[proof.tenantId])).rows[0]!;
    return{readOnly,rows,before};
  });
  assert.equal(readOnly,"on");assert.equal(rows.length,2);
  const grants=[] as Array<Record<string,unknown>>;const seen=new Set<string>();
  for(const row of rows){const key=canonicalizeJson([row.mission_id,row.agent_deployment_id,row.capability_version,row.actor,row.external_execution]);if(seen.has(key))continue;seen.add(key);grants.push({tenantId:proof.tenantId,actor:row.actor,missionId:row.mission_id,agentDeploymentId:row.agent_deployment_id,capabilityVersion:row.capability_version,...(row.external_execution?{externalExecution:row.external_execution}:{})});}
  const reads=createVerificationClaimsReportReads(database,{VERIFICATION_CLAIMS_REPORT_READ_PUBLIC_KEYS_JSON:JSON.stringify([{keyId:`claims-report-proof-${proof.namespace}`,publicKeyPem:proof.publicKeyPem}]),VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON:JSON.stringify(grants),SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SECRET_KEY,VERIFICATION_STORAGE_BUCKET:"ai-engineer-cloud-bucket"});assert.ok(reads);
  const tokens=new Map(rows.map(row=>[row.id,`claims-report-read-${row.id}-${randomUUID()}`])),wrongTenant=randomUUID(),wrongTenantToken=`claims-report-wrong-tenant-${randomUUID()}`,unownedActorToken=`claims-report-unowned-actor-${randomUUID()}`,unownedActor:Actor={kind:"service",id:randomUUID(),serviceIdentity:"knowledge_worker"};
  server=buildServer({verificationClaimsReportReads:reads,resolveIdentity:candidate=>{const row=rows.find(item=>tokens.get(item.id)===candidate);if(row)return{actor:row.actor,grants:[{tenantId:proof.tenantId,roles:["knowledge_reader"],scopes:[]}]};if(candidate===wrongTenantToken)return{actor:rows[0]!.actor,grants:[{tenantId:wrongTenant,roles:["knowledge_reader"],scopes:[]}]};if(candidate===unownedActorToken)return{actor:unownedActor,grants:[{tenantId:proof.tenantId,roles:["knowledge_reader"],scopes:[]}]};return undefined;}});
  await server.listen({host:"127.0.0.1",port:0});const address=server.server.address();assert.ok(address&&typeof address!=="string");const baseUrl=`http://127.0.0.1:${address.port}`;
  const results=[] as Array<{family:"claims"|"report";surface:string;operationId:string;resultArtifact:unknown;manifestArtifact:unknown;policyOutcome:string}>;
  for(const family of ["claims","report"] as const){
    const operationId=family==="claims"?proof.results.claimsRecovery.operationId:proof.results.reportRecovery.operationId;
    const row=rows.find(item=>item.id===operationId);assert.ok(row);const actor=row.actor,token=tokens.get(operationId);assert.ok(token);
    const client=new KnowledgeClient({baseUrl,getAccessToken:()=>token});
    const context:OperationContext={tenantId:proof.tenantId,operationId:randomUUID(),attemptId:randomUUID(),correlationId:`claims-report-public-read-${family}`,actor,capabilityVersion:"claims-report-public-read.v1",idempotencyKey:`read-only-${randomUUID()}`,reason:"read-only retained public claims/report proof",contractVersion:"v1"};
    const headers={authorization:`Bearer ${token}`,"x-tenant-id":proof.tenantId,"x-correlation-id":context.correlationId};
    const schema=family==="claims"?VerificationClaimsTerminalResourceSchema:VerificationReportTerminalResourceSchema;
    const path=family==="claims"?`/v1/verification/claims/${operationId}`:`/v1/verification/reports/${operationId}`;
    const direct:VerificationClaimsTerminalResource|VerificationReportTerminalResource=family==="claims"?await reads.getClaims({tenantId:proof.tenantId,operationId,actor}):await reads.getReport({tenantId:proof.tenantId,operationId,actor});
    const httpResponse=await fetch(`${baseUrl}${path}`,{headers});assert.equal(httpResponse.status,200);const http=schema.parse(await httpResponse.json());
    const typed=family==="claims"?await client.getVerificationClaimsResult(operationId,context):await client.getVerificationReportResult(operationId,context);
    const cli=await dispatchCliCommand(client as never,resolveCommand("verify",family==="claims"?"claims-result":"report-result")!,{operationId},context);
    const mcp=(await createClaimsReportReadMcpExecutor({operationService:{} as never,apiOrigin:baseUrl,identity:{actor,grants:[{tenantId:proof.tenantId,roles:["knowledge_reader"],scopes:[]}]},apiClient:client},family)({context:{tenantId:proof.tenantId,correlationId:context.correlationId},operationId}) as {structuredContent:unknown}).structuredContent;
    for(const candidate of [http,typed,cli,mcp])assert.equal(canonicalizeJson(schema.parse(candidate)),canonicalizeJson(direct));
    const serialized=JSON.stringify(direct);for(const forbidden of ["objectKey","rawBundle","providerResponse","BEGIN PUBLIC KEY","selectorResolutions","missingQualifierAssertionIds","pointerFailures"]){assert.equal(serialized.includes(forbidden),false);}
    results.push({family,surface:"http+typescript-client+cli+mcp",operationId,resultArtifact:direct.resultArtifact,manifestArtifact:direct.sealedRun.manifestArtifact,policyOutcome:direct.sealedRun.policyOutcome});
  }
  const claimsToken=tokens.get(proof.results.claimsRecovery.operationId);assert.ok(claimsToken);const readHeaders={authorization:`Bearer ${claimsToken}`,"x-tenant-id":proof.tenantId,"x-correlation-id":"claims-report-negative-read"};
  const unauthorized=await fetch(`${baseUrl}/v1/verification/claims/${operationIds[0]}`,{headers:{...readHeaders,authorization:"Bearer invalid-token"}});assert.equal(unauthorized.status,401);
  const missing=await fetch(`${baseUrl}/v1/verification/claims/00000000-0000-4000-8000-000000000000`,{headers:readHeaders});assert.equal(missing.status,404);assert.equal(JSON.stringify(await missing.json()).includes("output"),false);
  const wrongFamily=await fetch(`${baseUrl}/v1/verification/reports/${proof.results.claimsRecovery.operationId}`,{headers:readHeaders});assert.equal(wrongFamily.status,404);assert.equal(JSON.stringify(await wrongFamily.json()).includes("output"),false);
  const wrongTenantResponse=await fetch(`${baseUrl}/v1/verification/claims/${proof.results.claimsRecovery.operationId}`,{headers:{authorization:`Bearer ${wrongTenantToken}`,"x-tenant-id":wrongTenant,"x-correlation-id":"wrong-tenant"}});assert.equal(wrongTenantResponse.status,404);assert.equal(JSON.stringify(await wrongTenantResponse.json()).includes("output"),false);
  const unownedActorResponse=await fetch(`${baseUrl}/v1/verification/claims/${proof.results.claimsRecovery.operationId}`,{headers:{authorization:`Bearer ${unownedActorToken}`,"x-tenant-id":proof.tenantId,"x-correlation-id":"unowned-actor"}});assert.equal(unownedActorResponse.status,404);assert.equal(JSON.stringify(await unownedActorResponse.json()).includes("output"),false);
  const after=await database.transaction(proof.tenantId,async client=>(await client.query<{operations:number;artifacts:number}>(`select
    (select count(*)::int from knowledge_service.operation where tenant_id=$1) operations,
    (select count(*)::int from orchestration.artifact where tenant_id=$1) artifacts`,[proof.tenantId])).rows[0]!);
  assert.deepEqual(after,before);
  const sourcePaths=["packages/contracts/src/verification/claims-report-reads.ts","packages/application/src/verification/operations/verification-claims-report-reads.ts","packages/persistence/src/verification-claims-report-reads.ts","apps/api/src/verification-claims-report-reads-runtime.ts","apps/api/src/verification-ownership.ts","apps/api/src/server.ts","apps/api/src/index.ts","packages/client-typescript/src/client.ts","apps/cli/src/commands.ts","apps/mcp/src/index.ts","scripts/prove-verification-claims-report-read-transports.ts"];
  const sourceFiles=await Promise.all(sourcePaths.map(async path=>({path,sha256:createHash("sha256").update(await readFile(path)).digest("hex")})));
  const receipt={schemaVersion:"verification-claims-report-read-transports-proof.v1",sourceProof:{path:sourceProofPath,sha256:createHash("sha256").update(await readFile(sourceProofPath)).digest("hex")},tenantId:proof.tenantId,createdAt:new Date().toISOString(),checks:{database_default_transaction_read_only:true,server_owned_signature_and_ownership_trust:true,http_client_cli_mcp_exact_claims_read:true,http_client_cli_mcp_exact_report_read:true,strict_compact_outputs:true,unauthorized_read_rejected:true,missing_read_discloses_no_result:true,wrong_family_rejected:true,wrong_tenant_rejected:true,authenticated_unowned_actor_rejected:true,native_operation_and_artifact_counts_unchanged:true},results,parserDispatches:0,providerDispatches:0,sourceFiles};
  await writeFile(outputPath,JSON.stringify(receipt,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({output:outputPath,sha256:createHash("sha256").update(await readFile(outputPath)).digest("hex"),checks:Object.keys(receipt.checks).length,parserDispatches:0,providerDispatches:0}));
}finally{if(server)await server.close();await database.close();}
