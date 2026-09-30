import type { VerificationResourceReadServices } from "@aiengineer/knowledge-application";
import type { PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import { createVerificationHostRuntime, type VerificationHostRuntime } from "../verification/host-runtime.js";
import { createVerificationAdjudicationDecisionRuntime } from "../verification/api/verification-adjudication-decision-runtime.js";
import { createVerificationAdjudicationReads } from "../verification/api/verification-adjudication-reads-runtime.js";
import { createVerificationAuditInspectionReads } from "../verification/api/verification-audit-inspection-reads-runtime.js";
import { createVerificationBenchmarkCaptureProfileResolver } from "../verification/api/verification-benchmark-capture-profile.js";
import { createVerificationBenchmarkComparisonReads } from "../verification/api/verification-benchmark-comparison-reads-runtime.js";
import { createVerificationBenchmarkReads } from "../verification/api/verification-benchmark-reads-runtime.js";
import { createVerificationCaptureReads } from "../verification/api/verification-capture-reads-runtime.js";
import { createVerificationClaimsReportReads } from "../verification/api/verification-claims-report-reads-runtime.js";
import { createVerificationProviderReconciliationService } from "../verification/api/verification-provider-reconciliation-runtime.js";
import { createVerificationReads } from "../verification/api/verification-reads-runtime.js";
import { createVerificationSemanticReconciliationService } from "../verification/api/verification-semantic-reconciliation-runtime.js";
import { createVerificationStructuredExtractionReads } from "../verification/api/verification-structured-extraction-reads-runtime.js";
import type { HostEnvironment } from "./shared.js";

type Defined<T> = NonNullable<T>;

/**
 * Verification admission, ownership and read/decision/reconciliation services composed
 * identically for the API and MCP roles. Each service is present only when configured.
 */
export interface VerificationServices {
  /** Shared admission gates and trusted ownership resolution. */
  readonly runtime: VerificationHostRuntime;
  readonly reads?: Defined<ReturnType<typeof createVerificationReads>>;
  readonly benchmarkReads?: Defined<ReturnType<typeof createVerificationBenchmarkReads>>;
  readonly benchmarkComparisonReads?: Defined<ReturnType<typeof createVerificationBenchmarkComparisonReads>>;
  readonly providerReconciliation?: Defined<ReturnType<typeof createVerificationProviderReconciliationService>>;
  readonly semanticReconciliation?: Defined<ReturnType<typeof createVerificationSemanticReconciliationService>>;
  readonly structuredExtractionReads?: Defined<ReturnType<typeof createVerificationStructuredExtractionReads>>;
  readonly auditInspectionReads?: Defined<ReturnType<typeof createVerificationAuditInspectionReads>>;
  readonly claimsReportReads?: Defined<ReturnType<typeof createVerificationClaimsReportReads>>;
  readonly captureReads?: Defined<ReturnType<typeof createVerificationCaptureReads>>;
  readonly adjudicationReads?: Defined<ReturnType<typeof createVerificationAdjudicationReads>>;
  /** Opt-in adjudication decision intake: submission admission, ownership-gated reads. */
  readonly decisions?: Defined<ReturnType<typeof createVerificationAdjudicationDecisionRuntime>>;
  readonly resolveBenchmarkCaptureProfile?: Defined<
    ReturnType<typeof createVerificationBenchmarkCaptureProfileResolver>
  >;
}

/**
 * Construction order and configuration failure codes match the previous API bootstrap
 * (admission runtime, run/benchmark reads, then the formerly API-injected use cases).
 */
export function composeVerificationServices(
  database: PostgresCanonicalRepository | undefined,
  environment: HostEnvironment,
  options: { readonly production: boolean },
): VerificationServices {
  const runtime = createVerificationHostRuntime(database, environment, {
    production: options.production,
    extraAdmittedKinds:
      environment.VERIFICATION_ADJUDICATION_DECISIONS_ENABLED?.trim() === "1"
        ? ["verification_adjudication_decision"]
        : [],
  });
  const reads = createVerificationReads(database, environment);
  const benchmarkReads = createVerificationBenchmarkReads(database, environment);
  const benchmarkComparisonReads = createVerificationBenchmarkComparisonReads(database, environment);
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
  const decisions = createVerificationAdjudicationDecisionRuntime(database, environment);
  if (decisions && !runtime.resolveVerificationContext)
    throw new Error("VERIFICATION_ADJUDICATION_DECISION_OWNERSHIP_REQUIRED");
  return {
    runtime,
    ...(reads ? { reads } : {}),
    ...(benchmarkReads ? { benchmarkReads } : {}),
    ...(benchmarkComparisonReads ? { benchmarkComparisonReads } : {}),
    ...(providerReconciliation ? { providerReconciliation } : {}),
    ...(semanticReconciliation ? { semanticReconciliation } : {}),
    ...(structuredExtractionReads ? { structuredExtractionReads } : {}),
    ...(auditInspectionReads ? { auditInspectionReads } : {}),
    ...(claimsReportReads ? { claimsReportReads } : {}),
    ...(captureReads ? { captureReads } : {}),
    ...(adjudicationReads ? { adjudicationReads } : {}),
    ...(decisions ? { decisions } : {}),
    ...(resolveBenchmarkCaptureProfile ? { resolveBenchmarkCaptureProfile } : {}),
  };
}

/** The composed services as application verification read ports. */
export function verificationReadServices(verify: VerificationServices): VerificationResourceReadServices {
  return {
    ...(verify.structuredExtractionReads ? { structuredExtractionReads: verify.structuredExtractionReads } : {}),
    ...(verify.auditInspectionReads ? { auditInspectionReads: verify.auditInspectionReads } : {}),
    ...(verify.adjudicationReads ? { adjudicationReads: verify.adjudicationReads } : {}),
    ...(verify.decisions
      ? {
          adjudicationDecisionReads: verify.decisions.verificationAdjudicationDecisionReadService,
          isAdjudicationDecisionReadAdmitted: verify.decisions.isAdjudicationDecisionReadAdmitted,
        }
      : {}),
    ...(verify.captureReads ? { captureReads: verify.captureReads } : {}),
    ...(verify.claimsReportReads ? { claimsReportReads: verify.claimsReportReads } : {}),
    ...(verify.benchmarkComparisonReads ? { benchmarkComparisonReads: verify.benchmarkComparisonReads } : {}),
    ...(verify.benchmarkReads ? { benchmarkReads: verify.benchmarkReads } : {}),
    ...(verify.reads ? { runReads: verify.reads, caseReads: verify.reads.cases } : {}),
    ...(verify.providerReconciliation ? { providerReconciliation: verify.providerReconciliation } : {}),
    ...(verify.semanticReconciliation ? { semanticReconciliation: verify.semanticReconciliation } : {}),
  };
}
