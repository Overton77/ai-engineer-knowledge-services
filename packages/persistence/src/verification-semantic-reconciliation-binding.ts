import {z} from "zod";
import {SemanticBlindedInputSchema,SemanticProviderResponseObservationSchema,VerificationArtifactHandleSchema,VerificationSemanticProviderReconciliationSchema} from "@aiengineer/knowledge-contracts";
import {hydrateSemanticGatewayCapture,SemanticJudgeProfileSchema,semanticReconciliationOriginalBinding,type SemanticReconciliationOriginalBinding} from "@aiengineer/knowledge-application";
import {canonicalizeJson,prepareGatewaySemanticRequest,sha256Digest} from "@aiengineer/knowledge-verification";
import type {PostgresCanonicalRepository} from "./postgres.js";
import type {PostgresVerificationRepository} from "./verification.js";
import {mapSemanticObservation} from "./verification-semantic-observation.js";

const hex=z.string().regex(/^[a-f0-9]{64}$/u);
const rowSchema=z.object({id:z.uuid(),tenant_id:z.uuid(),operation_id:z.uuid(),operation_step_id:z.uuid(),budget_id:z.uuid(),provider_id:z.literal("gateway"),model:z.string().min(1).max(255),
  state:z.enum(["dispatched","uncertain"]),actual_cost_micros:z.null(),request_sha256:hex,semantic_request_sha256:hex,request_artifact_id:z.uuid(),profile_artifact_id:z.uuid(),profile_sha256:hex,
  dispatch_fence:z.uuid(),dispatch_fencing_token:z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),semantic_dispatch_lease_token:z.uuid(),semantic_dispatch_holder_identity:z.string().min(1).max(255),
  reservation_cost_micros:z.coerce.number().int().positive().max(20_000_000),operation_kind:z.enum(["verification_claims","verification_report"]),operation_status:z.enum(["succeeded","failed","cancelled"]),step_key:z.string(),step_kind:z.string(),response_artifact_id:z.uuid().nullable()});
type Row=Record<string,unknown>;

