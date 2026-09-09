import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalizeJson, GatewaySemanticJudgeAdapter, interpretCapturedGatewaySemanticResponse, prepareGatewaySemanticRequest, type GatewaySemanticResponseObservation, type ProviderArtifactSink, type SemanticJudgeAdapter } from "@aiengineer/knowledge-verification";
import { executeDiagnosticsGeneratedReportSemantics, type DiagnosticsGeneratedReportSemanticDispatchGrant, type DiagnosticsGeneratedReportSemanticPlan, type DiagnosticsGeneratedReportSemanticPlanEntry } from "../packages/application/src/verification-diagnostics-generated-report-semantics.js";
import { prepareVerificationEv162ReportSemantics } from "./prepare-verification-ev162-report-semantics.js";

type Digest = `sha256:${string}`;
const workspace=resolve(import.meta.dirname,"../.."),internal=resolve(workspace,"internal");
const preparationReceiptPath=resolve(internal,"verification-EV162-generated-report-semantic-plan-20260908.json");
const preparationReceiptDigest="sha256:57cf1e26e48dcaef65a851be8e9b7b0b49fe64ed6a896ff1a2d9a7f1a9b93045";
const digest=(bytes:Uint8Array|string):Digest=>`sha256:${createHash("sha256").update(bytes).digest("hex")}`;
type Artifact={kind:"request"|"raw_response"|"judge_output";digest:Digest;bytes:number;file:string;httpStatus?:number};
type Retained={entryDigest:Digest;reportId:string;assertionId:string;assessment?:unknown;failure?:string;artifacts:Artifact[];observation?:GatewaySemanticResponseObservation};

