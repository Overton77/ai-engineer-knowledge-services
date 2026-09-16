import { lstat, readFile, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { z } from "zod";
import { SemanticAssessmentRecordSchema, type SemanticAssessmentRecord } from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, interpretCapturedGatewaySemanticResponse, prepareGatewaySemanticRequest, sha256Digest, type GatewaySemanticResponseObservation } from "@aiengineer/knowledge-verification";
import { executeDiagnosticsGeneratedReportSemantics, type DiagnosticsGeneratedReportSemanticDispatchGrant, type DiagnosticsGeneratedReportSemanticPlanEntry, type PreparedDiagnosticsGeneratedReportSemantics } from "./verification-diagnostics-generated-report-semantics.js";

type Digest = `sha256:${string}`;
const DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const ArtifactSchema = z.strictObject({ kind:z.enum(["request","raw_response","judge_output"]), file:z.string().min(1).max(180), digest:DigestSchema, bytes:z.int().min(1).max(96_000), httpStatus:z.int().min(100).max(599).optional() });
const UsageSchema = z.strictObject({ promptTokens:z.int().min(0).optional(), completionTokens:z.int().min(0).optional(), totalTokens:z.int().min(0).optional(), costMicros:z.int().min(0).optional() });
const ObservationSchema = z.strictObject({schemaVersion:z.literal("verification-semantic-response-observation.v1"),requestDigest:DigestSchema,rawResponseDigest:DigestSchema,inputArtifactDigest:DigestSchema.optional(),deploymentId:z.string().min(1).max(255),requestedModel:z.string().min(1).max(255),observedModel:z.string().min(1).max(255).optional(),modelStatus:z.enum(["matched","missing","mismatch"]),revalidationRequired:z.boolean(),usage:UsageSchema});
const RecordSchema = z.strictObject({entryDigest:DigestSchema,reportId:z.string().min(1).max(255),assertionId:z.string().min(1).max(255),requestDigest:DigestSchema,rawResponseDigest:DigestSchema,judgeOutputDigest:DigestSchema,observation:ObservationSchema,assessment:SemanticAssessmentRecordSchema});
const ManifestSchema = z.strictObject({schemaVersion:z.literal("diagnostics-generated-report-semantic-replay-fixture.v1"),datasetManifestDigest:DigestSchema,sourceRunManifestDigest:DigestSchema,planDigest:DigestSchema,plan:z.unknown(),records:z.array(RecordSchema).min(1).max(30),artifacts:z.array(ArtifactSchema).min(3).max(90),fixtureDigest:DigestSchema});
type Manifest=z.infer<typeof ManifestSchema>;
type Artifact=z.infer<typeof ArtifactSchema>;
type Record=z.infer<typeof RecordSchema>;
type Capture=Readonly<{record:Record;entry:DiagnosticsGeneratedReportSemanticPlanEntry;requestBytes:Uint8Array;rawBytes:Uint8Array;httpStatus:number;judgeOutput:unknown;observation:GatewaySemanticResponseObservation}>;

export interface DiagnosticsGeneratedReportSemanticReplayFixture {
 readonly schemaVersion:"diagnostics-generated-report-semantic-replay-fixture.v1";
 readonly fixtureDigest:Digest;
 readonly datasetManifestDigest:Digest;
 /** The immutable run identity from the original live plan. */
 readonly sourceRunManifestDigest:Digest;
 readonly planDigest:Digest;
 readonly judgeIdentity:PreparedDiagnosticsGeneratedReportSemantics["plan"]["judgeIdentity"];
 readonly entryDigests:readonly Digest[];
 readonly reportHandles:PreparedDiagnosticsGeneratedReportSemantics["plan"]["reportHandles"];
 readonly localLedgerHandles:PreparedDiagnosticsGeneratedReportSemantics["plan"]["localLedgerHandles"];
}
const fixtureRuntime=new WeakMap<object,{manifest:Manifest;bytes:ReadonlyMap<string,Uint8Array>}>();

function same(left:unknown,right:unknown){return canonicalizeJson(left)===canonicalizeJson(right);}
function material(manifest:Manifest){const{fixtureDigest:_ignored,...rest}=manifest;return rest;}
function safeFile(file:string,artifact:Artifact){return file===`artifacts/${artifact.kind}-${artifact.digest.slice(7)}.bin`;}
function freezeClone<T>(value:T):T{const clone=structuredClone(value);const freeze=(item:unknown):unknown=>{if(item&&typeof item==="object"&&!Object.isFrozen(item)){for(const child of Object.values(item))freeze(child);Object.freeze(item);}return item;};return freeze(clone) as T;}
async function readArtifact(root:string,artifact:Artifact){
 if(!safeFile(artifact.file,artifact)||(artifact.kind==="raw_response")!==(artifact.httpStatus!==undefined)||artifact.kind==="request"&&artifact.bytes>10_000)throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_FIXTURE_ARTIFACT_METADATA");
 const path=resolve(root,artifact.file),rel=relative(root,path);if(rel===".."||rel.startsWith(`..${sep}`))throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_FIXTURE_PATH_ESCAPE");
 const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||await realpath(path)!==path)throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_FIXTURE_ARTIFACT_PATH_INVALID");if(stat.size!==artifact.bytes)throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_FIXTURE_ARTIFACT_DIGEST_MISMATCH");
 const bytes=new Uint8Array(await readFile(path));if(bytes.byteLength!==artifact.bytes||sha256Digest(bytes)!==artifact.digest)throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_FIXTURE_ARTIFACT_DIGEST_MISMATCH");return bytes;
}

