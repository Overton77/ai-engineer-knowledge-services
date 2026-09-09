import { OperationContextSchema, SemanticJudgeIdentitySchema, VerificationArtifactHandleSchema, VerifyReportRequestSchema, type OperationContext, type SemanticAssessmentRecord, type SemanticJudgeIdentity, type VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, digestCanonicalJson, prepareGatewaySemanticRequest, sha256Digest, verifySemanticCase, type AuthorizedSemanticCase, type SemanticJudgeAdapter, type TrustedArtifactResolver } from "@aiengineer/knowledge-verification";
import { VerificationClaimsApplicationService, type ReportVerificationResult, type VerificationClaimsServiceDependencies } from "./verification-claims.js";
import { replayCapturedSemanticAssessment } from "./verification-semantic-replay.js";

type Digest = `sha256:${string}`;
const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const same = (a: unknown, b: unknown) => canonicalizeJson(a) === canonicalizeJson(b);
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export interface DiagnosticsReportSemanticSourceBinding {
  readonly reportId: string; readonly assertionId: string; readonly fragmentId: string; readonly captureId: string;
  readonly sourceKey: string; readonly sourceClass: "first_party" | "first_party_marketing" | "publication" | "interested_party_comparison";
  readonly sourceUri: string; readonly sourceArtifact: VerificationArtifactHandle; readonly projectionArtifact: VerificationArtifactHandle;
  readonly transformationArtifactId: string; readonly selector: unknown; readonly selectedContentDigest: Digest;
  readonly rights: string; readonly goldStatus: "not_labeled";
}

export interface DiagnosticsGeneratedReportSemanticPlanEntry {
  readonly entryDigest: Digest; readonly reportId: string; readonly assertionId: string; readonly ordinal: number;
  readonly reportArtifact: VerificationArtifactHandle; readonly claimLedgerArtifact: VerificationArtifactHandle;
  readonly sourceBinding: DiagnosticsReportSemanticSourceBinding; readonly semanticCaseDigest: Digest;
  readonly inputArtifactDigest: Digest; readonly expectedRequestDigest: Digest; readonly requestBytes: number; readonly contentCharacters: number;
  readonly baseDeterministicDigest: Digest; readonly finalDeterministicDigest: Digest;
  readonly blindedInput: { readonly rubricVersion: "evidence-only.v1"; readonly assertionId: string; readonly proposition: string; readonly qualifiers: readonly string[]; readonly entityBindings: readonly { readonly role: string; readonly canonicalId: string }[]; readonly fragments: readonly { readonly fragmentId: string; readonly exactText: string }[] };
}

export interface DiagnosticsGeneratedReportSemanticPlan {
  readonly schemaVersion: "diagnostics-generated-report-semantic-plan.v1"; readonly planDigest: Digest;
  readonly labelBoundary: "engineering_expectations_only"; readonly diagnosticOnly: true; readonly datasetManifestDigest: Digest; readonly runManifestDigest: Digest; readonly contextDigest: Digest;
  readonly judgeIdentity: SemanticJudgeIdentity; readonly localLedgerHandles: readonly VerificationArtifactHandle[]; readonly reportHandles: readonly VerificationArtifactHandle[];
  readonly entries: readonly DiagnosticsGeneratedReportSemanticPlanEntry[];
  readonly limits: { readonly maximumCalls: number; readonly maximumCostMicros: number; readonly reservationMicrosPerCall: number; readonly maximumInputCharacters: 2_000; readonly maximumRequestBytes: 10_000; readonly maximumOutputTokens: 900; readonly concurrency: 1; readonly automaticRetries: 0; readonly stopAfterConsecutiveFailures: 3 };
  readonly dispatchAuthorized: false; readonly externalRequests: 0;
}

export interface PreparedDiagnosticsGeneratedReportSemantics { readonly plan: DiagnosticsGeneratedReportSemanticPlan; }
type RuntimeEntry = { semanticCase: AuthorizedSemanticCase; planEntry: DiagnosticsGeneratedReportSemanticPlanEntry };
const preparedRuntime = new WeakMap<object, { context: OperationContext; entries: readonly RuntimeEntry[]; dispatchStarted: boolean }>();

/** Trusted engineering composition, not an HTTP admission endpoint. The caller must
 * authenticate source metadata against its sealed catalog and capture registry.
 * Provider wires are derived only from service-branded diagnostic cases. */
