import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationContext, SemanticAssessmentRecord, VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { gatewaySemanticPromptDigest, sha256Digest, verifySemanticCase } from "@aiengineer/knowledge-verification";
import { prepareDiagnosticsGeneratedReportSemantics, executeDiagnosticsGeneratedReportSemantics, replayDiagnosticsGeneratedReportSemantics, type DiagnosticsGeneratedReportSemanticDispatchGrant, type DiagnosticsReportSemanticSourceBinding } from "./verification-diagnostics-generated-report-semantics.js";
vi.mock("@aiengineer/knowledge-verification", async importOriginal => ({ ...await importOriginal<object>(), verifySemanticCase: vi.fn() }));
vi.mock("./verification-claims.js", () => ({ VerificationClaimsApplicationService: class {
 constructor(private dependencies: { result: unknown; cases: unknown[] }) {}
 async verifyReport() { return this.dependencies.result; }
 prepareReportDiagnosticSemanticCases() { return this.dependencies.cases; }
} }));
const digest=sha256Digest("fixture"),uuid=(n:number)=>`11111111-1111-4111-8111-${String(n).padStart(12,"0")}`;
const context:OperationContext={contractVersion:"v1",tenantId:uuid(1),operationId:uuid(2),attemptId:uuid(3),correlationId:"test",actor:{kind:"service",id:uuid(4),serviceIdentity:"knowledge_worker"},capabilityVersion:"verification.v1",idempotencyKey:"diagnostic-test",reason:"fixture"};
const handle=(n:number):VerificationArtifactHandle=>({artifactId:uuid(n),tenantId:context.tenantId,digest,mediaType:"application/json",byteLength:7,objectKey:`fixture/${n}`,createdAt:"2026-09-08T00:00:00.000Z",producerActivityId:"test",producerVersion:"1",encryptionClass:"managed",retentionClass:"test",dataClassification:"internal",parentArtifactIds:[]});
const identity={deploymentId:"diagnostic-luna",provider:"vercel-ai-gateway",family:"openai",model:"openai/gpt-5.6-luna",capability:"llm_evidence_rubric" as const,graderVersion:"evidence-only.v1",promptDigest:gatewaySemanticPromptDigest,outputSchemaDigest:digest,configurationDigest:digest};
async function fixture(){
 const localLedgerHandles=Array.from({length:43},(_,i)=>handle(100+i)),reportHandles=Array.from({length:3},(_,i)=>handle(200+i)),sourceBindings:DiagnosticsReportSemanticSourceBinding[]=[];
 const reports=reportHandles.map((report,i)=>({reportId:`report-${i}`,request:{verificationContractVersion:"verification.v1",captureIds:["capture"],report:{artifactId:report.artifactId,digest},claimLedger:{artifactId:localLedgerHandles[i]!.artifactId,digest}},expectedReportArtifact:report,expectedClaimLedgerArtifact:localLedgerHandles[i]!}));
 const dependencies=reports.map((report,i)=>({result:{reportArtifact:report.expectedReportArtifact,claimLedgerArtifact:report.expectedClaimLedgerArtifact},cases:[0,1].map(j=>{
  const assertionId=`assertion-${i}-${j}`,fragmentId=`fragment-${i}-${j}`,exactText="Exact public statement.",selectedContentDigest=sha256Digest(exactText);
  sourceBindings.push({reportId:report.reportId,assertionId,fragmentId,captureId:"capture",sourceKey:"source",sourceClass:"first_party",sourceUri:"https://example.com/",sourceArtifact:handle(300),projectionArtifact:handle(301),transformationArtifactId:uuid(302),selector:{kind:"text_range",start:0,end:exactText.length},selectedContentDigest,rights:"public excerpt engineering grant",goldStatus:"not_labeled"});
  return {diagnosticOnly:true,baseDeterministicDigest:digest,finalDeterministicDigest:sha256Digest("failed"),semanticCase:{assertionId,proposition:exactText,qualifiers:[],entityBindings:[],riskClass:"low",downstreamUse:[],fragments:[{fragmentId,exactText,selectedContentDigest}]}};
 })}));
 let next=0;
 const prepared=await prepareDiagnosticsGeneratedReportSemantics({context,datasetManifestDigest:digest,runManifestDigest:digest,reports,createDependencies:()=>dependencies[next++] as never,sourceBindings,localLedgerHandles,reportHandles,judgeIdentity:identity,maximumCostMicros:30000,reservationMicrosPerCall:5000});
 const grant:DiagnosticsGeneratedReportSemanticDispatchGrant={schemaVersion:"diagnostics-generated-report-semantic-dispatch-grant.v1",planDigest:prepared.plan.planDigest,entryDigests:prepared.plan.entries.map(item=>item.entryDigest),model:"openai/gpt-5.6-luna",maximumCalls:6,maximumCostMicros:30000,reservationMicrosPerCall:5000,concurrency:1,automaticRetries:0,stopAfterConsecutiveFailures:3,dispatchAuthorized:true};
 return {prepared,grant,beforeDispatch:vi.fn(async()=>{}),afterAssessment:vi.fn(async()=>{}),createAdapter:vi.fn(async()=>({identity,maximumInputCharacters:2000,toolCatalog:[] as const,judge:vi.fn()})),deadlineEpochMs:()=>Date.now()+10000};
}
describe("generated report dispatch boundaries",()=>{
 beforeEach(()=>vi.mocked(verifySemanticCase).mockReset());
 it("freezes nested data and rejects fabricated preparation or changed grants before dispatch",async()=>{
  const input=await fixture();expect(()=>{(input.prepared.plan.entries[0]!.sourceBinding as {rights:string}).rights="changed";}).toThrow();
  await expect(executeDiagnosticsGeneratedReportSemantics({...input,prepared:structuredClone(input.prepared)})).rejects.toThrow("DISPATCH_NOT_AUTHORIZED");
  for(const change of [{maximumCalls:7},{maximumCostMicros:40000},{entryDigests:[]},{model:"openai/gpt-5.6-terra"}])await expect(executeDiagnosticsGeneratedReportSemantics({...input,grant:{...input.grant,...change} as never})).rejects.toThrow("DISPATCH_NOT_AUTHORIZED");
  expect(input.beforeDispatch).not.toHaveBeenCalled();expect(input.createAdapter).not.toHaveBeenCalled();
 });
 it("claims a dispatch once before awaits and retains each result",async()=>{
  const input=await fixture();vi.mocked(verifySemanticCase).mockResolvedValue({assertionId:"fixture"} as SemanticAssessmentRecord);
  const first=executeDiagnosticsGeneratedReportSemantics(input);await expect(executeDiagnosticsGeneratedReportSemantics(input)).rejects.toThrow("DISPATCH_NOT_AUTHORIZED");
  expect(await first).toMatchObject({attempted:6,completed:6,failed:0});expect(input.afterAssessment).toHaveBeenCalledTimes(6);
  await expect(executeDiagnosticsGeneratedReportSemantics(input)).rejects.toThrow("DISPATCH_NOT_AUTHORIZED");
 });
 it("stops after three failures without retries and stops on persistence failure",async()=>{
  const input=await fixture();input.createAdapter.mockRejectedValue(new Error("PROVIDER_FAILURE"));
  expect(await executeDiagnosticsGeneratedReportSemantics(input)).toMatchObject({attempted:3,failed:3,stoppedAfterConsecutiveFailures:true});expect(input.beforeDispatch).toHaveBeenCalledTimes(3);expect(input.afterAssessment).toHaveBeenCalledTimes(3);
  const disk=await fixture();disk.afterAssessment.mockRejectedValue(new Error("DISK_FULL"));await expect(executeDiagnosticsGeneratedReportSemantics(disk)).rejects.toThrow("DISK_FULL");expect(disk.beforeDispatch).toHaveBeenCalledTimes(1);
 });
 it("rejects duplicate replay entries on an authentic plan before hydration",async()=>{
  const {prepared}=await fixture(),createResolver=vi.fn();await expect(replayDiagnosticsGeneratedReportSemantics({prepared,planDigest:prepared.plan.planDigest,entries:prepared.plan.entries.map(()=>({entryDigest:prepared.plan.entries[0]!.entryDigest,expectedAssessment:{} as SemanticAssessmentRecord,judges:[]})),createResolver})).rejects.toThrow("REPLAY_PLAN_MISMATCH");expect(createResolver).not.toHaveBeenCalled();
 });
});


