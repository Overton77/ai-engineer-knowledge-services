import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {VerificationClaimsOperationResultSchema,VerificationReportOperationResultSchema,VerificationAdjudicationTerminalResourceSchema,type VerificationArtifactHandle} from "@aiengineer/knowledge-contracts";
import {VerificationAdmissionService,VerificationAuditInspectionGrantCatalog,VerificationClaimsProjectionGrantCatalog,VerificationAdjudicationReadService} from "@aiengineer/knowledge-application";
import {VERIFICATION_PARSER_LIMITS} from "@aiengineer/knowledge-conversion";
import {PostgresCanonicalRepository,PostgresVerificationRepository,PostgresVerificationAdjudicationReadRepository} from "@aiengineer/knowledge-persistence";
import {SupabaseArtifactStore} from "@aiengineer/knowledge-runtime";
import {canonicalizeJson,digestCanonicalJson} from "@aiengineer/knowledge-verification";
import {createVerificationAdjudicationRequestService} from "../apps/worker/src/verification-adjudication-runtime.js";
const proofPath=resolve(process.argv[2]??"../internal/verification-claims-report-worker-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json");
const proof=JSON.parse(await readFile(proofPath,"utf8")) as {namespace:string;tenantId:string;publicKeyPem:string;projection:{captureId:string;projectionArtifact:VerificationArtifactHandle;transformationArtifact:VerificationArtifactHandle};results:{claimsRecovery:{operationId:string;runId:string;manifestArtifact:VerificationArtifactHandle};reportRecovery:{operationId:string;runId:string;manifestArtifact:VerificationArtifactHandle}}};
const fixture=JSON.parse(await readFile(resolve("../internal/verification-frozen-source-registry-7a74a7a8-0dc4-4591-8bb1-5781ebddef42.json"),"utf8")) as {records:readonly{captureId:string;projections:readonly[{sourceArtifact:VerificationArtifactHandle;projectionArtifact:VerificationArtifactHandle;transformationArtifact:VerificationArtifactHandle;parserVersion:string;imageDigest:`sha256:${string}`}]}[]};
const nativeProjection=fixture.records.find(item=>item.captureId===proof.projection.captureId)?.projections[0];assert.ok(nativeProjection);assert.equal(digestCanonicalJson(nativeProjection.projectionArtifact),digestCanonicalJson(proof.projection.projectionArtifact));
// @ts-expect-error reviewed local-only helper intentionally lives outside the package graph.
const {loadVerifiedLocalDevelopmentConfig}=await import("../../internal/verification-local-direct-config.mjs") as {loadVerifiedLocalDevelopmentConfig():Promise<{DB_URL:string;API_URL:string;SECRET_KEY:string}>};
const local=await loadVerifiedLocalDevelopmentConfig();for(const [value,port] of [[local.DB_URL,"54322"],[local.API_URL,"54321"]] as const){const url=new URL(value);if(!["localhost","127.0.0.1"].includes(url.hostname)||url.port!==port)throw new Error("LOCAL_ONLY_AUDIT_PROOF_REQUIRED");}
import {KnowledgeClient} from "@aiengineer/knowledge-client";
import {buildServer} from "../apps/api/src/server.js";
import {createVerificationAdjudicationReads} from "../apps/api/src/verification-adjudication-reads-runtime.js";
import {dispatchCliCommand,resolveCommand} from "../apps/cli/src/commands.js";
import {createAdjudicationReadMcpExecutor} from "../apps/mcp/src/index.js";
let server:ReturnType<typeof buildServer>|undefined;
const tenantId=proof.tenantId,bucket="ai-engineer-cloud-bucket",kinds=["claims","report"] as const;
const nativePath=resolve("../internal/verification-adjudication-worker-ad8630a5-5fce-4041-8218-42a581215198.json");
const native=JSON.parse(await readFile(nativePath,"utf8"));
assert.equal(createHash("sha256").update(await readFile(nativePath)).digest("hex"),"ac0107dcb3226f2b3f603711c19e05651cfc4f4ef3495fbcd9644b176a1a4894");
const url=new URL(local.DB_URL);url.searchParams.set("options","-c default_transaction_read_only=on");
const database=new PostgresCanonicalRepository({connectionString:url.toString(),localOnly:true});
const counts=()=>database.transaction(tenantId,async client=>{assert.equal((await client.query<any>("show transaction_read_only")).rows[0].transaction_read_only,"on");return(await client.query<any>("select (select count(*)::int from knowledge_service.operation where tenant_id=$1) operations,(select count(*)::int from orchestration.artifact where tenant_id=$1) artifacts,(select count(*)::int from evidence.verification_adjudication_subject where tenant_id=$1) subjects",[tenantId])).rows[0];});
try{const before=await counts();
  const artifacts=new SupabaseArtifactStore({projectUrl:local.API_URL,serviceRoleKey:local.SECRET_KEY,bucket,maximumBytes:32_000_000});

  const repository=new PostgresVerificationRepository(database,artifacts,{async authorize(input){assert.equal(input.tenantId,tenantId);assert.ok(["verification_admission","verification_replay","policy_replay"].includes(input.purpose));}});
  const admission=new VerificationAdmissionService(repository,{async parse():Promise<never>{throw new Error("PARSER_FORBIDDEN_IN_AUDIT_PUBLIC_PROOF");}},{parserVersion:nativeProjection.parserVersion as "verification-native-parser.v1",imageDigest:nativeProjection.imageDigest,limits:VERIFICATION_PARSER_LIMITS},{storageBucket:bucket,producerVersion:"verification-admission.v1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",now:()=>new Date().toISOString()});
  async function sourceTerminal(kind:"claims"|"report"){const entry=kind==="claims"?proof.results.claimsRecovery:proof.results.reportRecovery,receipts=await database.listReceipts(tenantId,entry.operationId);assert.equal(receipts.length,1);const {eventId:_eventId,fencingToken:_fencingToken,...body}=receipts[0]!.body as Record<string,unknown>;return kind==="claims"?VerificationClaimsOperationResultSchema.parse(body):VerificationReportOperationResultSchema.parse(body);}
  const terminals={claims:await sourceTerminal("claims"),report:await sourceTerminal("report")};
  const projectionGrants=new VerificationClaimsProjectionGrantCatalog(kinds.map(kind=>({tenantId,assertions:{artifactId:terminals[kind].output.verified.assertionsArtifact.artifactId,digest:terminals[kind].output.verified.assertionsArtifact.digest},admissions:[{captureId:proof.projection.captureId,projectionArtifactId:nativeProjection.projectionArtifact.artifactId,transformationArtifactId:nativeProjection.transformationArtifact.artifactId}]})));
  const auditGrantValues=kinds.map(kind=>{const entry=kind==="claims"?proof.results.claimsRecovery:proof.results.reportRecovery;return{tenantId,auditArtifact:{artifactId:entry.manifestArtifact.artifactId,digest:entry.manifestArtifact.digest},runKind:kind};});
  const auditGrants=new VerificationAuditInspectionGrantCatalog(auditGrantValues);
  const dependencies={database,repository,admission,projectionGrants,auditGrants,trustedPublicKeys:{[`claims-report-proof-${proof.namespace}`]:proof.publicKeyPem},storageBucket:bucket,maximumInspectionMs:30_000,now:()=>new Date().toISOString(),subjects:{async commitPendingSubject():Promise<never>{throw new Error("WRITE_FORBIDDEN_IN_READ_PROOF");}}};
  const replay={async replayPacket(input:any){return createVerificationAdjudicationRequestService({...dependencies,reviewRequirements:input.reviewRequirements}).prepare(input.request,input.context,input.signal);}};


 const owners=await database.transaction(tenantId,async c=>(await c.query<any>(`select o.id,o.mission_id,a.agent_deployment_id,o.request->'authenticatedContext' context from knowledge_service.operation o join orchestration.attempt a on a.tenant_id=o.tenant_id and a.id=o.attempt_id where o.tenant_id=$1 and o.id=any($2::uuid[])`,[tenantId,native.results.map((v:any)=>v.operationId)])).rows);
 assert.equal(owners.length,8);const owner=owners[0],actor=owner.context.actor;
 for(const o of owners){assert.equal(canonicalizeJson(o.context.actor),canonicalizeJson(actor));assert.equal(o.mission_id,owner.mission_id);assert.equal(o.agent_deployment_id,owner.agent_deployment_id);assert.equal(o.context.capabilityVersion,owner.context.capabilityVersion);}
 const reads=createVerificationAdjudicationReads(database,{
 VERIFICATION_ADJUDICATION_PUBLIC_KEYS_JSON:JSON.stringify([{keyId:`claims-report-proof-${proof.namespace}`,publicKeyPem:proof.publicKeyPem}]),
 VERIFICATION_ADJUDICATION_GRANTS_JSON:JSON.stringify(auditGrantValues),
 VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON:JSON.stringify(kinds.map(kind=>({tenantId,assertions:{artifactId:terminals[kind].output.verified.assertionsArtifact.artifactId,digest:terminals[kind].output.verified.assertionsArtifact.digest},admissions:[{captureId:proof.projection.captureId,projectionArtifactId:nativeProjection.projectionArtifact.artifactId,transformationArtifactId:nativeProjection.transformationArtifact.artifactId}]}))),
 VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON:JSON.stringify([{tenantId,actor,missionId:owner.mission_id,agentDeploymentId:owner.agent_deployment_id,capabilityVersion:owner.context.capabilityVersion}]),
 SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SECRET_KEY,VERIFICATION_PARSER_IMAGE_DIGEST:nativeProjection.imageDigest,VERIFICATION_STORAGE_BUCKET:bucket});assert.ok(reads);
 const token=`adjudication-read-${randomUUID()}`,wrongToken=`unowned-${randomUUID()}`,otherTenant=randomUUID(),otherToken=`other-${randomUUID()}`;
 server=buildServer({verificationAdjudicationReadService:reads,resolveIdentity: t=>t===token?{actor,grants:[{tenantId,roles:["knowledge_reader"],scopes:[]}]}:t===wrongToken?{actor:{kind:"human",id:randomUUID()},grants:[{tenantId,roles:["knowledge_reader"],scopes:[]}]}:t===otherToken?{actor,grants:[{tenantId:otherTenant,roles:["knowledge_reader"],scopes:[]}]}:undefined});
 await server.listen({host:"127.0.0.1",port:0});const address=server.server.address();assert.ok(address&&typeof address!=="string");const baseUrl=`http://127.0.0.1:${address.port}`;
 const client=new KnowledgeClient({baseUrl,getAccessToken:()=>token});
 const results=[];
 for(const item of native.results){
  const context={...owner.context,tenantId,operationId:randomUUID(),correlationId:`public-adjudication-${item.operationId}`};
  const direct=await reads.getPendingSubject({tenantId,operationId:item.operationId,actor});
  const response=await fetch(`${baseUrl}/v1/verification/adjudications/${item.operationId}`,{headers:{authorization:`Bearer ${token}`,"x-tenant-id":tenantId,"x-correlation-id":context.correlationId}});assert.equal(response.status,200);
  const http=VerificationAdjudicationTerminalResourceSchema.parse(await response.json());
  const typed=await client.getAdjudicationSubject(item.operationId,context);
  const cli=await dispatchCliCommand(client as never,resolveCommand("adjudication","get")!,{operationId:item.operationId},context);
  const mcp=(await createAdjudicationReadMcpExecutor({operationService:{} as never,apiOrigin:baseUrl,identity:{actor,grants:[{tenantId,roles:["knowledge_reader"],scopes:[]}]},apiClient:client})({context:{tenantId,correlationId:context.correlationId},operationId:item.operationId}) as any).structuredContent;
  for(const v of [http,typed,cli,mcp])assert.equal(canonicalizeJson(v),canonicalizeJson(direct));
  for(const key of ["objectKey","requesterActor","requesterNote","storageBucket","BEGIN PUBLIC KEY"])assert.equal(JSON.stringify(direct).includes(key),false);
  results.push({operationId:item.operationId,kind:item.kind,subjectId:direct.output.subjectId,packetArtifact:direct.packetArtifact,surfaces:4});
 }
 const hostileChecks=[];
 for(const [name,id,auth,tenant,expected] of [
  ["unauthorized",native.results[0].operationId,"invalid",tenantId,401],
  ["unowned_actor",native.results[0].operationId,wrongToken,tenantId,404],
  ["wrong_tenant",native.results[0].operationId,otherToken,otherTenant,404],
  ["missing",native.deniedOperationId,token,tenantId,404],
  ["wrong_family",proof.results.claimsRecovery.operationId,token,tenantId,404],
  ["cancelled",native.cancelledOperationId,token,tenantId,422],
 ] as const){const r=await fetch(`${baseUrl}/v1/verification/adjudications/${id}`,{headers:{authorization:`Bearer ${auth}`,"x-tenant-id":tenant,"x-correlation-id":"negative-adjudication"}});assert.equal(r.status,expected,name);assert.equal(JSON.stringify(await r.json()).includes('"output"'),false);hostileChecks.push(name);}
 const after=await counts();assert.deepEqual(after,before);
 const paths=["packages/contracts/src/verification/adjudication-reads.ts","packages/application/src/verification-adjudication-reads.ts","packages/persistence/src/verification-adjudication-reads.ts","apps/api/src/verification-adjudication-reads-runtime.ts","apps/api/src/verification-ownership.ts","packages/persistence/src/verification-audit-runtime.ts","packages/persistence/src/verification-adjudication-runtime.ts","apps/api/src/server.ts","packages/client-typescript/src/client.ts","apps/cli/src/commands.ts","apps/mcp/src/index.ts","scripts/prove-verification-adjudication-public-reads.ts"];
 const sourceFiles=await Promise.all(paths.map(async path=>({path,sha256:createHash("sha256").update(await readFile(path)).digest("hex")})));
 const out=resolve("../internal",`verification-adjudication-public-reads-${randomUUID()}.json`);
 const receipt={schemaVersion:"verification-adjudication-public-reads-proof.v1",nativeProof:{path:nativePath,sha256:createHash("sha256").update(await readFile(nativePath)).digest("hex")},readOnly:true,results,hostileChecks,unchangedCounts:after,sourceFiles,limitations:["Local API, client, CLI dispatch and MCP executor; no external deployed server","Existing retained run targets; no human decision or admission mutation"]};
 await writeFile(out,JSON.stringify(receipt,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({out,sha256:createHash("sha256").update(await readFile(out)).digest("hex"),results:results.length,hostileChecks:hostileChecks.length}));
}finally{if(server)await server.close();await database.close();}
