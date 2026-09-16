import {
  OperationContextSchema,
  VerifyClaimsRequestSchema,
  VerifyReportRequestSchema,
  type DeterministicVerificationResult,
  type OperationContext,
  type VerificationArtifactHandle,
} from "@aiengineer/knowledge-contracts";
import { digestCanonicalJson } from "@aiengineer/knowledge-verification";
import {
  VerificationClaimsApplicationService,
  type ClaimsVerificationResult,
  type ReportVerificationResult,
  type VerificationClaimsServiceDependencies,
} from "../verification/operations/verification-claims.js";

type VerifyClaimsRequest = ReturnType<typeof VerifyClaimsRequestSchema.parse>;
type VerifyReportRequest = ReturnType<typeof VerifyReportRequestSchema.parse>;

export interface DiagnosticsOfflineClaimsRequest {
  readonly caseId: string;
  readonly request: VerifyClaimsRequest;
}

export interface DiagnosticsOfflineReportRequest {
  readonly reportId: string;
  readonly request: VerifyReportRequest;
}

export interface DiagnosticsOfflineClaimsReportClosureInput {
  /** Authenticated command-owned context. Serialized fixture bytes cannot replace it. */
  readonly context: OperationContext;
  /**
   * Produces dependencies over an already admitted, immutable local closure. It is
   * invoked once for execution and once for replay so authorization tickets and
   * other resolver state cannot leak between passes.
   */
  readonly createDependencies: () => VerificationClaimsServiceDependencies | Promise<VerificationClaimsServiceDependencies>;
  readonly claims?: readonly DiagnosticsOfflineClaimsRequest[];
  readonly reports?: readonly DiagnosticsOfflineReportRequest[];
}

export interface DiagnosticsOfflineClaimsResult {
  readonly caseId: string;
  readonly requestDigest: `sha256:${string}`;
  readonly assertionsArtifact: VerificationArtifactHandle;
  readonly producerAttemptId: string;
  readonly deterministicResult: DeterministicVerificationResult;
  readonly executionDigest: `sha256:${string}`;
  readonly replayDigest: `sha256:${string}`;
  readonly replayMatched: true;
}

export interface DiagnosticsOfflineReportResult extends Omit<DiagnosticsOfflineClaimsResult, "caseId"> {
  readonly reportId: string;
  readonly reportArtifact: VerificationArtifactHandle;
  readonly claimLedgerArtifact: VerificationArtifactHandle;
  readonly reportWide: ReportVerificationResult["reportWide"];
  readonly coverageScope: "producer_declared_assertions_only";
}

export interface DiagnosticsOfflineClaimsReportClosureResult {
  readonly schemaVersion: "verification-diagnostics-offline-claims-report.v1";
  readonly claims: readonly DiagnosticsOfflineClaimsResult[];
  readonly reports: readonly DiagnosticsOfflineReportResult[];
  readonly semantic: Readonly<{
    status: "unavailable";
    assessments: readonly never[];
    reason: "recorded_semantic_assessments_require_separate_exact_identity_replay";
  }>;
  readonly externalRequests: 0;
  readonly replayMatched: true;
}

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,254}$/u;

function frozenClone<T>(value: T): T {
  const clone = structuredClone(value);
  const freeze = (current: unknown): unknown => {
    if (current && typeof current === "object" && !Object.isFrozen(current)) {
      for (const child of Object.values(current)) freeze(child);
      Object.freeze(current);
    }
    return current;
  };
  return freeze(clone) as T;
}

function validateIds(kind: "case" | "report", values: readonly string[]): void {
  if (values.some((value) => !idPattern.test(value))) throw new Error(`DIAGNOSTICS_OFFLINE_${kind.toUpperCase()}_ID_INVALID`);
  if (new Set(values).size !== values.length) throw new Error(`DIAGNOSTICS_OFFLINE_${kind.toUpperCase()}_ID_DUPLICATE`);
}

