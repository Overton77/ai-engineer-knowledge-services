import type {
  OperationContext,
  VerificationArtifactHandle,
  VerificationBundle,
  VerificationPolicyDecision,
  VerificationRecordedPolicyInputs,
  VerificationRunManifest,
} from "@aiengineer/knowledge-contracts";
import { VerificationArtifactHandleSchema, VerificationBundleSchema } from "@aiengineer/knowledge-contracts";
import type { VerificationMetricServiceResult, VerificationSealPolicyCatalog } from "@aiengineer/knowledge-application";
import { VerificationMetricProfileSchema } from "@aiengineer/knowledge-application";
import { evaluateVerificationPolicy } from "@aiengineer/knowledge-policy";
import type { RegisterContentAddressedVerificationArtifactInput, VerificationRunLease } from "@aiengineer/knowledge-persistence";
import { deterministicUuid } from "@aiengineer/knowledge-runtime";
import {
  canonicalizeJson,
  digestCanonicalJson,
  sealAuditBundle,
  sha256Digest,
  verificationManifestDigest,
  type TrustedArtifactResolver,
  type VerificationAuditBundle,
} from "@aiengineer/knowledge-verification";

export interface VerificationMetricAuditSealerRepository {
  createTrustedArtifactResolver(): TrustedArtifactResolver;
  registerContentAddressedArtifact(input: RegisterContentAddressedVerificationArtifactInput): Promise<VerificationArtifactHandle>;
  recordVerificationRun(input: {
    readonly tenantId: string;
    readonly runId: string;
    readonly producerAttemptId: string;
    readonly verifierAttemptId: string;
    readonly policyVersion: string;
    readonly bundleArtifact: VerificationArtifactHandle;
    readonly resultArtifact: VerificationArtifactHandle;
    readonly policyArtifact: VerificationArtifactHandle;
    readonly manifestArtifact: VerificationArtifactHandle;
    readonly startedAt: string;
    readonly endedAt: string;
    readonly status: "succeeded" | "failed" | "review" | "abstained";
    readonly missionId: string;
    readonly workItemId: string;
    readonly operationId: string;
    readonly lease: VerificationRunLease;
  }): Promise<void>;
  loadAuditBundleForOperationRecovery(input: {
    readonly tenantId: string;
    readonly runId: string;
    readonly operationId: string;
    readonly verifierAttemptId: string;
  }): Promise<VerificationAuditBundle | undefined>;
}

export interface VerificationMetricAuditSealerRuntime {
  readonly code: {
    readonly gitSha: string;
    readonly dirty: boolean;
    readonly normalizerVersion: string;
  };
  readonly platform: string;
  /** Trusted worker deployment identity, never a caller or bundle field. */
  readonly deploymentId: string;
}

export interface CreateVerificationMetricAuditSealerInput {
  readonly repository: VerificationMetricAuditSealerRepository;
  readonly policyCatalog: VerificationSealPolicyCatalog;
  readonly storageBucket: string;
  readonly runtime: VerificationMetricAuditSealerRuntime;
  readonly now?: () => string;
}

export interface VerificationMetricAuditSealInput {
  readonly verified: VerificationMetricServiceResult;
  readonly context: OperationContext;
  readonly lease: VerificationRunLease;
  /** Captured by the activity before verification; retries reuse a sealed value. */
  readonly startedAt: string;
}

export interface VerificationMetricAuditSealResult {
  readonly runId: string;
  readonly manifestDigest: string;
  readonly policyOutcome: string;
}

/** Stable public codes keep sealing failures distinct from metric mechanics. */
export class VerificationMetricSealingError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "VerificationMetricSealingError";
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function fail(code: string): never { throw new VerificationMetricSealingError(code); }

function canonicalTime(value: string, code: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return fail(code);
  return parsed.toISOString();
}

function exactHandle(expected: VerificationArtifactHandle, actual: unknown, bytes: Uint8Array, code: string): VerificationArtifactHandle {
  const handle = VerificationArtifactHandleSchema.parse(actual);
  if (handle.tenantId !== expected.tenantId || handle.artifactId !== expected.artifactId
    || handle.digest !== expected.digest || handle.byteLength !== expected.byteLength
    || sha256Digest(bytes) !== expected.digest || bytes.byteLength !== expected.byteLength) fail(code);
  return handle;
}

