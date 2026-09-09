import {describe,it,expect,vi} from "vitest";
import {KnowledgeClient} from "./index.js";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const handle={artifactId:id(3),digest:`sha256:${"a".repeat(64)}`};
const resource={verificationContractVersion:"verification.v1",tenantId:id(1),operationId:id(2),requestDigest:handle.digest,terminalFencingToken:3,output:{schemaVersion:"verification-adjudication-decision-result.v1",subjectId:id(4),packetArtifact:handle,decisionArtifact:handle,decision:"affirm",reviewerProvenance:"synthetic_engineering",quorum:{required:2,humanAffirmRecorded:0,humanRejectRecorded:0,humanDeferRecorded:0,syntheticAffirmRecorded:1,reached:false},admissionChanged:false,humanGoldScoringEligible:false}};
describe("decision terminal client",()=>{
 it("uses the dedicated authenticated GET and validates the projection",async()=>{
  const fetch=vi.fn<typeof globalThis.fetch>(async()=>new Response(JSON.stringify(resource)));
  const client=new KnowledgeClient({baseUrl:"https://knowledge.example",fetch,getAccessToken:()=>"reader"});
  expect(await client.getAdjudicationDecision(id(2),{tenantId:id(1),correlationId:"read"})).toEqual(resource);
  const call=fetch.mock.calls[0]!;expect(String(call[0])).toBe(`https://knowledge.example/v1/verification/adjudication-decisions/${id(2)}`);
  expect(call[1]?.method).toBe("GET");expect(new Headers(call[1]?.headers).get("authorization")).toBe("Bearer reader");expect(new Headers(call[1]?.headers).get("x-tenant-id")).toBe(id(1));
  expect(()=>client.getAdjudicationDecision("../foreign",{tenantId:id(1),correlationId:"read"})).toThrow();expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValue(new Response(JSON.stringify({...resource,storageKey:"private"})));
  await expect(client.getAdjudicationDecision(id(2),{tenantId:id(1),correlationId:"read"})).rejects.toThrow();
 });
});