function serializableClaims(result: ClaimsVerificationResult) {
  return {
    assertionsArtifact: result.assertionsArtifact,
    producerAttemptId: result.producerAttemptId,
    deterministicResult: result.deterministicResult,
  };
}

function serializableReport(result: ReportVerificationResult) {
  return {
    ...serializableClaims(result),
    reportArtifact: result.reportArtifact,
    claimLedgerArtifact: result.claimLedgerArtifact,
    reportWide: result.reportWide,
    coverageScope: result.coverageScope,
  };
}

/**
 * Executes the production deterministic claims/report verifier twice over the
 * caller's admitted frozen closure and requires byte-canonical equality. This
 * helper never creates a judge adapter and therefore cannot imply semantic
 * provider completion.
 */
export async function verifyDiagnosticsOfflineClaimsReportClosure(
  input: DiagnosticsOfflineClaimsReportClosureInput,
): Promise<DiagnosticsOfflineClaimsReportClosureResult> {
  const context = OperationContextSchema.parse(input.context);
  const claims = (input.claims ?? []).map((item) => ({ caseId: item.caseId, request: VerifyClaimsRequestSchema.parse(item.request) }));
  const reports = (input.reports ?? []).map((item) => ({ reportId: item.reportId, request: VerifyReportRequestSchema.parse(item.request) }));
  if (claims.length === 0 && reports.length === 0) throw new Error("DIAGNOSTICS_OFFLINE_CLAIMS_REPORT_EMPTY");
  if (claims.length > 100 || reports.length > 20) throw new Error("DIAGNOSTICS_OFFLINE_CLAIMS_REPORT_BOUND_EXCEEDED");
  validateIds("case", claims.map((item) => item.caseId));
  validateIds("report", reports.map((item) => item.reportId));

  for (const item of [...claims, ...reports]) {
    if (item.request.captureIds.length !== new Set(item.request.captureIds).size) throw new Error("DIAGNOSTICS_OFFLINE_CAPTURE_ID_DUPLICATE");
  }

  const executeService = new VerificationClaimsApplicationService(await input.createDependencies());
  const replayService = new VerificationClaimsApplicationService(await input.createDependencies());
  const claimResults: DiagnosticsOfflineClaimsResult[] = [];
  for (const item of claims) {
    const primary = serializableClaims(await executeService.verifyClaims(item.request, context));
    const replay = serializableClaims(await replayService.verifyClaims(item.request, context));
    const primaryDigest = digestCanonicalJson(primary), replayDigest = digestCanonicalJson(replay);
    if (primaryDigest !== replayDigest) throw new Error(`DIAGNOSTICS_OFFLINE_CLAIMS_REPLAY_MISMATCH:${item.caseId}`);
    claimResults.push(frozenClone({ caseId: item.caseId, requestDigest: digestCanonicalJson(item.request), ...primary, executionDigest: primaryDigest, replayDigest, replayMatched: true as const }));
  }

  const reportResults: DiagnosticsOfflineReportResult[] = [];
  for (const item of reports) {
    const primary = serializableReport(await executeService.verifyReport(item.request, context));
    const replay = serializableReport(await replayService.verifyReport(item.request, context));
    const primaryDigest = digestCanonicalJson(primary), replayDigest = digestCanonicalJson(replay);
    if (primaryDigest !== replayDigest) throw new Error(`DIAGNOSTICS_OFFLINE_REPORT_REPLAY_MISMATCH:${item.reportId}`);
    reportResults.push(frozenClone({ reportId: item.reportId, requestDigest: digestCanonicalJson(item.request), ...primary, executionDigest: primaryDigest, replayDigest, replayMatched: true as const }));
  }

  return frozenClone({
    schemaVersion: "verification-diagnostics-offline-claims-report.v1" as const,
    claims: claimResults,
    reports: reportResults,
    semantic: {
      status: "unavailable" as const,
      assessments: [] as readonly never[],
      reason: "recorded_semantic_assessments_require_separate_exact_identity_replay" as const,
    },
    externalRequests: 0 as const,
    replayMatched: true as const,
  });
}
