import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { VerificationArtifactHandle, VerificationSource, VerificationSourceCapture } from "@aiengineer/knowledge-contracts";
import { VERIFICATION_PARSER_LIMITS, type VerificationParserOutput } from "@aiengineer/knowledge-conversion";
import { canonicalizeJson, gatewaySemanticConfigurationDigest, gatewaySemanticOutputSchemaDigest, gatewaySemanticPromptDigest, sha256Digest } from "@aiengineer/knowledge-verification";
import { VerificationAdmissionService, type VerificationAdmissionRepositoryPort } from "../packages/application/src/verification-admission.js";
import { loadDiagnosticsOfflineCatalog } from "../packages/application/src/verification-diagnostics-offline-catalog.js";
import { buildDiagnosticsOfflineLedgers } from "../packages/application/src/verification-diagnostics-offline-ledgers.js";
import { prepareDiagnosticsGeneratedReportSemantics, type DiagnosticsReportSemanticSourceBinding } from "../packages/application/src/verification-diagnostics-generated-report-semantics.js";
import type { DiagnosticsReportCoverage } from "../packages/application/src/verification-diagnostics-report-coverage.js";

type Digest = `sha256:${string}`;
const workspace = resolve(import.meta.dirname, "../..");
const repository = resolve(workspace, "ai-engineer-knowledge-services");
const internal = resolve(workspace, "internal");
const outputDirectory = resolve(internal, "verification-offline-demo-EV162-20260908");
const receiptPath = resolve(internal, "verification-offline-demo-EV162-20260908.json");
const outputPath = resolve(internal, "verification-EV162-generated-report-semantic-plan-20260908.json");
const catalogDirectory = resolve(repository, "catalog/verification-benchmarks/diagnostics-companies-v1");
const preparationDirectory = resolve(repository, "catalog/verification-assets/50a3552cffc639a78d7789865be929baefd64d2342431e2de958e669c21f163e");
const digest = (bytes: Uint8Array | string): Digest => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

type Preparation = { artifacts: { file: string; handle: VerificationArtifactHandle }[]; captures: { sourceKey: string; source: VerificationSource; capture: VerificationSourceCapture }[] };
type NativeArtifacts = { artifacts: { registration: VerificationArtifactHandle; text: string }[] };

