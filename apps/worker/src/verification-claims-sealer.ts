import {
  VerificationArtifactHandleSchema,
  SemanticAssessmentRecordSchema,
  VerificationClaimsArtifactSchema,
  VerificationReportLedgerSchema,
  type OperationContext,
  type SemanticAssessmentRecord,
  type VerificationArtifactHandle,
  type VerificationBundle,
  type VerificationPolicyDecision,
  type VerificationRecordedPolicyInputs,
  type VerificationRunManifest,
} from "@aiengineer/knowledge-contracts";
import type { RuntimePrincipalBinding } from "@aiengineer/knowledge-verification";
import type { ClaimsVerificationResult, ReportVerificationResult, VerificationSealPolicyCatalog } from "@aiengineer/knowledge-application";
import { evaluateVerificationPolicy } from "@aiengineer/knowledge-policy";
import type { RegisterContentAddressedVerificationArtifactInput, VerificationRunLease } from "@aiengineer/knowledge-persistence";
import { deterministicUuid } from "@aiengineer/knowledge-runtime";
import {
  canonicalizeJson,
  applyReportWideMechanicalGates,
  digestCanonicalJson,
  sealAuditBundle,
  sha256Digest,
  verificationManifestDigest,
  type AuditBundleSigner,
  type VerificationAuditBundle,
} from "@aiengineer/knowledge-verification";
import type { VerificationMetricAuditSealerRepository, VerificationMetricAuditSealerRuntime } from "./verification-metric-sealer.js";
import type { ClaimsSourceAuthorityStage } from "./verification-claims-source-authority.js";