/** Read-only terminal liability lookup. Settlement must repeat binding checks under lock. */
export async function loadNativeSemanticReconciliationBinding(input:{database:Pick<PostgresCanonicalRepository,"transaction">;repository:PostgresVerificationRepository;tenantId:string;providerAttemptId:string;signal?:AbortSignal;allowReconciled?:boolean}):Promise<SemanticReconciliationOriginalBinding> {
  const tenantId=z.uuid().parse(input.tenantId),providerAttemptId=z.uuid().parse(input.providerAttemptId);
  const active=()=>{if(input.signal?.aborted)throw new Error("SEMANTIC_RECONCILIATION_CANCELLED");};
  const read=()=>input.database.transaction(tenantId,async client=>{
    const row=(await client.query<Row>(`select p.*,o.operation_kind,o.status operation_status,s.step_key,s.step_kind from orchestration.verification_provider_attempt p
      join knowledge_service.operation o on o.tenant_id=p.tenant_id and o.id=p.operation_id
      join knowledge_service.operation_step s on s.tenant_id=p.tenant_id and s.id=p.operation_step_id and s.operation_id=p.operation_id
      where p.tenant_id=$1 and p.id=$2`,[tenantId,providerAttemptId])).rows[0];
    const capture=(await client.query<Row>("select * from orchestration.verification_provider_response_capture where tenant_id=$1 and provider_attempt_id=$2",[tenantId,providerAttemptId])).rows[0];
    const observation=(await client.query<Row>("select * from orchestration.verification_semantic_response_observation where tenant_id=$1 and provider_attempt_id=$2",[tenantId,providerAttemptId])).rows[0];
    let reconciliation:Row|undefined;
    let originalRow=row;
    if(input.allowReconciled&&row?.state==="settled"){
      reconciliation=(await client.query<Row>("select * from orchestration.verification_provider_reconciliation where tenant_id=$1 and provider_attempt_id=$2",[tenantId,providerAttemptId])).rows[0];
      const receipt=VerificationSemanticProviderReconciliationSchema.parse(reconciliation?.body);
      if(receipt.tenantId!==tenantId||receipt.providerAttemptId!==providerAttemptId||receipt.operationId!==row.operation_id||reconciliation?.operation_id!==row.operation_id
        ||row.actual_cost_micros===null||Number(row.actual_cost_micros)!==receipt.decision.actualCostMicros
        ||new Date(row.reconciled_at as Date|string).toISOString()!==new Date(reconciliation.applied_at as Date|string).toISOString())throw new Error("SEMANTIC_RECONCILIATION_SETTLED_DRIFT");
      originalRow={...row,state:receipt.originalState,actual_cost_micros:null};
    }
    return {row:rowSchema.parse(originalRow),capture,observation,...(reconciliation?{reconciliation}: {})};
  });
  active();const snapshot=await read();active();const p=snapshot.row;
  const host=p.operation_kind==="verification_claims"?"claims":"report",step=host==="claims"?"verify_claims_and_register":"verify_report_and_register";
  if(p.tenant_id!==tenantId||p.id!==providerAttemptId||p.step_key!==step||p.step_kind!==step||p.request_sha256!==p.semantic_request_sha256)throw new Error("SEMANTIC_RECONCILIATION_ORIGINAL_SCOPE");
  async function hydrate(id:string,type:string,limit:number,expectedDigest?:string){
    active();
    const native=await input.database.transaction(tenantId,async client=>(await client.query<Row>(`select sha256,size_bytes from orchestration.artifact where tenant_id=$1 and id=$2 and artifact_type=$3
      and storage_state='available' and orchestration.verification_artifact_is_admitted($1,$2,$3,sha256)`,[tenantId,id,type])).rows[0]);
    if(!native||Number(native.size_bytes)>limit||!Number.isSafeInteger(Number(native.size_bytes))||Number(native.size_bytes)<0)throw new Error("SEMANTIC_RECONCILIATION_ARTIFACT_REQUIRED");
    const digest=`sha256:${String(native.sha256)}`;
    if(expectedDigest&&digest!==expectedDigest)throw new Error("SEMANTIC_RECONCILIATION_ARTIFACT_DRIFT");
    const resolver=input.repository.createTrustedArtifactResolver();await resolver.authorizeArtifact({tenantId,artifactId:id,purpose:"verification_replay"});active();
    const loaded=await resolver.hydrateRegisteredArtifact({tenantId,artifactId:id});active();
    const handle=VerificationArtifactHandleSchema.parse(loaded.registration),bytes=loaded.bytes.slice();
    if(handle.tenantId!==tenantId||handle.artifactId!==id||handle.digest!==digest||bytes.length!==Number(native.size_bytes)||bytes.length!==handle.byteLength||sha256Digest(bytes)!==digest)throw new Error("SEMANTIC_RECONCILIATION_ARTIFACT_DRIFT");
    return {handle,bytes};
  }
  const decode=(bytes:Uint8Array)=>{const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes),value:unknown=JSON.parse(text);if(canonicalizeJson(value)!==text)throw new Error("SEMANTIC_RECONCILIATION_NONCANONICAL");return value;};
  const profile=await hydrate(p.profile_artifact_id,"verification_semantic_judge_profile",32_000,`sha256:${p.profile_sha256}`);
  const identity=SemanticJudgeProfileSchema.parse(decode(profile.bytes)).identity;
  const request=await hydrate(p.request_artifact_id,"verification_provider_request",160_000,`sha256:${p.request_sha256}`);
  if(request.handle.parentArtifactIds.length!==1)throw new Error("SEMANTIC_RECONCILIATION_REQUEST_LINEAGE");
  const blinded=await hydrate(request.handle.parentArtifactIds[0]!,"verification_semantic_blinded_input",96_000);
  const body=SemanticBlindedInputSchema.parse(decode(blinded.bytes));
  if(blinded.handle.parentArtifactIds.length!==0||identity.model!==p.model||identity.provider!=="vercel-ai-gateway"
    ||prepareGatewaySemanticRequest({...body,inputArtifactDigest:blinded.handle.digest as `sha256:${string}`},p.model).requestDigest!==request.handle.digest)throw new Error("SEMANTIC_RECONCILIATION_REQUEST_LINEAGE");
  let capture:SemanticReconciliationOriginalBinding["capture"],observationArtifact:SemanticReconciliationOriginalBinding["observationArtifact"];
  const c=snapshot.capture,o=snapshot.observation;
  if(c){
    if(c.operation_id!==p.operation_id||c.operation_step_id!==p.operation_step_id||c.profile_artifact_id!==p.profile_artifact_id||c.profile_sha256!==p.profile_sha256||Number(c.dispatch_fencing_token)!==p.dispatch_fencing_token)throw new Error("SEMANTIC_RECONCILIATION_CAPTURE_SCOPE");
    const retained=await hydrateSemanticGatewayCapture({capture:{tenantId,providerAttemptId,operationId:p.operation_id,operationStepId:p.operation_step_id,profileArtifactId:p.profile_artifact_id,profileDigest:`sha256:${p.profile_sha256}`,dispatchFencingToken:p.dispatch_fencing_token,httpStatus:Number(c.http_status),responseEnvelopeArtifactId:String(c.response_envelope_artifact_id),transportArtifactId:String(c.transport_artifact_id),transportDigest:`sha256:${String(c.transport_sha256)}`,capturedAt:c.captured_at instanceof Date?c.captured_at.toISOString():String(c.captured_at)},profileArtifact:profile.handle,blindedInputArtifact:blinded.handle,blindedInput:body,model:p.model,createResolver:()=>input.repository.createTrustedArtifactResolver(),...(input.signal?{signal:input.signal}:{})});
    capture={transportArtifact:retained.transportArtifact,responseEnvelopeArtifact:retained.responseEnvelopeArtifact,rawResponseArtifact:retained.rawResponseArtifact};
    if(p.response_artifact_id!==null&&p.response_artifact_id!==capture.responseEnvelopeArtifact.artifactId)throw new Error("SEMANTIC_RECONCILIATION_RESPONSE_DRIFT");
  }else if(o||p.response_artifact_id!==null)throw new Error("SEMANTIC_RECONCILIATION_CAPTURE_REQUIRED");
  if(o){
    const loaded=await hydrate(String(o.observation_artifact_id),"verification_semantic_response_observation",96_000,`sha256:${String(o.observation_sha256)}`);
    const observation=SemanticProviderResponseObservationSchema.parse({...decode(loaded.bytes) as object,observationArtifact:loaded.handle});
    for(const [key,expected] of Object.entries(mapSemanticObservation(observation))){
      const actual=o[key.replace(/[A-Z]/g,letter=>`_${letter.toLowerCase()}`)];
      if(typeof expected==="number"?actual===null||Number(actual)!==expected:actual!==expected)throw new Error("SEMANTIC_RECONCILIATION_OBSERVATION_DRIFT");
    }
    if(observation.context.tenantId!==tenantId||observation.context.host.operationKind!==p.operation_kind||observation.context.host.stepKey!==step
      ||canonicalizeJson(observation.judgeIdentity)!==canonicalizeJson(identity)||observation.requestedModel!==p.model
      ||observation.context.operationId!==p.operation_id||observation.context.operationStepId!==p.operation_step_id||observation.context.providerAttemptId!==providerAttemptId
      ||observation.context.leaseToken!==p.semantic_dispatch_lease_token||observation.context.holderIdentity!==p.semantic_dispatch_holder_identity||observation.context.fencingToken!==p.dispatch_fencing_token
      ||canonicalizeJson(observation.profileArtifact)!==canonicalizeJson(profile.handle)||canonicalizeJson(observation.blindedInputArtifact)!==canonicalizeJson(blinded.handle)
      ||canonicalizeJson(observation.requestArtifact)!==canonicalizeJson(request.handle)||canonicalizeJson(observation.responseEnvelopeArtifact)!==canonicalizeJson(capture!.responseEnvelopeArtifact)
      ||canonicalizeJson(observation.rawResponseArtifact)!==canonicalizeJson(capture!.rawResponseArtifact))throw new Error("SEMANTIC_RECONCILIATION_OBSERVATION_DRIFT");
    observationArtifact=loaded.handle;
  }
  const binding:SemanticReconciliationOriginalBinding={tenantId,operationId:p.operation_id,operationStepId:p.operation_step_id,providerAttemptId,budgetId:p.budget_id,host,providerId:p.provider_id,model:p.model,dispatchFence:p.dispatch_fence,dispatchLeaseToken:p.semantic_dispatch_lease_token,dispatchHolderIdentity:p.semantic_dispatch_holder_identity,dispatchFencingToken:p.dispatch_fencing_token,requestDigest:`sha256:${p.request_sha256}`,profileArtifact:profile.handle,blindedInputArtifact:blinded.handle,requestArtifact:request.handle,...(capture?{capture}:{}),...(observationArtifact?{observationArtifact}:{}),originalState:p.state,reservationCostMicros:p.reservation_cost_micros};
  if(snapshot.reconciliation){
    const r=snapshot.reconciliation,retained=await hydrate(String(r.artifact_id),"verification_provider_reconciliation",256_000,`sha256:${String(r.artifact_sha256)}`);
    const receipt=VerificationSemanticProviderReconciliationSchema.parse(decode(retained.bytes));
    if(canonicalizeJson(receipt)!==canonicalizeJson(r.body)||canonicalizeJson(semanticReconciliationOriginalBinding(receipt))!==canonicalizeJson(binding))throw new Error("SEMANTIC_RECONCILIATION_SETTLED_DRIFT");
  }
  active();if(canonicalizeJson(JSON.parse(JSON.stringify(await read())))!==canonicalizeJson(JSON.parse(JSON.stringify(snapshot))))throw new Error("SEMANTIC_RECONCILIATION_CONCURRENT_CHANGE");active();
  return binding;
}