export async function prepareDiagnosticsGeneratedReportSemantics(input: {
  readonly context: OperationContext; readonly datasetManifestDigest: Digest; readonly runManifestDigest: Digest;
  readonly reports: readonly { readonly reportId: string; readonly request: unknown; readonly expectedReportArtifact: VerificationArtifactHandle; readonly expectedClaimLedgerArtifact: VerificationArtifactHandle }[];
  readonly createDependencies: () => VerificationClaimsServiceDependencies | Promise<VerificationClaimsServiceDependencies>;
  readonly sourceBindings: readonly DiagnosticsReportSemanticSourceBinding[]; readonly localLedgerHandles: readonly VerificationArtifactHandle[]; readonly reportHandles: readonly VerificationArtifactHandle[];
  readonly judgeIdentity: SemanticJudgeIdentity; readonly maximumCostMicros: number; readonly reservationMicrosPerCall: number;
}): Promise<PreparedDiagnosticsGeneratedReportSemantics> {
  const context = OperationContextSchema.parse(input.context), identity = SemanticJudgeIdentitySchema.parse(input.judgeIdentity);
  if (identity.provider !== "vercel-ai-gateway" || identity.model !== "openai/gpt-5.6-luna" || identity.family !== "openai" || identity.capability !== "llm_evidence_rubric") throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_JUDGE_INVALID");
  if (!digestPattern.test(input.datasetManifestDigest) || !digestPattern.test(input.runManifestDigest) || input.reports.length !== 3 || new Set(input.reports.map(item => item.reportId)).size !== 3) throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_SCOPE_INVALID");
  const localLedgerHandles = input.localLedgerHandles.map(value => VerificationArtifactHandleSchema.parse(value));
  const reportHandles = input.reportHandles.map(value => VerificationArtifactHandleSchema.parse(value));
  if (localLedgerHandles.length !== 43 || reportHandles.length !== 3 || new Set([...localLedgerHandles, ...reportHandles].map(item => item.artifactId)).size !== 46) throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_LOCAL_CLOSURE_INVALID");
  if ([...localLedgerHandles, ...reportHandles].some(item => item.tenantId !== context.tenantId)
    || input.reports.some(item => !localLedgerHandles.some(handle => same(handle, item.expectedClaimLedgerArtifact)) || !reportHandles.some(handle => same(handle, item.expectedReportArtifact)))) throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_LOCAL_CLOSURE_INVALID");
  const sourceBindings = new Map(input.sourceBindings.map(binding => [`${binding.reportId}\u0000${binding.assertionId}\u0000${binding.fragmentId}`, structuredClone(binding)]));
  if (sourceBindings.size !== input.sourceBindings.length) throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_SOURCE_BINDING_DUPLICATE");
  const runtimeEntries: RuntimeEntry[] = [], entries: DiagnosticsGeneratedReportSemanticPlanEntry[] = [];
  for (const descriptor of input.reports) {
    const request = VerifyReportRequestSchema.parse(descriptor.request), service = new VerificationClaimsApplicationService(await input.createDependencies());
    const result: ReportVerificationResult = await service.verifyReport(request, context);
    if (!same(result.reportArtifact, descriptor.expectedReportArtifact) || !same(result.claimLedgerArtifact, descriptor.expectedClaimLedgerArtifact)) throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_ARTIFACT_DRIFT");
    const cases = service.prepareReportDiagnosticSemanticCases(result, context);
    for (const [ordinal, diagnostic] of cases.entries()) {
      const semanticCase = diagnostic.semanticCase;
      if (semanticCase.fragments.length !== 1) throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_FRAGMENT_COUNT_INVALID");
      const fragment = semanticCase.fragments[0]!, sourceBinding = sourceBindings.get(`${descriptor.reportId}\u0000${semanticCase.assertionId}\u0000${fragment.fragmentId}`);
      if (!sourceBinding || sourceBinding.sourceArtifact.tenantId !== context.tenantId || sourceBinding.projectionArtifact.tenantId !== context.tenantId || sourceBinding.selectedContentDigest !== fragment.selectedContentDigest || sha256Digest(fragment.exactText) !== sourceBinding.selectedContentDigest || sourceBinding.goldStatus !== "not_labeled" || !sourceBinding.rights) throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_SOURCE_BINDING_INVALID");
      const blindedInput = { rubricVersion: "evidence-only.v1" as const, assertionId: semanticCase.assertionId, proposition: semanticCase.proposition, qualifiers: [...semanticCase.qualifiers], entityBindings: semanticCase.entityBindings.map(item => ({ ...item })), fragments: [{ fragmentId: fragment.fragmentId, exactText: fragment.exactText }] };
      const contentCharacters = blindedInput.proposition.length + fragment.exactText.length;
      if (contentCharacters > 2_000) throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_CONTENT_LIMIT");
      const inputArtifactDigest = digestCanonicalJson(blindedInput), requestWire = prepareGatewaySemanticRequest({ ...blindedInput, inputArtifactDigest }, identity.model, 2_000);
      if (requestWire.requestBytes.byteLength > 10_000) throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_REQUEST_LIMIT");
      const material = { reportId: descriptor.reportId, assertionId: semanticCase.assertionId, ordinal, reportArtifact: result.reportArtifact, claimLedgerArtifact: result.claimLedgerArtifact, sourceBinding, semanticCaseDigest: digestCanonicalJson({ ...blindedInput, riskClass: semanticCase.riskClass, downstreamUse: semanticCase.downstreamUse }), inputArtifactDigest, expectedRequestDigest: requestWire.requestDigest, requestBytes: requestWire.requestBytes.byteLength, contentCharacters, baseDeterministicDigest: diagnostic.baseDeterministicDigest as Digest, finalDeterministicDigest: diagnostic.finalDeterministicDigest as Digest, blindedInput };
      const planEntry = structuredClone({ entryDigest: digestCanonicalJson(material), ...material }) as DiagnosticsGeneratedReportSemanticPlanEntry;
      entries.push(planEntry); runtimeEntries.push({ semanticCase, planEntry });
    }
  }
  if (entries.length < 1 || entries.length > 30 || sourceBindings.size !== entries.length || !Number.isSafeInteger(input.maximumCostMicros) || input.maximumCostMicros < 1 || input.maximumCostMicros > 200_000 || !Number.isSafeInteger(input.reservationMicrosPerCall) || input.reservationMicrosPerCall < 1 || input.reservationMicrosPerCall > 5_000 || input.reservationMicrosPerCall * entries.length > input.maximumCostMicros) throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_LIMIT_INVALID");
  const material = { schemaVersion: "diagnostics-generated-report-semantic-plan.v1" as const, labelBoundary: "engineering_expectations_only" as const, diagnosticOnly: true as const, datasetManifestDigest: input.datasetManifestDigest, runManifestDigest: input.runManifestDigest, contextDigest: digestCanonicalJson(context), judgeIdentity: identity, localLedgerHandles, reportHandles, entries, limits: { maximumCalls: entries.length, maximumCostMicros: input.maximumCostMicros, reservationMicrosPerCall: input.reservationMicrosPerCall, maximumInputCharacters: 2_000 as const, maximumRequestBytes: 10_000 as const, maximumOutputTokens: 900 as const, concurrency: 1 as const, automaticRetries: 0 as const, stopAfterConsecutiveFailures: 3 as const }, dispatchAuthorized: false as const, externalRequests: 0 as const };
  const plan = structuredClone({ ...material, planDigest: digestCanonicalJson(material) }) as DiagnosticsGeneratedReportSemanticPlan;
  const prepared = Object.freeze({ plan: deepFreeze(plan) }); preparedRuntime.set(prepared, { context, entries: runtimeEntries.map(item => ({ semanticCase: item.semanticCase, planEntry: deepFreeze(item.planEntry) })), dispatchStarted: false }); return prepared;
}