function decodeBundle(bytes: Uint8Array): VerificationBundle {
  let raw: unknown;
  try { raw = JSON.parse(decoder.decode(bytes)); } catch { return fail("VERIFICATION_METRIC_SEAL_OBSERVATIONS_INVALID"); }
  // The union schema intentionally has no empty form. Call it out explicitly
  // because an empty metric set would otherwise evaluate to a misleading pass.
  if (raw && typeof raw === "object" && Array.isArray((raw as { metricObservations?: unknown }).metricObservations)
    && (raw as { metricObservations: unknown[] }).metricObservations.length === 0) {
    return fail("VERIFICATION_METRIC_SEAL_METRICS_REQUIRED");
  }
  try { return VerificationBundleSchema.parse(raw); }
  catch { return fail("VERIFICATION_METRIC_SEAL_OBSERVATIONS_INVALID"); }
}

function uniqueHandles(handles: readonly VerificationArtifactHandle[]): VerificationArtifactHandle[] {
  const result = new Map<string, VerificationArtifactHandle>();
  for (const handle of handles) {
    const previous = result.get(handle.artifactId);
    if (previous && digestCanonicalJson(previous) !== digestCanonicalJson(handle)) fail("VERIFICATION_METRIC_SEAL_ARTIFACT_IDENTITY_CONFLICT");
    result.set(handle.artifactId, handle);
  }
  return [...result.values()].sort((left, right) => left.artifactId.localeCompare(right.artifactId));
}

function edge(fromArtifactId: string, toArtifactId: string, ordinal: number, activityId = "verification-worker:sealMetricAudit", activityVersion = "verification-metric-sealer.v1") {
  return {
    edgeId: deterministicUuid("verification-metric-seal-lineage", `${fromArtifactId}:${toArtifactId}:${ordinal}`),
    fromArtifactId,
    toArtifactId,
    relation: "generated" as const,
    activityId,
    activityVersion,
  };
}

function registeredArtifactInput(input: {
  tenantId: string;
  bytes: Uint8Array;
  mediaType: string;
  createdAt: string;
  producerAttemptId: string;
  missionId: string;
  parentArtifactIds: readonly string[];
  transformation: unknown;
  artifactType: string;
  storageBucket: string;
}): RegisterContentAddressedVerificationArtifactInput {
  return {
    tenantId: input.tenantId,
    bytes: input.bytes,
    mediaType: input.mediaType,
    createdAt: input.createdAt,
    producerActivityId: "verification-worker:sealMetricAudit",
    producerVersion: "verification-metric-sealer.v1",
    encryptionClass: "supabase-managed",
    retentionClass: "verification-audit",
    dataClassification: "restricted",
    parentArtifactIds: [...input.parentArtifactIds].sort(),
    transformationSignature: digestCanonicalJson(input.transformation),
    artifactType: input.artifactType,
    bucketClass: "ledger",
    storageBucket: input.storageBucket,
    producerAttemptId: input.producerAttemptId,
    missionId: input.missionId,
  };
}

function assertRuntimeBinding(runtime: VerificationMetricAuditSealerRuntime, bundle: VerificationBundle, verified: VerificationMetricServiceResult): void {
  const separation = verified.deterministicResult.deploymentSeparation;
  if (separation.status !== "established") fail("VERIFICATION_METRIC_SEALING_INELIGIBLE_DEPLOYMENT");
  if (runtime.deploymentId !== separation.verifierDeploymentId || runtime.deploymentId !== bundle.verifier.deploymentId) {
    fail("VERIFICATION_METRIC_SEAL_RUNTIME_DEPLOYMENT_MISMATCH");
  }
}

function assertMetricOnly(bundle: VerificationBundle): void {
  if (bundle.metricObservations.length === 0) fail("VERIFICATION_METRIC_SEAL_METRICS_REQUIRED");
  if (bundle.assertions.length !== 0) fail("VERIFICATION_METRIC_SEAL_ASSERTIONS_FORBIDDEN");
}

function runStatusForPolicy(outcome: VerificationPolicyDecision["outcome"]): "succeeded" | "failed" | "review" | "abstained" {
  if (outcome === "fail") return "failed";
  if (outcome === "review") return "review";
  if (outcome === "abstain") return "abstained";
  return "succeeded";
}

