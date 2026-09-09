import { describe,it,expect,vi } from "vitest";
import { verificationMetricActivityHandler } from "./verification-metric-activity.js";

describe("metric worker failure classification",()=>{
  it("does not register a successful operation result when configured sealing fails",async()=>{
    const verify=vi.fn(async()=>({admissionState:"mechanical_only"})),registerContentAddressedArtifact=vi.fn();
    const seal=vi.fn(async()=>{throw new Error("VERIFICATION_SEAL_POLICY_GRANT_REQUIRED");});
    const handler=verificationMetricActivityHandler({service:{verify} as never,repository:{registerContentAddressedArtifact} as never,
      operations:{getOperationRecord:async()=>({status:"running"}) as never},storageBucket:"test",now:()=>"2026-09-05T00:00:00.000Z",sealer:{seal}});
    const request={verificationContractVersion:"verification.v1",captureIds:["capture-1"],observations:{artifactId:"00000000-0000-4000-8000-000000000001",digest:`sha256:${"1".repeat(64)}`}};
    const claim={id:"step",leaseToken:"lease",fencingToken:4,holderIdentity:"worker"};
    await expect(handler.execute({claim,activity:{context:{},operationInput:{schemaVersion:"verification-service-request.v1",useCase:"verifyMetricObservation",request}}} as never))
      .rejects.toMatchObject({code:"VERIFICATION_SEAL_POLICY_GRANT_REQUIRED",retryable:false});
    expect(seal).toHaveBeenCalledWith(expect.objectContaining({lease:{stepId:"step",leaseToken:"lease",fencingToken:4,holderIdentity:"worker"}}));
    expect(registerContentAddressedArtifact).not.toHaveBeenCalled();
  });
  it("rejects malformed input without hydration or a retry",async()=>{
    const verify=vi.fn(),getOperationRecord=vi.fn();
    const handler=verificationMetricActivityHandler({service:{verify} as never,repository:{} as never,operations:{getOperationRecord},storageBucket:"ai-engineer-cloud-bucket",now:()=>new Date().toISOString()});
    await expect(handler.execute({activity:{context:{},operationInput:{findings:["passed"]}}} as never)).rejects.toMatchObject({code:"INVALID_VERIFICATION_METRIC_INPUT",retryable:false});
    expect(verify).not.toHaveBeenCalled();expect(getOperationRecord).not.toHaveBeenCalled();
  });
  it("keeps registry ownership denial nonretryable and performs no metric calculation",async()=>{
    const verify=vi.fn();
    const handler=verificationMetricActivityHandler({service:{verify} as never,repository:{} as never,operations:{getOperationRecord:async()=>undefined},storageBucket:"ai-engineer-cloud-bucket",now:()=>new Date().toISOString()});
    const request={verificationContractVersion:"verification.v1",captureIds:["capture-1"],observations:{artifactId:"00000000-0000-4000-8000-000000000001",digest:`sha256:${"1".repeat(64)}`}};
    await expect(handler.execute({activity:{context:{},operationInput:{schemaVersion:"verification-service-request.v1",useCase:"verifyMetricObservation",request}}} as never)).rejects.toMatchObject({code:"VERIFICATION_OPERATION_NOT_ACTIVE",retryable:false});
    expect(verify).not.toHaveBeenCalled();
  });
});
