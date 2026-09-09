import {describe,it,expect,vi} from "vitest";
import {digestCanonicalJson,sha256Digest} from "@aiengineer/knowledge-verification";
import {verificationAdjudicationDecisionActivityHandler} from "./verification-adjudication-decision-activity.js";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function fixture(){
 const context={tenantId:id(1),operationId:id(2),attemptId:id(3),actor:{kind:"service" as const,id:id(4),serviceIdentity:"human_reviewer" as const},correlationId:"fixture",capabilityVersion:"v1",contractVersion:"v1" as const,idempotencyKey:"fixture-review",reason:"Synthetic test"};
 const request={verificationContractVersion:"verification.v1" as const,subjectId:id(5),packetArtifact:{artifactId:id(6),digest:sha256Digest("packet")},decision:"affirm" as const,rationale:"Synthetic test only"};
 const decisionBytes=new TextEncoder().encode('{}');
 const prepared={decisionId:id(7),request,requestDigest:digestCanonicalJson(request),context,authority:{provenance:"synthetic_engineering" as const,role:"verification_expert"},sourceOperationId:id(8),decisionDigest:sha256Digest(decisionBytes),rationaleDigest:sha256Digest(request.rationale),decisionBytes,parentArtifactIds:[id(6)]};
 const output={schemaVersion:"verification-adjudication-decision-result.v1" as const,subjectId:id(5),packetArtifact:request.packetArtifact,decisionArtifact:{artifactId:id(9),digest:prepared.decisionDigest},decision:"affirm" as const,reviewerProvenance:"synthetic_engineering" as const,quorum:{required:2,humanAffirmRecorded:0,humanRejectRecorded:0,humanDeferRecorded:0,syntheticAffirmRecorded:1,reached:false},admissionChanged:false as const,humanGoldScoringEligible:false as const};
 const prepare=vi.fn().mockResolvedValue(prepared),commitDecision=vi.fn().mockResolvedValue(output),getOperationRecord=vi.fn().mockResolvedValue({status:"running"});
 const handler=verificationAdjudicationDecisionActivityHandler({preparation:{prepare},decisions:{commitDecision},operations:{getOperationRecord},storageBucket:"ai-engineer-cloud-bucket",now:()=>"2026-09-08T00:00:00Z"});
 const input={activity:{context,operationInput:{schemaVersion:"verification-service-request.v1",useCase:"recordAdjudicationDecision",request}},claim:{operationId:id(2),id:id(10),inputSha256:"a".repeat(64),leaseToken:id(11),fencingToken:3,holderIdentity:"fixture"}};
 const run=()=>handler.execute(input as never);
 return {input,prepared,output,prepare,commitDecision,getOperationRecord,run};
}
describe("packet-bound decision worker activity",()=>{
 it("passes the claimed fence and emits a bound result without admission changes",async()=>{
  const f=fixture();expect(await f.run()).toMatchObject({useCase:"recordAdjudicationDecision",operationId:id(2),output:f.output});
  expect(f.commitDecision.mock.calls[0]![0]).toMatchObject({lease:{stepId:id(10),leaseToken:id(11),fencingToken:3,holderIdentity:"fixture"},registration:{storageBucket:"ai-engineer-cloud-bucket",producerAttemptId:id(3)}});
 });
 it("stops before preparation or commit when the operation is cancelled",async()=>{
  const f=fixture();f.getOperationRecord.mockResolvedValue({status:"cancelled"});await expect(f.run()).rejects.toThrow("CANCELLED");expect(f.prepare).not.toHaveBeenCalled();expect(f.commitDecision).not.toHaveBeenCalled();
 });
 it("rejects preparation substitutions before commit and output substitutions before success",async()=>{
  const f=fixture();f.prepare.mockResolvedValue({...f.prepared,requestDigest:sha256Digest("wrong")});await expect(f.run()).rejects.toThrow("BINDING");expect(f.commitDecision).not.toHaveBeenCalled();
  const g=fixture();g.commitDecision.mockResolvedValue({...g.output,subjectId:id(99)});await expect(g.run()).rejects.toThrow("COMMIT_BINDING");
 });
 it("withholds success after cancellation during commit and hides infrastructure error text",async()=>{
  const f=fixture();f.commitDecision.mockImplementation(async()=>{f.getOperationRecord.mockResolvedValue({status:"cancelled"});return f.output;});await expect(f.run()).rejects.toThrow("CANCELLED");
  const g=fixture();g.prepare.mockRejectedValue(new Error("private storage credential detail"));await expect(g.run()).rejects.toMatchObject({message:"VERIFICATION_ADJUDICATION_DECISION_INFRASTRUCTURE_FAILURE",retryable:true});
 });
});
