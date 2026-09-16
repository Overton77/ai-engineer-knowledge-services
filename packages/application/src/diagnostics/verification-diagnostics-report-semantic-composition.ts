import type { VerificationArtifactHandle, VerificationBenchmarkDataset, VerificationSource, VerificationSourceCapture } from "@aiengineer/knowledge-contracts";

import type { VerificationAdmissionService } from "../verification/admission/verification-admission.js";
import type { buildDiagnosticsOfflineLedgers } from "./verification-diagnostics-offline-ledgers.js";
import type { verifyDiagnosticsOfflineClaimsReportClosure } from "./verification-diagnostics-offline-claims-report.js";
import type { DiagnosticsReportCoverage } from "./verification-diagnostics-report-coverage.js";
import { prepareDiagnosticsGeneratedReportSemantics, type DiagnosticsReportSemanticSourceBinding } from "./verification-diagnostics-generated-report-semantics.js";

/** Reconstructs the original diagnostic plan only when the current generated
 * report bytes, source metadata and ledger handles match its sealed inputs.
 * sourceRunManifestDigest belongs to the captured run, never the current demo. */
export async function prepareDiagnosticsReportSemanticReplayComposition(input: {
  dataset: VerificationBenchmarkDataset;
  judgeIdentity: Parameters<typeof prepareDiagnosticsGeneratedReportSemantics>[0]["judgeIdentity"];
  sourceRunManifestDigest: `sha256:${string}`;
  sourceLedger: { sources: { sourceKey: string; sourceClass: DiagnosticsReportSemanticSourceBinding["sourceClass"]; captureId: string; sourceArtifactDigest: string; rights: string; goldStatus: "not_labeled" }[] };
  captures: readonly { source: VerificationSource; capture: VerificationSourceCapture }[];
  reports: readonly DiagnosticsReportCoverage[];
  nativeLedgers: ReturnType<typeof buildDiagnosticsOfflineLedgers>;
  nativeVerification: Awaited<ReturnType<typeof verifyDiagnosticsOfflineClaimsReportClosure>>;
  admission: VerificationAdmissionService;
}) {
  const captures=new Map(input.captures.map(item=>[item.capture.captureId,item]));
  const artifacts=new Map<string,VerificationArtifactHandle>(input.nativeLedgers.artifacts.map(item=>[item.registration.artifactId,item.registration]));
  const bindings: DiagnosticsReportSemanticSourceBinding[]=[];
  for(const report of input.reports) for(const block of report.blocks.filter(item=>item.kind==="assertion")) {
    const testCase=input.dataset.cases.find(item=>item.caseId===block.caseId),evidence=testCase?.evidence[0];
    const capture=evidence&&captures.get(evidence.captureId),source=evidence&&input.sourceLedger.sources.find(item=>item.sourceKey===evidence.sourceKey),projection=evidence&&artifacts.get(evidence.projectionArtifactId);
    if(!block.caseId||!evidence||!capture||!source||!projection||source.captureId!==evidence.captureId||source.sourceArtifactDigest!==capture.capture.contentArtifact.digest)throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_SOURCE_METADATA_DRIFT");
    bindings.push({reportId:report.reportId,assertionId:block.caseId,fragmentId:evidence.fragmentId,captureId:evidence.captureId,sourceKey:evidence.sourceKey,sourceClass:source.sourceClass,sourceUri:capture.source.canonicalUri,sourceArtifact:capture.capture.contentArtifact,projectionArtifact:projection,transformationArtifactId:evidence.transformationArtifactId,selector:evidence.selector,selectedContentDigest:evidence.selectedContentDigest as `sha256:${string}`,rights:source.rights,goldStatus:source.goldStatus});
  }

  return prepareDiagnosticsGeneratedReportSemantics({context:input.nativeLedgers.context,datasetManifestDigest:input.dataset.manifestDigest as `sha256:${string}`,runManifestDigest:input.sourceRunManifestDigest,
    reports:input.nativeLedgers.reports.map(item=>{const expected=input.nativeVerification.reports.find(value=>value.reportId===item.reportId);if(!expected)throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_REPORT_REQUIRED");return {reportId:item.reportId,request:item.request,expectedReportArtifact:expected.reportArtifact,expectedClaimLedgerArtifact:expected.claimLedgerArtifact};}),
    createDependencies:()=>input.nativeLedgers.createDependencies(input.admission),sourceBindings:bindings,localLedgerHandles:[...input.nativeVerification.claims.map(item=>item.assertionsArtifact),...input.nativeVerification.reports.map(item=>item.claimLedgerArtifact)],reportHandles:input.nativeVerification.reports.map(item=>item.reportArtifact),judgeIdentity:input.judgeIdentity,maximumCostMicros:200000,reservationMicrosPerCall:5000});
}