/**
 * Seals a mechanically verified metric bundle without creating a policy pass.
 * Metric inputs deliberately mark critical facts unknown because this path has
 * no semantic authority or source-policy assessment. Policy configuration then
 * chooses review, abstention, or failure for a mechanically passing result.
 */
export class VerificationMetricAuditSealer {
  readonly #now: () => string;

  constructor(private readonly dependencies: CreateVerificationMetricAuditSealerInput) {
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async seal(input: VerificationMetricAuditSealInput): Promise<VerificationMetricAuditSealResult> {
    const { context, verified } = input;
    if (!context.missionId || !context.workItemId) fail("VERIFICATION_METRIC_SEAL_OPERATION_CONTEXT_REQUIRED");
    const startedAt = canonicalTime(input.startedAt, "VERIFICATION_METRIC_SEAL_STARTED_AT_INVALID");
    if (!verified.producerAttemptId) fail("VERIFICATION_METRIC_SEAL_PRODUCER_ATTEMPT_REQUIRED");

    const observations = await this.#hydrateObservations(context.tenantId, verified.observationsArtifact);
    const bundle = decodeBundle(observations.bytes);
    assertMetricOnly(bundle);
    assertRuntimeBinding(this.dependencies.runtime, bundle, verified);
    const profileArtifact = VerificationArtifactHandleSchema.parse(verified.profileArtifact);
    if (profileArtifact.tenantId !== context.tenantId) fail("VERIFICATION_METRIC_SEAL_PROFILE_TENANT_MISMATCH");

    const policy = await this.dependencies.policyCatalog.resolve(
      { tenantId: context.tenantId, policyVersion: bundle.policyVersion },
      this.dependencies.repository.createTrustedArtifactResolver(),
    );
    const runId = deterministicUuid("verification-metric-run", context.operationId);
    const recovered = await this.dependencies.repository.loadAuditBundleForOperationRecovery({
      tenantId: context.tenantId, runId, operationId: context.operationId, verifierAttemptId: context.attemptId,
    });
    if (recovered) this.#recover(runId, recovered, bundle, verified, policy.artifact);

    const captures = uniqueHandles(bundle.captures.flatMap((capture) => [
      capture.contentArtifact,
      ...(capture.canonicalProjectionArtifact ? [capture.canonicalProjectionArtifact] : []),
    ]));
    const inputsBase = await this.#completeInputs(context.tenantId, observations.handle, profileArtifact, captures, policy.artifact);
    if(recovered){
      const existing=recovered.manifest.inputArtifacts;
      if(inputsBase.some(required=>!existing.some(item=>digestCanonicalJson(item)===digestCanonicalJson(required))))fail("VERIFICATION_METRIC_SEAL_RECOVERY_PROVENANCE_INCOMPLETE");
      return this.#recover(runId,recovered,bundle,verified,policy.artifact);
    }
    const completedAt = canonicalTime(this.#now(), "VERIFICATION_METRIC_SEAL_COMPLETED_AT_INVALID");
    if (Date.parse(completedAt) < Date.parse(startedAt)) fail("VERIFICATION_METRIC_SEAL_TIME_ORDER_INVALID");
    const resultBytes = encoder.encode(canonicalizeJson(verified.deterministicResult));
    const resultArtifact = await this.dependencies.repository.registerContentAddressedArtifact(registeredArtifactInput({
      tenantId: context.tenantId, bytes: resultBytes,
      mediaType: "application/vnd.aiengineer.deterministic-verification-result+json", createdAt: completedAt,
      producerAttemptId: context.attemptId, missionId: context.missionId,
      // Mechanical output is content-addressed across operations. Its direct
      // input is the admitted observations bundle; profile and policy remain
      // causal manifest inputs but cannot change this CAS signature.
      parentArtifactIds: [observations.handle.artifactId],
      transformation: { kind: "verification_metric_deterministic_result.v1", bundleDigest: observations.handle.digest, verifierAlgorithm: "deterministic-metric.v1" },
      artifactType: "deterministic_verification_result", storageBucket: this.dependencies.storageBucket,
    }));
    const recordedInputs: VerificationRecordedPolicyInputs = {
      schemaVersion: "verification-policy-inputs.v1",
      policyVersion: policy.definition.policyVersion,
      runId,
      recordedAt: completedAt,
      deterministicResult: verified.deterministicResult,
      assertions: [],
      metrics: bundle.metricObservations.map((metric) => ({
        observationId: metric.observationId,
        riskClass: "critical" as const,
        downstreamUse: ["verification"],
        criticalFactsKnown: false,
        conflictPresent: false,
      })),
      sourceAssessments: [],
    };
    const policyInputsBytes = encoder.encode(canonicalizeJson(recordedInputs));
    const policyInputsArtifact = await this.dependencies.repository.registerContentAddressedArtifact(registeredArtifactInput({
      tenantId: context.tenantId, bytes: policyInputsBytes,
      mediaType: "application/vnd.aiengineer.verification-policy-inputs+json", createdAt: completedAt,
      producerAttemptId: context.attemptId, missionId: context.missionId,
      parentArtifactIds: [resultArtifact.artifactId],
      transformation: { kind: "verification_metric_policy_inputs.v1", runId, resultDigest: resultArtifact.digest },
      artifactType: "verification_policy_inputs", storageBucket: this.dependencies.storageBucket,
    }));
    const decision: VerificationPolicyDecision = evaluateVerificationPolicy(policy.definition, recordedInputs);
    const decisionBytes = encoder.encode(canonicalizeJson(decision));
    const decisionArtifact = await this.dependencies.repository.registerContentAddressedArtifact(registeredArtifactInput({
      tenantId: context.tenantId, bytes: decisionBytes,
      mediaType: "application/vnd.aiengineer.verification-policy-decision+json", createdAt: completedAt,
      producerAttemptId: context.attemptId, missionId: context.missionId,
      parentArtifactIds: [resultArtifact.artifactId, policy.artifact.artifactId, policyInputsArtifact.artifactId],
      transformation: { kind: "verification_metric_policy_decision.v1", runId, policyVersion: decision.policyVersion, policyInputsDigest: policyInputsArtifact.digest },
      artifactType: "verification_policy_decision", storageBucket: this.dependencies.storageBucket,
    }));

    const manifest = this.#manifest({
      runId, startedAt, completedAt, bundle, verified, policyArtifact: policy.artifact,
      policyInputsArtifact, resultArtifact, decisionArtifact, inputsBase, policyOutcome: decision.outcome,
    });
    const audit = await sealAuditBundle({
      tenantId: context.tenantId,
      verificationBundle: bundle,
      manifest,
      policyBinding: { policyVersion: policy.definition.policyVersion, policyArtifact: policy.artifact, recordedPolicyInputsArtifact: policyInputsArtifact },
      recordedPolicyInputsBytes: policyInputsBytes,
      policyDecision: decision,
    });
    const auditBytes = encoder.encode(canonicalizeJson(audit));
    const manifestArtifact = await this.dependencies.repository.registerContentAddressedArtifact(registeredArtifactInput({
      tenantId: context.tenantId, bytes: auditBytes,
      mediaType: "application/vnd.aiengineer.verification-run-manifest+json", createdAt: completedAt,
      producerAttemptId: context.attemptId, missionId: context.missionId,
      parentArtifactIds: uniqueHandles([...manifest.inputArtifacts, ...manifest.outputArtifacts]).map((item) => item.artifactId),
      transformation: { kind: "verification_metric_audit_bundle.v1", runId, manifestDigest: manifest.canonicalization.manifestDigest },
      artifactType: "verification_run_manifest", storageBucket: this.dependencies.storageBucket,
    }));
    await this.dependencies.repository.recordVerificationRun({
      tenantId: context.tenantId, runId, producerAttemptId: verified.producerAttemptId, verifierAttemptId: context.attemptId,
      policyVersion: policy.definition.policyVersion, bundleArtifact: observations.handle, resultArtifact, policyArtifact: policy.artifact,
      manifestArtifact, startedAt, endedAt: completedAt, status: runStatusForPolicy(decision.outcome), missionId: context.missionId,
      workItemId: context.workItemId, operationId: context.operationId, lease: input.lease,
    });
    return Object.freeze({ runId, manifestDigest: manifest.canonicalization.manifestDigest, policyOutcome: decision.outcome });
  }

