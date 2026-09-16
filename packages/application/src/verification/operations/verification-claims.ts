import {
  OperationContextSchema,
  VerificationArtifactHandleSchema,
  VerificationClaimsArtifactSchema,
  VerificationReportLedgerSchema,
  VerifyClaimsRequestSchema,
  VerifyReportRequestSchema,
  type OperationContext,
  type SemanticAssessmentRecord,
  type VerificationArtifactHandle,
  type VerificationBundle,
} from "@aiengineer/knowledge-contracts";
import { verifySemanticCase, type SemanticJudgeAdapter, type SemanticJudgeExecution, authorizeSemanticCase, resolveWithAdmittedResolver, type AuthorizedSemanticCase, applyReportWideMechanicalGates, digestCanonicalJson, sha256Digest, verifyDeterministicBundle, verifyReportWideFromLedger, type DeterministicSelectorResolver, type RuntimePrincipalBinding } from "@aiengineer/knowledge-verification";
import { z } from "zod";
import type { VerificationMetricCapturePort, VerificationMetricNativeProjectionAdmissionPort } from "./verification-metrics.js";

export interface VerificationClaimsArtifactResolver {
  authorizeArtifact(input: { readonly tenantId: string; readonly artifactId: string; readonly purpose: "verification_admission" }): Promise<void>;
  hydrateRegisteredArtifact(input: { readonly tenantId: string; readonly artifactId: string }): Promise<{ readonly registration: VerificationArtifactHandle; readonly bytes: Uint8Array }>;
}

/** Runtime configuration owns verifier identity.  Request bodies never can. */
export interface VerificationClaimsRuntimePrincipalPort {
  bind(input: { readonly context: OperationContext; readonly assertionsArtifact: VerificationArtifactHandle; readonly captureIds: readonly string[] }): Promise<{ readonly runtimePrincipals: RuntimePrincipalBinding; readonly producerAttemptId: string }>;
}

export interface VerificationClaimsServiceDependencies {
  readonly artifactResolver: VerificationClaimsArtifactResolver;
  readonly captures: VerificationMetricCapturePort;
  readonly runtimePrincipals: VerificationClaimsRuntimePrincipalPort;
  readonly projectionGrants?: VerificationClaimsProjectionGrantCatalog;
  readonly nativeProjectionAdmission?: VerificationMetricNativeProjectionAdmissionPort;
  readonly selectorResolvers?: readonly DeterministicSelectorResolver[];
}

export interface ClaimsVerificationResult {
  readonly mode: "deterministic_only";
  readonly deterministicResult: ReturnType<typeof verifyDeterministicBundle>;
  readonly assertionsArtifact: VerificationArtifactHandle;
  /** Server-resolved only. Non-enumerable so it cannot widen a public terminal DTO. */
  readonly runtimePrincipals: RuntimePrincipalBinding;
  readonly producerAttemptId: string;
  readonly sourceArtifacts: readonly VerificationArtifactHandle[];
}

export interface ClaimsSemanticAssessmentBatch { readonly assessments: readonly SemanticAssessmentRecord[]; }

export interface ReportDiagnosticSemanticCase {
  readonly diagnosticOnly: true;
  readonly semanticCase: AuthorizedSemanticCase;
  readonly baseDeterministicDigest: string;
  readonly finalDeterministicDigest: string;
}

export interface ReportVerificationResult extends ClaimsVerificationResult {
  readonly reportArtifact: VerificationArtifactHandle;
  readonly claimLedgerArtifact: VerificationArtifactHandle;
  readonly reportWide: ReturnType<typeof verifyReportWideFromLedger>;
  /** Coverage metrics describe the producer-declared ledger only. */
  readonly coverageScope: "producer_declared_assertions_only";
}

const decode = (bytes: Uint8Array, code: string): unknown => {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error(code); }
};

const projectionGrantSchema = z.strictObject({
  tenantId: z.uuid(),
  assertions: z.strictObject({ artifactId: z.uuid(), digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u) }),
  admissions: z.array(z.strictObject({ captureId: z.string().trim().min(1).max(255), projectionArtifactId: z.uuid(), transformationArtifactId: z.uuid() })).max(100),
}).superRefine((value, context) => {
  const keys = value.admissions.map((item) => `${item.captureId}:${item.projectionArtifactId}`);
  if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", path: ["admissions"], message: "projection admissions must be unique" });
});
export type VerificationClaimsProjectionGrant = z.infer<typeof projectionGrantSchema>;

