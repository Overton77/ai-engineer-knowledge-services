import type { ServiceStatus } from "@aiengineer/knowledge-contracts";
import { KNOWLEDGE_SERVICE_NAME } from "@aiengineer/knowledge-domain";

export interface KnowledgeApplication {
  getStatus(): Promise<ServiceStatus>;
}

export function createKnowledgeApplication(): KnowledgeApplication {
  return {
    async getStatus() {
      return {
        service: KNOWLEDGE_SERVICE_NAME,
        status: "ready",
        contractVersion: "v1",
        runtime: "node",
      };
    },
  };
}

export * from "./preparation.js";
export * from "./knowledge.js";
export * from "./surface.js";
export * from "./a2a-adapter.js";
export * from "./verification-admission.js";
export * from "./verification-replay.js";
export * from "./verification-provider.js";
export * from "./verification-benchmark.js";
export * from "./verification-benchmark-inputs.js";
export * from "./verification-benchmark-registered-profile.js";
export * from "./verification-benchmark-registered-replay.js";
export * from "./verification-benchmark-source-import.js";
export * from "./verification-benchmark-offline-executor.js";
export * from "./verification-benchmark-publication.js";
export * from "./verification-benchmark-runtime-config.js";
export * from "./verification-benchmark-observations.js";
export * from "./verification-benchmark-projections.js";
export * from "./verification-benchmark-response-replay.js";
export * from "./verification-service.js";
export * from "./verification-metrics.js";
export * from "./verification-claims.js";
export * from "./verification-parse.js";
export * from "./verification-audit-inspection.js";
export * from "./verification-audit-inspection-grants.js";
export * from "./verification-audit-inspection-reads.js";
export * from "./verification-reads.js";
export * from "./verification-benchmark-reads.js";
export * from "./verification-benchmark-comparison.js";
export * from "./verification-benchmark-comparison-publication.js";
export * from "./verification-benchmark-comparison-runtime-config.js";
export * from "./verification-benchmark-comparison-reads.js";
export * from "./verification-seal-policy.js";
export * from "./verification-structured-extraction-profile.js";

export * from "./verification-provider-transport.js";

export * from "./verification-structured-extraction-replay.js";
export * from "./verification-structured-extraction-candidate.js";
export * from "./verification-structured-extraction-publication.js";
export * from "./verification-structured-extraction-failure.js";
export * from "./verification-structured-extraction-result.js";
export * from "./verification-structured-extraction-failure-result.js";
export * from "./verification-structured-extraction-reads.js";

export * from "./verification-structured-extraction-runtime.js";

export * from "./verification-provider-reconciliation.js";
export * from "./verification-semantic.js";
export * from "./verification-claims-report-reads.js";
export * from "./verification-adjudication.js";
export * from "./verification-adjudication-reads.js";
export * from "./verification-semantic-observation.js";
export * from "./verification-semantic-observation-recorder.js";
export * from "./verification-drift-revalidation.js";
export * from "./verification-component-drift.js";
export * from "./verification-semantic-recovery.js";
export * from "./verification-semantic-replay.js";
export * from "./verification-semantic-audit-replay.js";
export * from "./verification-semantic-profile.js";
export * from "./verification-semantic-provider-reconciliation.js";

export * from "./verification-diagnostics-offline-catalog.js";

export * from "./verification-diagnostics-semantic-fixture.js";
export * from "./verification-diagnostics-generated-report-semantic-fixture.js";
export * from "./verification-diagnostics-semantic-replay.js";
export * from "./verification-diagnostics-adversarial.js";
export * from "./verification-diagnostics-mutation-report.js";
export * from "./verification-diagnostics-report-coverage.js";
export * from "./verification-diagnostics-quality-gates.js";
export * from "./verification-source-acquisition.js";
export * from "./verification-benchmark-version-diff.js";
export * from "./verification-benchmark-refresh-proposal.js";
export * from "./verification-capture-reads.js";
export * from "./verification-adjudication-decision.js";