export interface DiagnosticsGeneratedReportSemanticDispatchGrant {
  readonly schemaVersion: "diagnostics-generated-report-semantic-dispatch-grant.v1"; readonly planDigest: Digest; readonly entryDigests: readonly Digest[];
  readonly model: "openai/gpt-5.6-luna"; readonly maximumCalls: number; readonly maximumCostMicros: number; readonly reservationMicrosPerCall: number;
  readonly concurrency: 1; readonly automaticRetries: 0; readonly stopAfterConsecutiveFailures: 3; readonly dispatchAuthorized: true;
}

/** Executes serially after an exact external grant; every attempted call is journaled first. */
export async function executeDiagnosticsGeneratedReportSemantics(input: {
  readonly prepared: PreparedDiagnosticsGeneratedReportSemantics; readonly grant: DiagnosticsGeneratedReportSemanticDispatchGrant;
  readonly beforeDispatch: (entry: DiagnosticsGeneratedReportSemanticPlanEntry) => Promise<void>;
  readonly afterAssessment?: (entry: DiagnosticsGeneratedReportSemanticPlanEntry, result: { readonly entryDigest: Digest; readonly assessment?: SemanticAssessmentRecord; readonly failure?: string }) => Promise<void>;
  readonly createAdapter: (entry: DiagnosticsGeneratedReportSemanticPlanEntry) => Promise<SemanticJudgeAdapter>; readonly deadlineEpochMs: () => number;
}) {
  const runtime = preparedRuntime.get(input.prepared), plan = input.prepared.plan, grant = input.grant;
  if (!runtime || runtime.dispatchStarted || grant.schemaVersion !== "diagnostics-generated-report-semantic-dispatch-grant.v1" || !grant.dispatchAuthorized || grant.planDigest !== plan.planDigest || grant.model !== plan.judgeIdentity.model || grant.maximumCalls !== plan.entries.length || grant.maximumCostMicros !== plan.limits.maximumCostMicros || grant.reservationMicrosPerCall !== plan.limits.reservationMicrosPerCall || grant.concurrency !== 1 || grant.automaticRetries !== 0 || grant.stopAfterConsecutiveFailures !== 3 || !same(grant.entryDigests, plan.entries.map(item => item.entryDigest))) throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_DISPATCH_NOT_AUTHORIZED");
  // Claim the budget before the first await, including concurrent attempts.
  runtime.dispatchStarted = true;
  const results: { entryDigest: Digest; assessment?: SemanticAssessmentRecord; failure?: string }[] = []; let consecutiveFailures = 0;
  for (const item of runtime.entries) {
    if (consecutiveFailures >= 3) break;
    await input.beforeDispatch(item.planEntry);
    try {
      const adapter = await input.createAdapter(item.planEntry);
      if (!same(adapter.identity, plan.judgeIdentity) || adapter.maximumInputCharacters !== 2_000 || (adapter.toolCatalog?.length ?? 0) !== 0) throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_ADAPTER_DRIFT");
      results.push({ entryDigest: item.planEntry.entryDigest, assessment: await verifySemanticCase(item.semanticCase, { primary: adapter }, { deadlineEpochMs: input.deadlineEpochMs() }) }); consecutiveFailures = 0;
    } catch (error) { results.push({ entryDigest: item.planEntry.entryDigest, failure: error instanceof Error ? error.message : "unknown" }); consecutiveFailures += 1; }
    // Persistence failure stops the run; it must not become another provider retry.
    if (input.afterAssessment) await input.afterAssessment(item.planEntry, structuredClone(results[results.length - 1]!));
  }
  return Object.freeze({ results, attempted: results.length, completed: results.filter(item => item.assessment).length, failed: results.filter(item => item.failure).length, stoppedAfterConsecutiveFailures: consecutiveFailures >= 3 });
}