/** Loads and authenticates a caller-pinned fixture without granting dispatch authority. */
export async function loadDiagnosticsGeneratedReportSemanticFixture(input:{readonly directory:string;readonly expectedFixtureDigest:Digest}):Promise<DiagnosticsGeneratedReportSemanticReplayFixture>{
 const root=await realpath(input.directory),manifestPath=resolve(root,"manifest.json"),stat=await lstat(manifestPath);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2_000_000||await realpath(manifestPath)!==manifestPath)throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_FIXTURE_MANIFEST_PATH_INVALID");
 const manifest=ManifestSchema.parse(JSON.parse(new TextDecoder("utf8",{fatal:true}).decode(await readFile(manifestPath)))) as Manifest;
 if(manifest.fixtureDigest!==input.expectedFixtureDigest||manifest.fixtureDigest!==sha256Digest(canonicalizeJson(material(manifest))))throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_FIXTURE_SEAL_MISMATCH");
 const plan=manifest.plan as PreparedDiagnosticsGeneratedReportSemantics["plan"];
 if(!plan||typeof plan!=="object"||manifest.datasetManifestDigest!==plan.datasetManifestDigest||manifest.sourceRunManifestDigest!==plan.runManifestDigest||manifest.planDigest!==plan.planDigest||!Array.isArray(plan.entries)||manifest.records.length!==plan.entries.length||!Array.isArray(plan.reportHandles)||!Array.isArray(plan.localLedgerHandles))throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_FIXTURE_PLAN_MISMATCH");
 if(new Set(manifest.records.map(item=>item.entryDigest)).size!==manifest.records.length||new Set(manifest.artifacts.map(item=>`${item.kind}:${item.digest}`)).size!==manifest.artifacts.length||new Set(manifest.artifacts.map(item=>item.file)).size!==manifest.artifacts.length)throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_FIXTURE_DUPLICATE");
 const bytes=new Map<string,Uint8Array>();for(const artifact of manifest.artifacts)bytes.set(`${artifact.kind}:${artifact.digest}`,await readArtifact(root,artifact));
 const fixture=Object.freeze({schemaVersion:"diagnostics-generated-report-semantic-replay-fixture.v1" as const,fixtureDigest:manifest.fixtureDigest as Digest,datasetManifestDigest:manifest.datasetManifestDigest as Digest,sourceRunManifestDigest:manifest.sourceRunManifestDigest as Digest,planDigest:manifest.planDigest as Digest,judgeIdentity:freezeClone(plan.judgeIdentity),entryDigests:Object.freeze(manifest.records.map(item=>item.entryDigest as Digest)),reportHandles:freezeClone(plan.reportHandles),localLedgerHandles:freezeClone(plan.localLedgerHandles)});
 fixtureRuntime.set(fixture,{manifest:freezeClone(manifest),bytes});return fixture;
}

