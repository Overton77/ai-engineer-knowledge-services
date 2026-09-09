import { describe, expect, it, vi } from "vitest";
import { createVerificationClaimsSemanticStage, parseClaimsSemanticRuntimeConfiguration } from "./verification-claims-semantic-stage.js";
import { createNativeSemanticGatewayCall } from "@aiengineer/knowledge-persistence";
import { sha256Digest } from "@aiengineer/knowledge-verification";
vi.mock("@aiengineer/knowledge-persistence",async importOriginal => ({...await importOriginal<object>(),createNativeSemanticGatewayCall:vi.fn()}));

function fixture() {
  const lease = {id:"step",tenantId:"tenant",operationId:"operation",stepKey:"verify_claims_and_register",stepKind:"verify_claims_and_register",leaseToken:"token",holderIdentity:"worker",fencingToken:2};
  const body = {rubricVersion:"evidence-only.v1",assertionId:"claim-1",proposition:"A",qualifiers:[],entityBindings:[],fragments:[{fragmentId:"f-1",exactText:"A"}]};
  const bytes = new TextEncoder().encode("retained evidence"), digest = sha256Digest(bytes);
  const profile = {artifactId:"profile",digest};
  const grants = [{role:"primary",identity:{model:"openai/gpt-5.6-luna"},profileArtifact:profile},{role:"cross_family",identity:{model:"anthropic/claude-haiku-4.5"},profileArtifact:{...profile,artifactId:"second"}}];
  const hydrate = vi.fn(async (grant:any) => ({artifact:grant.profileArtifact}));
  const judge = vi.fn(async () => ({verdict:"insufficient_evidence"}));
  vi.mocked(createNativeSemanticGatewayCall).mockReset().mockResolvedValue({adapter:{judge}} as never);
  const assertBatch = vi.fn();
  const service = {gradePreparedSemantics:vi.fn(async (_result:any,_context:any,adapters:any) => {const judges=await adapters({});await judges.primary.judge(body,{});return {assessments:[{assertionId:"claim-1"}]};}),assertSemanticAssessmentBatch:assertBatch};
  const query = vi.fn(async () => ({rows:[{observation_artifact_id:"observation",observation_sha256:digest.slice(7),transport_artifact_id:"transport",transport_sha256:digest.slice(7)}]}));
  const repository = {createTrustedArtifactResolver:() => ({authorizeArtifact:vi.fn(),hydrateRegisteredArtifact:async ({artifactId}:any) => ({registration:{tenantId:"tenant",artifactId,digest,byteLength:bytes.length},bytes})})};
  const dependencies = {service,database:{transaction:async (_tenant:any,work:any) => work({query})},repository,profiles:{resolve:()=>grants,hydrate},settings:{classification:"synthetic",ceilingCostMicros:1000,reservationCostMicros:100,deadlineMs:1000},apiKey:"fixture",storageBucket:"fixture",now:()=>"2026-09-07T00:00:00Z"};
  const input = {verified:{},context:{tenantId:"tenant",operationId:"operation",attemptId:"verifier"},claim:{stepId:lease.id,leaseToken:lease.leaseToken,holderIdentity:lease.holderIdentity,fencingToken:lease.fencingToken},runtimeLease:lease,startedAt:"2026-09-07T00:00:00Z"};
  return {dependencies,input,hydrate,query,assertBatch,service,bytes,body};
}
describe("native claims semantic stage boundary",() => {
  it("passes the actual lease and shared budget, returns both retained roots, and leaves the unused judge lazy",async () => {
    const f=fixture(),stage=createVerificationClaimsSemanticStage(f.dependencies as never);
    const result=await stage.grade(f.input as never);
    expect(createNativeSemanticGatewayCall).toHaveBeenCalledOnce();
    expect(createNativeSemanticGatewayCall).toHaveBeenCalledWith(expect.objectContaining({lease:f.input.runtimeLease,producerAttemptId:"verifier",host:"claims",budget:expect.objectContaining({ceilingCostMicros:1000,reservationCostMicros:100})}));
    expect(vi.mocked(createNativeSemanticGatewayCall).mock.calls[0]![0].budget.budgetKey).toMatch(/^[a-z0-9][a-z0-9._-]{0,119}$/);
    expect(f.hydrate).toHaveBeenCalledOnce();expect(f.assertBatch).toHaveBeenCalledOnce();
    expect(result.evidenceArtifacts.map(value=>value.artifactId)).toEqual(["observation","transport"]);
  });
  it("rejects substituted fencing or host before grading",async () => {
    const f=fixture(),stage=createVerificationClaimsSemanticStage(f.dependencies as never);
    await expect(stage.grade({...f.input,runtimeLease:{...f.input.runtimeLease,fencingToken:3}} as never)).rejects.toThrow("SEMANTIC_RUNTIME_LEASE_REQUIRED");
    await expect(stage.grade({...f.input,verified:{reportArtifact:{}}} as never)).rejects.toThrow("SEMANTIC_RUNTIME_LEASE_REQUIRED");
    expect(f.service.gradePreparedSemantics).not.toHaveBeenCalled();
  });
  it("shares one budget across invoked judge families with distinct logical provider attempts",async () => {
    const f=fixture();
    f.service.gradePreparedSemantics.mockImplementationOnce(async (_result,_context,adapters) => {
      const judges=await adapters({});
      await judges.primary.judge(f.body,{});await judges.crossFamily.judge(f.body,{});
      return {assessments:[{assertionId:"claim-1"}]};
    });
    await createVerificationClaimsSemanticStage(f.dependencies as never).grade(f.input as never);
    const calls=vi.mocked(createNativeSemanticGatewayCall).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![0].budget).toEqual(calls[1]![0].budget);
    expect(calls[0]![0].providerAttemptId).not.toBe(calls[1]![0].providerAttemptId);
  });
  it("rejects missing durable observation and changed retained bytes",async () => {
    const f=fixture(),stage=createVerificationClaimsSemanticStage(f.dependencies as never);
    f.query.mockResolvedValueOnce({rows:[]});
    await expect(stage.grade(f.input as never)).rejects.toThrow("SEMANTIC_STAGE_OBSERVATION_REQUIRED");
    f.bytes[0]=0;
    await expect(stage.grade(f.input as never)).rejects.toThrow("SEMANTIC_STAGE_EVIDENCE_DRIFT");
    expect(f.assertBatch).not.toHaveBeenCalled();
  });
  it("requires explicit bounded configuration, profile grants and a key",() => {
    expect(parseClaimsSemanticRuntimeConfiguration({})).toBeUndefined();
    expect(()=>parseClaimsSemanticRuntimeConfiguration({VERIFICATION_SEMANTIC_RUNTIME_JSON:"{"})).toThrow("SEMANTIC_RUNTIME_CONFIGURATION_INVALID");
    const settings=fixture().dependencies.settings;
    expect(()=>parseClaimsSemanticRuntimeConfiguration({VERIFICATION_SEMANTIC_RUNTIME_JSON:JSON.stringify(settings)})).toThrow("SEMANTIC_RUNTIME_PROFILE_AND_KEY_REQUIRED");
    expect(()=>parseClaimsSemanticRuntimeConfiguration({VERIFICATION_SEMANTIC_RUNTIME_JSON:JSON.stringify({...settings,ceilingCostMicros:20_000_001})})).toThrow();
  });
});