/** Replays only observations captured for this exact plan and returns zero external requests. */
export async function replayDiagnosticsGeneratedReportSemantics(input: {
  readonly prepared: PreparedDiagnosticsGeneratedReportSemantics; readonly planDigest: Digest;
  readonly entries: readonly { readonly entryDigest: Digest; readonly expectedAssessment: SemanticAssessmentRecord; readonly judges: Parameters<typeof replayCapturedSemanticAssessment>[0]["judges"] }[];
  readonly createResolver: () => TrustedArtifactResolver;
}) {
  const runtime = preparedRuntime.get(input.prepared), plan = input.prepared.plan;
  if (!runtime || input.planDigest !== plan.planDigest || input.entries.length !== plan.entries.length || new Set(input.entries.map(item => item.entryDigest)).size !== input.entries.length) throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_REPLAY_PLAN_MISMATCH");
  const cases = new Map(runtime.entries.map(item => [item.planEntry.entryDigest, item.semanticCase])), assessments: SemanticAssessmentRecord[] = [], artifacts = new Set<string>();
  for (const fixture of input.entries) {
    const semanticCase = cases.get(fixture.entryDigest); if (!semanticCase) throw new Error("DIAGNOSTICS_REPORT_SEMANTIC_REPLAY_ENTRY_MISMATCH");
    const result = await replayCapturedSemanticAssessment({ semanticCase, producerDeploymentId: "diagnostics-offline-author.v1", expectedAssessment: fixture.expectedAssessment, judges: fixture.judges, createResolver: input.createResolver });
    assessments.push(result.assessment); result.replayedArtifactIds.forEach(id => artifacts.add(id));
  }
  return Object.freeze({ assessments, replayedArtifactIds: [...artifacts].sort(), externalRequests: 0 as const });
}
