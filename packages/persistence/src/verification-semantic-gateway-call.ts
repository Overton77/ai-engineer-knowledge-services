import { recoverCapturedSemanticGatewayCall } from "./verification-semantic-recovery.js";
import { SemanticBlindedInputSchema, SemanticJudgeIdentitySchema, VerificationArtifactHandleSchema, type SemanticBlindedInput, type SemanticJudgeIdentity, type VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { AccountedVerificationProviderSink, SemanticGatewayObservationRecorder, SemanticObservationArtifactComposer, SemanticProviderComposerBinding, VerificationProviderArtifactComposer } from "@aiengineer/knowledge-application";
import { canonicalizeJson, prepareGatewaySemanticRequest, requestSignal, requireActive, GatewaySemanticJudgeAdapter, type SemanticJudgeAdapter } from "@aiengineer/knowledge-verification";
import type { PostgresCanonicalRepository } from "./postgres.js";
import type { PostgresVerificationRepository } from "./verification.js";
import type { LeasedStep } from "./types.js";
import { PostgresVerificationProviderAccounting } from "./verification-provider-accounting.js";
import { PostgresVerificationProviderResponseCaptureStore } from "./verification-provider-response-capture.js";
import { PostgresSemanticObservationArtifactRegistration } from "./verification-semantic-observation-registration.js";
import { PostgresVerificationSemanticObservationStore } from "./verification-semantic-observation-store.js";
import { verificationProviderHostTuple } from "./verification-provider-host.js";

/** One trusted logical call; reuses captured durable attempts instead of redispatching them. */
export async function createNativeSemanticGatewayCall(input: {
  readonly database: PostgresCanonicalRepository; readonly artifacts: PostgresVerificationRepository;
  readonly lease: LeasedStep; readonly host: "claims" | "report"; readonly producerAttemptId: string; readonly providerAttemptId: string;
  readonly profileArtifact: VerificationArtifactHandle; readonly blindedInput: SemanticBlindedInput; readonly identity: SemanticJudgeIdentity;
  readonly apiKey: string; readonly model: ConstructorParameters<typeof GatewaySemanticJudgeAdapter>[0]["model"];
  readonly budget: { readonly budgetId: string; readonly budgetKey: string; readonly ceilingCostMicros: number; readonly reservationCostMicros: number };
  readonly classification: "synthetic" | "public"; readonly storageBucket: string; readonly now: () => string;
  readonly fetch?: typeof fetch;
}): Promise<{ readonly adapter: SemanticJudgeAdapter; readonly blindedInputArtifact: VerificationArtifactHandle }> {
  const lease=structuredClone(input.lease),hostName=input.host,host=verificationProviderHostTuple(hostName),budget=structuredClone(input.budget);
  const blinded=SemanticBlindedInputSchema.parse(input.blindedInput),identity=SemanticJudgeIdentitySchema.parse(input.identity),profile=VerificationArtifactHandleSchema.parse(input.profileArtifact);
  const semanticHost=hostName==="claims" ? {operationKind:"verification_claims",stepKey:"verify_claims_and_register",useCase:"verifyClaims"} as const : {operationKind:"verification_report",stepKey:"verify_report_and_register",useCase:"verifyReport"} as const;
  const producerAttemptId=input.producerAttemptId,providerAttemptId=input.providerAttemptId;
  const database=input.database,artifacts=input.artifacts,model=input.model,storageBucket=input.storageBucket,now=input.now;
  const runtimeInput={...input,lease,profileArtifact:profile,blindedInput:blinded,identity,budget};
  if(lease.stepKey!==host.stepKey || lease.stepKind!==host.stepKey || profile.tenantId!==lease.tenantId || producerAttemptId===providerAttemptId) throw new Error("SEMANTIC_GATEWAY_SCOPE_INVALID");
  const registration={storageBucket:input.storageBucket,producerActivityId:"verification-semantic-gateway",producerVersion:"v1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",now:input.now};
  const captures=new PostgresVerificationProviderResponseCaptureStore(input.database,hostName);
  const provider=new VerificationProviderArtifactComposer({registerContentAddressedArtifact:artifact=>input.artifacts.registerFencedContentAddressedArtifact({artifact,lease:{stepId:lease.id,leaseToken:lease.leaseToken,fencingToken:lease.fencingToken,holderIdentity:lease.holderIdentity}})}, {
    ...registration,tenantId:lease.tenantId,producerAttemptId,externalProcessingGrant:{providerId:"gateway",dataClassification:input.classification,modalities:["text"]},
    transportResponse:{binding:{tenantId:lease.tenantId,operationId:lease.operationId,operationStepId:lease.id,providerAttemptId,profileArtifactId:profile.artifactId,profileDigest:profile.digest as `sha256:${string}`,dispatchFencingToken:lease.fencingToken},record:value=>captures.store({lease,...value}).then(()=>{})},
  });
  const accounting=new PostgresVerificationProviderAccounting(input.database,{lease,host:hostName,profileArtifactId:profile.artifactId,profileDigest:profile.digest as `sha256:${string}`});
  const sink=new AccountedVerificationProviderSink(provider,accounting,{tenantId:lease.tenantId,...budget},{attemptId:providerAttemptId,providerId:"gateway",model:input.model,reservationCostMicros:budget.reservationCostMicros});
  let recorder: SemanticGatewayObservationRecorder | undefined,settled=false;
  const gateway=new GatewaySemanticJudgeAdapter({apiKey:input.apiKey,model:input.model,identity,artifactSink:sink,...(input.fetch?{fetch:input.fetch}:{}),recordObservation:async event=>{
    if(!recorder)throw new Error("SEMANTIC_GATEWAY_RECORDER_UNBOUND");
    await recorder.record(event);await sink.settleOrRetain(event.usage);settled=true;
  }});
  const blindedInputArtifact=await provider.registerSemanticInput(blinded);
  recorder=new SemanticGatewayObservationRecorder({tenantId:lease.tenantId,operationId:lease.operationId,operationStepId:lease.id,deploymentId:identity.deploymentId},new SemanticProviderComposerBinding({
    context:{tenantId:lease.tenantId,operationId:lease.operationId,operationStepId:lease.id,leaseToken:lease.leaseToken,fencingToken:lease.fencingToken,holderIdentity:lease.holderIdentity,producerAttemptId,providerAttemptId,host:semanticHost},
    profileArtifact:profile,blindedInputArtifact,judgeIdentity:identity,
  },provider),new SemanticObservationArtifactComposer(new PostgresSemanticObservationArtifactRegistration(input.artifacts,lease),registration),new PostgresVerificationSemanticObservationStore(input.database));
  let invoked=false;
  const adapter:SemanticJudgeAdapter={identity:gateway.identity,maximumInputCharacters:gateway.maximumInputCharacters,toolCatalog:[],async judge(value,execution){
    const {inputArtifactDigest,...actual}=value;
    if(invoked || inputArtifactDigest!==blindedInputArtifact.digest || canonicalizeJson(actual)!==canonicalizeJson(blinded))throw new Error("SEMANTIC_GATEWAY_INPUT_MISMATCH");
    invoked=true;
    const request=prepareGatewaySemanticRequest(value,model);
    const previous=await accounting.readOriginalAttempt(lease.tenantId,{requestDigest:request.requestDigest,attemptOrdinal:0});
    if(previous && previous.state!=="reserved") {
      if(previous.providerId!=="gateway" || previous.model!==model)throw new Error("SEMANTIC_GATEWAY_RECOVERY_PROVIDER_MISMATCH");
      const active=requestSignal(execution);
      try {
        requireActive(active.signal,execution);
        const recovered=await recoverCapturedSemanticGatewayCall({database,artifacts,lease,host:hostName,providerAttemptId:previous.attemptId,profileArtifact:profile,blindedInputArtifact,blindedInput:blinded,identity,storageBucket,now,signal:active.signal});
        requireActive(active.signal,execution);
        return recovered.output;
      } finally { active.release(); }
    }
    if(previous && previous.attemptId!==providerAttemptId) {
      const resumed=await createNativeSemanticGatewayCall({...runtimeInput,providerAttemptId:previous.attemptId});
      return resumed.adapter.judge(value,execution);
    }
    try{return await gateway.judge(value,execution);}catch(error){if(!settled)await sink.settleOrRetain({});throw error;}
  }};
  return {adapter,blindedInputArtifact};
}
