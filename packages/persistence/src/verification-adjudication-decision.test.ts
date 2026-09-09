import {describe,it,expect,vi} from "vitest";
import {digestCanonicalJson,sha256Digest} from "@aiengineer/knowledge-verification";
import type {PreparedVerificationAdjudicationDecision,VerificationAdjudicationDecisionCommitPort} from "@aiengineer/knowledge-application";
import {PostgresVerificationAdjudicationDecisionRepository} from "./verification-adjudication-decision.js";
import {createVerificationArtifactHandle} from "./verification.js";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function fixture(){
 const context={tenantId:id(1),operationId:id(2),attemptId:id(3),actor:{kind:"service" as const,id:id(4),serviceIdentity:"human_reviewer" as const},correlationId:"fixture",capabilityVersion:"v1",idempotencyKey:"review-fixture",reason:"Engineering only",contractVersion:"v1" as const};
 const request={verificationContractVersion:"verification.v1" as const,subjectId:id(5),packetArtifact:{artifactId:id(6),digest:sha256Digest("packet")},decision:"affirm" as const,rationale:"Synthetic only"};
 const decisionBytes=new TextEncoder().encode('{}');
 const prepared:PreparedVerificationAdjudicationDecision={decisionId:id(7),request,requestDigest:digestCanonicalJson(request),context,authority:{provenance:"synthetic_engineering",role:"verification_expert"},sourceOperationId:id(8),decisionDigest:sha256Digest(decisionBytes),rationaleDigest:sha256Digest(request.rationale),decisionBytes,parentArtifactIds:[id(6)]};
 const durable={schemaVersion:"knowledge-operation-request/v1",kind:"verification_adjudication_decision",input:{schemaVersion:"verification-service-request.v1",useCase:"recordAdjudicationDecision",request},expectedVersions:{verification:"verification.v1"},authenticatedContext:context};
 const step={schemaVersion:durable.schemaVersion,kind:durable.kind,operationInput:durable.input,expectedVersions:durable.expectedVersions,context,step:{name:"record_packet_bound_decision",ordinal:0}};
 const input:Parameters<VerificationAdjudicationDecisionCommitPort["commitDecision"]>[0]={prepared,lease:{operationId:id(2),stepId:id(9),leaseToken:id(10),fencingToken:1,holderIdentity:"fixture",inputSha256:digestCanonicalJson(step).slice(7)},registration:{createdAt:"2026-09-08T00:00:00Z",producerAttemptId:id(3),producerActivityId:"fixture",producerVersion:"v1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",storageBucket:"verification-ledger"}};
 const state:{live:boolean;subjectLive:boolean;grant:boolean;row?:Record<string,unknown>;durable:unknown}={live:true,subjectLive:true,grant:true,durable};
 const query=vi.fn(async(sql:string,values:readonly unknown[]=[])=>{
  let rows:Record<string,unknown>[]=[];
  if(sql.includes("for update of o,s,l")) rows=state.live?[{request:state.durable,request_sha256:digestCanonicalJson(state.durable).slice(7),input:step,input_sha256:input.lease.inputSha256,actor_identity:`${context.actor.kind}:${context.actor.id}`,attempt_id:id(3),mission_id:null}]:[];
  else if(sql.includes("from evidence.verification_adjudication_subject"))rows=[{unexpired:state.subjectLive,request_operation_id:id(8),packet_artifact_id:id(6),packet_sha256:request.packetArtifact.digest.slice(7),eligible_reviewer_roles:["verification_expert"]}];
  else if(sql.includes("from evidence.verification_adjudication_reviewer_grant"))rows=state.grant?[{id:id(20)}]:[];
  else if(sql.startsWith("select * from evidence.verification_adjudication_decision"))rows=state.row?[state.row]:[];
  else if(sql.startsWith("insert into evidence.verification_adjudication_decision")){const columns=sql.slice(sql.indexOf('(')+1,sql.indexOf(')')).split(',');state.row=Object.fromEntries(columns.map((name,i)=>[name,values[i]]));}
  else if(sql.includes("from evidence.verification_adjudication_review_state"))rows=[{quorum_required:2,human_affirmed:0,human_rejected:0,human_deferred:0,synthetic_affirmed:1,quorum_reached:false}];
  else throw new Error(`Unexpected query ${sql}`);
  return {rows,rowCount:rows.length};
 });
 const prepare=vi.fn(async()=>structuredClone(prepared));
 const register=vi.fn(async({artifact}:{artifact:Parameters<typeof createVerificationArtifactHandle>[0]})=>createVerificationArtifactHandle(artifact));
 const transaction=vi.fn(async(_tenant:string,fn:(c:{query:typeof query})=>Promise<unknown>)=>fn({query}));
 const repository=new PostgresVerificationAdjudicationDecisionRepository({transaction} as never,{registerFencedContentAddressedArtifact:register} as never,{prepare});
 return {input,state,query,prepare,register,repository};
}
describe("packet-bound decision commit boundary (mocked engineering tests)",()=>{
 it("registers, commits and recovers one immutable decision under a renewed fence",async()=>{
  const f=fixture();const first=await f.repository.commitDecision(f.input);
  expect(first).toMatchObject({reviewerProvenance:"synthetic_engineering",quorum:{reached:false},admissionChanged:false,humanGoldScoringEligible:false});
  expect(await f.repository.commitDecision({...f.input,lease:{...f.input.lease,fencingToken:2,leaseToken:id(11)}})).toEqual(first);
  expect(f.query.mock.calls.filter(([sql])=>sql.startsWith("insert into"))).toHaveLength(1);
 });
 it("rejects caller byte and prepared-authority tampering before storage writes",async()=>{
  for(const mutate of [(f:ReturnType<typeof fixture>)=>{f.input.prepared.decisionBytes[0]=1;},(f:ReturnType<typeof fixture>)=>{(f.input as {prepared:PreparedVerificationAdjudicationDecision}).prepared={...f.input.prepared,decisionId:id(99)};}]){
   const f=fixture();const trusted=structuredClone(f.input.prepared);f.prepare.mockResolvedValue(trusted);mutate(f);
   await expect(f.repository.commitDecision(f.input)).rejects.toThrow("PREPARATION_DRIFT");expect(f.register).not.toHaveBeenCalled();
  }
 });
 it("rejects stale leases and mismatched durable requests before registration",async()=>{
  const f=fixture();f.state.live=false;await expect(f.repository.commitDecision(f.input)).rejects.toThrow("STALE_LEASE");expect(f.register).not.toHaveBeenCalled();
  f.state.live=true;f.state.durable={...(f.state.durable as object),expectedVersions:{verification:"different"}};
  await expect(f.repository.commitDecision(f.input)).rejects.toThrow("DURABLE_BINDING");expect(f.register).not.toHaveBeenCalled();
 });
 it("rechecks lease and subject after asynchronous storage registration",async()=>{
  for(const boundary of ["lease","subject"]){const f=fixture();const register=f.register.getMockImplementation()!;
   f.register.mockImplementation(async value=>{const result=await register(value);if(boundary==="lease")f.state.live=false;else f.state.subjectLive=false;return result;});
   await expect(f.repository.commitDecision(f.input)).rejects.toThrow(boundary==="lease"?"STALE_LEASE":"SUBJECT_BINDING");expect(f.state.row).toBeUndefined();}
 });
 it("rejects recovery drift instead of overwriting evidence",async()=>{
  const f=fixture();await f.repository.commitDecision(f.input);f.state.row!.decision="reject";
  await expect(f.repository.commitDecision(f.input)).rejects.toThrow("RECOVERY_DRIFT");expect(f.state.row!.decision).toBe("reject");
 });
 it("does not record a decision when artifact registration fails",async()=>{
  const f=fixture();f.register.mockRejectedValue(new Error("STORAGE_UNAVAILABLE"));
  await expect(f.repository.commitDecision(f.input)).rejects.toThrow("STORAGE_UNAVAILABLE");expect(f.state.row).toBeUndefined();
 });
 it("rechecks the exact human grant inside the commit transaction",async()=>{
  const f=fixture();
  // In-memory authority fixture only; no canonical human record is created.
  const context={...f.input.prepared.context,actor:{kind:"human" as const,id:id(4)}};
  const prepared={...f.input.prepared,context,authority:{provenance:"human_origin" as const,grantId:id(20),role:"verification_expert"}};
  f.prepare.mockResolvedValue(prepared);
  const query=f.query.getMockImplementation()!;
  f.query.mockImplementation(async(sql,values)=>{
   const result=await query(sql,values);
   if(sql.includes("for update of o,s,l")){
    const row=result.rows[0]!;
    const durable={...(row.request as object),authenticatedContext:context};
    const step={...(row.input as object),context};
    row.request=durable;row.request_sha256=digestCanonicalJson(durable).slice(7);
    row.input=step;row.input_sha256=digestCanonicalJson(step).slice(7);row.actor_identity=`human:${id(4)}`;
   }
   return result;
  });
  const durable=f.state.durable as {input:unknown;expectedVersions:unknown};
  const step={schemaVersion:"knowledge-operation-request/v1",kind:"verification_adjudication_decision",operationInput:durable.input,expectedVersions:durable.expectedVersions,context,step:{name:"record_packet_bound_decision",ordinal:0}};
  f.state.grant=false;
  await expect(f.repository.commitDecision({...f.input,prepared,lease:{...f.input.lease,inputSha256:digestCanonicalJson(step).slice(7)}})).rejects.toThrow("AUTHORITY_EXPIRED");
  expect(f.state.row).toBeUndefined();
 });
});



