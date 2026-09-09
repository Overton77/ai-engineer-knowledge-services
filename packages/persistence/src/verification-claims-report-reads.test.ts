import { KNOWLEDGE_OPERATION_REQUEST_SCHEMA_VERSION } from "@aiengineer/knowledge-application";
import { deterministicUuid } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, digestCanonicalJson, sha256Digest } from "@aiengineer/knowledge-verification";
import { describe, expect, it, vi } from "vitest";
import { ClaimsReportReadError, parseSignedPolicyDecision, PostgresClaimsReportReadRepository } from "./verification-claims-report-reads.js";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const tenantId=id(1),operationId=id(2),attemptId=id(3),stepId=id(4),receiptId=id(5),eventId=id(6),at="2026-09-07T00:00:00.000Z";
const handle=(n:number,overrides:Record<string,unknown>={})=>({artifactId:id(n),tenantId,digest:sha256Digest(`artifact-${n}`),mediaType:"application/json",byteLength:2,objectKey:`private/${n}`,createdAt:at,producerActivityId:"fixture",producerVersion:"fixture.v1",encryptionClass:"managed",retentionClass:"verification-audit",dataClassification:"restricted" as const,parentArtifactIds:[],...overrides});
const context={tenantId,operationId,attemptId,missionId:id(7),workItemId:id(8),correlationId:"claims-read",actor:{kind:"service" as const,id:id(9),serviceIdentity:"mission_control_client" as const},capabilityVersion:"verification-service.v1",idempotencyKey:"claims-read-key",reason:"test",contractVersion:"v1" as const};
const request={verificationContractVersion:"verification.v1" as const,captureIds:["capture-1"],assertions:{artifactId:id(10),digest:sha256Digest("assertions")}};
const serviceInput={schemaVersion:"verification-service-request.v1" as const,useCase:"verifyClaims" as const,request};
const durable={schemaVersion:KNOWLEDGE_OPERATION_REQUEST_SCHEMA_VERSION,kind:"verification_claims" as const,input:serviceInput,expectedVersions:{verification:"verification.v1",service:"verification-service-request.v1"},authenticatedContext:context};
const step={schemaVersion:KNOWLEDGE_OPERATION_REQUEST_SCHEMA_VERSION,kind:"verification_claims" as const,operationInput:serviceInput,expectedVersions:durable.expectedVersions,context,step:{name:"verify_claims_and_register" as const,ordinal:0 as const}};
const deterministic={verificationContractVersion:"verification.v1" as const,status:"passed" as const,semanticEligibility:true,deploymentSeparation:{status:"established" as const,basis:"runtime_principal_binding" as const,producerDeploymentId:"producer",verifierDeploymentId:"verifier"},captureChecks:[],assertions:[],metrics:[],summary:{capturesTotal:1,capturesPassed:1,assertionsTotal:0,assertionsPassed:0,metricsTotal:0,metricsPassed:0,failedCheckCodes:[],reviewReasons:[]}};

function fixture(change:Record<string,unknown>={}){
  const assertions=handle(10,{digest:request.assertions.digest}),manifest=handle(11),source=handle(12),requestDigest=digestCanonicalJson(request);
  const parents=[assertions.artifactId,manifest.artifactId];
  const body={schemaVersion:"verification-operation-result.v1" as const,operationId,useCase:"verifyClaims" as const,requestDigest,output:{verified:{mode:"deterministic_only" as const,deterministicResult:deterministic,assertionsArtifact:assertions,producerAttemptId:id(13),sourceArtifacts:[source]},sealedRun:{runId:id(14),manifestDigest:sha256Digest("manifest"),policyOutcome:"review" as const,manifestArtifact:manifest}}};
  const bytes=new TextEncoder().encode(canonicalizeJson(body));
  const resultArtifact=handle(15,{digest:sha256Digest(bytes),byteLength:bytes.byteLength,mediaType:"application/vnd.aiengineer.verification-operation-result+json",producerActivityId:"verification-service:verifyClaims",producerVersion:"verification-service.v1",encryptionClass:"supabase-managed",parentArtifactIds:parents,transformationSignature:digestCanonicalJson({operationId,requestDigest,parents})});
  const result={...body,resultArtifact},outputSha=digestCanonicalJson(result).slice(7);
  const row={operation_kind:"verification_claims",status:"succeeded",request:durable,request_sha256:digestCanonicalJson(durable).slice(7),idempotency_key:context.idempotencyKey,actor_identity:`service:${context.actor.id}`,attempt_id:attemptId,mission_id:context.missionId,work_item_id:context.workItemId,correlation_id:deterministicUuid("correlation",context.correlationId),causation_id:null,ownership_mode:"standalone",external_run_id:null,step_id:stepId,step_status:"succeeded",step_key:"verify_claims_and_register",step_kind:"verify_claims_and_register",input:step,input_sha256:digestCanonicalJson(step).slice(7),receipt_id:receiptId,receipt_kind:"verify_claims_and_register.succeeded",outcome:"succeeded",receipt_input_sha256:digestCanonicalJson(step).slice(7),output_sha256:outputSha,body:{...result,eventId,fencingToken:7},artifact_id:resultArtifact.artifactId,artifact_type:"deterministic_verification_result",bucket_class:"ledger",event_id:eventId,event_operation_id:operationId,event_step_id:stepId,event_kind:"step.succeeded",event_from_state:"running",event_to_state:"succeeded",event_guarded_sha256:outputSha,event_payload:{outputSha256:outputSha,fencingToken:"7"},...change};
  return{row,bytes,resultArtifact};
}

