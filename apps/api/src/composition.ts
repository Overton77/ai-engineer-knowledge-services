import type { ApiHost } from "@aiengineer/knowledge-host";
import type { ServerOptions } from "./server.js";

/** Maps host-composed services onto the HTTP server's existing option names. */
export function apiServerOptions(host: ApiHost): ServerOptions {
  const { knowledge, operations, verify } = host;
  const { runtime } = verify;
  return {
    ...(verify.decisions ?? {}),
    ...(verify.driftRevalidation ? { verificationDriftRevalidation: verify.driftRevalidation } : {}),
    ...(verify.benchmarkReads ? { verificationBenchmarkReads: verify.benchmarkReads } : {}),
    ...(verify.benchmarkComparisonReads
      ? { verificationBenchmarkComparisonReads: verify.benchmarkComparisonReads }
      : {}),
    ...(verify.providerReconciliation ? { verificationProviderReconciliation: verify.providerReconciliation } : {}),
    ...(verify.semanticReconciliation ? { verificationSemanticReconciliation: verify.semanticReconciliation } : {}),
    ...(verify.structuredExtractionReads
      ? { verificationStructuredExtractionReads: verify.structuredExtractionReads }
      : {}),
    ...(verify.auditInspectionReads ? { verificationAuditInspectionReads: verify.auditInspectionReads } : {}),
    ...(verify.claimsReportReads ? { verificationClaimsReportReads: verify.claimsReportReads } : {}),
    ...(verify.captureReads ? { verificationCaptureReads: verify.captureReads } : {}),
    ...(verify.resolveBenchmarkCaptureProfile
      ? { resolveVerificationBenchmarkCaptureProfile: verify.resolveBenchmarkCaptureProfile }
      : {}),
    ...(verify.adjudicationReads ? { verificationAdjudicationReadService: verify.adjudicationReads } : {}),
    ...(verify.reads ? { verificationReads: verify.reads, verificationCaseReads: verify.reads.cases } : {}),
    ...(host.publicOrigin ? { publicOrigin: host.publicOrigin } : {}),
    ...(operations
      ? {
          operationService: operations.service,
          retrievalOperationService: operations.retrieval,
          callbackReplayStore: operations.callbackReplay,
          ...(knowledge.resources ? { resourceReader: knowledge.resources } : {}),
          ...(runtime.verificationConfigured
            ? {
                ...(runtime.verificationOperationService
                  ? { verificationOperationService: runtime.verificationOperationService }
                  : {}),
                ...(runtime.verificationCaptureCatalog
                  ? { verificationCaptureCatalog: runtime.verificationCaptureCatalog }
                  : {}),
                ...(runtime.isParseArtifactRequestAdmitted
                  ? { isParseArtifactRequestAdmitted: runtime.isParseArtifactRequestAdmitted }
                  : {}),
                ...(runtime.isStructuredExtractionRequestAdmitted
                  ? { isStructuredExtractionRequestAdmitted: runtime.isStructuredExtractionRequestAdmitted }
                  : {}),
                ...(runtime.isBenchmarkRequestAdmitted
                  ? { isBenchmarkRequestAdmitted: runtime.isBenchmarkRequestAdmitted }
                  : {}),
                ...(runtime.isBenchmarkComparisonRequestAdmitted
                  ? { isBenchmarkComparisonRequestAdmitted: runtime.isBenchmarkComparisonRequestAdmitted }
                  : {}),
                ...(runtime.isClaimsRequestAdmitted
                  ? { isClaimsRequestAdmitted: runtime.isClaimsRequestAdmitted }
                  : {}),
                ...(runtime.isAuditInspectionRequestAdmitted
                  ? { isAuditInspectionRequestAdmitted: runtime.isAuditInspectionRequestAdmitted }
                  : {}),
                ...(runtime.isAdjudicationRequestAdmitted
                  ? { isAdjudicationRequestAdmitted: runtime.isAdjudicationRequestAdmitted }
                  : {}),
                ...(runtime.resolveVerificationContext
                  ? { resolveVerificationContext: runtime.resolveVerificationContext }
                  : {}),
              }
            : {}),
          ...(knowledge.canonicalRetrievalExecutor
            ? { canonicalRetrievalExecutor: knowledge.canonicalRetrievalExecutor }
            : {}),
          ...(knowledge.replayEvidencePacketCitations
            ? { replayEvidencePacketCitations: knowledge.replayEvidencePacketCitations }
            : {}),
          ...(knowledge.getEvidencePacket ? { getEvidencePacket: knowledge.getEvidencePacket } : {}),
        }
      : {}),
  };
}