/** Reinterprets the sealed provider bytes and reruns semantic verification with fetch fully local. */
export async function replayDiagnosticsGeneratedReportSemanticFixture(input:{readonly prepared:PreparedDiagnosticsGeneratedReportSemantics;readonly fixture:DiagnosticsGeneratedReportSemanticReplayFixture}){
 const runtime=fixtureRuntime.get(input.fixture),plan=input.prepared.plan;if(!runtime||input.fixture.planDigest!==plan.planDigest||runtime.manifest.datasetManifestDigest!==plan.datasetManifestDigest||runtime.manifest.sourceRunManifestDigest!==plan.runManifestDigest||!same(runtime.manifest.plan,plan)||runtime.manifest.records.length!==plan.entries.length)throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_FIXTURE_REPLAY_BINDING");
 const used=new Set<string>(),captures=new Map<Digest,Capture>();
 for(const [index,entry] of plan.entries.entries()){
  const record=runtime.manifest.records[index];if(!record||record.entryDigest!==entry.entryDigest||record.reportId!==entry.reportId||record.assertionId!==entry.assertionId)throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_FIXTURE_ENTRY_MISMATCH");
  const requestArtifact=runtime.manifest.artifacts.find(item=>item.kind==="request"&&item.digest===record.requestDigest),rawArtifact=runtime.manifest.artifacts.find(item=>item.kind==="raw_response"&&item.digest===record.rawResponseDigest),outputArtifact=runtime.manifest.artifacts.find(item=>item.kind==="judge_output"&&item.digest===record.judgeOutputDigest);
  if(!requestArtifact||!rawArtifact||rawArtifact.httpStatus===undefined||!outputArtifact)throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_FIXTURE_ARTIFACT_CLOSURE");for(const item of [requestArtifact,rawArtifact,outputArtifact])used.add(`${item.kind}:${item.digest}`);
  const requestBytes=runtime.bytes.get(`request:${requestArtifact.digest}`)!,rawBytes=runtime.bytes.get(`raw_response:${rawArtifact.digest}`)!,outputBytes=runtime.bytes.get(`judge_output:${outputArtifact.digest}`)!;
  const wire=prepareGatewaySemanticRequest({...entry.blindedInput,inputArtifactDigest:entry.inputArtifactDigest},plan.judgeIdentity.model,plan.limits.maximumInputCharacters,plan.judgeIdentity.promptDigest);
  if(wire.requestDigest!==entry.expectedRequestDigest||wire.requestBytes.byteLength!==entry.requestBytes||record.requestDigest!==wire.requestDigest||!Buffer.from(requestBytes).equals(Buffer.from(wire.requestBytes)))throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_FIXTURE_REQUEST_MISMATCH");
  let observed:GatewaySemanticResponseObservation|undefined;const interpreted=await interpretCapturedGatewaySemanticResponse({rawResponseBytes:rawBytes,rawResponseDigest:record.rawResponseDigest as Digest,httpStatus:rawArtifact.httpStatus,requestDigest:record.requestDigest as Digest,identity:plan.judgeIdentity,inputArtifactDigest:entry.inputArtifactDigest,recordObservation:async value=>{observed=value;},assertActive:()=>{}});
  let judgeOutput:unknown;try{const text=new TextDecoder("utf8",{fatal:true}).decode(outputBytes);judgeOutput=JSON.parse(text);if(canonicalizeJson(judgeOutput)!==text)throw new Error();}catch{throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_FIXTURE_OUTPUT_ENCODING");}
  if(!same(judgeOutput,interpreted)||!observed||!same(observed,record.observation))throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_FIXTURE_OBSERVATION_MISMATCH");
  captures.set(entry.entryDigest,Object.freeze({record:freezeClone(record),entry,requestBytes:new Uint8Array(requestBytes),rawBytes:new Uint8Array(rawBytes),httpStatus:rawArtifact.httpStatus,judgeOutput:freezeClone(judgeOutput),observation:freezeClone(observed)}));
 }
 if(used.size!==runtime.manifest.artifacts.length)throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_FIXTURE_UNUSED_ARTIFACT");
 const grant:DiagnosticsGeneratedReportSemanticDispatchGrant={schemaVersion:"diagnostics-generated-report-semantic-dispatch-grant.v1",planDigest:plan.planDigest,entryDigests:plan.entries.map(item=>item.entryDigest),model:"openai/gpt-5.6-luna",maximumCalls:plan.limits.maximumCalls,maximumCostMicros:plan.limits.maximumCostMicros,reservationMicrosPerCall:plan.limits.reservationMicrosPerCall,concurrency:1,automaticRetries:0,stopAfterConsecutiveFailures:3,dispatchAuthorized:true};
 const result=await executeDiagnosticsGeneratedReportSemantics({prepared:input.prepared,grant,beforeDispatch:async entry=>{if(!captures.has(entry.entryDigest))throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_FIXTURE_REPLAY_MISSING");},async createAdapter(entry){const capture=captures.get(entry.entryDigest)!;
  return {identity:plan.judgeIdentity,maximumInputCharacters:plan.limits.maximumInputCharacters,toolCatalog:[],async judge(value){
    if(!same(value,{...entry.blindedInput,inputArtifactDigest:entry.inputArtifactDigest}))throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_FIXTURE_REPLAY_REQUEST");
    return freezeClone(capture.judgeOutput);
  }};},deadlineEpochMs:()=>Date.now()+60_000,afterAssessment:async(entry,value)=>{const expected=captures.get(entry.entryDigest)?.record.assessment;if(!expected||value.failure||!same(value.assessment,expected))throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_FIXTURE_REPLAY_ASSESSMENT");}});
 if(result.attempted!==plan.entries.length||result.completed!==plan.entries.length||result.failed!==0)throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_FIXTURE_REPLAY_INCOMPLETE");
 return Object.freeze({fixtureDigest:input.fixture.fixtureDigest,datasetManifestDigest:input.fixture.datasetManifestDigest,sourceRunManifestDigest:input.fixture.sourceRunManifestDigest,planDigest:input.fixture.planDigest,reportHandles:input.fixture.reportHandles,localLedgerHandles:input.fixture.localLedgerHandles,results:Object.freeze(result.results.map((item,index)=>Object.freeze({entryDigest:item.entryDigest,reportId:plan.entries[index]!.reportId,assertionId:plan.entries[index]!.assertionId,assessment:item.assessment as SemanticAssessmentRecord}))),externalRequests:0 as const,diagnosticOnly:true as const});
}
