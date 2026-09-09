import {createVerificationAdjudicationDecisionRuntime} from "../apps/api/src/verification-adjudication-decision-runtime.js";
import {buildServer} from "../apps/api/src/server.js";
import {KnowledgeClient} from "../packages/client-typescript/src/index.js";
import {dispatchCliCommand,resolveCommand} from "../apps/cli/src/commands.js";
import {createAdjudicationDecisionReadMcpExecutor} from "../apps/mcp/src/index.js";
import {PostgresVerificationAdjudicationDecisionReadRepository} from "../packages/persistence/src/verification-adjudication-decision-reads.js";
import {PostgresKnowledgeOperationService} from "@aiengineer/knowledge-persistence";
import {CanonicalActivityRegistry,createCanonicalActivityExecutor} from "../apps/worker/src/activity-registry.js";
import {CanonicalDurableKnowledgeWorker} from "../apps/worker/src/canonical-worker.js";
import {createVerificationAdjudicationDecisionHandler} from "../apps/worker/src/verification-adjudication-decision-runtime.js";
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
const tenantId=proof.tenantId,bucket="ai-engineer-cloud-bucket",kinds=["claims","report"] as const;
const nativePath=resolve("../internal/verification-adjudication-worker-46b38b61-da1f-454d-8ca8-2be87b887f1b.json");
const native=JSON.parse(await readFile(nativePath,"utf8"));
const url=new URL(local.DB_URL);url.searchParams.set("options","-c default_transaction_read_only=on");
const database=new PostgresCanonicalRepository({connectionString:url.toString(),localOnly:true});
try{
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

 const readRepository=new PostgresVerificationAdjudicationReadRepository(database,()=>repository.createTrustedArtifactResolver(),replay);
 const service=new VerificationAdjudicationReadService(readRepository);

 const operationId="255bfea1-57f2-4798-8705-7bb5dd1d6aa3";
 const ownership=await database.transaction(tenantId,async c=>(await c.query("select o.mission_id,o.request->'authenticatedContext' context,a.agent_deployment_id from knowledge_service.operation o join orchestration.attempt a on a.tenant_id=o.tenant_id and a.id=o.attempt_id where o.tenant_id=$1 and o.id=$2",[tenantId,operationId])).rows[0]);
 assert.ok(ownership);
 const actor={kind:"service" as const,id:randomUUID(),serviceIdentity:"mission_control_client" as const};
 const environment={VERIFICATION_ADJUDICATION_DECISIONS_ENABLED:"1",VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON:JSON.stringify([{tenantId,actor,missionId:ownership.mission_id,agentDeploymentId:ownership.agent_deployment_id,capabilityVersion:ownership.context.capabilityVersion}]),VERIFICATION_ADJUDICATION_PUBLIC_KEYS_JSON:JSON.stringify([{keyId:`claims-report-proof-${proof.namespace}`,publicKeyPem:proof.publicKeyPem}]),VERIFICATION_ADJUDICATION_GRANTS_JSON:JSON.stringify(auditGrantValues),VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON:JSON.stringify(kinds.map(kind=>({tenantId,assertions:{artifactId:terminals[kind].output.verified.assertionsArtifact.artifactId,digest:terminals[kind].output.verified.assertionsArtifact.digest},admissions:[{captureId:proof.projection.captureId,projectionArtifactId:nativeProjection.projectionArtifact.artifactId,transformationArtifactId:nativeProjection.transformationArtifact.artifactId}]}))),SUPABASE_URL:local.API_URL,SUPABASE_SECRET_KEY:local.SECRET_KEY,VERIFICATION_PARSER_IMAGE_DIGEST:nativeProjection.imageDigest};
 const runtime=createVerificationAdjudicationDecisionRuntime(database,environment);assert.ok(runtime);
 const identity={actor,grants:[{tenantId,roles:["knowledge_operator" as const],scopes:[]}]};
 const server=buildServer({...runtime,resolveIdentity:token=>token==="decision-proof"?identity:{...identity,actor:{...actor,id:randomUUID()}}});
 try{
  const baseUrl=await server.listen({host:"127.0.0.1",port:0});
  const client=new KnowledgeClient({baseUrl,getAccessToken:()=>"decision-proof"});
  const context={tenantId,correlationId:randomUUID()};
  const http=await client.getAdjudicationDecision(operationId,context);
  assert.equal(http.terminalFencingToken,839);assert.equal(http.output.reviewerProvenance,"synthetic_engineering");
  const cli=await dispatchCliCommand(client,resolveCommand("adjudication","get-decision")!,{operationId},context as never);assert.deepEqual(cli,http);
  const mcp=await createAdjudicationDecisionReadMcpExecutor({operationService:{} as never,apiOrigin:baseUrl,identity,apiClient:client})({context,operationId});assert.deepEqual(mcp.structuredContent,http);
  const denied=await fetch(`${baseUrl}/v1/verification/adjudication-decisions/${operationId}`,{headers:{authorization:"Bearer foreign","x-tenant-id":tenantId}});assert.equal(denied.status,404);
  const request={verificationContractVersion:"verification.v1" as const,subjectId:http.output.subjectId,packetArtifact:http.output.packetArtifact,decision:"affirm" as const,rationale:"Denied non-reviewer fixture"};
  assert.equal(await runtime.isAdjudicationDecisionAdmitted({request,context:{...ownership.context,actor}}),false);
  for(const forbidden of ["objectKey","storageBucket","rationale","reviewer_actor_id"])assert.equal(JSON.stringify(http).includes(forbidden),false);
  const output=resolve(`../internal/verification-decision-native-public-read-${randomUUID()}.json`);
  await writeFile(output,JSON.stringify({tenantId,operationId,result:http,surfaces:["HTTP client real loopback socket","CLI dispatch via HTTP","MCP executor via HTTP"],deniedActorStatus:denied.status,nonReviewerAdmission:false,readOnly:true,providerCalls:0,limitations:["Retained synthetic decision; no human quality evidence","Public GET runtime factory; full API startup and POST-to-worker-to-dashboard proof remain"]},null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({output,passed:true}));
 }finally{await server.close();}
}finally{await database.close();}