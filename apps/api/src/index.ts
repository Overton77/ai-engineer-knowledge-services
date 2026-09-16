import {createVerificationProviderReconciliationService} from "./verification-provider-reconciliation-runtime.js";
import { createVerificationCaptureReads } from "./verification-capture-reads-runtime.js";
import { createVerificationBenchmarkCaptureProfileResolver } from "./verification-benchmark-capture-profile.js";
import {createVerificationSemanticReconciliationService} from "./verification-semantic-reconciliation-runtime.js";
import {parseVerificationStructuredExtractionRuntimeConfig,createStructuredExtractionRequestAdmission,VerificationAuditInspectionGrantCatalog,VerificationClaimsProjectionGrantCatalog,VerificationSealPolicyCatalog,VerificationServiceCatalog} from "@aiengineer/knowledge-application";
import { createLocalIdentityResolver, loadServerConfig } from "@aiengineer/knowledge-config";
import { EvidencePacketSchema, ExternalExecutionContextSchema, VerificationAdjudicationReviewRequirementsSchema, type InspectAuditBundleRequest, type ParseArtifactRequest, type RequestAdjudicationRequest, type VerificationOperationContextHints } from "@aiengineer/knowledge-contracts";
import { parseVerificationBenchmarkComparisonRuntimeConfig,parseVerificationBenchmarkRuntimeConfig,apiOwnedOperationKinds,verificationServiceOperationKinds } from "@aiengineer/knowledge-application";
import { PostgresCallbackReplayStore, PostgresCanonicalRepository, PostgresKnowledgeOperationService, PostgresVerificationComponentDriftPublisher, PostgresVerificationRepository, createRemoteRetrievalArtifactReader } from "@aiengineer/knowledge-persistence";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { buildServer } from "./server.js";
import { createCallbackSigningSecretResolver } from "./a2a-http.js";
import { createGatewayEmbeddingAdapterFromEnvironment } from "@aiengineer/knowledge-embeddings";
import { CanonicalRetrievalExecutor } from "./retrieval-executor.js";
import { deterministicUuid, SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { UuidSchema } from "@aiengineer/knowledge-contracts";
import { createVerificationOwnershipResolver } from "./verification-ownership.js";
import { createVerificationReads } from "./verification-reads-runtime.js";
import { createVerificationBenchmarkReads } from "./verification-benchmark-reads-runtime.js";
import {createVerificationBenchmarkComparisonReads} from "./verification-benchmark-comparison-reads-runtime.js";
import {createVerificationStructuredExtractionReads} from "./verification-structured-extraction-reads-runtime.js";
import {createVerificationAuditInspectionReads} from "./verification-audit-inspection-reads-runtime.js";
import {createVerificationClaimsReportReads} from "./verification-claims-report-reads-runtime.js";
import {createVerificationAdjudicationDecisionRuntime} from "./verification-adjudication-decision-runtime.js";
import {createVerificationAdjudicationReads} from "./verification-adjudication-reads-runtime.js";
import {parseBenchmarkReadPublicKeys} from "./verification-benchmark-reads-runtime.js";
import { createVerificationDriftRevalidationRuntime } from "./verification-drift-revalidation-runtime.js";

// Trusted host composition injects the same accounted adapter used by selected publication.
export { buildServer, CanonicalRetrievalExecutor };

type Environment = Readonly<Record<string, string | undefined>>;

export function validateApiPublicOrigin(
  value: string | undefined,
  production: boolean,
): string | undefined {
  if (!value?.trim()) {
    if (production) throw new Error("KNOWLEDGE_API_URL_REQUIRED");
    return undefined;
  }
  const url = new URL(value);
  if (
    url.username || url.password || url.search || url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && !production))
  ) throw new Error("INVALID_KNOWLEDGE_API_URL");
  return url.origin;
}