type Verified = ClaimsVerificationResult | ReportVerificationResult;
export interface ClaimsSealInput { readonly verified: Verified; readonly context: OperationContext; readonly claim: VerificationRunLease; readonly runtimeLease?: import("@aiengineer/knowledge-persistence").LeasedStep; readonly startedAt: string; }
export interface ClaimsSealResult { readonly runId: string; readonly manifestDigest: `sha256:${string}`; readonly policyOutcome: VerificationPolicyDecision["outcome"]; readonly manifestArtifact: VerificationArtifactHandle; }
export interface ClaimsSealer { seal(input: ClaimsSealInput): Promise<ClaimsSealResult>; }
export interface ClaimsSealerOptions {
  readonly repository: VerificationMetricAuditSealerRepository & {
    loadAuditBundleArtifactForOperationRecovery(input: { readonly tenantId: string; readonly runId: string; readonly operationId: string; readonly verifierAttemptId: string }): Promise<{ readonly auditBundle: VerificationAuditBundle; readonly manifestArtifact: VerificationArtifactHandle } | undefined>;
  };
  readonly policyCatalog: VerificationSealPolicyCatalog;
  readonly semanticStage?: {
    grade(input: ClaimsSealInput): Promise<{ readonly assessments: readonly SemanticAssessmentRecord[]; readonly evidenceArtifacts: readonly VerificationArtifactHandle[] }>;
  };
  readonly sourceAuthorityStage?: ClaimsSourceAuthorityStage;
  readonly storageBucket: string;
  readonly runtime: VerificationMetricAuditSealerRuntime;
  readonly signer?: AuditBundleSigner;
  readonly now?: () => string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const fail = (code: string): never => { throw new Error(code); };

function canonicalTime(value: string, code: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? fail(code) : parsed.toISOString();
}

function uniqueHandles(handles: readonly VerificationArtifactHandle[]): VerificationArtifactHandle[] {
  const result = new Map<string, VerificationArtifactHandle>();
  for (const raw of handles) {
    const handle = VerificationArtifactHandleSchema.parse(raw);
    const previous = result.get(handle.artifactId);
    if (previous && digestCanonicalJson(previous) !== digestCanonicalJson(handle)) fail("VERIFICATION_CLAIMS_SEAL_ARTIFACT_IDENTITY_CONFLICT");
    result.set(handle.artifactId, handle);
  }
  return [...result.values()].sort((left, right) => left.artifactId.localeCompare(right.artifactId));
}

function registerInput(options: ClaimsSealerOptions, input: {
  tenantId: string; producerAttemptId: string; missionId: string; bytes: Uint8Array; mediaType: string; createdAt: string;
  parents: readonly string[]; transformation: unknown; artifactType: string;
}): RegisterContentAddressedVerificationArtifactInput {
  return { tenantId: input.tenantId, producerAttemptId: input.producerAttemptId, missionId: input.missionId, bytes: input.bytes,
    mediaType: input.mediaType, createdAt: input.createdAt, producerActivityId: "verification-worker:sealClaimsAudit",
    producerVersion: "verification-claims-sealer.v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit",
    dataClassification: "restricted", parentArtifactIds: [...new Set(input.parents)].sort(), transformationSignature: digestCanonicalJson(input.transformation),
    artifactType: input.artifactType, bucketClass: "ledger", storageBucket: options.storageBucket };
}

function claimScope(claimType: VerificationBundle["assertions"][number]["claimType"]): VerificationRecordedPolicyInputs["assertions"][number]["claimScope"] {
  if (claimType === "causal") return "causal";
  if (claimType === "comparative") return "comparative_superiority";
  if (claimType === "methodological") return "method_validation";
  return "descriptive_fact";
}

function pendingSemantic(assertionId: string, failed: boolean): SemanticAssessmentRecord {
  return {
    assertionId, verdict: failed ? "unverifiable" : "pending_semantic_review", disposition: failed ? "fail" : "review",
    evidenceSupport: "not_assessed", worldCorrectness: "not_assessed", attributionFaithfulness: "not_assessed",
    sourceAuthority: "not_assessed", provenanceIntegrity: "not_assessed", judgeIdentities: [], supportingFragmentIds: [],
    contradictingFragmentIds: [], unsupportedFacets: ["semantic_support", "source_authority"],
    reasonCodes: [failed ? "MECHANICAL_FAILURE" : "DETERMINISTIC_ONLY"], crossFamilySecondJudge: false, rawProviderConfidences: [],
  };
}

function statusFor(outcome: VerificationPolicyDecision["outcome"]): "succeeded" | "failed" | "review" | "abstained" {
  return outcome === "fail" ? "failed" : outcome === "review" ? "review" : outcome === "abstain" ? "abstained" : "succeeded";
}

function runtimePrincipalBindingBody(input: { readonly verified: Verified; readonly context: OperationContext; readonly claim: VerificationRunLease; readonly assertionsArtifact: VerificationArtifactHandle; readonly bundle: VerificationBundle }) {
  const runtime = input.verified.runtimePrincipals;
  const digest = (value: unknown) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
  if (runtime?.basis !== "runtime_principal_binding" || typeof runtime.producerDeploymentId !== "string" || runtime.producerDeploymentId.length === 0
    || typeof runtime.verifierDeploymentId !== "string" || runtime.verifierDeploymentId.length === 0
    || !digest(runtime.producerPrincipalDigest) || !digest(runtime.verifierPrincipalDigest)
    || input.verified.deterministicResult.deploymentSeparation.basis !== "runtime_principal_binding"
    || input.verified.deterministicResult.deploymentSeparation.producerDeploymentId !== runtime.producerDeploymentId
    || input.verified.deterministicResult.deploymentSeparation.verifierDeploymentId !== runtime.verifierDeploymentId
    || input.verified.producerAttemptId !== input.bundle.producer.attemptId) fail("VERIFICATION_CLAIMS_SEAL_RUNTIME_PRINCIPAL_BINDING_INVALID");
  return Object.freeze({ schemaVersion: "verification-runtime-principal-binding.v1" as const, tenantId: input.context.tenantId,
    operationId: input.context.operationId, operationStepId: input.claim.stepId, producerAttemptId: input.verified.producerAttemptId,
    verifierAttemptId: input.context.attemptId, assertionsArtifact: input.assertionsArtifact,
    runtimePrincipals: Object.freeze({ basis: runtime.basis, producerDeploymentId: runtime.producerDeploymentId,
      verifierDeploymentId: runtime.verifierDeploymentId, producerPrincipalDigest: runtime.producerPrincipalDigest,
      verifierPrincipalDigest: runtime.verifierPrincipalDigest }) satisfies RuntimePrincipalBinding });
}

function edge(fromArtifactId: string, toArtifactId: string, ordinal: number, activityId = "verification-worker:sealClaimsAudit", activityVersion = "verification-claims-sealer.v1") {
  return { edgeId: deterministicUuid("verification-claims-seal-lineage", `${fromArtifactId}:${toArtifactId}:${ordinal}`), fromArtifactId, toArtifactId,
    relation: "generated" as const, activityId, activityVersion };
}

/** Native audit-bundle sealing for deterministic-only claims and report verification. */
export function createVerificationClaimsAuditSealer(options: ClaimsSealerOptions): ClaimsSealer {
  const now = options.now ?? (() => new Date().toISOString());
  return { async seal(input) {
    const { context, verified } = input;
    const missionId: string = context.missionId ?? fail("VERIFICATION_CLAIMS_SEAL_OPERATION_CONTEXT_REQUIRED");
    const workItemId: string = context.workItemId ?? fail("VERIFICATION_CLAIMS_SEAL_OPERATION_CONTEXT_REQUIRED");
    if (!verified.producerAttemptId) fail("VERIFICATION_CLAIMS_SEAL_PRODUCER_ATTEMPT_REQUIRED");
    const startedAt = canonicalTime(input.startedAt, "VERIFICATION_CLAIMS_SEAL_STARTED_AT_INVALID");
    const report = "reportArtifact" in verified;
    const assertionsHydrated = await hydrateExact(options, context.tenantId, verified.assertionsArtifact, "VERIFICATION_CLAIMS_SEAL_ASSERTIONS_MISMATCH");
    const bundle = report
      ? VerificationReportLedgerSchema.parse(decodeJson(assertionsHydrated.bytes, "VERIFICATION_REPORT_LEDGER_INVALID")).bundle
      : VerificationClaimsArtifactSchema.parse(decodeJson(assertionsHydrated.bytes, "VERIFICATION_CLAIMS_ARTIFACT_INVALID")).bundle;
    const deterministicResult = report ? applyReportWideMechanicalGates(verified.deterministicResult, verified.reportWide) : verified.deterministicResult;
    if (report) {
      const ledger = VerificationReportLedgerSchema.parse(decodeJson(assertionsHydrated.bytes, "VERIFICATION_REPORT_LEDGER_INVALID"));
      if (digestCanonicalJson(ledger.reportArtifact) !== digestCanonicalJson(verified.reportArtifact)) fail("VERIFICATION_CLAIMS_SEAL_REPORT_BINDING_MISMATCH");
      await hydrateExact(options, context.tenantId, verified.reportArtifact, "VERIFICATION_CLAIMS_SEAL_REPORT_MISMATCH");
    }
    const separation = verified.deterministicResult.deploymentSeparation;
    if (separation.verifierDeploymentId !== options.runtime.deploymentId) {
      fail("VERIFICATION_CLAIMS_SEAL_RUNTIME_IDENTITY_REQUIRED");
    }
    const policy = await options.policyCatalog.resolve({ tenantId: context.tenantId, policyVersion: bundle.policyVersion }, options.repository.createTrustedArtifactResolver());
    const sourceAuthority = options.sourceAuthorityStage ? await options.sourceAuthorityStage.assess({ tenantId: context.tenantId,
      bundle, policyArtifact: policy.artifact }) : undefined;
    const sourceAuthorityArtifacts = sourceAuthority ? await completeInputs(options, context.tenantId, sourceAuthority.evidenceArtifacts) : [];
    const runId = deterministicUuid(report ? "verification-report-run" : "verification-claims-run", context.operationId);
    const runtimePrincipalBinding = runtimePrincipalBindingBody({ verified, context, claim: input.claim, assertionsArtifact: assertionsHydrated.handle, bundle });
    const runtimePrincipalBindingBytes = encoder.encode(canonicalizeJson(runtimePrincipalBinding));
    const base = uniqueHandles([assertionsHydrated.handle, ...(report ? [verified.reportArtifact] : []), ...verified.sourceArtifacts, policy.artifact, ...sourceAuthorityArtifacts]);
    const inputsBase = await completeInputs(options, context.tenantId, base);
    const recovered = await options.repository.loadAuditBundleArtifactForOperationRecovery({ tenantId: context.tenantId, runId, operationId: context.operationId, verifierAttemptId: context.attemptId });
    if (recovered) return recover(recovered.auditBundle, recovered.manifestArtifact, { runId, bundle, verified, deterministicResult, policyArtifact: policy.artifact, required: inputsBase, runtimePrincipalBinding, runtimePrincipalBindingDigest: sha256Digest(runtimePrincipalBindingBytes) });

    const semanticAssessments = new Map<string, SemanticAssessmentRecord>();
    let semanticArtifacts: readonly VerificationArtifactHandle[] = [];
    if (options.semanticStage && deterministicResult.status === "passed" && deterministicResult.semanticEligibility) {
      const graded = await options.semanticStage.grade(input);
      for (const value of graded.assessments) {
        const assessment = SemanticAssessmentRecordSchema.parse(value);
        if (semanticAssessments.has(assessment.assertionId) || !bundle.assertions.some(assertion => assertion.assertionId === assessment.assertionId)) fail("VERIFICATION_CLAIMS_SEMANTIC_COVERAGE_MISMATCH");
        semanticAssessments.set(assessment.assertionId,assessment);
      }
      if (semanticAssessments.size !== bundle.assertions.length || (semanticAssessments.size > 0 && graded.evidenceArtifacts.length === 0)) fail("VERIFICATION_CLAIMS_SEMANTIC_COVERAGE_MISMATCH");
      semanticArtifacts = await completeInputs(options,context.tenantId,graded.evidenceArtifacts);
    }
    if (sourceAuthority) for (const [assertionId, semantic] of semanticAssessments) {
      if (semantic.judgeIdentities.length && !semanticArtifacts.some(artifact => artifact.digest === sourceAuthority.semanticProfileDigests.get(assertionId)))
        fail("SOURCE_AUTHORITY_SEMANTIC_PROFILE_MISMATCH");
    }
    const completedAt = canonicalTime(now(), "VERIFICATION_CLAIMS_SEAL_COMPLETED_AT_INVALID");
    if (Date.parse(completedAt) < Date.parse(startedAt)) fail("VERIFICATION_CLAIMS_SEAL_TIME_ORDER_INVALID");
    const runtimePrincipalBindingArtifact = await options.repository.registerContentAddressedArtifact(registerInput(options, { tenantId: context.tenantId,
      producerAttemptId: context.attemptId, missionId, bytes: runtimePrincipalBindingBytes, mediaType: "application/vnd.aiengineer.verification-runtime-principal-binding+json",
      createdAt: completedAt, parents: [assertionsHydrated.handle.artifactId], transformation: { kind: "verification_runtime_principal_binding.v1", tenantId: context.tenantId, operationId: context.operationId,
        operationStepId: input.claim.stepId, producerAttemptId: verified.producerAttemptId, verifierAttemptId: context.attemptId, assertionsArtifact: assertionsHydrated.handle, bindingDigest: sha256Digest(runtimePrincipalBindingBytes) }, artifactType: "verification_runtime_principal_binding" }));
    const bundleBytes = encoder.encode(canonicalizeJson(bundle));
    const bundleArtifact = await options.repository.registerContentAddressedArtifact(registerInput(options, { tenantId: context.tenantId,
      producerAttemptId: context.attemptId, missionId, bytes: bundleBytes, mediaType: "application/vnd.aiengineer.verification-bundle+json",
      createdAt: completedAt, parents: [assertionsHydrated.handle.artifactId], transformation: { kind: "verification_claims_bundle_projection.v1", sourceDigest: assertionsHydrated.handle.digest }, artifactType: "verification_bundle" }));
    const resultArtifact = await options.repository.registerContentAddressedArtifact(registerInput(options, { tenantId: context.tenantId,
      producerAttemptId: context.attemptId, missionId, bytes: encoder.encode(canonicalizeJson(deterministicResult)),
      mediaType: "application/vnd.aiengineer.deterministic-verification-result+json", createdAt: completedAt, parents: [bundleArtifact.artifactId],
      transformation: { kind: report ? "verification_report_deterministic_result.v1" : "verification_claims_deterministic_result.v1", bundleDigest: bundleArtifact.digest }, artifactType: "deterministic_verification_result" }));
    const reportGateArtifact = report ? await options.repository.registerContentAddressedArtifact(registerInput(options, { tenantId: context.tenantId,
      producerAttemptId: context.attemptId, missionId, bytes: encoder.encode(canonicalizeJson(reportGateBody(verified, resultArtifact.digest))),
      mediaType: "application/vnd.aiengineer.verification-report-result+json", createdAt: completedAt,
      parents: [resultArtifact.artifactId, verified.reportArtifact.artifactId, verified.claimLedgerArtifact.artifactId],
      transformation: { kind: "verification_report_wide_gate.v1", resultDigest: resultArtifact.digest, reportWideDigest: digestCanonicalJson(verified.reportWide) }, artifactType: "verification_report_result" })) : undefined;
    const recordedInputs: VerificationRecordedPolicyInputs = { schemaVersion: "verification-policy-inputs.v1", policyVersion: policy.definition.policyVersion,
      runId, recordedAt: completedAt, deterministicResult,
      assertions: bundle.assertions.map((assertion) => { const mechanical = deterministicResult.assertions.find((item) => item.assertionId === assertion.assertionId);
        return { assertionId: assertion.assertionId, riskClass: assertion.riskClass, downstreamUse: [...assertion.downstreamUse], claimScope: claimScope(assertion.claimType),
          semantic: semanticAssessments.get(assertion.assertionId) ?? pendingSemantic(assertion.assertionId, !mechanical || mechanical.status !== "passed" || !mechanical.semanticEligibility),
          ...(sourceAuthority?.assertions.get(assertion.assertionId) ?? { authorityStatus: "unknown" as const,
            independentCorroboration: false, conflictPresent: false, criticalFactsKnown: false }) }; }), metrics: [], sourceAssessments: sourceAuthority?.sourceAssessments ?? [] };
    const policyInputsBytes = encoder.encode(canonicalizeJson(recordedInputs));
    const policyInputsArtifact = await options.repository.registerContentAddressedArtifact(registerInput(options, { tenantId: context.tenantId,
      producerAttemptId: context.attemptId, missionId, bytes: policyInputsBytes, mediaType: "application/vnd.aiengineer.verification-policy-inputs+json",
      createdAt: completedAt, parents: [resultArtifact.artifactId,...semanticArtifacts.map(artifact => artifact.artifactId), ...sourceAuthorityArtifacts.map(artifact => artifact.artifactId)], transformation: { kind: "verification_claims_policy_inputs.v1", runId, resultDigest: resultArtifact.digest }, artifactType: "verification_policy_inputs" }));
    const decision = evaluateVerificationPolicy(policy.definition, recordedInputs);
    if (!sourceAuthority && (decision.outcome === "pass" || decision.outcome === "pass_with_warnings")) fail("VERIFICATION_CLAIMS_SEAL_POLICY_PASS_FORBIDDEN");
    const decisionArtifact = await options.repository.registerContentAddressedArtifact(registerInput(options, { tenantId: context.tenantId,
      producerAttemptId: context.attemptId, missionId, bytes: encoder.encode(canonicalizeJson(decision)), mediaType: "application/vnd.aiengineer.verification-policy-decision+json",
      createdAt: completedAt, parents: [resultArtifact.artifactId, policy.artifact.artifactId, policyInputsArtifact.artifactId],
      transformation: { kind: "verification_claims_policy_decision.v1", runId, policyVersion: decision.policyVersion, policyInputsDigest: policyInputsArtifact.digest }, artifactType: "verification_policy_decision" }));
    const inputArtifacts = uniqueHandles([...inputsBase, runtimePrincipalBindingArtifact, ...semanticArtifacts, ...sourceAuthorityArtifacts, policyInputsArtifact]);
    const outputArtifacts = uniqueHandles([bundleArtifact, resultArtifact, decisionArtifact, ...(reportGateArtifact ? [reportGateArtifact] : [])]);
    const indexed = [...inputArtifacts, ...outputArtifacts];
    const known = new Set(indexed.map((item) => item.artifactId));
    if (indexed.some((item) => item.parentArtifactIds.some((id) => !known.has(id)))) fail("VERIFICATION_CLAIMS_SEAL_LINEAGE_INCOMPLETE");
    const owned = new Set([bundleArtifact.artifactId, resultArtifact.artifactId, policyInputsArtifact.artifactId, decisionArtifact.artifactId]);
    const lineage = indexed.flatMap((artifact) => artifact.parentArtifactIds.map((parentId, ordinal) => owned.has(artifact.artifactId)
      ? edge(artifact.artifactId, parentId, ordinal) : edge(artifact.artifactId, parentId, ordinal, artifact.producerActivityId, artifact.producerVersion)));
    const manifest: VerificationRunManifest = { verificationContractVersion: "verification.v1", manifestId: deterministicUuid("verification-claims-manifest", runId), runId,
      versions: { policy: bundle.policyVersion, schema: "verification.v1", normalizer: options.runtime.code.normalizerVersion },
      code: { gitSha: options.runtime.code.gitSha, dirty: options.runtime.code.dirty }, runtime: { platform: options.runtime.platform, deploymentId: options.runtime.deploymentId },
      inputArtifacts, outputArtifacts, stages: [{ name: report ? "verify_report_and_seal" : "verify_claims_and_seal", status: "succeeded", startedAt, endedAt: completedAt }],
      calls: [], toolPolicy: [], networkPolicy: "allowlisted", deterministicResult, judgments: [], policyOutcome: decision.outcome,
      resultDigest: resultArtifact.digest, ...(reportGateArtifact ? { gateDigest: reportGateArtifact.digest } : {}), lineage,
      canonicalization: { algorithm: "RFC8785", implementationVersion: "knowledge-verification.v1", manifestDigest: sha256Digest("") }, startedAt, completedAt };
    manifest.canonicalization.manifestDigest = verificationManifestDigest(manifest);
    const audit = await sealAuditBundle({ tenantId: context.tenantId, verificationBundle: bundle, manifest,
      policyBinding: { policyVersion: policy.definition.policyVersion, policyArtifact: policy.artifact, recordedPolicyInputsArtifact: policyInputsArtifact },
      recordedPolicyInputsBytes: policyInputsBytes, policyDecision: decision, ...(options.signer ? { signer: options.signer } : {}) });
    const manifestArtifact = await options.repository.registerContentAddressedArtifact(registerInput(options, { tenantId: context.tenantId,
      producerAttemptId: context.attemptId, missionId, bytes: encoder.encode(canonicalizeJson(audit)), mediaType: "application/vnd.aiengineer.verification-run-manifest+json",
      createdAt: completedAt, parents: uniqueHandles([...inputArtifacts, ...outputArtifacts]).map((item) => item.artifactId),
      transformation: { kind: "verification_claims_audit_bundle.v1", runId, manifestDigest: manifest.canonicalization.manifestDigest }, artifactType: "verification_run_manifest" }));
    await options.repository.recordVerificationRun({ tenantId: context.tenantId, runId, producerAttemptId: verified.producerAttemptId,
      verifierAttemptId: context.attemptId, policyVersion: policy.definition.policyVersion, bundleArtifact, resultArtifact, policyArtifact: policy.artifact,
      manifestArtifact, startedAt, endedAt: completedAt, status: statusFor(decision.outcome), missionId, workItemId,
      operationId: context.operationId, lease: input.claim });
    return Object.freeze({ runId, manifestDigest: manifest.canonicalization.manifestDigest as `sha256:${string}`, policyOutcome: decision.outcome, manifestArtifact });
  } };
}

function decodeJson(bytes: Uint8Array, code: string): unknown {
  try { return JSON.parse(decoder.decode(bytes)); } catch { return fail(code); }
}

async function hydrateExact(options: ClaimsSealerOptions, tenantId: string, expected: VerificationArtifactHandle, code: string) {
  const resolver = options.repository.createTrustedArtifactResolver();
  await resolver.authorizeArtifact({ tenantId, artifactId: expected.artifactId, purpose: "verification_admission" });
  const hydrated = await resolver.hydrateRegisteredArtifact({ tenantId, artifactId: expected.artifactId });
  const handle = VerificationArtifactHandleSchema.parse(hydrated.registration);
  if (digestCanonicalJson(handle) !== digestCanonicalJson(expected) || handle.tenantId !== tenantId || hydrated.bytes.byteLength !== handle.byteLength || sha256Digest(hydrated.bytes) !== handle.digest) fail(code);
  return { handle, bytes: hydrated.bytes };
}

async function completeInputs(options: ClaimsSealerOptions, tenantId: string, initial: readonly VerificationArtifactHandle[]): Promise<VerificationArtifactHandle[]> {
  const handles = new Map(uniqueHandles(initial).map((item) => [item.artifactId, item]));
  const pending = [...handles.keys()]; const visited = new Set<string>(); let bytes = 0;
  const resolver = options.repository.createTrustedArtifactResolver();
  while (pending.length) {
    const artifactId = pending.shift()!;
    if (visited.has(artifactId)) continue;
    if (visited.size >= 256 || pending.length > 4096) fail("VERIFICATION_CLAIMS_SEAL_PROVENANCE_LIMIT");
    await resolver.authorizeArtifact({ tenantId, artifactId, purpose: "verification_admission" });
    const hydrated = await resolver.hydrateRegisteredArtifact({ tenantId, artifactId });
    const handle = VerificationArtifactHandleSchema.parse(hydrated.registration);
    bytes += hydrated.bytes.byteLength;
    if (bytes > 32_000_000 || handle.tenantId !== tenantId || handle.artifactId !== artifactId || handle.byteLength !== hydrated.bytes.byteLength || handle.digest !== sha256Digest(hydrated.bytes)) fail("VERIFICATION_CLAIMS_SEAL_PROVENANCE_IDENTITY_MISMATCH");
    const expected = handles.get(artifactId);
    if (expected && digestCanonicalJson(expected) !== digestCanonicalJson(handle)) fail("VERIFICATION_CLAIMS_SEAL_PROVENANCE_IDENTITY_MISMATCH");
    handles.set(artifactId, handle); visited.add(artifactId); pending.push(...handle.parentArtifactIds);
  }
  return uniqueHandles([...handles.values()]);
}

function reportGateBody(verified: ReportVerificationResult, deterministicResultDigest: string) {
  return { schemaVersion: "verification-report-result.v1" as const, coverageScope: verified.coverageScope, deterministicResultDigest, reportWide: verified.reportWide };
}

function recover(recovered: VerificationAuditBundle, manifestArtifact: VerificationArtifactHandle, input: { runId: string; bundle: VerificationBundle; verified: Verified; deterministicResult: Verified["deterministicResult"]; policyArtifact: VerificationArtifactHandle; required: readonly VerificationArtifactHandle[]; runtimePrincipalBinding: ReturnType<typeof runtimePrincipalBindingBody>; runtimePrincipalBindingDigest: `sha256:${string}` }): ClaimsSealResult {
  const manifest = recovered.manifest; const artifacts = [...manifest.inputArtifacts, ...manifest.outputArtifacts];
  const includes = (expected: VerificationArtifactHandle) => artifacts.some((item) => digestCanonicalJson(item) === digestCanonicalJson(expected));
  const retainedRuntimeBindings = manifest.inputArtifacts.filter((item) => item.mediaType === "application/vnd.aiengineer.verification-runtime-principal-binding+json");
  const runtimeBindingMatches = retainedRuntimeBindings.length === 0 || (retainedRuntimeBindings.length === 1
    && retainedRuntimeBindings[0]!.tenantId === recovered.tenantId && retainedRuntimeBindings[0]!.digest === input.runtimePrincipalBindingDigest
    && retainedRuntimeBindings[0]!.parentArtifactIds.length === 1 && retainedRuntimeBindings[0]!.parentArtifactIds[0] === input.verified.assertionsArtifact.artifactId);
  const expectedResultDigest = digestCanonicalJson(input.deterministicResult);
  const expectedGateDigest = "reportArtifact" in input.verified ? digestCanonicalJson(reportGateBody(input.verified, expectedResultDigest)) : undefined;
  if (recovered.tenantId !== input.verified.assertionsArtifact.tenantId || manifest.runId !== input.runId
    || digestCanonicalJson(recovered.verificationBundle) !== digestCanonicalJson(input.bundle)
    || recovered.deterministicResultDigest !== expectedResultDigest
    || manifest.resultDigest !== expectedResultDigest
    || manifestArtifact.tenantId !== recovered.tenantId
    || (("reportArtifact" in input.verified) && (manifest.gateDigest !== expectedGateDigest || !manifest.outputArtifacts.some((item) => item.digest === expectedGateDigest)))
    || (!("reportArtifact" in input.verified) && manifest.gateDigest !== undefined)
    || recovered.policyBinding.policyVersion !== input.bundle.policyVersion || manifest.versions.policy !== input.bundle.policyVersion
    || digestCanonicalJson(recovered.policyBinding.policyArtifact) !== digestCanonicalJson(input.policyArtifact)
    || !runtimeBindingMatches
    || input.required.some((item) => !includes(item))) fail("VERIFICATION_CLAIMS_SEAL_RECOVERY_DRIFT");
  return Object.freeze({ runId: input.runId, manifestDigest: manifest.canonicalization.manifestDigest as `sha256:${string}`, policyOutcome: manifest.policyOutcome, manifestArtifact });
}


