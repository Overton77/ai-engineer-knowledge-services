import {describe,it,expect,vi} from "vitest";
import {KnowledgeIntegrationService} from "@aiengineer/knowledge-application";
import {buildServer} from "./server.js";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const actor={kind:"service" as const,id:id(2),serviceIdentity:"human_reviewer" as const};
const headers={authorization:"Bearer review-test", "x-tenant-id":id(1),"x-correlation-id":"review-test","idempotency-key":"review-test-001"};
const request={verificationContractVersion:"verification.v1",subjectId:id(3),packetArtifact:{artifactId:id(4),digest:`sha256:${"a".repeat(64)}`},decision:"affirm",rationale:"Synthetic engineering test"};
function fixture(admitted?:boolean,reviewer=true){
 const operations=new KnowledgeIntegrationService(),grant=vi.fn().mockResolvedValue(admitted);
 const identity={actor:reviewer?actor:{...actor,serviceIdentity:"mission_control_client" as const},grants:[{tenantId:id(1),roles:["knowledge_operator" as const],scopes:[]}]};
 const server=buildServer({verificationOperationService:operations,resolveIdentity:()=>identity,resolveVerificationContext:async input=>({tenantId:input.tenantId,operationId:id(5),attemptId:id(6),correlationId:input.correlationId,idempotencyKey:input.idempotencyKey,actor:input.identity.actor,capabilityVersion:"verification.v1",reason:"Test",contractVersion:"v1"}),...(admitted===undefined?{}:{isAdjudicationDecisionAdmitted:grant})});
 const send=(payload:unknown=request)=>server.inject({method:"POST",url:"/v1/verification/adjudications:record-decision",headers,payload:payload as object});
 return {server,operations,grant,send};
}
describe("packet-bound decision HTTP boundary",()=>{
 it("does not enqueue when runtime or reviewer grant is absent",async()=>{
  for(const [admitted,status] of [[undefined,503],[false,403]] as const){const f=fixture(admitted);try{expect((await f.send()).statusCode).toBe(status);expect(f.operations.get(id(5),id(1))).toBeUndefined();}finally{await f.server.close();}}
 });
 it("rejects non-reviewer service identity before grant lookup",async()=>{
  const f=fixture(true,false);try{expect((await f.send()).statusCode).toBe(403);expect(f.grant).not.toHaveBeenCalled();expect(f.operations.get(id(5),id(1))).toBeUndefined();}finally{await f.server.close();}
 });
 it("rejects request authority injection and forwards authenticated identity to grant checking",async()=>{
  const f=fixture(true);try{
   expect((await f.send({...request,reviewerRole:"admin"})).statusCode).toBe(400);expect(f.grant).not.toHaveBeenCalled();
   const response=await f.send();expect(response.statusCode,response.body).toBe(202);
   expect(f.grant).toHaveBeenCalledWith({request,context:expect.objectContaining({tenantId:id(1),actor})});
   expect(f.operations.input(id(5),id(1))).toEqual({schemaVersion:"verification-service-request.v1",useCase:"recordAdjudicationDecision",request});
  }finally{await f.server.close();}
 });
});