export async function createApiRuntime(environment: Environment = process.env) {
  const config = loadServerConfig(environment as NodeJS.ProcessEnv);
  const connectionString = environment.POSTGRES_URL?.trim();
  if (config.NODE_ENV === "production" && !connectionString)
    throw new Error("POSTGRES_URL_REQUIRED");
  const publicOrigin = validateApiPublicOrigin(
    environment.KNOWLEDGE_API_URL,
    config.NODE_ENV === "production",
  );
  const database = connectionString
    ? new PostgresCanonicalRepository({
        connectionString,
        ...(environment.CANONICAL_LOCAL_ONLY === "1" ? { localOnly:true } : {}),
      })
    : undefined;
  const driftEnabled=environment.VERIFICATION_DRIFT_REVALIDATION_ENABLED?.trim()??"0";
  if(!["0","1"].includes(driftEnabled))throw new Error("VERIFICATION_DRIFT_REVALIDATION_ENABLED_INVALID");
  const driftAllowlistRaw=environment.VERIFICATION_DRIFT_CONSUMER_SERVICE_IDENTITIES_JSON?.trim();
  let verificationDriftRevalidation:ReturnType<typeof createVerificationDriftRevalidationRuntime>|undefined;
  if(driftEnabled==="1"){
    if(!database||!driftAllowlistRaw||driftAllowlistRaw.length>16_384)throw new Error("VERIFICATION_DRIFT_REVALIDATION_RUNTIME_REQUIRED");
    const componentMonitorsRaw=environment.VERIFICATION_COMPONENT_DRIFT_MONITORS_JSON?.trim();
    const componentPublicKeysRaw=environment.VERIFICATION_COMPONENT_DRIFT_PUBLIC_KEYS_JSON?.trim();
    let component:Parameters<typeof createVerificationDriftRevalidationRuntime>[4];
    if(componentMonitorsRaw&&componentPublicKeysRaw){
      const projectUrl=environment.SUPABASE_URL?.trim(),serviceRoleKey=environment.SUPABASE_SECRET_KEY?.trim();
      if(!projectUrl||!serviceRoleKey)throw new Error("VERIFICATION_COMPONENT_DRIFT_STORAGE_REQUIRED");
      const storageBucket=environment.VERIFICATION_STORAGE_BUCKET?.trim()||"ai-engineer-cloud-bucket";
      const store=new SupabaseArtifactStore({projectUrl,serviceRoleKey,bucket:storageBucket,maximumBytes:4_194_304});
      component={forTenant(tenantId){
        const repository=new PostgresVerificationRepository(database,store,{async authorize(input){
          if(input.tenantId!==tenantId||input.purpose!=="verification_replay")throw new Error("COMPONENT_DRIFT_ARTIFACT_DENIED");
        }});
        return {
          createResolver:()=>repository.createTrustedArtifactResolver(),
          publisher:new PostgresVerificationComponentDriftPublisher(database,repository,{storageBucket}),
        };
      }};
    }
    verificationDriftRevalidation=createVerificationDriftRevalidationRuntime(database,driftAllowlistRaw,componentMonitorsRaw,componentPublicKeysRaw,component);
  } else if(driftAllowlistRaw) throw new Error("VERIFICATION_DRIFT_REVALIDATION_DISABLED_CONFIG_PRESENT");
  const gatewayConfigured = Boolean(
    environment.AI_GATEWAY_API_KEY?.trim() || environment.VERCEL_OIDC_TOKEN?.trim(),
  );
  const canonicalRetrievalExecutor = database && gatewayConfigured
    ? new CanonicalRetrievalExecutor(
        database,
        createGatewayEmbeddingAdapterFromEnvironment(environment as NodeJS.ProcessEnv),
      )
    : undefined;
  // Citation replay reads sealed bytes from remote object custody, never from producer files.
  const retrievalStorageUrl=environment.SUPABASE_URL?.trim(),retrievalStorageKey=environment.SUPABASE_SECRET_KEY?.trim();
  const retrievalBuckets=(environment.KNOWLEDGE_RETRIEVAL_ARTIFACT_BUCKETS?.trim()||"ai-engineer-cloud-bucket")
    .split(",").map(bucket=>bucket.trim()).filter(Boolean);
  const replayEvidencePacketCitations=database&&retrievalStorageUrl&&retrievalStorageKey
    ? (()=>{const read=createRemoteRetrievalArtifactReader(database,{projectUrl:retrievalStorageUrl,serviceRoleKey:retrievalStorageKey,buckets:retrievalBuckets});
        return (tenantId:string,packetId:string)=>database.replayEvidencePacketCitations(tenantId,packetId,read);})()
    : undefined;
  const verificationAttemptId=environment.VERIFICATION_SERVICE_ATTEMPT_ID?.trim();
  const ownershipGrants=environment.VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON?.trim();
  const eveRuntimeAttestationKeysJson=environment.VERIFICATION_EVE_RUNTIME_ATTESTATION_KEYS_JSON?.trim();
  if(config.NODE_ENV==="production"&&verificationAttemptId&&!ownershipGrants)throw new Error("VERIFICATION_OWNERSHIP_GRANTS_REQUIRED");
  const dynamicVerificationContext=database&&ownershipGrants?createVerificationOwnershipResolver(database,ownershipGrants,eveRuntimeAttestationKeysJson?{eveRuntimeAttestationKeysJson}:{}):undefined;
  const verificationConfigured=Boolean(database&&(dynamicVerificationContext||verificationAttemptId));
  const benchmarkRaw=environment.VERIFICATION_BENCHMARK_CONFIG_JSON?.trim();
  const benchmarkConfig=benchmarkRaw?parseVerificationBenchmarkRuntimeConfig(benchmarkRaw):undefined;
  if(benchmarkConfig&&!dynamicVerificationContext)throw new Error("BENCHMARK_RUNTIME_OWNERSHIP_GRANTS_REQUIRED");
  const comparisonRaw=environment.VERIFICATION_BENCHMARK_COMPARISON_CONFIG_JSON?.trim();
  const comparisonConfig=comparisonRaw?parseVerificationBenchmarkComparisonRuntimeConfig(comparisonRaw):undefined;
  if(comparisonConfig&&!dynamicVerificationContext)throw new Error("BENCHMARK_COMPARISON_OWNERSHIP_GRANTS_REQUIRED");
  const extractionRaw=environment.VERIFICATION_STRUCTURED_EXTRACTION_CONFIG_JSON?.trim();
  const extractionConfig=extractionRaw?parseVerificationStructuredExtractionRuntimeConfig(extractionRaw):undefined;
  if(extractionConfig&&(!dynamicVerificationContext||extractionConfig.executionMode!=="live_provider"))throw new Error("STRUCTURED_EXTRACTION_API_OWNERSHIP_AND_LIVE_RUNTIME_REQUIRED");
  if(extractionConfig)parseBenchmarkReadPublicKeys(JSON.stringify(Object.entries(extractionConfig.trustedPublicKeys).map(([keyId,publicKeyPem])=>({keyId,publicKeyPem}))));
  const metricEnabled=environment.VERIFICATION_METRIC_ENABLED?.trim();
  if(metricEnabled&&metricEnabled!=="0"&&metricEnabled!=="1")throw new Error("INVALID_VERIFICATION_METRIC_ENABLED");
  if(metricEnabled==="1"&&!dynamicVerificationContext)throw new Error("VERIFICATION_METRIC_OWNERSHIP_GRANTS_REQUIRED");
  const claimsEnabled=environment.VERIFICATION_CLAIMS_ENABLED?.trim();
  if(claimsEnabled&&claimsEnabled!=="0"&&claimsEnabled!=="1")throw new Error("INVALID_VERIFICATION_CLAIMS_ENABLED");
  if(claimsEnabled==="1"&&!dynamicVerificationContext)throw new Error("VERIFICATION_CLAIMS_OWNERSHIP_GRANTS_REQUIRED");
  const auditInspectionEnabled=environment.VERIFICATION_AUDIT_INSPECTION_ENABLED?.trim();
  if(auditInspectionEnabled&&auditInspectionEnabled!=="0"&&auditInspectionEnabled!=="1")throw new Error("INVALID_VERIFICATION_AUDIT_INSPECTION_ENABLED");
  if(auditInspectionEnabled==="1"&&!dynamicVerificationContext)throw new Error("VERIFICATION_AUDIT_INSPECTION_OWNERSHIP_GRANTS_REQUIRED");
  let isAuditInspectionRequestAdmitted:((tenantId:string,request:InspectAuditBundleRequest)=>Promise<boolean>)|undefined;
  if(auditInspectionEnabled==="1"){
    const raw=environment.VERIFICATION_AUDIT_INSPECTION_GRANTS_JSON?.trim();
    if(!raw||raw.length>262_144)throw new Error("VERIFICATION_AUDIT_INSPECTION_RUNTIME_GRANTS_REQUIRED");
    let grants:unknown;try{grants=JSON.parse(raw);}catch{throw new Error("VERIFICATION_AUDIT_INSPECTION_RUNTIME_GRANTS_INVALID");}
    const catalog=new VerificationAuditInspectionGrantCatalog(grants);
    isAuditInspectionRequestAdmitted=async(tenantId,request)=>{
      let grant;try{grant=catalog.resolve(tenantId,request);}catch(error){if(error instanceof Error&&error.message==="VERIFICATION_AUDIT_INSPECTION_GRANT_REQUIRED")return false;throw error;}
      if(!database)return false;
      const expectedKind=grant.runKind==="claims"?"verification_claims":"verification_report";
      const rows=await database.transaction(tenantId,async client=>(await client.query<{operation_kind:string;status:string}>(`select o.operation_kind,o.status from evidence.verification_run r join knowledge_service.operation o on o.tenant_id=r.tenant_id and o.id=r.operation_id where r.tenant_id=$1 and r.run_manifest_artifact_id=$2 and r.manifest_sha256=$3`,[tenantId,request.auditBundle.artifactId,request.auditBundle.digest.slice(7)])).rows);
      return rows.length===1&&rows[0]!.operation_kind===expectedKind&&rows[0]!.status==="succeeded";
    };
  }
  const adjudicationGrantsRaw=environment.VERIFICATION_ADJUDICATION_GRANTS_JSON?.trim();
  const adjudicationRequirementsRaw=environment.VERIFICATION_ADJUDICATION_REVIEW_REQUIREMENTS_JSON?.trim();
  const adjudicationPublicKeysRaw=environment.VERIFICATION_ADJUDICATION_PUBLIC_KEYS_JSON?.trim();
  const adjudicationConfigured=[adjudicationGrantsRaw,adjudicationRequirementsRaw,adjudicationPublicKeysRaw].filter((value)=>value!==undefined).length;
  if(adjudicationConfigured!==0&&adjudicationConfigured!==3)throw new Error("VERIFICATION_ADJUDICATION_RUNTIME_CONFIGURATION_REQUIRED");
  let isAdjudicationRequestAdmitted:((tenantId:string,request:RequestAdjudicationRequest)=>Promise<boolean>)|undefined;
  if(adjudicationConfigured===3){
    if(!dynamicVerificationContext)throw new Error("VERIFICATION_ADJUDICATION_OWNERSHIP_GRANTS_REQUIRED");
    if(adjudicationGrantsRaw!.length>262_144||adjudicationRequirementsRaw!.length>262_144)throw new Error("VERIFICATION_ADJUDICATION_RUNTIME_CONFIGURATION_TOO_LARGE");
    let grants:unknown,requirements:unknown;
    try{grants=JSON.parse(adjudicationGrantsRaw!);requirements=JSON.parse(adjudicationRequirementsRaw!);}catch{throw new Error("VERIFICATION_ADJUDICATION_RUNTIME_CONFIGURATION_INVALID");}
    let catalog:VerificationAuditInspectionGrantCatalog;
    try{catalog=new VerificationAuditInspectionGrantCatalog(grants);VerificationAdjudicationReviewRequirementsSchema.parse(requirements);parseBenchmarkReadPublicKeys(adjudicationPublicKeysRaw!);}catch{throw new Error("VERIFICATION_ADJUDICATION_RUNTIME_CONFIGURATION_INVALID");}
    isAdjudicationRequestAdmitted=async(tenantId,request)=>{
      let grant;try{grant=catalog.resolve(tenantId,{verificationContractVersion:request.verificationContractVersion,auditBundle:request.evidencePacket});}catch(error){if(error instanceof Error&&error.message==="VERIFICATION_AUDIT_INSPECTION_GRANT_REQUIRED")return false;throw error;}
      if(!database)return false;
      const expectedKind=grant.runKind==="claims"?"verification_claims":"verification_report";
      const rows=await database.transaction(tenantId,async client=>(await client.query<{operation_kind:string;status:string}>(`select o.operation_kind,o.status from evidence.verification_run r join knowledge_service.operation o on o.tenant_id=r.tenant_id and o.id=r.operation_id where r.tenant_id=$1 and r.run_manifest_artifact_id=$2 and r.manifest_sha256=$3`,[tenantId,request.evidencePacket.artifactId,request.evidencePacket.digest.slice(7)])).rows);
      return rows.length===1&&rows[0]!.operation_kind===expectedKind&&rows[0]!.status==="succeeded";
    };
  }
  const parseArtifactEnabled=environment.VERIFICATION_PARSE_ARTIFACT_ENABLED?.trim();
  if(parseArtifactEnabled&&parseArtifactEnabled!=="0"&&parseArtifactEnabled!=="1")throw new Error("INVALID_VERIFICATION_PARSE_ARTIFACT_ENABLED");
  let isParseArtifactRequestAdmitted:((tenantId:string,request:ParseArtifactRequest)=>boolean)|undefined;
  let verificationCaptureCatalog: VerificationServiceCatalog | undefined;
  const captureAcquireEnabled = environment.VERIFICATION_CAPTURE_ACQUIRE_ENABLED?.trim();
  if (captureAcquireEnabled && !["0", "1"].includes(captureAcquireEnabled)) throw new Error("INVALID_VERIFICATION_CAPTURE_ACQUIRE_ENABLED");
  if (captureAcquireEnabled === "1") {
    if (!dynamicVerificationContext) throw new Error("VERIFICATION_ACQUISITION_OWNERSHIP_GRANTS_REQUIRED");
    const raw = environment.VERIFICATION_SERVICE_CATALOG_JSON?.trim();
    if (!raw || raw.length > 262_144) throw new Error("VERIFICATION_ACQUISITION_RUNTIME_GRANTS_REQUIRED");
    let value: unknown; try { value = JSON.parse(raw); } catch { throw new Error("VERIFICATION_ACQUISITION_RUNTIME_GRANTS_INVALID"); }
    verificationCaptureCatalog = new VerificationServiceCatalog(value as ConstructorParameters<typeof VerificationServiceCatalog>[0]);
    if (!verificationCaptureCatalog.hasAcquisitionGrants()) throw new Error("VERIFICATION_ACQUISITION_RUNTIME_GRANTS_REQUIRED");
  }
  if(parseArtifactEnabled==="1"){
    if(!dynamicVerificationContext)throw new Error("VERIFICATION_PARSE_ARTIFACT_OWNERSHIP_GRANTS_REQUIRED");
    const raw=environment.VERIFICATION_SERVICE_CATALOG_JSON?.trim();
    if(!raw||raw.length>262_144)throw new Error("VERIFICATION_PARSE_ARTIFACT_RUNTIME_GRANTS_REQUIRED");
    let value:unknown;try{value=JSON.parse(raw);}catch{throw new Error("VERIFICATION_PARSE_ARTIFACT_RUNTIME_GRANTS_INVALID");}
    const catalog=new VerificationServiceCatalog(value as ConstructorParameters<typeof VerificationServiceCatalog>[0]);
    if(!catalog.hasParseArtifactGrants())throw new Error("VERIFICATION_PARSE_ARTIFACT_RUNTIME_GRANTS_REQUIRED");
    isParseArtifactRequestAdmitted=(tenantId,request)=>request.sourceArtifact.tenantId===tenantId&&catalog.admitsParseArtifact(request);
  }
  let isClaimsRequestAdmitted:((tenantId:string,request:import("@aiengineer/knowledge-contracts").VerifyClaimsRequest|import("@aiengineer/knowledge-contracts").VerifyReportRequest)=>boolean)|undefined;
  if(claimsEnabled==="1"){
    const projectionRaw=environment.VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON?.trim(),sealRaw=environment.VERIFICATION_SEAL_POLICY_GRANTS_JSON?.trim();
    if(!projectionRaw||!sealRaw)throw new Error("VERIFICATION_CLAIMS_RUNTIME_GRANTS_REQUIRED");
    if(projectionRaw.length>262_144||sealRaw.length>262_144)throw new Error("VERIFICATION_CLAIMS_RUNTIME_GRANTS_TOO_LARGE");
    let projections:unknown,policies:unknown;
    try{projections=JSON.parse(projectionRaw);policies=JSON.parse(sealRaw);}catch{throw new Error("VERIFICATION_CLAIMS_RUNTIME_GRANTS_INVALID");}
    if(!Array.isArray(projections)||projections.length<1||projections.length>256||!Array.isArray(policies)||policies.length<1||policies.length>256)throw new Error("VERIFICATION_CLAIMS_RUNTIME_GRANTS_INVALID");
    const projectionCatalog=new VerificationClaimsProjectionGrantCatalog(projections),policyCatalog=new VerificationSealPolicyCatalog(policies);
    void policyCatalog;
    const imageDigest=environment.VERIFICATION_PARSER_IMAGE_DIGEST?.trim(),gitSha=environment.VERIFICATION_CODE_GIT_SHA?.trim(),dirty=environment.VERIFICATION_CODE_DIRTY?.trim(),platform=environment.VERIFICATION_RUNTIME_PLATFORM?.trim(),deploymentId=environment.VERIFICATION_RUNTIME_DEPLOYMENT_ID?.trim();
    if(!imageDigest||!/^sha256:[a-f0-9]{64}$/u.test(imageDigest)||!gitSha||!platform||!deploymentId||!["0","1"].includes(dirty??""))throw new Error("VERIFICATION_CLAIMS_WORKER_RUNTIME_REQUIRED");
    isClaimsRequestAdmitted=(tenantId,request)=>{const artifact="assertions" in request?request.assertions:request.claimLedger;try{projectionCatalog.resolve(tenantId,artifact);return true;}catch(error){if(error instanceof Error&&error.message==="VERIFICATION_CLAIMS_PROJECTION_GRANT_REQUIRED")return false;throw error;}};
  }
  if(verificationAttemptId)UuidSchema.parse(verificationAttemptId);
  const verificationWorkItemId=environment.VERIFICATION_SERVICE_WORK_ITEM_ID?.trim();if(verificationWorkItemId)UuidSchema.parse(verificationWorkItemId);
  const verificationMissionId=environment.VERIFICATION_SERVICE_MISSION_ID?.trim();if(verificationMissionId)UuidSchema.parse(verificationMissionId);
  const verificationCausationId=environment.VERIFICATION_SERVICE_CAUSATION_ID?.trim();
  const externalRuntime=environment.VERIFICATION_SERVICE_EXTERNAL_RUNTIME?.trim(),externalRunId=environment.VERIFICATION_SERVICE_EXTERNAL_RUN_ID?.trim();
  if(Boolean(externalRuntime)!==Boolean(externalRunId))throw new Error("VERIFICATION_EXTERNAL_EXECUTION_CONFIG_INCOMPLETE");
  const verificationExternalExecution=externalRuntime&&externalRunId?ExternalExecutionContextSchema.parse({runtime:externalRuntime,runId:externalRunId,...(environment.VERIFICATION_SERVICE_EXTERNAL_ROOT_RUN_ID?.trim()?{rootRunId:environment.VERIFICATION_SERVICE_EXTERNAL_ROOT_RUN_ID.trim()}:{}),...(environment.VERIFICATION_SERVICE_EXTERNAL_SESSION_ID?.trim()?{sessionId:environment.VERIFICATION_SERVICE_EXTERNAL_SESSION_ID.trim()}:{}),...(environment.VERIFICATION_SERVICE_EXTERNAL_TURN_ID?.trim()?{turnId:environment.VERIFICATION_SERVICE_EXTERNAL_TURN_ID.trim()}:{}),...(environment.VERIFICATION_SERVICE_EXTERNAL_TOOL_CALL_ID?.trim()?{toolCallId:environment.VERIFICATION_SERVICE_EXTERNAL_TOOL_CALL_ID.trim()}:{}),}):undefined;
  const verificationReads=createVerificationReads(database,environment);
  const verificationBenchmarkReads=createVerificationBenchmarkReads(database,environment);
  const verificationBenchmarkComparisonReads=createVerificationBenchmarkComparisonReads(database,environment);
  const verificationProviderReconciliation=createVerificationProviderReconciliationService(database,environment);
  const verificationSemanticReconciliation=createVerificationSemanticReconciliationService(database,environment);
  const verificationStructuredExtractionReads=createVerificationStructuredExtractionReads(database,environment);
  const verificationAuditInspectionReads=createVerificationAuditInspectionReads(database,environment);
  const verificationClaimsReportReads=createVerificationClaimsReportReads(database,environment);
  const verificationCaptureReads=createVerificationCaptureReads(database,environment);
  const benchmarkCaptureProfiles=environment.VERIFICATION_BENCHMARK_CAPTURE_PROFILES_JSON?.trim();
  if(benchmarkCaptureProfiles&&(!database||!ownershipGrants))throw new Error("VERIFICATION_BENCHMARK_CAPTURE_PROFILE_CONFIGURATION_REQUIRED");
  const resolveVerificationBenchmarkCaptureProfile=benchmarkCaptureProfiles?createVerificationBenchmarkCaptureProfileResolver(database!,benchmarkCaptureProfiles,ownershipGrants!):undefined;
  const verificationAdjudicationReadService=createVerificationAdjudicationReads(database,environment);
  const decisionRuntime=createVerificationAdjudicationDecisionRuntime(database,environment);
  if(decisionRuntime&&!dynamicVerificationContext)throw new Error("VERIFICATION_ADJUDICATION_DECISION_OWNERSHIP_REQUIRED");
  const server = buildServer({
    ...(decisionRuntime??{}),
    ...(verificationDriftRevalidation?{verificationDriftRevalidation}:{}),
    ...(verificationBenchmarkReads?{verificationBenchmarkReads}:{}),
    ...(verificationBenchmarkComparisonReads?{verificationBenchmarkComparisonReads}:{}),
    ...(verificationProviderReconciliation?{verificationProviderReconciliation}:{}),
    ...(verificationSemanticReconciliation?{verificationSemanticReconciliation}:{}),
    ...(verificationStructuredExtractionReads?{verificationStructuredExtractionReads}:{}),
    ...(verificationAuditInspectionReads?{verificationAuditInspectionReads}:{}),
    ...(verificationClaimsReportReads?{verificationClaimsReportReads}:{}),
    ...(verificationCaptureReads?{verificationCaptureReads}:{}),
    ...(resolveVerificationBenchmarkCaptureProfile?{resolveVerificationBenchmarkCaptureProfile}:{}),
    ...(verificationAdjudicationReadService?{verificationAdjudicationReadService}:{}),
    ...(verificationReads?{verificationReads,verificationCaseReads:verificationReads.cases}:{}),
    ...(publicOrigin ? { publicOrigin } : {}),
    resolveIdentity:createLocalIdentityResolver(environment.KNOWLEDGE_API_IDENTITIES),
    resolveCallbackSigningSecret:createCallbackSigningSecretResolver(environment.KNOWLEDGE_CALLBACK_SIGNING_KEYS),
    ...(database ? {
      operationService:new PostgresKnowledgeOperationService(database),
      retrievalOperationService:new PostgresKnowledgeOperationService(database,{admittedOperationKinds:apiOwnedOperationKinds}),
      callbackReplayStore:new PostgresCallbackReplayStore(database),
      resourceReader:database,
      ...(verificationConfigured?{
        verificationOperationService:new PostgresKnowledgeOperationService(database,{admittedOperationKinds:[...verificationServiceOperationKinds,...(decisionRuntime?["verification_adjudication_decision" as const]:[]),...(parseArtifactEnabled==="1"?["verification_parse_artifact" as const]:[]),...(metricEnabled==="1"?["verification_metric" as const]:[]),...(claimsEnabled==="1"?["verification_claims" as const,"verification_report" as const]:[]),...(auditInspectionEnabled==="1"?["verification_audit_bundle" as const]:[]),...(isAdjudicationRequestAdmitted?["verification_adjudication" as const]:[]),...(benchmarkConfig?["verification_benchmark" as const]:[]),...(comparisonConfig?["verification_benchmark_compare" as const]:[]),...(extractionConfig?["verification_structured_extraction" as const]:[])]}),
        ...(isParseArtifactRequestAdmitted?{isParseArtifactRequestAdmitted}:{}),
        ...(verificationCaptureCatalog ? { verificationCaptureCatalog } : {}),
        ...(extractionConfig?{isStructuredExtractionRequestAdmitted:createStructuredExtractionRequestAdmission(extractionConfig)}:{}),
        ...(benchmarkConfig?{isBenchmarkRequestAdmitted:(tenantId:string,request:import("@aiengineer/knowledge-contracts").RunBenchmarkRequest)=>{try{benchmarkConfig.inputs.resolve(tenantId,request);return true;}catch(error){if(error instanceof Error&&error.message==="BENCHMARK_INPUT_TRUSTED_GRANT_REQUIRED")return false;throw error;}}}:{}),
        ...(comparisonConfig?{isBenchmarkComparisonRequestAdmitted:(tenantId:string,request:import("@aiengineer/knowledge-contracts").CompareBenchmarkRunsRequest)=>{try{comparisonConfig.catalog.resolve(tenantId,request.comparisonProfile);return true;}catch(error){if(error instanceof Error&&error.message==="BENCHMARK_COMPARISON_PROFILE_TRUSTED_GRANT_REQUIRED")return false;throw error;}}}:{}),
        ...(isClaimsRequestAdmitted?{isClaimsRequestAdmitted}:{}),
        ...(isAuditInspectionRequestAdmitted?{isAuditInspectionRequestAdmitted}:{}),
        ...(isAdjudicationRequestAdmitted?{isAdjudicationRequestAdmitted}:{}),
        resolveVerificationContext:dynamicVerificationContext??(({tenantId,identity,correlationId,idempotencyKey,useCase,hints}:{tenantId:string;identity:{actor:import("@aiengineer/knowledge-contracts").Actor};correlationId:string;idempotencyKey:string;useCase:string;hints:VerificationOperationContextHints})=>{
          if((hints.attemptId&&hints.attemptId!==verificationAttemptId)||(hints.workItemId&&hints.workItemId!==verificationWorkItemId)||(hints.missionId&&hints.missionId!==verificationMissionId)||(hints.causationId&&hints.causationId!==verificationCausationId)||(hints.externalExecution&&JSON.stringify(hints.externalExecution)!==JSON.stringify(verificationExternalExecution)))return undefined;
          return {tenantId,operationId:deterministicUuid("verification-http-operation",`${tenantId}:${useCase}:${idempotencyKey}`),attemptId:verificationAttemptId!,...(verificationWorkItemId?{workItemId:verificationWorkItemId}:{}),...(verificationMissionId?{missionId:verificationMissionId}:{}),...(verificationCausationId?{causationId:verificationCausationId}:{}),...(verificationExternalExecution?{externalExecution:verificationExternalExecution}:{}),correlationId,actor:identity.actor,capabilityVersion:environment.VERIFICATION_SERVICE_CAPABILITY_VERSION?.trim()||"verification-service.v1",idempotencyKey,reason:`authenticated ${useCase} request`,contractVersion:"v1" as const};
        }),
      }:{}),
      ...(canonicalRetrievalExecutor ? { canonicalRetrievalExecutor } : {}),
      ...(replayEvidencePacketCitations ? { replayEvidencePacketCitations } : {}),
      getEvidencePacket:async (tenantId:string, packetId:string) => {
        const packet = await database.getEvidencePacket(tenantId, packetId);
        return packet === undefined ? undefined : EvidencePacketSchema.parse(packet);
      },
    } : {}),
  });
  return { config, database, server, retrievalConfigured: Boolean(canonicalRetrievalExecutor),
    citationReplayConfigured: Boolean(replayEvidencePacketCitations),verificationConfigured };
}

