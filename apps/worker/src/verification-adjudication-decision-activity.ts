import type { VerificationAdjudicationDecisionPreparationService, VerificationAdjudicationDecisionCommitPort } from "@aiengineer/knowledge-application";
import { VerificationAdjudicationDecisionRequestSchema, VerificationAdjudicationDecisionResultSchema, type JsonValue } from "@aiengineer/knowledge-contracts";
import type { OperationsRepository } from "@aiengineer/knowledge-persistence";
import { canonicalizeJson, digestCanonicalJson, sha256Digest } from "@aiengineer/knowledge-verification";
import { z } from "zod";
import { CanonicalActivityError, type CanonicalActivityHandler } from "./activity-registry.js";

const inputSchema=z.strictObject({schemaVersion:z.literal("verification-service-request.v1"),useCase:z.literal("recordAdjudicationDecision"),request:VerificationAdjudicationDecisionRequestSchema});
export interface VerificationAdjudicationDecisionActivityDependencies {
 readonly preparation:Pick<VerificationAdjudicationDecisionPreparationService,"prepare">;
 readonly decisions:VerificationAdjudicationDecisionCommitPort;
 readonly operations:Pick<OperationsRepository,"getOperationRecord">;
 readonly storageBucket:string;
 readonly now:()=>string;
 readonly cancellationPollMs?:number;
}

export function verificationAdjudicationDecisionActivityHandler(dependencies:VerificationAdjudicationDecisionActivityDependencies):CanonicalActivityHandler {
 const pollMs=dependencies.cancellationPollMs??250;
 if(!Number.isSafeInteger(pollMs)||pollMs<25||pollMs>5000)throw new Error("VERIFICATION_DECISION_POLL_INVALID");
 return {operationKind:"verification_adjudication_decision",stepName:"record_packet_bound_decision",async execute({activity,claim}){
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;let polling=false;let pollFailure:unknown;
  const failure=(code:string)=>new CanonicalActivityError(code,code,false);
  const active=async()=>{const operation=await dependencies.operations.getOperationRecord(activity.context.tenantId,activity.context.operationId);if(!operation||operation.status!=="running"){controller.abort();throw failure("VERIFICATION_ADJUDICATION_DECISION_CANCELLED");}};
  const poll=()=>{if(polling||controller.signal.aborted)return;polling=true;void active().catch(error=>{pollFailure=error;controller.abort();}).finally(()=>{polling=false;if(!controller.signal.aborted)timer=setTimeout(poll,pollMs);});};
  try{
   const input=inputSchema.parse(activity.operationInput);
   if(claim.operationId!==activity.context.operationId)throw failure("VERIFICATION_ADJUDICATION_DECISION_BINDING");
   await active();timer=setTimeout(poll,pollMs);
   const prepared=await dependencies.preparation.prepare({request:input.request,context:activity.context,signal:controller.signal});
   await active();
   if(controller.signal.aborted)throw failure("VERIFICATION_ADJUDICATION_DECISION_CANCELLED");
   if(prepared.requestDigest!==digestCanonicalJson(input.request)||canonicalizeJson(prepared.request)!==canonicalizeJson(input.request)
    ||canonicalizeJson(prepared.context)!==canonicalizeJson(activity.context)||sha256Digest(prepared.decisionBytes)!==prepared.decisionDigest)throw failure("VERIFICATION_ADJUDICATION_DECISION_BINDING");
   const output=VerificationAdjudicationDecisionResultSchema.parse(await dependencies.decisions.commitDecision({prepared,
    lease:{operationId:claim.operationId,stepId:claim.id,inputSha256:claim.inputSha256,leaseToken:claim.leaseToken,fencingToken:claim.fencingToken,holderIdentity:claim.holderIdentity},
    registration:{createdAt:dependencies.now(),producerAttemptId:activity.context.attemptId,...(activity.context.missionId?{missionId:activity.context.missionId}:{}),producerActivityId:"verification-service:recordAdjudicationDecision",producerVersion:"verification-service.v1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",storageBucket:dependencies.storageBucket}}));
   await active();
   if(controller.signal.aborted)throw failure("VERIFICATION_ADJUDICATION_DECISION_CANCELLED");
   if(output.subjectId!==input.request.subjectId||canonicalizeJson(output.packetArtifact)!==canonicalizeJson(input.request.packetArtifact)
    ||output.decision!==input.request.decision||output.decisionArtifact.digest!==prepared.decisionDigest||output.reviewerProvenance!==prepared.authority.provenance)throw failure("VERIFICATION_ADJUDICATION_DECISION_COMMIT_BINDING");
   return {schemaVersion:"verification-operation-result.v1",operationId:activity.context.operationId,useCase:"recordAdjudicationDecision",requestDigest:prepared.requestDigest,output} as unknown as JsonValue;
  }catch(error){
   if(pollFailure!==undefined)error=pollFailure;
   if(error instanceof CanonicalActivityError)throw error;
   if(error instanceof z.ZodError)throw new CanonicalActivityError("VERIFICATION_ADJUDICATION_DECISION_INVALID","VERIFICATION_ADJUDICATION_DECISION_INVALID",false,{cause:error});
   const raw=error instanceof Error?error.message:"";
   const code=/^VERIFICATION_ADJUDICATION_DECISION_[A-Z_]+$/u.test(raw)?raw:"VERIFICATION_ADJUDICATION_DECISION_INFRASTRUCTURE_FAILURE";
   throw new CanonicalActivityError(code,code,code.endsWith("INFRASTRUCTURE_FAILURE"),{cause:error});
  }finally{if(timer!==undefined)clearTimeout(timer);controller.abort();}
 }};
}
