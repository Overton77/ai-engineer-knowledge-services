import {
  VerificationAdjudicationDecisionTerminalResourceSchema,
  VerificationAdjudicationTerminalResourceSchema,
  VerificationAuditInspectionResourceSchema,
  VerificationBenchmarkComparisonResourceSchema,
  VerificationBenchmarkRunManifestResourceSchema,
  VerificationBenchmarkRunSummaryResourceSchema,
  VerificationCaptureTerminalResourceSchema,
  VerificationCaseResourceSchema,
  VerificationClaimsTerminalResourceSchema,
  VerificationEvidenceResourceSchema,
  VerificationProviderReconciliationResourceSchema,
  VerificationReportTerminalResourceSchema,
  VerificationRunCasesResourceSchema,
  VerificationRunManifestResourceSchema,
  VerificationRunSummaryResourceSchema,
  VerificationStructuredExtractionResourceSchema,
  type Actor,
  type VerificationArtifactHandle,
} from "@aiengineer/knowledge-contracts";
import type { ZodType } from "zod";
import {
  boundedResourceResult,
  classifyResourceReadError,
  resourceReadFailure,
  type ResourceReadResult,
} from "./resource-read-result.js";

/** An authenticated actor reading one tenant-owned verification operation. */
export interface OwnedOperationRead {
  readonly tenantId: string;
  readonly operationId: string;
  readonly actor: Actor;
}

export interface ProviderAttemptScope extends OwnedOperationRead {
  readonly providerAttemptId: string;
}

interface ProviderReconciliationService<TScope> {
  applyDecision(input: TScope & { readonly artifact: VerificationArtifactHandle }): Promise<unknown>;
  getDecision(input: TScope): Promise<unknown>;
}

/**
 * Composed verification read services. Each owns its ownership authorization,
 * signature policy and trusted storage; absent services mean the capability is not admitted.
 */
export interface VerificationResourceReadServices {
  readonly structuredExtractionReads?: { getExtraction(input: OwnedOperationRead): Promise<unknown> };
  readonly auditInspectionReads?: { getInspection(input: OwnedOperationRead): Promise<unknown> };
  readonly adjudicationReads?: { getPendingSubject(input: OwnedOperationRead): Promise<unknown> };
  readonly adjudicationDecisionReads?: { getDecision(input: OwnedOperationRead): Promise<unknown> };
  readonly isAdjudicationDecisionReadAdmitted?: (input: OwnedOperationRead) => Promise<boolean>;
  readonly captureReads?: { getCapture(input: OwnedOperationRead): Promise<unknown> };
  readonly claimsReportReads?: {
    getClaims(input: OwnedOperationRead): Promise<unknown>;
    getReport(input: OwnedOperationRead): Promise<unknown>;
  };
  readonly benchmarkComparisonReads?: { getComparison(input: { tenantId: string; comparisonId: string }): Promise<unknown> };
  readonly benchmarkReads?: {
    getRun(input: { tenantId: string; runId: string }): Promise<unknown>;
    getManifest(input: { tenantId: string; runId: string }): Promise<unknown>;
  };
  readonly runReads?: {
    getRun(input: { tenantId: string; runId: string }): Promise<unknown>;
    getRunManifest(input: { tenantId: string; runId: string }): Promise<unknown>;
  };
  readonly caseReads?: {
    listRunCases(input: { tenantId: string; runId: string; pageSize: number; cursor?: string }): Promise<unknown>;
    getCase(input: { tenantId: string; caseRunId: string }): Promise<unknown>;
    getEvidence(input: { tenantId: string; evidenceId: string }): Promise<unknown>;
  };
  readonly providerReconciliation?: ProviderReconciliationService<ProviderAttemptScope>;
  readonly semanticReconciliation?: ProviderReconciliationService<ProviderAttemptScope & { readonly host: "claims" | "report" }>;
  readonly maximumResponseBytes?: number;
}

export type VerificationResourceReads = ReturnType<typeof createVerificationResourceReads>;

const DEFAULT_CASE_PAGE_SIZE = 25;

/**
 * Verification resource reads shared by the API routes and MCP tools. The caller has
 * authorized `knowledge.read` (or `operation.submit` for reconciliation apply) for the
 * tenant and supplies the bearer-bound actor. Every result is schema-validated and must
 * name exactly the requested tenant and resource; otherwise it fails closed as integrity.
 */