let serverlessRuntime: ReturnType<typeof createApiRuntime> | undefined;
const getServerlessRuntime = () =>
  (serverlessRuntime ??= createApiRuntime());

export function createApiRequestHandler(
  runtime: () => Promise<Pick<Awaited<ReturnType<typeof createApiRuntime>>, "server">>,
) {
  return async (request:IncomingMessage, response:ServerResponse):Promise<void> => {
    const { server } = await runtime();
    await server.ready();
    await new Promise<void>((resolve, reject) => {
      response.once("finish", resolve);
      response.once("error", reject);
      server.server.emit("request", request, response);
    });
  };
}

/** Vercel Node function entrypoint; the Fastify/runtime singleton survives warm invocations. */
const handler = createApiRequestHandler(getServerlessRuntime);
export default handler;

async function main() {
  const { config, database, server } = await createApiRuntime();
  await server.listen({ host:config.HOST, port:config.PORT });
  let stopping = false;
  const shutdown = (signal:string) => {
    if (stopping) return;
    stopping = true;
    void server.close().then(() => database?.close()).catch((error) => {
      process.stderr.write(`${JSON.stringify({event:"knowledge.api.shutdown_failed",signal,error:error instanceof Error?error.message:"unknown"})}\n`);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main().catch((error) => {
    process.stderr.write(`${JSON.stringify({event:"knowledge.api.start_failed",error:error instanceof Error?error.message:"unknown"})}\n`);
    process.exitCode = 1;
  });