export async function prepareVerificationEv162ReportSemantics(options: { readonly writeReceipt?: boolean } = {}) {
  const receiptBytes = await readFile(receiptPath), receiptDigest = digest(receiptBytes);
  if (receiptDigest !== "sha256:015ed86422dc69a0f55f28f801eef012232f6dded5f8264d105abd6c8353982b") throw new Error("EV162_RECEIPT_DRIFT");
  const receipt = JSON.parse(receiptBytes.toString("utf8")) as { qualityGate: { datasetManifestDigest: Digest; runManifestDigest: Digest }; files: {name:string;digest:Digest;bytes:number}[] };
  const [{ dataset }, preparationBytes, reportCoverageText, nativeVerificationText, nativeArtifactsText, sourceLedgerText] = await Promise.all([
    loadDiagnosticsOfflineCatalog("diagnostics-companies-v1", catalogDirectory), readFile(resolve(preparationDirectory, "manifest.json")),
    readFile(resolve(outputDirectory, "report-coverage.json"), "utf8"), readFile(resolve(outputDirectory, "native-verification.json"), "utf8"),
    readFile(resolve(outputDirectory, "native-ledger-artifacts.json"), "utf8"), readFile(resolve(catalogDirectory, "source-ledger.json"), "utf8"),
  ]);
  for(const [name,bytes] of [["report-coverage.json",reportCoverageText],["native-verification.json",nativeVerificationText],["native-ledger-artifacts.json",nativeArtifactsText]] as const){const pinned=receipt.files.find(file=>file.name===name);if(!pinned||pinned.bytes!==Buffer.byteLength(bytes)||pinned.digest!==digest(bytes))throw new Error(`EV162_INPUT_FILE_DRIFT:${name}`);}
  if (digest(preparationBytes) !== dataset.sourcePreparationDigest || dataset.manifestDigest !== receipt.qualityGate.datasetManifestDigest) throw new Error("EV162_SOURCE_CLOSURE_DRIFT");
  const preparation = JSON.parse(preparationBytes.toString("utf8")) as Preparation;
  const artifactMap = new Map(preparation.artifacts.map(item => [item.handle.artifactId, item]));
  const captureMap = new Map(preparation.captures.map(item => [item.capture.captureId, item]));
  const repositoryPort: VerificationAdmissionRepositoryPort = {
    createTrustedArtifactResolver: () => ({
      async authorizeArtifact({ tenantId, artifactId, purpose }) { const item=artifactMap.get(artifactId); if(purpose!=="verification_admission"||!item||item.handle.tenantId!==tenantId)throw new Error("EV162_ARTIFACT_DENIED"); },
      async hydrateRegisteredArtifact({ tenantId, artifactId }) { const item=artifactMap.get(artifactId);if(!item||item.handle.tenantId!==tenantId)throw new Error("EV162_ARTIFACT_MISSING");const bytes=await readFile(resolve(preparationDirectory,item.file));if(bytes.length!==item.handle.byteLength||digest(bytes)!==item.handle.digest)throw new Error("EV162_ARTIFACT_DRIFT");return {registration:item.handle,bytes}; },
    }),
    async getRegisteredCapture({ tenantId, captureId }) { const item=captureMap.get(captureId);if(!item||item.capture.contentArtifact.tenantId!==tenantId)throw new Error("EV162_CAPTURE_MISSING");return {source:item.source,capture:item.capture}; },
    async registerContentAddressedArtifact() { throw new Error("EV162_READ_ONLY"); },
  };
  const admission = new VerificationAdmissionService(repositoryPort,{async parse():Promise<VerificationParserOutput>{throw new Error("EV162_PARSER_DISABLED");}},{parserVersion:"verification-native-parser.v1",imageDigest:"sha256:1669a3f9674b2e0a70ba1c8686c1cb3647492b8268bdfa7a9a4452fb0530fb37",limits:VERIFICATION_PARSER_LIMITS},{storageBucket:"offline-read-only",producerVersion:"verification-admission.v1",encryptionClass:"supabase-managed",retentionClass:"verification-audit",now:()=>"2026-09-08T00:00:00.000Z"});
  const reports = (JSON.parse(reportCoverageText) as { reports: DiagnosticsReportCoverage[] }).reports;
  const retainedArtifacts = await Promise.all(preparation.artifacts.map(async item => ({ registration:item.handle,bytes:new Uint8Array(await readFile(resolve(preparationDirectory,item.file))) })));
  const ledgers = buildDiagnosticsOfflineLedgers({dataset,reports,captures:preparation.captures,artifacts:retainedArtifacts});
  const nativeArtifacts = JSON.parse(nativeArtifactsText) as NativeArtifacts;
  const generated = ledgers.artifacts.filter(item => item.registration.producerActivityId === "diagnostics-offline-ledgers");
  if (generated.length !== 46 || nativeArtifacts.artifacts.length !== 46) throw new Error("EV162_LOCAL_ARTIFACT_COUNT");
  for (const expected of nativeArtifacts.artifacts) { const actual=generated.find(item=>item.registration.artifactId===expected.registration.artifactId);if(!actual||canonicalizeJson(actual.registration)!==canonicalizeJson(expected.registration)||new TextDecoder("utf8",{fatal:true}).decode(actual.bytes)!==expected.text)throw new Error("EV162_LOCAL_ARTIFACT_IDENTITY_DRIFT"); }
  const native = JSON.parse(nativeVerificationText) as { claims: { assertionsArtifact: VerificationArtifactHandle }[]; reports: { reportId:string; reportArtifact:VerificationArtifactHandle; claimLedgerArtifact:VerificationArtifactHandle }[] };
  const localLedgerHandles=[...native.claims.map(item=>item.assertionsArtifact),...native.reports.map(item=>item.claimLedgerArtifact)],reportHandles=native.reports.map(item=>item.reportArtifact);
  if(localLedgerHandles.length!==43||reportHandles.length!==3||!localLedgerHandles.every(handle=>generated.some(item=>canonicalizeJson(item.registration)===canonicalizeJson(handle)))||!reportHandles.every(handle=>generated.some(item=>canonicalizeJson(item.registration)===canonicalizeJson(handle))))throw new Error("EV162_RETAINED_HANDLE_DRIFT");
  const sourceLedger=JSON.parse(sourceLedgerText) as {sources:{sourceKey:string;sourceClass:DiagnosticsReportSemanticSourceBinding["sourceClass"];captureId:string;sourceArtifactDigest:Digest;rights:string;goldStatus:"not_labeled"}[]};
  const sourceBindings:DiagnosticsReportSemanticSourceBinding[]=[];
  for(const report of reports)for(const block of report.blocks.filter(block=>block.kind==="assertion")){
    if(!block.caseId||!block.evidence)throw new Error("EV162_REPORT_EVIDENCE_REQUIRED");const testCase=dataset.cases.find(item=>item.caseId===block.caseId),evidence=testCase?.evidence[0],capture=evidence&&captureMap.get(evidence.captureId),source=evidence&&sourceLedger.sources.find(item=>item.sourceKey===evidence.sourceKey),projection=evidence&&artifactMap.get(evidence.projectionArtifactId)?.handle;
    if(!testCase||!evidence||!capture||!source||!projection||source.captureId!==evidence.captureId||source.sourceArtifactDigest!==capture.capture.contentArtifact.digest)throw new Error("EV162_SOURCE_LICENSE_BINDING");
    sourceBindings.push({reportId:report.reportId,assertionId:block.caseId,fragmentId:evidence.fragmentId,captureId:evidence.captureId,sourceKey:evidence.sourceKey,sourceClass:source.sourceClass,sourceUri:capture.source.canonicalUri,sourceArtifact:capture.capture.contentArtifact,projectionArtifact:projection,transformationArtifactId:evidence.transformationArtifactId,selector:evidence.selector,selectedContentDigest:evidence.selectedContentDigest as Digest,rights:source.rights,goldStatus:source.goldStatus});
  }
  const identity={deploymentId:"diagnostics-ev162-report-luna.v1",provider:"vercel-ai-gateway",family:"openai",model:"openai/gpt-5.6-luna",capability:"llm_evidence_rubric" as const,graderVersion:"evidence-only.v1",promptDigest:gatewaySemanticPromptDigest,outputSchemaDigest:gatewaySemanticOutputSchemaDigest,configurationDigest:gatewaySemanticConfigurationDigest("openai/gpt-5.6-luna")};
  const prepared=await prepareDiagnosticsGeneratedReportSemantics({context:ledgers.context,datasetManifestDigest:dataset.manifestDigest as Digest,runManifestDigest:receipt.qualityGate.runManifestDigest,reports:ledgers.reports.map(item=>{const expected=native.reports.find(value=>value.reportId===item.reportId);if(!expected)throw new Error("EV162_REPORT_RESULT_REQUIRED");return {reportId:item.reportId,request:item.request,expectedReportArtifact:expected.reportArtifact,expectedClaimLedgerArtifact:expected.claimLedgerArtifact};}),createDependencies:()=>ledgers.createDependencies(admission),sourceBindings,localLedgerHandles,reportHandles,judgeIdentity:identity,maximumCostMicros:200_000,reservationMicrosPerCall:5_000});
  if(prepared.plan.entries.length!==29)throw new Error("EV162_REPORT_ASSERTION_COUNT");
  if(options.writeReceipt!==false)await writeFile(outputPath,JSON.stringify({schemaVersion:"verification-ev162-generated-report-semantic-preparation.v1",createdAt:new Date().toISOString(),subject:{receiptPath,digest:receiptDigest,outputDirectory,datasetManifestDigest:dataset.manifestDigest,runManifestDigest:receipt.qualityGate.runManifestDigest},plan:prepared.plan,checks:{exactFortyThreeLedgerHandlesRetained:true,exactThreeReportHandlesRetained:true,allFortySixLocalArtifactBytesRetained:true,twentyNineReportAssertionWires:true,sourceCaptureProjectionLicenseBound:true,fullReportsExcludedFromWire:true,providerDispatches:0},dispatchGrantRequired:true,limitations:["Diagnostic-only assertion assessments cannot change the failed report-wide consistency disposition.","Luna-only engineering evidence; no human-gold, authority, applicability, or acceptance promotion.","No prior v1 semantic observation is attached or rebound."]},null,2)+"\n",{flag:"wx"});
  return {prepared,outputPath,receiptDigest};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)prepareVerificationEv162ReportSemantics().then(({prepared})=>process.stdout.write(JSON.stringify({outputPath,planDigest:prepared.plan.planDigest,entries:prepared.plan.entries.length,maximumCostMicros:prepared.plan.limits.maximumCostMicros,externalRequests:prepared.plan.externalRequests})+"\n")).catch(error=>{process.stderr.write(`${error instanceof Error?error.message:"unknown"}\n`);process.exitCode=1;});