/** Trusted runtime grants bind native projection envelopes to one exact claims/ledger artifact. */
export class VerificationClaimsProjectionGrantCatalog {
  readonly #grants = new Map<string, VerificationClaimsProjectionGrant>();
  constructor(values: readonly VerificationClaimsProjectionGrant[]) {
    for (const raw of values) {
      const value = structuredClone(projectionGrantSchema.parse(raw));
      const key = `${value.tenantId}:${value.assertions.artifactId}:${value.assertions.digest}`;
      if (this.#grants.has(key)) throw new Error("DUPLICATE_VERIFICATION_CLAIMS_PROJECTION_GRANT");
      this.#grants.set(key, Object.freeze(value));
    }
  }
  resolve(tenantId: string, assertions: { readonly artifactId: string; readonly digest: string }): VerificationClaimsProjectionGrant {
    const value = this.#grants.get(`${tenantId}:${assertions.artifactId}:${assertions.digest}`);
    if (!value) throw new Error("VERIFICATION_CLAIMS_PROJECTION_GRANT_REQUIRED");
    return value;
  }
}

/** Deterministic claim/report composition. Semantic judging is intentionally an injected
 * later stage; mechanical failures never reach it. */
export class VerificationClaimsApplicationService {
  readonly #semanticPreparations = new WeakMap<object, { resultDigest: string; contextDigest: string; bundle: VerificationBundle; artifacts: Map<string, Uint8Array>; reportBaseDeterministicResult?: ClaimsVerificationResult["deterministicResult"] }>();
  readonly #semanticBatches = new WeakMap<object, { result: ClaimsVerificationResult; contextDigest: string; batchDigest: string }>();
  constructor(private readonly dependencies: VerificationClaimsServiceDependencies) {}

  async gradePreparedSemantics(result: ClaimsVerificationResult, contextValue: unknown,
    adaptersForCase: (semanticCase: AuthorizedSemanticCase) => Promise<{ primary: SemanticJudgeAdapter; crossFamily?: SemanticJudgeAdapter }>,
    execution: SemanticJudgeExecution = {}): Promise<ClaimsSemanticAssessmentBatch> {
    const context = OperationContextSchema.parse(contextValue), cases = this.prepareSemanticCases(result, context);
    const prepared = this.#semanticPreparations.get(result)!;
    const assessments: SemanticAssessmentRecord[] = [];
    for (const semanticCase of cases) {
      if (execution.signal?.aborted) throw new Error("JUDGE_CANCELLED");
      const adapters = await adaptersForCase(semanticCase);
      if ([adapters.primary.identity, adapters.crossFamily?.identity].some(identity => identity?.deploymentId === prepared.bundle.producer.deploymentId)) throw new Error("SEMANTIC_PRODUCER_VERIFIER_COLLISION");
      if (adapters.crossFamily && adapters.crossFamily.identity.deploymentId === adapters.primary.identity.deploymentId) throw new Error("SEMANTIC_VERIFIER_IDENTITY_COLLISION");
      assessments.push(await verifySemanticCase(semanticCase, adapters, execution));
    }
    // Revalidate the private preparation after asynchronous adapter work.
    this.prepareSemanticCases(result, context);
    const batch = Object.freeze({ assessments: Object.freeze(assessments) });
    this.#semanticBatches.set(batch, { result, contextDigest: digestCanonicalJson(context), batchDigest: digestCanonicalJson(batch) });
    return batch;
  }

  assertSemanticAssessmentBatch(result: ClaimsVerificationResult, contextValue: unknown, batch: ClaimsSemanticAssessmentBatch): void {
    this.prepareSemanticCases(result, contextValue);
    const issued = this.#semanticBatches.get(batch);
    if (!issued || issued.result !== result || issued.contextDigest !== digestCanonicalJson(OperationContextSchema.parse(contextValue)) || issued.batchDigest !== digestCanonicalJson(batch)) throw new Error("VERIFICATION_SEMANTIC_BATCH_REQUIRED");
  }


