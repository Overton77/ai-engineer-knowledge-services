// Configuration and identity (absorbed from @aiengineer/knowledge-config).
export * from "./config/index.js";

// Composition root.
export * from "./create-host.js";
export * from "./server/api.js";
export * from "./server/mcp.js";
export * from "./server/worker.js";
export * from "./server/knowledge.js";
export * from "./server/verification.js";
export * from "./local/capabilities.js";
export * from "./local/catalog-profile.js";
export * from "./local/local-host.js";
export {
  assertOperationKindAdmitted,
  bindResolvedVerificationContext,
  createKnowledgeResourceReads,
  createVerificationResourceReads,
  isAdjudicationDecisionReviewerActor,
  operationCatalog,
  productionWorkerOperationKinds,
  submitCanonicalRetrievalRun,
  transportProblem,
  type CanonicalRetrievalExecutorPort,
  type CatalogOperation,
  type Group,
  type KnowledgeOperationPort,
  type KnowledgeResourceReads,
  type ResolveVerificationContext,
  type ResourceReadResult,
  type VerificationResourceReads,
  VerificationOperationApplicationService,
} from "@aiengineer/knowledge-application";
export type { HostEnvironment } from "./server/shared.js";
export { HostResources, constructWithResources } from "./lifecycle/resources.js";
export { startPollingLoop, type PollingLoop } from "./lifecycle/polling.js";

// Shared verification host: admission gates and ownership used by API and MCP.
export * from "./verification/host-runtime.js";
export * from "./verification/api/verification-reads-runtime.js";
export * from "./verification/api/verification-benchmark-reads-runtime.js";
export * from "./verification/api/verification-benchmark-comparison-reads-runtime.js";
// Verification read, reconciliation and decision construction (formerly API-injected seams).
export * from "./verification/api/verification-ownership.js";
export * from "./verification/api/verification-structured-extraction-reads-runtime.js";
export * from "./verification/api/verification-audit-inspection-reads-runtime.js";
export * from "./verification/api/verification-capture-reads-runtime.js";
export * from "./verification/api/verification-claims-report-reads-runtime.js";
export * from "./verification/api/verification-adjudication-reads-runtime.js";
export * from "./verification/api/verification-adjudication-decision-runtime.js";
export * from "./verification/api/verification-provider-reconciliation-runtime.js";
export * from "./verification/api/verification-semantic-reconciliation-runtime.js";
export * from "./verification/api/verification-benchmark-capture-profile.js";
export * from "./verification/api/verification-drift-revalidation-runtime.js";
export * from "./verification/worker/verification-audit-signing-runtime.js";