export function createVerificationResourceReads(services: VerificationResourceReadServices) {
  const read = async <T>(
    mode: "missing" | "terminal",
    load: (() => Promise<unknown>) | undefined,
    schema: ZodType<T>,
    inScope: (resource: T) => boolean,
  ): Promise<ResourceReadResult<T>> => {
    if (!load) return resourceReadFailure("unavailable");
    try {
      const resource = schema.parse(await load());
      if (!inScope(resource)) throw new Error("VERIFICATION_READ_SCOPE_MISMATCH");
      return boundedResourceResult(resource, services.maximumResponseBytes);
    } catch (error) {
      return classifyResourceReadError(error, mode);
    }
  };
  const owned = (input: OwnedOperationRead) => (resource: { tenantId: string; operationId: string }) =>
    resource.tenantId === input.tenantId && resource.operationId === input.operationId;
  const bind = <S,>(service: S | undefined, call: (service: S) => Promise<unknown>) =>
    service ? () => call(service) : undefined;
  const reconciliation = <S extends ProviderAttemptScope>(
    service: ProviderReconciliationService<S> | undefined,
    input: S & { readonly artifact?: VerificationArtifactHandle },
  ) => {
    const { artifact, ...scope } = input;
    return read(
      "missing",
      bind(service, (candidate) =>
        artifact ? candidate.applyDecision({ ...(scope as unknown as S), artifact }) : candidate.getDecision(scope as unknown as S)),
      VerificationProviderReconciliationResourceSchema,
      (resource) =>
        resource.tenantId === input.tenantId &&
        resource.operationId === input.operationId &&
        resource.providerAttemptId === input.providerAttemptId,
    );
  };
  return {
    structuredExtraction: (input: OwnedOperationRead) =>
      read("missing", bind(services.structuredExtractionReads, (service) => service.getExtraction(input)),
        VerificationStructuredExtractionResourceSchema, owned(input)),
    auditInspection: (input: OwnedOperationRead) =>
      read("terminal", bind(services.auditInspectionReads, (service) => service.getInspection(input)),
        VerificationAuditInspectionResourceSchema, owned(input)),
    adjudicationSubject: (input: OwnedOperationRead) =>
      read("terminal", bind(services.adjudicationReads, (service) => service.getPendingSubject(input)),
        VerificationAdjudicationTerminalResourceSchema, owned(input)),
    /** Decision reads require the operation-ownership gate before the signed read. */
    adjudicationDecision: (input: OwnedOperationRead) => {
      const service = services.adjudicationDecisionReads, admitted = services.isAdjudicationDecisionReadAdmitted;
      return read(
        "terminal",
        service && admitted
          ? async () => {
              if (!(await admitted(input))) throw Object.assign(new Error("VERIFICATION_DECISION_NOT_FOUND"), { code: "NOT_FOUND" });
              return service.getDecision(input);
            }
          : undefined,
        VerificationAdjudicationDecisionTerminalResourceSchema,
        owned(input),
      );
    },
    capture: (input: OwnedOperationRead) =>
      read("terminal", bind(services.captureReads, (service) => service.getCapture(input)),
        VerificationCaptureTerminalResourceSchema, owned(input)),
    claims: (input: OwnedOperationRead) =>
      read("terminal", bind(services.claimsReportReads, (service) => service.getClaims(input)),
        VerificationClaimsTerminalResourceSchema, owned(input)),
    report: (input: OwnedOperationRead) =>
      read("terminal", bind(services.claimsReportReads, (service) => service.getReport(input)),
        VerificationReportTerminalResourceSchema, owned(input)),
    benchmarkComparison: (input: { tenantId: string; comparisonId: string }) =>
      read("missing", bind(services.benchmarkComparisonReads, (service) => service.getComparison(input)),
        VerificationBenchmarkComparisonResourceSchema,
        (resource) => resource.tenantId === input.tenantId && resource.comparisonId === input.comparisonId),
    benchmarkRun: (input: { tenantId: string; runId: string }) =>
      read("missing", bind(services.benchmarkReads, (service) => service.getRun(input)),
        VerificationBenchmarkRunSummaryResourceSchema,
        (resource) => resource.tenantId === input.tenantId && resource.runId === input.runId),
    benchmarkManifest: (input: { tenantId: string; runId: string }) =>
      read("missing", bind(services.benchmarkReads, (service) => service.getManifest(input)),
        VerificationBenchmarkRunManifestResourceSchema,
        (resource) => resource.tenantId === input.tenantId && resource.runId === input.runId),
    run: (input: { tenantId: string; runId: string }) =>
      read("missing", bind(services.runReads, (service) => service.getRun(input)),
        VerificationRunSummaryResourceSchema,
        (resource) => resource.tenantId === input.tenantId && resource.runId === input.runId),
    runManifest: (input: { tenantId: string; runId: string }) =>
      read("missing", bind(services.runReads, (service) => service.getRunManifest(input)),
        VerificationRunManifestResourceSchema,
        (resource) => resource.tenantId === input.tenantId && resource.runId === input.runId),
    runCases: (input: { tenantId: string; runId: string; pageSize?: number; cursor?: string }) =>
      read("missing",
        bind(services.caseReads, (service) => service.listRunCases({
          tenantId: input.tenantId,
          runId: input.runId,
          pageSize: input.pageSize ?? DEFAULT_CASE_PAGE_SIZE,
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        })),
        VerificationRunCasesResourceSchema,
        (resource) => resource.tenantId === input.tenantId && resource.runId === input.runId),
    case: (input: { tenantId: string; caseRunId: string }) =>
      read("missing", bind(services.caseReads, (service) => service.getCase(input)),
        VerificationCaseResourceSchema,
        (resource) => resource.tenantId === input.tenantId && "caseRunId" in resource && resource.caseRunId === input.caseRunId),
    evidence: (input: { tenantId: string; evidenceId: string }) =>
      read("missing", bind(services.caseReads, (service) => service.getEvidence(input)),
        VerificationEvidenceResourceSchema,
        (resource) => resource.tenantId === input.tenantId && "evidenceId" in resource && resource.evidenceId === input.evidenceId),
    /** Reads, or with `artifact` applies, a signed extraction accounting decision; never redispatches. */
    providerReconciliation: (input: ProviderAttemptScope & { readonly artifact?: VerificationArtifactHandle }) =>
      reconciliation(services.providerReconciliation, input),
    semanticReconciliation: (input: ProviderAttemptScope & { readonly host: "claims" | "report"; readonly artifact?: VerificationArtifactHandle }) =>
      reconciliation(services.semanticReconciliation, input),
  };
}