  /** Only this service's original, unchanged result may authorize semantic grading. */
  prepareSemanticCases(result: ClaimsVerificationResult, contextValue: unknown): readonly AuthorizedSemanticCase[] {
    const context = OperationContextSchema.parse(contextValue), prepared = this.#semanticPreparations.get(result);
    if (!prepared || prepared.resultDigest !== digestCanonicalJson(result) || prepared.contextDigest !== digestCanonicalJson(context)) throw new Error("VERIFICATION_SEMANTIC_PREPARATION_REQUIRED");
    const deterministic = result.deterministicResult;
    if (deterministic.status !== "passed" || !deterministic.semanticEligibility) return [];
    return this.#prepareSemanticCasesFrom(prepared, deterministic);
  }

  /**
   * Makes assertion-level cases inspectable when a report's source custody is sound but the
   * report is deliberately held by its cross-assertion consistency gates. These cases are
   * diagnostic-only and cannot be asserted as an ordinary service-issued semantic batch.
   */
  prepareReportDiagnosticSemanticCases(result: ReportVerificationResult, contextValue: unknown): readonly ReportDiagnosticSemanticCase[] {
    const context = OperationContextSchema.parse(contextValue), prepared = this.#semanticPreparations.get(result), base = prepared?.reportBaseDeterministicResult;
    if (!prepared || !base || prepared.resultDigest !== digestCanonicalJson(result) || prepared.contextDigest !== digestCanonicalJson(context)) throw new Error("VERIFICATION_REPORT_DIAGNOSTIC_PREPARATION_REQUIRED");
    const recomputed = applyReportWideMechanicalGates(base, result.reportWide);
    if (digestCanonicalJson(recomputed) !== digestCanonicalJson(result.deterministicResult) || base.status !== "passed" || !base.semanticEligibility || result.deterministicResult.status !== "failed" || result.deterministicResult.semanticEligibility) throw new Error("VERIFICATION_REPORT_DIAGNOSTIC_GATE_INVALID");
    const allowed = new Set(["REPORT_INTERNAL_CONTRADICTION_FREE", "REPORT_CROSS_SECTION_CONSISTENCY"]);
    const baseFailures = new Set(base.summary.failedCheckCodes);
    const addedFailures = result.deterministicResult.summary.failedCheckCodes.filter(code => !baseFailures.has(code));
    if (baseFailures.size !== 0 || addedFailures.length === 0 || addedFailures.some(code => !allowed.has(code))) throw new Error("VERIFICATION_REPORT_DIAGNOSTIC_FAILURE_SCOPE");
    const baseDigest = digestCanonicalJson(base), finalDigest = digestCanonicalJson(result.deterministicResult);
    return Object.freeze(this.#prepareSemanticCasesFrom(prepared, base).map(semanticCase => Object.freeze({ diagnosticOnly: true as const, semanticCase, baseDeterministicDigest: baseDigest, finalDeterministicDigest: finalDigest })));
  }

  #prepareSemanticCasesFrom(prepared: { bundle: VerificationBundle; artifacts: Map<string, Uint8Array> }, deterministic: ClaimsVerificationResult["deterministicResult"]): readonly AuthorizedSemanticCase[] {
    return Object.freeze(prepared.bundle.assertions.map(assertion => {
      const mechanical = deterministic.assertions.find(item => item.assertionId === assertion.assertionId);
      if (!mechanical || mechanical.status !== "passed" || !mechanical.semanticEligibility) throw new Error("SEMANTIC_MECHANICAL_GATE_CLOSED");
      const selected = assertion.evidence.map(edge => {
        const capture = prepared.bundle.captures.find(item => item.captureId === edge.fragment.captureId);
        const handle = capture && [capture.contentArtifact, ...(capture.canonicalProjectionArtifact ? [capture.canonicalProjectionArtifact] : [])].find(item => item.artifactId === edge.fragment.representationArtifactId);
        const bytes = handle && prepared.artifacts.get(handle.artifactId);
        if (!handle || !bytes) throw new Error("VERIFICATION_SEMANTIC_REPRESENTATION_REQUIRED");
        const selection = resolveWithAdmittedResolver({ captureId: edge.fragment.captureId, representationArtifactId: handle.artifactId, representationDigest: handle.digest, selector: edge.fragment.selector, content: bytes.slice() }, this.dependencies.selectorResolvers ?? []);
        const original = mechanical.evidence.find(item => item.evidenceId === edge.evidenceId);
        if (!selection || !original || digestCanonicalJson(selection.resolution) !== digestCanonicalJson(original.resolution)) throw new Error("VERIFICATION_SEMANTIC_SELECTOR_DRIFT");
        return { evidenceId: edge.evidenceId, fragmentId: edge.fragment.fragmentId, exactText: new TextDecoder("utf-8", { fatal: true }).decode(selection.selectedContent), selectedContentDigest: sha256Digest(selection.selectedContent) };
      });
      return authorizeSemanticCase(prepared.bundle, deterministic, assertion.assertionId, selected);
    }));
  }