function subject(value:ReturnType<typeof fixture>){
  const hydrate=vi.fn(async()=>({registration:value.resultArtifact,bytes:value.bytes}));
  const repository=new PostgresClaimsReportReadRepository({transaction:async(_tenant:string,work:(client:any)=>Promise<any>)=>work({query:async()=>({rows:[value.row],rowCount:1})})} as never,()=>({authorizeArtifact:vi.fn(),hydrateRegisteredArtifact:hydrate}),{verify:vi.fn(async()=>true)});
  return{repository,hydrate};
}

describe("PostgresClaimsReportReadRepository", () => {
  it("accepts only canonical, digest-bound public policy reasons from a signed decision artifact", () => {
    const decision={schemaVersion:"verification-policy-decision.v1" as const,policyVersion:"policy.v1",runId:id(14),outcome:"fail" as const,assertionOutcomes:[],reasonCodes:["SEMANTIC_HARD_FAILURE","SEMANTIC_DISPOSITION_FAIL"],overrideApplied:false};
    const bytes=new TextEncoder().encode(canonicalizeJson(decision));
    const policyHandle=handle(60,{digest:sha256Digest(bytes),mediaType:"application/vnd.aiengineer.verification-policy-decision+json"});
    const input={bytes,handle:policyHandle,policyDecisionDigest:policyHandle.digest,runId:id(14),policyVersion:"policy.v1",outcome:"fail"};
    expect(parseSignedPolicyDecision(input)).toEqual({outcome:"fail",reasonCodes:["SEMANTIC_HARD_FAILURE","SEMANTIC_DISPOSITION_FAIL"]});
    expect(()=>parseSignedPolicyDecision({...input,policyDecisionDigest:sha256Digest("forged")})).toThrow("SIGNED_POLICY_DECISION_BINDING");
    expect(()=>parseSignedPolicyDecision({...input,bytes:new TextEncoder().encode(`${canonicalizeJson(decision)}\n`)})).toThrow();
    const unsupported={...decision,reasonCodes:["PRIVATE_REASON"]}; const unsupportedBytes=new TextEncoder().encode(canonicalizeJson(unsupported)); const unsupportedHandle={...policyHandle,digest:sha256Digest(unsupportedBytes)};
    expect(()=>parseSignedPolicyDecision({...input,bytes:unsupportedBytes,handle:unsupportedHandle,policyDecisionDigest:unsupportedHandle.digest})).toThrow("SIGNED_POLICY_DECISION_BINDING");
  });
  it("rejects malformed identities before database access", async () => {
    const repository = new PostgresClaimsReportReadRepository({ transaction: async () => { throw new Error("DATABASE_SHOULD_NOT_RUN"); } } as never, () => { throw new Error("RESOLVER_SHOULD_NOT_RUN"); }, { verify: async () => false });
    await expect(repository.loadVerifiedClaimsReport("bad", "also-bad")).rejects.toEqual(expect.objectContaining<Partial<ClaimsReportReadError>>({ code: "INVALID" }));
  });
  it("rejects cross-kind durable rows before Storage hydration",async()=>{
    const value=fixture({operation_kind:"verification_report"}),test=subject(value);
    await expect(test.repository.loadVerifiedClaimsReport(tenantId,operationId)).rejects.toMatchObject({code:"INTEGRITY"});
    expect(test.hydrate).not.toHaveBeenCalled();
  });
  it("rejects context and event-fence drift before Storage hydration",async()=>{
    for(const change of [{ownership_mode:"eve"},{correlation_id:id(99)},{event_payload:{outputSha256:"bad",fencingToken:"7"}}]){
      const test=subject(fixture(change));
      await expect(test.repository.loadVerifiedClaimsReport(tenantId,operationId)).rejects.toMatchObject({code:"INTEGRITY"});
      expect(test.hydrate).not.toHaveBeenCalled();
    }
  });
  it("rejects result transformation drift before reading its bytes",async()=>{
    const value=fixture(),body={...(value.row.body as Record<string,unknown>),resultArtifact:{...value.resultArtifact,transformationSignature:sha256Digest("wrong")}};
    const outputSha=digestCanonicalJson(Object.fromEntries(Object.entries(body).filter(([key])=>key!=="eventId"&&key!=="fencingToken"))).slice(7);
    const changed=fixture({body,output_sha256:outputSha,event_guarded_sha256:outputSha,event_payload:{outputSha256:outputSha,fencingToken:"7"}});
    const test=subject(changed);
    await expect(test.repository.loadVerifiedClaimsReport(tenantId,operationId)).rejects.toMatchObject({code:"INTEGRITY"});
    expect(test.hydrate).not.toHaveBeenCalled();
  });
});
