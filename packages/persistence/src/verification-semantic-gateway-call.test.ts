import {PostgresVerificationProviderAccounting} from "./verification-provider-accounting.js";
import {GatewaySemanticJudgeAdapter} from "@aiengineer/knowledge-verification";
import {describe,expect,it,vi} from "vitest";
import {createNativeSemanticGatewayCall} from "./verification-semantic-gateway-call.js";
import {createVerificationArtifactHandle} from "./verification.js";
import {gatewaySemanticPromptDigest,gatewaySemanticOutputSchemaDigest,gatewaySemanticConfigurationDigest} from "@aiengineer/knowledge-verification";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function fixture(){const register=vi.fn(async({artifact}:any)=>createVerificationArtifactHandle(artifact)),network=vi.fn();const model="openai/gpt-5.6-luna" as const;
 const profile=createVerificationArtifactHandle({tenantId:id(1),bytes:new TextEncoder().encode("profile"),createdAt:"2026-09-07T00:00:00.000Z",producerActivityId:"fixture",producerVersion:"v1",encryptionClass:"managed",retentionClass:"audit",dataClassification:"restricted",mediaType:"application/json"});
 return {register,network,input:{database:{} as never,artifacts:{registerFencedContentAddressedArtifact:register} as never,lease:{id:id(3),tenantId:id(1),operationId:id(2),stepKey:"verify_claims_and_register",stepKind:"verify_claims_and_register",inputSha256:"a".repeat(64),status:"running",attemptCount:1,maxAttempts:1,rowVersion:1,holderIdentity:"worker",leaseToken:id(4),fencingToken:2,expiresAt:"2026-09-07T01:00:00.000Z"},host:"claims" as const,producerAttemptId:id(5),providerAttemptId:id(6),profileArtifact:profile,blindedInput:{rubricVersion:"evidence-only.v1" as const,assertionId:"claim-1",proposition:"A",qualifiers:[],entityBindings:[],fragments:[{fragmentId:"f-1",exactText:"A"}]},identity:{deploymentId:"judge",provider:"vercel-ai-gateway",family:"openai",model,capability:"llm_evidence_rubric" as const,graderVersion:"evidence-only.v1",promptDigest:gatewaySemanticPromptDigest,outputSchemaDigest:gatewaySemanticOutputSchemaDigest,configurationDigest:gatewaySemanticConfigurationDigest(model)},model,apiKey:"fixture-key",budget:{budgetId:id(7),budgetKey:"semantic",ceilingCostMicros:10000,reservationCostMicros:100},classification:"synthetic" as const,storageBucket:"ai-engineer-cloud-bucket",now:()=>"2026-09-07T00:00:00.000Z",fetch:network}};
}
describe("native semantic gateway call composition",()=>{
 it("fences the blinded input and rejects altered judge content before network",async()=>{const f=fixture();const call=await createNativeSemanticGatewayCall(f.input);expect(f.register).toHaveBeenCalledOnce();expect(f.register.mock.calls[0]?.[0].lease).toMatchObject({stepId:id(3),fencingToken:2});await expect(call.adapter.judge({...f.input.blindedInput,proposition:"altered",inputArtifactDigest:call.blindedInputArtifact.digest as `sha256:${string}`},{})).rejects.toThrow("SEMANTIC_GATEWAY_INPUT_MISMATCH");expect(f.network).not.toHaveBeenCalled();});
 it("rejects a wrong operation host before registering artifacts",async()=>{const f=fixture();await expect(createNativeSemanticGatewayCall({...f.input,host:"report"})).rejects.toThrow("SEMANTIC_GATEWAY_SCOPE_INVALID");expect(f.register).not.toHaveBeenCalled();});
});

it("resumes an existing undispatched reservation when the caller proposes a new attempt ID",async()=>{
 const f=fixture();const read=vi.spyOn(PostgresVerificationProviderAccounting.prototype,"readOriginalAttempt").mockResolvedValue({attemptId:id(19),state:"reserved"} as never);
 const judge=vi.spyOn(GatewaySemanticJudgeAdapter.prototype,"judge").mockResolvedValue({assertionId:"claim-1"});
 try {const call=await createNativeSemanticGatewayCall(f.input);await expect(call.adapter.judge({...f.input.blindedInput,inputArtifactDigest:call.blindedInputArtifact.digest as `sha256:${string}`},{})).resolves.toEqual({assertionId:"claim-1"});expect(read).toHaveBeenCalledTimes(2);expect(judge).toHaveBeenCalledOnce();expect(f.network).not.toHaveBeenCalled();}
 finally{read.mockRestore();judge.mockRestore();}
});