  #retainRuntimePrincipalBinding<T extends object>(result: T, runtimePrincipals: RuntimePrincipalBinding): T & Pick<ClaimsVerificationResult, "runtimePrincipals"> {
    // This server-resolved binding is passed to sealing but remains outside serialized/public operation DTOs.
    Object.defineProperty(result, "runtimePrincipals", { value: Object.freeze({ ...runtimePrincipals }), enumerable: false, configurable: false, writable: false });
    return Object.freeze(result) as T & Pick<ClaimsVerificationResult, "runtimePrincipals">;
  }

  #retainSemanticPreparation<T extends ClaimsVerificationResult>(result: T, context: OperationContext, bundle: VerificationBundle, captures: readonly { registration: VerificationArtifactHandle; bytes: Uint8Array }[], reportBaseDeterministicResult?: ClaimsVerificationResult["deterministicResult"]): T {
    this.#semanticPreparations.set(result, { resultDigest: digestCanonicalJson(result), contextDigest: digestCanonicalJson(context), bundle: structuredClone(bundle), artifacts: new Map(captures.map(item => [item.registration.artifactId, item.bytes.slice()])), ...(reportBaseDeterministicResult ? { reportBaseDeterministicResult: structuredClone(reportBaseDeterministicResult) } : {}) });
    return result;
  }

  async verifyClaims(requestValue: unknown, contextValue: unknown): Promise<ClaimsVerificationResult> {
    const request = VerifyClaimsRequestSchema.parse(requestValue);
    const context = OperationContextSchema.parse(contextValue);
    const assertions = await this.#hydrateExact(context.tenantId, request.assertions);
    const artifact = VerificationClaimsArtifactSchema.parse(decode(assertions.bytes, "VERIFICATION_CLAIMS_ARTIFACT_INVALID"));
    this.#assertCaptureIds(artifact.bundle.captures.map((item) => item.captureId), request.captureIds);
    const captures = await this.#hydrateCaptures(context.tenantId, artifact.bundle);
    await this.#assertRegisteredCaptures(context.tenantId, artifact.bundle);
    const isProjectionLineageAdmitted = await this.#admitNativeProjections(context.tenantId, assertions.registration, artifact.bundle);
    const identity = await this.dependencies.runtimePrincipals.bind({ context, assertionsArtifact: assertions.registration, captureIds: request.captureIds });
    return this.#retainSemanticPreparation(this.#retainRuntimePrincipalBinding({ mode: "deterministic_only", deterministicResult: verifyDeterministicBundle({ bundle: artifact.bundle, artifacts: captures.map((item) => ({ artifactId: item.registration.artifactId, content: item.bytes })), runtimePrincipals: identity.runtimePrincipals }, {
      ...(this.dependencies.selectorResolvers ? { selectorResolvers: this.dependencies.selectorResolvers } : {}),
      ...(isProjectionLineageAdmitted ? { isProjectionLineageAdmitted } : {}),
    }), assertionsArtifact: assertions.registration, producerAttemptId: identity.producerAttemptId, sourceArtifacts: captures.map((item) => item.registration) }, identity.runtimePrincipals), context, artifact.bundle, captures);
  }

  async verifyReport(requestValue: unknown, contextValue: unknown): Promise<ReportVerificationResult> {
    const request = VerifyReportRequestSchema.parse(requestValue);
    const context = OperationContextSchema.parse(contextValue);
    // The production trusted resolver grants one single-use hydration ticket at a time.
    // Keep authorization and hydration paired for each artifact instead of interleaving them.
    const report = await this.#hydrateExact(context.tenantId, request.report);
    const ledger = await this.#hydrateExact(context.tenantId, request.claimLedger);
    const reportText = new TextDecoder("utf-8", { fatal: true }).decode(report.bytes);
    const parsed = VerificationReportLedgerSchema.parse(decode(ledger.bytes, "VERIFICATION_REPORT_LEDGER_INVALID"));
    if (digestCanonicalJson(parsed.reportArtifact) !== digestCanonicalJson(report.registration)) throw new Error("VERIFICATION_REPORT_LEDGER_REPORT_MISMATCH");
    this.#assertCaptureIds(parsed.bundle.captures.map((item) => item.captureId), request.captureIds);
    // A report ledger permits report assertions, while the claim route accepts claims only.
    // Recompute mechanically here against the same server-bound principal instead of trusting
    // caller supplied outcomes.
    const captures = await this.#hydrateCaptures(context.tenantId, parsed.bundle);
    await this.#assertRegisteredCaptures(context.tenantId, parsed.bundle);
    const isProjectionLineageAdmitted = await this.#admitNativeProjections(context.tenantId, ledger.registration, parsed.bundle);
    const identity = await this.dependencies.runtimePrincipals.bind({ context, assertionsArtifact: ledger.registration, captureIds: request.captureIds });
    const baseDeterministicResult = verifyDeterministicBundle({ bundle: parsed.bundle, artifacts: captures.map((item) => ({ artifactId: item.registration.artifactId, content: item.bytes })), runtimePrincipals: identity.runtimePrincipals }, {
      ...(this.dependencies.selectorResolvers ? { selectorResolvers: this.dependencies.selectorResolvers } : {}),
      ...(isProjectionLineageAdmitted ? { isProjectionLineageAdmitted } : {}),
    });
    const reportWide = verifyReportWideFromLedger(reportText, parsed, baseDeterministicResult);
    const deterministicResult = applyReportWideMechanicalGates(baseDeterministicResult, reportWide);
    return this.#retainSemanticPreparation(this.#retainRuntimePrincipalBinding({ mode: "deterministic_only", deterministicResult, assertionsArtifact: ledger.registration, reportArtifact: report.registration, claimLedgerArtifact: ledger.registration, reportWide, coverageScope: "producer_declared_assertions_only" as const, producerAttemptId: identity.producerAttemptId, sourceArtifacts: captures.map((item) => item.registration) }, identity.runtimePrincipals), context, parsed.bundle, captures, baseDeterministicResult);
  }

  #assertCaptureIds(actual: readonly string[], expected: readonly string[]): void {
    if (actual.length !== expected.length || actual.some((id) => !expected.includes(id)) || new Set(actual).size !== actual.length) throw new Error("VERIFICATION_CLAIMS_CAPTURE_SET_MISMATCH");
  }
  async #assertRegisteredCaptures(tenantId: string, bundle: import("@aiengineer/knowledge-contracts").VerificationBundle): Promise<void> {
    for (const capture of bundle.captures) {
      const registered = await this.dependencies.captures.getRegisteredCapture({ tenantId, captureId: capture.captureId });
      const declaredSource = bundle.sources.find((source) => source.sourceId === capture.sourceId);
      const declaredBaseCapture = capture.canonicalProjectionArtifact === undefined ? capture : (() => {
        const { canonicalProjectionArtifact: _projection, ...base } = capture;
        return base;
      })();
      const registeredCaptureMatches = registered.capture.canonicalProjectionArtifact === undefined
        ? digestCanonicalJson(registered.capture) === digestCanonicalJson(declaredBaseCapture)
        : digestCanonicalJson(registered.capture) === digestCanonicalJson(capture);
      if (!declaredSource || digestCanonicalJson(registered.source) !== digestCanonicalJson(declaredSource) || !registeredCaptureMatches) throw new Error("VERIFICATION_CLAIMS_CAPTURE_REGISTRATION_MISMATCH");
    }
  }
  async #hydrateCaptures(tenantId: string, bundle: VerificationBundle) {
    const results = new Map<string, { registration: VerificationArtifactHandle; bytes: Uint8Array }>();
    for (const expected of bundle.captures.flatMap((capture) => [capture.contentArtifact, ...(capture.canonicalProjectionArtifact ? [capture.canonicalProjectionArtifact] : [])])) {
      const hydrated = await this.#hydrateExact(tenantId, expected);
      const prior = results.get(hydrated.registration.artifactId);
      if (prior && digestCanonicalJson(prior.registration) !== digestCanonicalJson(hydrated.registration)) throw new Error("VERIFICATION_CLAIMS_SHARED_ARTIFACT_BINDING_CONFLICT");
      results.set(hydrated.registration.artifactId, hydrated);
    }
    return [...results.values()];
  }
  async #admitNativeProjections(tenantId: string, assertionsArtifact: VerificationArtifactHandle, bundle: VerificationBundle) {
    const projected = bundle.captures.filter((capture) => capture.canonicalProjectionArtifact !== undefined);
    if (projected.length === 0) return undefined;
    if (!this.dependencies.projectionGrants || !this.dependencies.nativeProjectionAdmission) throw new Error("VERIFICATION_CLAIMS_NATIVE_PROJECTION_ADMISSION_REQUIRED");
    const grant = this.dependencies.projectionGrants.resolve(tenantId, assertionsArtifact);
    const admitted = new Set<string>();
    for (const capture of projected) {
      const projection = capture.canonicalProjectionArtifact!;
      const item = grant.admissions.find((candidate) => candidate.captureId === capture.captureId && candidate.projectionArtifactId === projection.artifactId);
      if (!item) throw new Error("VERIFICATION_CLAIMS_PROJECTION_ENVELOPE_GRANT_REQUIRED");
      const hydrated = await this.dependencies.nativeProjectionAdmission.hydrateAdmittedProjection({ tenantId, captureId: capture.captureId,
        expectedSourceArtifact: { artifactId: capture.contentArtifact.artifactId, digest: capture.contentArtifact.digest as `sha256:${string}` },
        transformationArtifactId: item.transformationArtifactId, projectionArtifactId: item.projectionArtifactId });
      if (hydrated.receipt.captureId !== capture.captureId
        || digestCanonicalJson(hydrated.receipt.sourceArtifact) !== digestCanonicalJson(capture.contentArtifact)
        || digestCanonicalJson(hydrated.receipt.projectionArtifact) !== digestCanonicalJson(projection)) throw new Error("VERIFICATION_CLAIMS_PROJECTION_ADMISSION_MISMATCH");
      admitted.add(`${capture.captureId}:${capture.contentArtifact.artifactId}:${capture.contentArtifact.digest}:${projection.artifactId}:${projection.digest}`);
    }
    return (binding: { captureId: string; sourceArtifact: VerificationArtifactHandle; projectionArtifact: VerificationArtifactHandle }) => admitted.has(`${binding.captureId}:${binding.sourceArtifact.artifactId}:${binding.sourceArtifact.digest}:${binding.projectionArtifact.artifactId}:${binding.projectionArtifact.digest}`);
  }
  async #hydrateExact(tenantId: string, expected: { readonly artifactId: string; readonly digest: string }) {
    await this.dependencies.artifactResolver.authorizeArtifact({ tenantId, artifactId: expected.artifactId, purpose: "verification_admission" });
    const hydrated = await this.dependencies.artifactResolver.hydrateRegisteredArtifact({ tenantId, artifactId: expected.artifactId });
    const registration = VerificationArtifactHandleSchema.parse(hydrated.registration);
    if (registration.tenantId !== tenantId || registration.artifactId !== expected.artifactId || registration.digest !== expected.digest || registration.byteLength !== hydrated.bytes.byteLength || sha256Digest(hydrated.bytes) !== registration.digest || digestCanonicalJson(registration) !== digestCanonicalJson(hydrated.registration)) throw new Error("VERIFICATION_CLAIMS_ARTIFACT_REGISTRATION_MISMATCH");
    return { registration, bytes: hydrated.bytes };
  }
}