async function durableWrite(path:string,body:string|Uint8Array){const file=await open(path,"wx");try{await file.writeFile(body);await file.sync();}finally{await file.close();}}
async function durableAppend(path:string,value:unknown){const file=await open(path,"a");try{await file.writeFile(`${JSON.stringify(value)}\n`);await file.sync();}finally{await file.close();}}
async function putArtifact(root:string,kind:Artifact["kind"],bytes:Uint8Array,httpStatus?:number):Promise<Artifact>{
 const d=digest(bytes),file=`artifacts/${kind}-${d.slice(7)}.bin`,path=resolve(root,file);
 try{await durableWrite(path,bytes);}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;const prior=await readFile(path);if(digest(prior)!==d||prior.length!==bytes.length)throw new Error("EV162_REPORT_SEMANTIC_CAS_COLLISION");}
 return {kind,digest:d,bytes:bytes.length,file,...(httpStatus===undefined?{}:{httpStatus})};
}
function exactCost(value: unknown): number | undefined {
 return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
function liability(records: Iterable<Retained>, reservationMicrosPerCall:number) {
 let knownCostMicros=0,unknownCostRecords=0;
 for(const item of records){const cost=exactCost(item.observation?.usage.costMicros);if(cost===undefined)unknownCostRecords+=1;else knownCostMicros+=cost;}
 return {knownCostMicros,unknownCostRecords,conservativeCostMicros:knownCostMicros+unknownCostRecords*reservationMicrosPerCall};
}
function assertSecretAbsent(bytes:Uint8Array,secret:string){if(Buffer.from(bytes).includes(secret))throw new Error("EV162_REPORT_SEMANTIC_SECRET_IN_ARTIFACT");}
async function reprepare(){
 const bytes=await readFile(preparationReceiptPath);if(digest(bytes)!==preparationReceiptDigest)throw new Error("EV162_REPORT_SEMANTIC_PREPARATION_RECEIPT_DRIFT");
 const receipt=JSON.parse(bytes.toString("utf8")) as {plan:{planDigest:Digest}};
 const value=await prepareVerificationEv162ReportSemantics({writeReceipt:false});if(value.prepared.plan.planDigest!==receipt.plan.planDigest)throw new Error("EV162_REPORT_SEMANTIC_PLAN_DRIFT");return value.prepared;
}
function grantFrom(value:unknown):DiagnosticsGeneratedReportSemanticDispatchGrant{return value as DiagnosticsGeneratedReportSemanticDispatchGrant;}

async function live(grantPath:string,requestedOutput?:string){
 const prepared=await reprepare(),grant=grantFrom(JSON.parse(await readFile(resolve(grantPath),"utf8"))),apiKey=process.env.AI_GATEWAY_API_KEY;
 if(!apiKey)throw new Error("AI_GATEWAY_API_KEY_REQUIRED");
 const runId=randomUUID(),lockPath=resolve(internal,`verification-EV162-report-semantics-live-lock-${prepared.plan.planDigest.slice(7)}.json`),root=requestedOutput?resolve(requestedOutput):resolve(internal,`verification-EV162-report-semantics-live-${runId}`);
 const lock={schemaVersion:"verification-ev162-report-semantic-plan-lock.v1",runId,planDigest:prepared.plan.planDigest,grantDigest:digest(canonicalizeJson(grant)),outputDirectory:root,createdAt:new Date().toISOString()};
 // This immutable plan lock is deliberately never removed. A crash is an
 // uncertain dispatch and cannot authorize a second process or provider run.
 await durableWrite(lockPath,`${JSON.stringify(lock,null,2)}\n`);await mkdir(root);await mkdir(resolve(root,"artifacts"));
 const startup={schemaVersion:"verification-ev162-report-semantic-startup-reservation.v1",runId,planDigest:prepared.plan.planDigest,grantDigest:digest(canonicalizeJson(grant)),maximumCalls:29,maximumCostMicros:200000,reservationMicrosPerCall:5000,concurrency:1,automaticRetries:0,createdAt:new Date().toISOString()};
 await durableWrite(resolve(root,"startup-reservation.json"),`${JSON.stringify(startup,null,2)}\n`);const journal=resolve(root,"journal.jsonl");await durableWrite(journal,`${JSON.stringify({event:"startup_reserved",...startup})}\n`);
 const retained=new Map<Digest,Retained>();
 const result=await executeDiagnosticsGeneratedReportSemantics({prepared,grant,
  async beforeDispatch(entry){if(retained.has(entry.entryDigest))throw new Error("EV162_REPORT_SEMANTIC_DUPLICATE_ATTEMPT");const prior=liability(retained.values(),prepared.plan.limits.reservationMicrosPerCall);if(prior.conservativeCostMicros+prepared.plan.limits.reservationMicrosPerCall>prepared.plan.limits.maximumCostMicros)throw new Error("EV162_REPORT_SEMANTIC_LIABILITY_EXCEEDED");retained.set(entry.entryDigest,{entryDigest:entry.entryDigest,reportId:entry.reportId,assertionId:entry.assertionId,artifacts:[]});await durableAppend(journal,{event:"before_dispatch",at:new Date().toISOString(),entryDigest:entry.entryDigest,reportId:entry.reportId,assertionId:entry.assertionId,requestDigest:entry.expectedRequestDigest,priorLiability:prior,nextReservationMicros:prepared.plan.limits.reservationMicrosPerCall});},
  async createAdapter(entry){
   const item=retained.get(entry.entryDigest)!;
   const sink:ProviderArtifactSink={
    async assertExternalProcessingAdmission({providerId,modality}){if(providerId!=="gateway"||modality!=="text")throw new Error("EV162_REPORT_SEMANTIC_PROVIDER_DENIED");},
    async persistBeforeDispatch({requestDigest,requestBytes}){if(requestDigest!==entry.expectedRequestDigest||requestBytes.length!==entry.requestBytes||requestBytes.length>10000)throw new Error("EV162_REPORT_SEMANTIC_REQUEST_DRIFT");assertSecretAbsent(requestBytes,apiKey);const artifact=await putArtifact(root,"request",requestBytes);item.artifacts.push(artifact);await durableAppend(journal,{event:"request_persisted",entryDigest:entry.entryDigest,...artifact});},
    async persistAfterResponse({requestDigest,rawResponseBytes,httpStatus}){if(requestDigest!==entry.expectedRequestDigest||rawResponseBytes.length>96000||httpStatus===undefined)throw new Error("EV162_REPORT_SEMANTIC_RESPONSE_DRIFT");assertSecretAbsent(rawResponseBytes,apiKey);const artifact=await putArtifact(root,"raw_response",rawResponseBytes,httpStatus);item.artifacts.push(artifact);await durableAppend(journal,{event:"response_persisted",entryDigest:entry.entryDigest,...artifact});},
   };
   const inner=new GatewaySemanticJudgeAdapter({apiKey,model:"openai/gpt-5.6-luna",identity:prepared.plan.judgeIdentity,maximumInputCharacters:2000,artifactSink:sink,async recordObservation(observation){item.observation=observation;await durableAppend(journal,{event:"observation_captured",entryDigest:entry.entryDigest,observation});}});
   const adapter:SemanticJudgeAdapter={identity:inner.identity,maximumInputCharacters:inner.maximumInputCharacters,toolCatalog:[],async judge(input,execution){const output=await inner.judge(input,execution),bytes=new TextEncoder().encode(canonicalizeJson(output));assertSecretAbsent(bytes,apiKey);const artifact=await putArtifact(root,"judge_output",bytes);item.artifacts.push(artifact);await durableAppend(journal,{event:"judge_output_persisted",entryDigest:entry.entryDigest,...artifact});return output;}};return adapter;
  },
  deadlineEpochMs:()=>Date.now()+60000,
  async afterAssessment(entry,value){const item=retained.get(entry.entryDigest);if(!item)throw new Error("EV162_REPORT_SEMANTIC_RESULT_WITHOUT_ATTEMPT");if(value.assessment)item.assessment=value.assessment;if(value.failure)item.failure=value.failure;await durableWrite(resolve(root,`assessment-${String(entry.ordinal).padStart(2,"0")}-${entry.entryDigest.slice(7)}.json`),`${JSON.stringify(item,null,2)}\n`);await durableAppend(journal,{event:"assessment_retained",at:new Date().toISOString(),entryDigest:entry.entryDigest,assessment:item.assessment,failure:item.failure});},
 });
 const records=[...retained.values()],accounting=liability(records,prepared.plan.limits.reservationMicrosPerCall);
 if(result.attempted>29||accounting.conservativeCostMicros>prepared.plan.limits.maximumCostMicros)throw new Error("EV162_REPORT_SEMANTIC_LIABILITY_EXCEEDED");
 const receipt={schemaVersion:"verification-ev162-generated-report-semantics-live.v1",recordedAt:new Date().toISOString(),runId,plan:prepared.plan,grant,startup,lock:{path:lockPath,digest:digest(`${JSON.stringify(lock,null,2)}\n`)},result,records,accounting:{...accounting,maximumCostMicros:prepared.plan.limits.maximumCostMicros,reservationMicrosPerUnknownRecord:prepared.plan.limits.reservationMicrosPerCall},checks:{diagnosticOnly:true,reportAdmissionChanged:false,priorSemanticRecordsReused:0,fullReportsUploaded:false,serial:true,automaticRetries:0,providerCalls:result.attempted,exactApiKeyAbsent:true},limitations:["Diagnostic-only Luna evidence; report-wide failures remain terminal.","No human-gold, authority/applicability, cross-family, or acceptance promotion."]};
 const receiptText=`${JSON.stringify(receipt,null,2)}\n`;assertSecretAbsent(new TextEncoder().encode(receiptText),apiKey);await durableWrite(resolve(root,"receipt.json"),receiptText);await durableAppend(journal,{event:"complete",at:new Date().toISOString(),receiptDigest:digest(receiptText)});process.stdout.write(`${JSON.stringify({root,receipt:resolve(root,"receipt.json"),attempted:result.attempted,completed:result.completed,failed:result.failed,...accounting})}\n`);
}

type LiveReceipt = {
 readonly schemaVersion:"verification-ev162-generated-report-semantics-live.v1";
 readonly plan:DiagnosticsGeneratedReportSemanticPlan;
 readonly grant:DiagnosticsGeneratedReportSemanticDispatchGrant;
 readonly result:{readonly results:readonly {readonly entryDigest:Digest;readonly assessment?:unknown;readonly failure?:string}[];readonly attempted:number;readonly completed:number;readonly failed:number};
 readonly records:readonly Retained[];
};
type ReplayCapture={readonly retained:Retained;readonly request:Artifact;readonly requestBytes:Uint8Array;readonly raw:Artifact & {readonly httpStatus:number};readonly rawBytes:Uint8Array;readonly output:Artifact;readonly outputValue:unknown;readonly observation:GatewaySemanticResponseObservation};

async function readExactArtifact(liveRoot:string,artifact:Artifact){
 const expectedFile=`artifacts/${artifact.kind}-${artifact.digest.slice(7)}.bin`;
 if(artifact.file!==expectedFile||!Number.isSafeInteger(artifact.bytes)||artifact.bytes<0)throw new Error("EV162_REPORT_SEMANTIC_REPLAY_ARTIFACT_PATH_INVALID");
 const bytes=new Uint8Array(await readFile(resolve(liveRoot,expectedFile)));
 if(bytes.byteLength!==artifact.bytes||digest(bytes)!==artifact.digest)throw new Error("EV162_REPORT_SEMANTIC_REPLAY_ARTIFACT_DRIFT");
 return bytes;
}
async function validateReplayCapture(liveRoot:string,entry:DiagnosticsGeneratedReportSemanticPlanEntry,retained:Retained,identity:DiagnosticsGeneratedReportSemanticPlan["judgeIdentity"]):Promise<ReplayCapture>{
 if(retained.entryDigest!==entry.entryDigest||retained.reportId!==entry.reportId||retained.assertionId!==entry.assertionId||new Set(retained.artifacts.map(item=>item.kind)).size!==retained.artifacts.length)throw new Error("EV162_REPORT_SEMANTIC_REPLAY_RECORD_DRIFT");
 const request=retained.artifacts.find(item=>item.kind==="request"),raw=retained.artifacts.find(item=>item.kind==="raw_response"),output=retained.artifacts.find(item=>item.kind==="judge_output");
 if(!request||!raw||!output||retained.artifacts.length!==3||raw.httpStatus===undefined||!Number.isInteger(raw.httpStatus)||raw.httpStatus<100||raw.httpStatus>599)throw new Error("EV162_REPORT_SEMANTIC_REPLAY_ARTIFACT_MISSING");
 const [requestBytes,rawBytes,outputBytes]=await Promise.all([readExactArtifact(liveRoot,request),readExactArtifact(liveRoot,raw),readExactArtifact(liveRoot,output)]);
 if(requestBytes.byteLength>10_000||rawBytes.byteLength>96_000||outputBytes.byteLength>96_000)throw new Error("EV162_REPORT_SEMANTIC_REPLAY_ARTIFACT_LIMIT");
 const wire=prepareGatewaySemanticRequest({...entry.blindedInput,inputArtifactDigest:entry.inputArtifactDigest},"openai/gpt-5.6-luna",2_000);
 if(wire.requestDigest!==entry.expectedRequestDigest||wire.requestBytes.byteLength!==entry.requestBytes||request.digest!==wire.requestDigest||!Buffer.from(requestBytes).equals(Buffer.from(wire.requestBytes)))throw new Error("EV162_REPORT_SEMANTIC_REPLAY_REQUEST_DRIFT");
 let observation:GatewaySemanticResponseObservation|undefined;
 const outputValue=await interpretCapturedGatewaySemanticResponse({rawResponseBytes:rawBytes,rawResponseDigest:raw.digest,httpStatus:raw.httpStatus,requestDigest:request.digest,identity,inputArtifactDigest:entry.inputArtifactDigest,recordObservation:async value=>{observation=value;},assertActive:()=>{}});
 let retainedOutput:unknown;try{retainedOutput=JSON.parse(new TextDecoder("utf8",{fatal:true}).decode(outputBytes));}catch{throw new Error("EV162_REPORT_SEMANTIC_REPLAY_OUTPUT_INVALID");}
 if(canonicalizeJson(retainedOutput)!==new TextDecoder().decode(outputBytes)||canonicalizeJson(outputValue)!==canonicalizeJson(retainedOutput)||!observation||canonicalizeJson(observation)!==canonicalizeJson(retained.observation))throw new Error("EV162_REPORT_SEMANTIC_REPLAY_INTERPRETATION_DRIFT");
 return {retained,request,requestBytes,raw:{...raw,httpStatus:raw.httpStatus},rawBytes,output,outputValue,observation};
}

async function replay(liveReceiptPath:string,expectedReceiptDigest:string,requestedOutput?:string){
 if(!/^sha256:[a-f0-9]{64}$/u.test(expectedReceiptDigest))throw new Error("EV162_REPORT_SEMANTIC_REPLAY_EXPECTED_DIGEST_REQUIRED");
 const prepared=await reprepare(),livePath=resolve(liveReceiptPath),liveRoot=dirname(livePath),liveBytes=await readFile(livePath);
 if(digest(liveBytes)!==expectedReceiptDigest)throw new Error("EV162_REPORT_SEMANTIC_REPLAY_RECEIPT_DIGEST_MISMATCH");
 const liveReceipt=JSON.parse(liveBytes.toString("utf8")) as LiveReceipt;
 if(liveReceipt.schemaVersion!=="verification-ev162-generated-report-semantics-live.v1"||canonicalizeJson(liveReceipt.plan)!==canonicalizeJson(prepared.plan)||liveReceipt.records.length<1||liveReceipt.result.attempted!==liveReceipt.records.length||liveReceipt.result.results.length!==liveReceipt.records.length||liveReceipt.result.completed+liveReceipt.result.failed!==liveReceipt.result.attempted)throw new Error("EV162_REPORT_SEMANTIC_REPLAY_INPUT_DRIFT");
 if(new Set(liveReceipt.records.map(item=>item.entryDigest)).size!==liveReceipt.records.length)throw new Error("EV162_REPORT_SEMANTIC_REPLAY_RECORD_DUPLICATE");
 const expectedEntries=prepared.plan.entries.slice(0,liveReceipt.records.length);
 if(expectedEntries.some((entry,index)=>entry.entryDigest!==liveReceipt.records[index]?.entryDigest||entry.entryDigest!==liveReceipt.result.results[index]?.entryDigest||canonicalizeJson(liveReceipt.records[index]?.assessment??null)!==canonicalizeJson(liveReceipt.result.results[index]?.assessment??null)||liveReceipt.records[index]?.failure!==liveReceipt.result.results[index]?.failure))throw new Error("EV162_REPORT_SEMANTIC_REPLAY_RESULT_DRIFT");
 const captures=new Map<Digest,ReplayCapture>();for(const [index,entry] of expectedEntries.entries())captures.set(entry.entryDigest,await validateReplayCapture(liveRoot,entry,liveReceipt.records[index]!,prepared.plan.judgeIdentity));
 const root=requestedOutput?resolve(requestedOutput):resolve(internal,`verification-EV162-report-semantics-replay-${randomUUID()}`);await mkdir(root);const journal=resolve(root,"journal.jsonl");await durableWrite(journal,`${JSON.stringify({event:"offline_replay_started",planDigest:prepared.plan.planDigest,sourceReceiptDigest:expectedReceiptDigest})}\n`);
 const result=await executeDiagnosticsGeneratedReportSemantics({prepared,grant:liveReceipt.grant,
  async beforeDispatch(entry){if(!captures.has(entry.entryDigest))throw new Error("EV162_REPORT_SEMANTIC_REPLAY_RECORD_MISSING");await durableAppend(journal,{event:"offline_entry",entryDigest:entry.entryDigest});},
  async createAdapter(entry){const capture=captures.get(entry.entryDigest);if(!capture)throw new Error("EV162_REPORT_SEMANTIC_REPLAY_RECORD_MISSING");const status=capture.raw.httpStatus;
   const sink:ProviderArtifactSink={async assertExternalProcessingAdmission(value){if(value.providerId!=="gateway"||value.modality!=="text")throw new Error("EV162_REPORT_SEMANTIC_REPLAY_PROVIDER_DRIFT");},async persistBeforeDispatch(value){if(value.requestDigest!==capture.request.digest||digest(value.requestBytes)!==capture.request.digest||!Buffer.from(value.requestBytes).equals(Buffer.from(capture.requestBytes)))throw new Error("EV162_REPORT_SEMANTIC_REPLAY_REQUEST_DRIFT");},async persistAfterResponse(value){if(value.requestDigest!==capture.request.digest||digest(value.rawResponseBytes)!==capture.raw.digest||value.httpStatus!==status||!Buffer.from(value.rawResponseBytes).equals(Buffer.from(capture.rawBytes)))throw new Error("EV162_REPORT_SEMANTIC_REPLAY_RESPONSE_DRIFT");}};
   const inner=new GatewaySemanticJudgeAdapter({apiKey:"offline-replay-only",model:"openai/gpt-5.6-luna",identity:prepared.plan.judgeIdentity,maximumInputCharacters:2000,artifactSink:sink,fetch:async()=>new Response(capture.rawBytes,{status}),async recordObservation(value){if(canonicalizeJson(value)!==canonicalizeJson(capture.observation))throw new Error("EV162_REPORT_SEMANTIC_REPLAY_OBSERVATION_DRIFT");}});
   return {identity:inner.identity,maximumInputCharacters:inner.maximumInputCharacters,toolCatalog:[] as const,async judge(input,execution){const value=await inner.judge(input,execution);if(canonicalizeJson(value)!==canonicalizeJson(capture.outputValue))throw new Error("EV162_REPORT_SEMANTIC_REPLAY_OUTPUT_DRIFT");return value;}};
  },deadlineEpochMs:()=>Date.now()+60000,
  async afterAssessment(entry,value){const retained=captures.get(entry.entryDigest)?.retained;if(!retained||canonicalizeJson(value.assessment??null)!==canonicalizeJson(retained.assessment??null)||value.failure!==retained.failure)throw new Error("EV162_REPORT_SEMANTIC_REPLAY_ASSESSMENT_DRIFT");await durableAppend(journal,{event:"offline_assessment_matched",entryDigest:entry.entryDigest});},
 });
 if(result.attempted!==liveReceipt.result.attempted||result.completed!==liveReceipt.result.completed||result.failed!==liveReceipt.result.failed)throw new Error("EV162_REPORT_SEMANTIC_REPLAY_COUNT_DRIFT");
 const receipt={schemaVersion:"verification-ev162-generated-report-semantics-offline-replay.v1",recordedAt:new Date().toISOString(),sourceReceipt:{path:livePath,digest:expectedReceiptDigest},planDigest:prepared.plan.planDigest,result,externalRequests:0,checks:{allArtifactDigestsAndLengthsMatched:true,allArtifactPathsCanonical:true,requestsRebuiltFromPlan:true,rawResponsesReinterpreted:true,observationsRecomputed:true,outputsMatched:true,assessmentsMatched:true},limitations:["Replays exact captured Gateway response bytes; does not dispatch or change report admission."]};await durableWrite(resolve(root,"receipt.json"),`${JSON.stringify(receipt,null,2)}\n`);process.stdout.write(`${JSON.stringify({root,receipt:resolve(root,"receipt.json"),attempted:result.attempted,externalRequests:0})}\n`);
}

async function main(){const[mode,input,second,third]=process.argv.slice(2);if(mode==="live"&&input)return live(input,second);if(mode==="replay"&&input&&second)return replay(input,second,third);throw new Error("USAGE: live <grant.json> [output-directory] | replay <live-receipt.json> <expected-sha256> [output-directory]");}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:"unknown"}\n`);process.exitCode=1;});


