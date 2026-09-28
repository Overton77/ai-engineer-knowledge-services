// Transport proofs compose MCP in process with exactly the services they give the API
// (Unit 3 removed MCP's HTTP client shim). Maps API ServerOptions onto MCP options.
import {
  createKnowledgeResourceReads,
  createVerificationResourceReads,
  VerificationOperationApplicationService,
} from "@aiengineer/knowledge-application";
import type { ServerOptions } from "../apps/api/src/server.js";
import type { KnowledgeMcpServerOptions } from "../apps/mcp/src/index.js";

export function inProcessMcpOptions(
  api: ServerOptions,
  apiOrigin: string,
): Pick<
  KnowledgeMcpServerOptions,
  "knowledge" | "verificationReads" | "verificationOperations" | "resolveVerificationContext" | "verificationAdmission"
> {
  const admission = {
    ...(api.isParseArtifactRequestAdmitted ? { isParseArtifactRequestAdmitted: api.isParseArtifactRequestAdmitted } : {}),
    ...(api.isStructuredExtractionRequestAdmitted ? { isStructuredExtractionRequestAdmitted: api.isStructuredExtractionRequestAdmitted } : {}),
    ...(api.isBenchmarkRequestAdmitted ? { isBenchmarkRequestAdmitted: api.isBenchmarkRequestAdmitted } : {}),
    ...(api.isBenchmarkComparisonRequestAdmitted ? { isBenchmarkComparisonRequestAdmitted: api.isBenchmarkComparisonRequestAdmitted } : {}),
    ...(api.isClaimsRequestAdmitted ? { isClaimsRequestAdmitted: api.isClaimsRequestAdmitted } : {}),
    ...(api.isAuditInspectionRequestAdmitted ? { isAuditInspectionRequestAdmitted: api.isAuditInspectionRequestAdmitted } : {}),
    ...(api.isAdjudicationRequestAdmitted ? { isAdjudicationRequestAdmitted: api.isAdjudicationRequestAdmitted } : {}),
    ...(api.isAdjudicationDecisionAdmitted ? { isAdjudicationDecisionAdmitted: api.isAdjudicationDecisionAdmitted } : {}),
  };
  const operations = api.operationService ?? api.service;
  return {
    knowledge: {
      reads: createKnowledgeResourceReads({
        ...(api.resourceReader ? { resources: api.resourceReader } : {}),
        ...(operations ? { operations } : {}),
        ...(api.getEvidencePacket ? { getEvidencePacket: api.getEvidencePacket } : {}),
        ...(api.replayEvidencePacketCitations ? { replayEvidencePacketCitations: api.replayEvidencePacketCitations } : {}),
        ...(api.maximumResourceResponseBytes === undefined ? {} : { maximumResponseBytes: api.maximumResourceResponseBytes }),
      }),
      ...(api.retrievalOperationService ?? operations ? { retrievalOperations: (api.retrievalOperationService ?? operations)! } : {}),
      ...(api.canonicalRetrievalExecutor ? { retrievalExecutor: api.canonicalRetrievalExecutor } : {}),
    },
    verificationReads: createVerificationResourceReads({
      ...(api.verificationStructuredExtractionReads ? { structuredExtractionReads: api.verificationStructuredExtractionReads } : {}),
      ...(api.verificationAuditInspectionReads ? { auditInspectionReads: api.verificationAuditInspectionReads } : {}),
      ...(api.verificationAdjudicationReadService ? { adjudicationReads: api.verificationAdjudicationReadService } : {}),
      ...(api.verificationAdjudicationDecisionReadService ? { adjudicationDecisionReads: api.verificationAdjudicationDecisionReadService } : {}),
      ...(api.isAdjudicationDecisionReadAdmitted ? { isAdjudicationDecisionReadAdmitted: api.isAdjudicationDecisionReadAdmitted } : {}),
      ...(api.verificationCaptureReads ? { captureReads: api.verificationCaptureReads } : {}),
      ...(api.verificationClaimsReportReads ? { claimsReportReads: api.verificationClaimsReportReads } : {}),
      ...(api.verificationBenchmarkComparisonReads ? { benchmarkComparisonReads: api.verificationBenchmarkComparisonReads } : {}),
      ...(api.verificationBenchmarkReads ? { benchmarkReads: api.verificationBenchmarkReads } : {}),
      ...(api.verificationReads ? { runReads: api.verificationReads } : {}),
      ...(api.verificationCaseReads ? { caseReads: api.verificationCaseReads } : {}),
      ...(api.verificationProviderReconciliation ? { providerReconciliation: api.verificationProviderReconciliation } : {}),
      ...(api.verificationSemanticReconciliation ? { semanticReconciliation: api.verificationSemanticReconciliation } : {}),
      ...(api.maximumResourceResponseBytes === undefined ? {} : { maximumResponseBytes: api.maximumResourceResponseBytes }),
    }),
    ...(api.verificationOperationService && api.resolveVerificationContext
      ? {
          verificationOperations: new VerificationOperationApplicationService(
            api.verificationOperationService,
            apiOrigin,
            api.verificationCaptureCatalog,
          ),
          // The API resolver's request parameter is the Fastify request; MCP passes its incoming request.
          resolveVerificationContext: api.resolveVerificationContext as never,
        }
      : {}),
    // API admission gate types are narrower request shapes of the same host gates.
    verificationAdmission: admission as never,
  };
}
