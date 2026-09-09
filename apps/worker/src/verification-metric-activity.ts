import type { VerificationMetricApplicationService,VerificationMetricServiceResult,VerificationOperationRepositoryPort } from "@aiengineer/knowledge-application";
import { VerifyMetricObservationRequestSchema,type JsonValue,type OperationContext } from "@aiengineer/knowledge-contracts";
import type { OperationsRepository,VerificationRunLease } from "@aiengineer/knowledge-persistence";
import { canonicalizeJson,digestCanonicalJson } from "@aiengineer/knowledge-verification";
import { z } from "zod";
import { CanonicalActivityError,type CanonicalActivityHandler } from "./activity-registry.js";

const inputSchema=z.strictObject({schemaVersion:z.literal("verification-service-request.v1"),useCase:z.literal("verifyMetricObservation"),request:VerifyMetricObservationRequestSchema});

/** Admitted only when trusted metric hydration, grants and runtime binding exist. */
export function verificationMetricActivityHandler(dependencies:{
  service:VerificationMetricApplicationService;
  repository:VerificationOperationRepositoryPort;
  operations:Pick<OperationsRepository,"getOperationRecord">;
  storageBucket:string;
  now:()=>string;
  sealer?:{seal(input:{verified:VerificationMetricServiceResult;context:OperationContext;lease:VerificationRunLease;startedAt:string}):Promise<{runId:string;manifestDigest:string;policyOutcome:string}>};
}):CanonicalActivityHandler {
  return {operationKind:"verification_metric",stepName:"verify_metric_and_register",async execute({activity,claim}){
    const {context}=activity;
    const active=async()=>{
      const operation=await dependencies.operations.getOperationRecord(context.tenantId,context.operationId);
      if(!operation||operation.status!=="running")throw new CanonicalActivityError("VERIFICATION_OPERATION_NOT_ACTIVE","VERIFICATION_OPERATION_NOT_ACTIVE",false);
    };
    try {
      const input=inputSchema.parse(activity.operationInput);
      await active();
      const startedAt=dependencies.now();
      const verified=await dependencies.service.verify(input.request,context);
      await active();
      const sealedRun=dependencies.sealer?await dependencies.sealer.seal({verified,context,startedAt,
        lease:{stepId:claim.id,leaseToken:claim.leaseToken,fencingToken:claim.fencingToken,holderIdentity:claim.holderIdentity}}):undefined;
      await active();
      const parents=[...new Set([verified.observationsArtifact.artifactId,verified.profileArtifact.artifactId,...verified.hydratedCaptureArtifactIds])];
      const body={schemaVersion:"verification-operation-result.v1",operationId:context.operationId,useCase:"verifyMetricObservation",requestDigest:digestCanonicalJson(input.request),
        output:{admissionState:verified.admissionState,result:{valid:verified.deterministicResult.status==="passed",deterministicResult:verified.deterministicResult},...(sealedRun?{sealedRun}:{})}};
      const resultArtifact=await dependencies.repository.registerContentAddressedArtifact({tenantId:context.tenantId,producerAttemptId:context.attemptId,...(context.missionId?{missionId:context.missionId}:{}),
        bytes:new TextEncoder().encode(canonicalizeJson(body)),mediaType:"application/vnd.aiengineer.verification-operation-result+json",createdAt:dependencies.now(),
        producerActivityId:"verification-service:verifyMetricObservation",producerVersion:"verification-service.v1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",dataClassification:"restricted",
        parentArtifactIds:parents,transformationSignature:digestCanonicalJson({operationId:context.operationId,requestDigest:body.requestDigest,parents}),
        artifactType:"deterministic_verification_result",bucketClass:"ledger",storageBucket:dependencies.storageBucket});
      await active();
      return {...body,resultArtifact} as unknown as JsonValue;
    } catch(error){
      if(error instanceof CanonicalActivityError)throw error;
      if(error instanceof z.ZodError)throw new CanonicalActivityError("INVALID_VERIFICATION_METRIC_INPUT","INVALID_VERIFICATION_METRIC_INPUT",false);
      const message=error instanceof Error?error.message:"";
      const code=/^[A-Z][A-Z0-9_]{2,127}$/u.test(message)?message:"VERIFICATION_METRIC_INFRASTRUCTURE_FAILURE";
      const retryable=code==="VERIFICATION_METRIC_INFRASTRUCTURE_FAILURE"||code.startsWith("OBJECT_STORE_")||code==="REGISTERED_ARTIFACT_BYTES_UNAVAILABLE";
      throw new CanonicalActivityError(code,code,retryable,{cause:error});
    }
  }};
}