  async #hydrateObservations(tenantId: string, expected: VerificationArtifactHandle): Promise<{ handle: VerificationArtifactHandle; bytes: Uint8Array }> {
    const resolver = this.dependencies.repository.createTrustedArtifactResolver();
    await resolver.authorizeArtifact({ tenantId, artifactId: expected.artifactId, purpose: "verification_admission" });
    const hydrated = await resolver.hydrateRegisteredArtifact({ tenantId, artifactId: expected.artifactId });
    return { handle: exactHandle(expected, hydrated.registration, hydrated.bytes, "VERIFICATION_METRIC_SEAL_OBSERVATIONS_MISMATCH"), bytes: hydrated.bytes };
  }

  /** Authorize every registered parent; bound both graph size and hydrated bytes. */
  async #completeInputs(tenantId: string, observations: VerificationArtifactHandle, profile: VerificationArtifactHandle,
    captures: readonly VerificationArtifactHandle[], policy: VerificationArtifactHandle): Promise<VerificationArtifactHandle[]> {
    const handles = new Map(uniqueHandles([observations, profile, ...captures, policy]).map(handle => [handle.artifactId, handle]));
    const visited = new Set<string>();
    const pending = [...handles.keys()];
    let totalBytes = 0;
    const resolver = this.dependencies.repository.createTrustedArtifactResolver();
    while (pending.length) {
      const artifactId = pending.shift()!;
      if (visited.has(artifactId)) continue;
      if (visited.size >= 256) fail("VERIFICATION_METRIC_SEAL_PROVENANCE_LIMIT");
      await resolver.authorizeArtifact({tenantId, artifactId, purpose:"verification_admission"});
      const hydrated = await resolver.hydrateRegisteredArtifact({tenantId, artifactId});
      const registered = VerificationArtifactHandleSchema.parse(hydrated.registration);
      totalBytes += hydrated.bytes.byteLength;
      if (totalBytes > 32_000_000) fail("VERIFICATION_METRIC_SEAL_PROVENANCE_LIMIT");
      if (registered.tenantId !== tenantId || registered.artifactId !== artifactId
        || registered.byteLength !== hydrated.bytes.byteLength || registered.digest !== sha256Digest(hydrated.bytes)) {
        fail("VERIFICATION_METRIC_SEAL_PROVENANCE_IDENTITY_MISMATCH");
      }
      const expected = handles.get(artifactId);
      if (expected && digestCanonicalJson(expected) !== digestCanonicalJson(registered)) fail("VERIFICATION_METRIC_SEAL_PROVENANCE_IDENTITY_MISMATCH");
      handles.set(artifactId, registered);
      visited.add(artifactId);
      pending.push(...registered.parentArtifactIds);
      if (artifactId === profile.artifactId) {
        const declared = VerificationMetricProfileSchema.parse(JSON.parse(decoder.decode(hydrated.bytes)));
        if (declared.observations.artifactId !== observations.artifactId || declared.observations.digest !== observations.digest) {
          fail("VERIFICATION_METRIC_SEAL_PROFILE_BINDING_MISMATCH");
        }
        // These immutable profile references authorized native projection use.
        pending.push(...declared.projectionAdmissions.map(item => item.transformationArtifactId));
      }
      if (pending.length > 4096) fail("VERIFICATION_METRIC_SEAL_PROVENANCE_LIMIT");
    }
    return uniqueHandles([...handles.values()]);
  }

  #manifest(input: {
    runId: string;
    startedAt: string;
    completedAt: string;
    bundle: VerificationBundle;
    verified: VerificationMetricServiceResult;
    policyArtifact: VerificationArtifactHandle;
    policyInputsArtifact: VerificationArtifactHandle;
    resultArtifact: VerificationArtifactHandle;
    decisionArtifact: VerificationArtifactHandle;
    inputsBase: readonly VerificationArtifactHandle[];
    policyOutcome: VerificationPolicyDecision["outcome"];
  }): VerificationRunManifest {
    const inputArtifacts = uniqueHandles([...input.inputsBase, input.policyInputsArtifact]);
    const outputArtifacts = uniqueHandles([input.resultArtifact, input.decisionArtifact]);
    const indexed = [...inputArtifacts, ...outputArtifacts];
    const knownIds = new Set(indexed.map((artifact) => artifact.artifactId));
    // Existing capture/profile/policy lineage is evidence, not work performed by
    // this sealer. Its registered handle is the authoritative activity identity.
    // The bounded, authorized traversal must have supplied every registered parent.
    for (const artifact of indexed) {
      if (artifact.parentArtifactIds.some((parentArtifactId) => !knownIds.has(parentArtifactId))) {
        fail("VERIFICATION_METRIC_SEAL_LINEAGE_INCOMPLETE");
      }
    }
    const owned = new Set([input.resultArtifact.artifactId, input.policyInputsArtifact.artifactId, input.decisionArtifact.artifactId]);
    const lineage = indexed.flatMap((artifact) => artifact.parentArtifactIds.map((parentArtifactId, ordinal) => owned.has(artifact.artifactId)
      ? edge(artifact.artifactId, parentArtifactId, ordinal)
      : edge(artifact.artifactId, parentArtifactId, ordinal, artifact.producerActivityId, artifact.producerVersion)));
    const manifest: VerificationRunManifest = {
      verificationContractVersion: "verification.v1",
      manifestId: deterministicUuid("verification-metric-manifest", input.runId),
      runId: input.runId,
      versions: { policy: input.bundle.policyVersion, schema: "verification.v1", normalizer: this.dependencies.runtime.code.normalizerVersion },
      code: { gitSha: this.dependencies.runtime.code.gitSha, dirty: this.dependencies.runtime.code.dirty },
      runtime: { platform: this.dependencies.runtime.platform, deploymentId: this.dependencies.runtime.deploymentId },
      inputArtifacts,
      outputArtifacts,
      stages: [{ name: "verify_metric_and_seal", status: "succeeded", startedAt: input.startedAt, endedAt: input.completedAt }],
      calls: [],
      toolPolicy: [],
      // Artifact hydration is limited to configured storage; this stage makes no provider call.
      networkPolicy: "allowlisted",
      deterministicResult: input.verified.deterministicResult,
      judgments: [],
      policyOutcome: input.policyOutcome,
      resultDigest: digestCanonicalJson(input.verified.deterministicResult),
      lineage,
      canonicalization: { algorithm: "RFC8785", implementationVersion: "knowledge-verification.v1", manifestDigest: sha256Digest("") },
      startedAt: input.startedAt,
      completedAt: input.completedAt,
    };
    manifest.canonicalization.manifestDigest = verificationManifestDigest(manifest);
    return manifest;
  }

  #recover(
    runId: string,
    recovered: VerificationAuditBundle,
    bundle: VerificationBundle,
    verified: VerificationMetricServiceResult,
    policyArtifact: VerificationArtifactHandle,
  ): VerificationMetricAuditSealResult {
    const manifest = recovered.manifest;
    const recordedArtifacts = [...manifest.inputArtifacts, ...manifest.outputArtifacts];
    const includesExact = (artifact: VerificationArtifactHandle) => recordedArtifacts.some((recorded) => digestCanonicalJson(recorded) === digestCanonicalJson(artifact));
    if (recovered.tenantId !== verified.observationsArtifact.tenantId || manifest.runId !== runId
      || digestCanonicalJson(recovered.verificationBundle) !== digestCanonicalJson(bundle)
      || recovered.deterministicResultDigest !== digestCanonicalJson(verified.deterministicResult)
      || manifest.resultDigest !== digestCanonicalJson(verified.deterministicResult)
      || manifest.versions.policy !== bundle.policyVersion
      || recovered.policyBinding.policyVersion !== bundle.policyVersion
      || digestCanonicalJson(recovered.policyBinding.policyArtifact) !== digestCanonicalJson(policyArtifact)
      || !includesExact(verified.observationsArtifact) || !includesExact(verified.profileArtifact) || !includesExact(policyArtifact)) {
      fail("VERIFICATION_METRIC_SEAL_RECOVERY_DRIFT");
    }
    return Object.freeze({ runId, manifestDigest: manifest.canonicalization.manifestDigest, policyOutcome: manifest.policyOutcome });
  }
}

export function createVerificationMetricAuditSealer(input: CreateVerificationMetricAuditSealerInput): VerificationMetricAuditSealer {
  return new VerificationMetricAuditSealer(input);
}
