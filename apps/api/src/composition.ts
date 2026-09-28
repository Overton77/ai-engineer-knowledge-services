import type { ApiCompositionSeams, ApiHost } from "@aiengineer/knowledge-host";
import type { ServerOptions } from "./server.js";
import { createVerificationAdjudicationDecisionRuntime } from "./verification-adjudication-decision-runtime.js";
import { createVerificationAdjudicationReads } from "./verification-adjudication-reads-runtime.js";
import { createVerificationAuditInspectionReads } from "./verification-audit-inspection-reads-runtime.js";
import { createVerificationBenchmarkCaptureProfileResolver } from "./verification-benchmark-capture-profile.js";
import { createVerificationCaptureReads } from "./verification-capture-reads-runtime.js";
import { createVerificationClaimsReportReads } from "./verification-claims-report-reads-runtime.js";
import { createVerificationDriftRevalidationRuntime } from "./verification-drift-revalidation-runtime.js";
import { createVerificationProviderReconciliationService } from "./verification-provider-reconciliation-runtime.js";
import { createVerificationSemanticReconciliationService } from "./verification-semantic-reconciliation-runtime.js";
import { createVerificationStructuredExtractionReads } from "./verification-structured-extraction-reads-runtime.js";

/**
 * API-owned use cases injected into host composition. Each is a Unit 3 seam: it
 * moves into application with ownership, admission and retrieval execution.
 */
export const apiCompositionSeams = {
  createVerificationDriftRevalidation: (ports) =>
    createVerificationDriftRevalidationRuntime(
      ports.database,
      ports.serviceIdentitiesJson,
      ports.componentMonitorsJson,
      ports.componentPublicKeysJson,
      ports.component,
    ),
  createVerificationUseCases({ database, environment, verification }) {
    const providerReconciliation = createVerificationProviderReconciliationService(database, environment);
    const semanticReconciliation = createVerificationSemanticReconciliationService(database, environment);
    const structuredExtractionReads = createVerificationStructuredExtractionReads(database, environment);
    const auditInspectionReads = createVerificationAuditInspectionReads(database, environment);
    const claimsReportReads = createVerificationClaimsReportReads(database, environment);
    const captureReads = createVerificationCaptureReads(database, environment);
    const ownershipGrants = environment.VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON?.trim();
    const benchmarkCaptureProfiles = environment.VERIFICATION_BENCHMARK_CAPTURE_PROFILES_JSON?.trim();
    if (benchmarkCaptureProfiles && (!database || !ownershipGrants))
      throw new Error("VERIFICATION_BENCHMARK_CAPTURE_PROFILE_CONFIGURATION_REQUIRED");
    const resolveBenchmarkCaptureProfile = benchmarkCaptureProfiles
      ? createVerificationBenchmarkCaptureProfileResolver(database!, benchmarkCaptureProfiles, ownershipGrants!)
      : undefined;
    const adjudicationReads = createVerificationAdjudicationReads(database, environment);
    const decisionRuntime = createVerificationAdjudicationDecisionRuntime(database, environment);
    if (decisionRuntime && !verification.resolveVerificationContext)
      throw new Error("VERIFICATION_ADJUDICATION_DECISION_OWNERSHIP_REQUIRED");
    return {
      providerReconciliation,
      semanticReconciliation,
      structuredExtractionReads,
      auditInspectionReads,
      claimsReportReads,
      captureReads,
      resolveBenchmarkCaptureProfile,
      adjudicationReads,
      decisionRuntime,
    };
  },
} satisfies ApiCompositionSeams<unknown, unknown>;

type Seams = typeof apiCompositionSeams;
export type ComposedApiHost = ApiHost<
  ReturnType<Seams["createVerificationDriftRevalidation"]>,
  ReturnType<Seams["createVerificationUseCases"]>
>;

/** Maps host-composed services onto the HTTP server's existing option names. */
export function apiServerOptions(host: ComposedApiHost): ServerOptions {
  const { knowledge, operations, verify } = host;
  const { runtime, useCases } = verify;
  return {
    ...(useCases.decisionRuntime ?? {}),
    ...(verify.driftRevalidation ? { verificationDriftRevalidation: verify.driftRevalidation } : {}),
    ...(verify.benchmarkReads ? { verificationBenchmarkReads: verify.benchmarkReads } : {}),
    ...(verify.benchmarkComparisonReads ? { verificationBenchmarkComparisonReads: verify.benchmarkComparisonReads } : {}),
    ...(useCases.providerReconciliation ? { verificationProviderReconciliation: useCases.providerReconciliation } : {}),
    ...(useCases.semanticReconciliation ? { verificationSemanticReconciliation: useCases.semanticReconciliation } : {}),
    ...(useCases.structuredExtractionReads
      ? { verificationStructuredExtractionReads: useCases.structuredExtractionReads }
      : {}),
    ...(useCases.auditInspectionReads ? { verificationAuditInspectionReads: useCases.auditInspectionReads } : {}),
    ...(useCases.claimsReportReads ? { verificationClaimsReportReads: useCases.claimsReportReads } : {}),
    ...(useCases.captureReads ? { verificationCaptureReads: useCases.captureReads } : {}),
    ...(useCases.resolveBenchmarkCaptureProfile
      ? { resolveVerificationBenchmarkCaptureProfile: useCases.resolveBenchmarkCaptureProfile }
      : {}),
    ...(useCases.adjudicationReads ? { verificationAdjudicationReadService: useCases.adjudicationReads } : {}),
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
                ...(runtime.verificationCaptureCatalog ? { verificationCaptureCatalog: runtime.verificationCaptureCatalog } : {}),
                ...(runtime.isParseArtifactRequestAdmitted
                  ? { isParseArtifactRequestAdmitted: runtime.isParseArtifactRequestAdmitted }
                  : {}),
                ...(runtime.isStructuredExtractionRequestAdmitted
                  ? { isStructuredExtractionRequestAdmitted: runtime.isStructuredExtractionRequestAdmitted }
                  : {}),
                ...(runtime.isBenchmarkRequestAdmitted ? { isBenchmarkRequestAdmitted: runtime.isBenchmarkRequestAdmitted } : {}),
                ...(runtime.isBenchmarkComparisonRequestAdmitted
                  ? { isBenchmarkComparisonRequestAdmitted: runtime.isBenchmarkComparisonRequestAdmitted }
                  : {}),
                ...(runtime.isClaimsRequestAdmitted ? { isClaimsRequestAdmitted: runtime.isClaimsRequestAdmitted } : {}),
                ...(runtime.isAuditInspectionRequestAdmitted
                  ? { isAuditInspectionRequestAdmitted: runtime.isAuditInspectionRequestAdmitted }
                  : {}),
                ...(runtime.isAdjudicationRequestAdmitted
                  ? { isAdjudicationRequestAdmitted: runtime.isAdjudicationRequestAdmitted }
                  : {}),
                ...(runtime.resolveVerificationContext ? { resolveVerificationContext: runtime.resolveVerificationContext } : {}),
              }
            : {}),
          ...(knowledge.canonicalRetrievalExecutor ? { canonicalRetrievalExecutor: knowledge.canonicalRetrievalExecutor } : {}),
          ...(knowledge.replayEvidencePacketCitations
            ? { replayEvidencePacketCitations: knowledge.replayEvidencePacketCitations }
            : {}),
          ...(knowledge.getEvidencePacket ? { getEvidencePacket: knowledge.getEvidencePacket } : {}),
        }
      : {}),
  };
}
