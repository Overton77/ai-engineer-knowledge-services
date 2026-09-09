import {
  OperationContextSchema,
  VerificationArtifactHandleSchema,
  VerificationBundleSchema,
  VerifyMetricObservationRequestSchema,
  type DeterministicVerificationResult,
  type OperationContext,
  type VerificationArtifactHandle,
  type VerificationBundle,
  type VerificationSource,
  type VerificationSourceCapture,
  type VerifyMetricObservationRequest,
} from "@aiengineer/knowledge-contracts";
import {
  digestCanonicalJson,
  sha256Digest,
  verifyDeterministicBundle,
  type DeterministicSelectorResolver,
  type RuntimePrincipalBinding,
  type TrustedArtifactResolver,
} from "@aiengineer/knowledge-verification";
import { z } from "zod";

type Digest = `sha256:${string}`;

const artifactReferenceSchema = z.strictObject({
  artifactId: z.uuid(),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
});
const captureIdsSchema = z.array(z.string().trim().min(1).max(255)).min(1).max(100).superRefine((ids, context) => {
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "capture IDs must be unique" });
});

/**
 * Immutable server-side profile for a metric-observation artifact. It binds
 * the caller-visible artifact and capture IDs, and supplies the otherwise
 * absent native-projection transformation-envelope IDs.
 */
export const VerificationMetricProfileSchema = z.strictObject({
  schemaVersion: z.literal("verification-metric-profile.v1"),
  profileId: z.string().trim().min(1).max(255),
  observations: artifactReferenceSchema,
  captureIds: captureIdsSchema,
  projectionAdmissions: z.array(z.strictObject({
    captureId: z.string().trim().min(1).max(255),
    projectionArtifactId: z.uuid(),
    transformationArtifactId: z.uuid(),
  })).max(100).superRefine((items, context) => {
    const keys = items.map((item) => `${item.captureId}:${item.projectionArtifactId}`);
    if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", message: "projection admissions must be unique by capture and projection" });
  }),
});
export type VerificationMetricProfile = z.infer<typeof VerificationMetricProfileSchema>;

export interface VerificationMetricProfileGrant {
  readonly profileArtifact: { readonly artifactId: string; readonly digest: Digest };
  readonly observations: { readonly artifactId: string; readonly digest: Digest };
}

function immutable<T>(value: T): T {
  const copy = structuredClone(value);
  const visit = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object" || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate as Record<string, unknown>)) visit(child);
    Object.freeze(candidate);
  };
  visit(copy);
  return copy;
}

/** Server-created grants; request data can select a grant but cannot create one. */
export class VerificationMetricProfileCatalog {
  readonly #byObservation = new Map<string, VerificationMetricProfileGrant>();

  constructor(grants: readonly VerificationMetricProfileGrant[]) {
    for (const grantValue of grants) {
      const parsed = z.strictObject({ profileArtifact: artifactReferenceSchema, observations: artifactReferenceSchema }).parse(grantValue);
      const grant = immutable({
        profileArtifact: { artifactId: parsed.profileArtifact.artifactId, digest: parsed.profileArtifact.digest as Digest },
        observations: { artifactId: parsed.observations.artifactId, digest: parsed.observations.digest as Digest },
      });
      const key = this.#key(grant.observations);
      if (this.#byObservation.has(key)) throw new Error("DUPLICATE_VERIFICATION_METRIC_PROFILE_GRANT");
      this.#byObservation.set(key, grant);
    }
    Object.freeze(this);
  }

  profileFor(observations: { readonly artifactId: string; readonly digest: string }): VerificationMetricProfileGrant {
    const grant = this.#byObservation.get(this.#key(observations));
    if (!grant) throw new Error("VERIFICATION_METRIC_PROFILE_GRANT_REQUIRED");
    return grant;
  }

  #key(value: { readonly artifactId: string; readonly digest: string }): string {
    return `${value.artifactId}:${value.digest}`;
  }
}

/** Registered source/capture records are authoritative over the observations artifact. */
export interface VerificationMetricCapturePort {
  getRegisteredCapture(input: { readonly tenantId: string; readonly captureId: string }): Promise<{
    readonly source: VerificationSource;
    readonly capture: VerificationSourceCapture;
  }>;
}

/** This identity is made from authenticated runtime configuration, never request fields. */
export interface VerificationMetricRuntimeIdentity {
  readonly runtimePrincipals: RuntimePrincipalBinding;
  /** Producer attempt joined from the registered observations artifact. */
  readonly producerAttemptId: string;
}

export interface VerificationMetricRuntimePrincipalPort {
  bind(input: {
    readonly context: OperationContext;
    readonly observationsArtifact: VerificationArtifactHandle;
    readonly captureIds: readonly string[];
  }): Promise<VerificationMetricRuntimeIdentity>;
}

/** Mirrors VerificationAdmissionService.hydrateAdmittedProjection without importing an implementation. */
export interface VerificationMetricNativeProjectionAdmissionPort {
  hydrateAdmittedProjection(input: {
    readonly tenantId: string;
    readonly captureId: string;
    readonly expectedSourceArtifact: { readonly artifactId: string; readonly digest: Digest };
    readonly transformationArtifactId: string;
    readonly projectionArtifactId: string;
  }): Promise<{
    readonly receipt: {
      readonly captureId: string;
      readonly sourceArtifact: VerificationArtifactHandle;
      readonly projectionArtifact: VerificationArtifactHandle;
    };
  }>;
}

export interface VerificationMetricServiceDependencies {
  readonly artifactResolver: TrustedArtifactResolver;
  readonly captures: VerificationMetricCapturePort;
  readonly profiles: VerificationMetricProfileCatalog;
  readonly runtimePrincipals: VerificationMetricRuntimePrincipalPort;
  readonly nativeProjectionAdmission?: VerificationMetricNativeProjectionAdmissionPort;
  readonly selectorResolvers?: readonly DeterministicSelectorResolver[];
}

export interface VerificationMetricServiceResult {
  readonly admissionState: "mechanical_only";
  readonly deterministicResult: DeterministicVerificationResult;
  readonly observationsArtifact: VerificationArtifactHandle;
  readonly profileArtifact: VerificationArtifactHandle;
  /** Trusted artifact-derived producer identity for sealed-run composition. */
  readonly producerAttemptId: string;
  readonly hydratedCaptureArtifactIds: readonly string[];
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}

function decodeJson(bytes: Uint8Array, code: string): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error(code); }
}

/**
 * Metric application service. This composes trusted registered artifacts,
 * profile grants, source/capture identity, selector mechanics, arithmetic and
 * runtime principal binding. It deliberately returns no policy admission.
 */
export class VerificationMetricApplicationService {
  constructor(private readonly dependencies: VerificationMetricServiceDependencies) {}

  async verify(requestValue: unknown, contextValue: unknown): Promise<VerificationMetricServiceResult> {
    const request = VerifyMetricObservationRequestSchema.parse(requestValue);
    const context = OperationContextSchema.parse(contextValue);
    const grant = this.dependencies.profiles.profileFor(request.observations);
    // TrustedArtifactResolver consumes one authorization ticket per hydration.
    // Keep this sequence explicit so production repositories retain that guard.
    const profileArtifact = await this.#hydrateExact(context.tenantId, grant.profileArtifact);
    const observationsArtifact = await this.#hydrateExact(context.tenantId, request.observations);
    const profile = VerificationMetricProfileSchema.parse(decodeJson(profileArtifact.bytes, "VERIFICATION_METRIC_PROFILE_INVALID"));
    this.#assertProfileBinding(profile, request, grant);
    const bundle = VerificationBundleSchema.parse(decodeJson(observationsArtifact.bytes, "VERIFICATION_METRIC_OBSERVATIONS_INVALID"));
    if (bundle.assertions.length !== 0) throw new Error("VERIFICATION_METRIC_OBSERVATIONS_ASSERTIONS_FORBIDDEN");
    this.#assertCaptureSet(bundle, request.captureIds);
    const hydratedCaptures = await this.#hydrateTrustedCaptures(context.tenantId, bundle);
    const admittedProjectionLineage = await this.#admitNativeProjectionEvidence(context.tenantId, bundle, profile);
    const runtimeIdentity = await this.dependencies.runtimePrincipals.bind({
      context,
      observationsArtifact: observationsArtifact.registration,
      captureIds: [...request.captureIds],
    });
    const deterministicResult = verifyDeterministicBundle({
      bundle,
      artifacts: hydratedCaptures.map(({ artifact, bytes }) => ({ artifactId: artifact.artifactId, content: bytes })),
      runtimePrincipals: runtimeIdentity.runtimePrincipals,
    }, {
      ...(this.dependencies.selectorResolvers ? { selectorResolvers: this.dependencies.selectorResolvers } : {}),
      ...(admittedProjectionLineage ? { isProjectionLineageAdmitted: admittedProjectionLineage } : {}),
    });
    return Object.freeze({
      admissionState: "mechanical_only" as const,
      deterministicResult,
      observationsArtifact: observationsArtifact.registration,
      profileArtifact: profileArtifact.registration,
      producerAttemptId: runtimeIdentity.producerAttemptId,
      hydratedCaptureArtifactIds: hydratedCaptures.map(({ artifact }) => artifact.artifactId).sort(),
    });
  }

  #assertProfileBinding(profile: VerificationMetricProfile, request: VerifyMetricObservationRequest, grant: VerificationMetricProfileGrant): void {
    if (profile.observations.artifactId !== request.observations.artifactId || profile.observations.digest !== request.observations.digest
      || grant.observations.artifactId !== request.observations.artifactId || grant.observations.digest !== request.observations.digest) {
      throw new Error("VERIFICATION_METRIC_PROFILE_OBSERVATIONS_MISMATCH");
    }
    if (!sameSet(profile.captureIds, request.captureIds)) throw new Error("VERIFICATION_METRIC_PROFILE_CAPTURE_SET_MISMATCH");
  }

  #assertCaptureSet(bundle: VerificationBundle, requestCaptureIds: readonly string[]): void {
    const bundleCaptureIds = bundle.captures.map((capture) => capture.captureId);
    if (new Set(bundleCaptureIds).size !== bundleCaptureIds.length || !sameSet(bundleCaptureIds, requestCaptureIds)) {
      throw new Error("VERIFICATION_METRIC_OBSERVATIONS_CAPTURE_SET_MISMATCH");
    }
  }

  async #hydrateTrustedCaptures(tenantId: string, bundle: VerificationBundle): Promise<Array<{ artifact: VerificationArtifactHandle; bytes: Uint8Array }>> {
    const artifacts = new Map<string, { artifact: VerificationArtifactHandle; bytes: Uint8Array }>();
    const add = (hydrated: { artifact: VerificationArtifactHandle; bytes: Uint8Array }): void => {
      const previous = artifacts.get(hydrated.artifact.artifactId);
      if (previous && (digestCanonicalJson(previous.artifact) !== digestCanonicalJson(hydrated.artifact)
        || previous.bytes.byteLength !== hydrated.bytes.byteLength
        || previous.bytes.some((value, index) => value !== hydrated.bytes[index]))) {
        throw new Error("VERIFICATION_METRIC_SHARED_ARTIFACT_BINDING_CONFLICT");
      }
      artifacts.set(hydrated.artifact.artifactId, hydrated);
    };
    for (const declared of bundle.captures) {
      const registered = await this.dependencies.captures.getRegisteredCapture({ tenantId, captureId: declared.captureId });
      const declaredSource = bundle.sources.find((source) => source.sourceId === declared.sourceId);
      const declaredBaseCapture = declared.canonicalProjectionArtifact === undefined ? declared : (() => {
        const { canonicalProjectionArtifact: _projection, ...base } = declared;
        return base;
      })();
      const registeredCaptureMatches = registered.capture.canonicalProjectionArtifact === undefined
        ? digestCanonicalJson(registered.capture) === digestCanonicalJson(declaredBaseCapture)
        : digestCanonicalJson(registered.capture) === digestCanonicalJson(declared);
      if (!declaredSource || digestCanonicalJson(registered.source) !== digestCanonicalJson(declaredSource)
        || !registeredCaptureMatches) {
        throw new Error("VERIFICATION_METRIC_CAPTURE_REGISTRATION_MISMATCH");
      }
      add(await this.#hydrateExpected(tenantId, declared.contentArtifact));
      if (declared.canonicalProjectionArtifact) add(await this.#hydrateExpected(tenantId, declared.canonicalProjectionArtifact));
    }
    return [...artifacts.values()];
  }

  async #admitNativeProjectionEvidence(
    tenantId: string,
    bundle: VerificationBundle,
    profile: VerificationMetricProfile,
  ): Promise<((binding: { captureId: string; sourceArtifact: VerificationArtifactHandle; projectionArtifact: VerificationArtifactHandle }) => boolean) | undefined> {
    const projectionCaptures = bundle.captures.filter((capture) => capture.canonicalProjectionArtifact !== undefined);
    if (projectionCaptures.length === 0) return undefined;
    if (!this.dependencies.nativeProjectionAdmission) throw new Error("VERIFICATION_METRIC_NATIVE_PROJECTION_ADMISSION_REQUIRED");
    const admitted = new Set<string>();
    for (const capture of projectionCaptures) {
      const projection = capture.canonicalProjectionArtifact!;
      const admission = profile.projectionAdmissions.find((item) => item.captureId === capture.captureId && item.projectionArtifactId === projection.artifactId);
      if (!admission) throw new Error("VERIFICATION_METRIC_PROJECTION_ENVELOPE_GRANT_REQUIRED");
      const hydrated = await this.dependencies.nativeProjectionAdmission.hydrateAdmittedProjection({
        tenantId,
        captureId: capture.captureId,
        expectedSourceArtifact: { artifactId: capture.contentArtifact.artifactId, digest: capture.contentArtifact.digest as Digest },
        transformationArtifactId: admission.transformationArtifactId,
        projectionArtifactId: admission.projectionArtifactId,
      });
      if (hydrated.receipt.captureId !== capture.captureId
        || digestCanonicalJson(hydrated.receipt.sourceArtifact) !== digestCanonicalJson(capture.contentArtifact)
        || digestCanonicalJson(hydrated.receipt.projectionArtifact) !== digestCanonicalJson(projection)) {
        throw new Error("VERIFICATION_METRIC_NATIVE_PROJECTION_RECEIPT_MISMATCH");
      }
      admitted.add(this.#projectionBindingKey(capture.captureId, capture.contentArtifact, projection));
    }
    return (binding) => admitted.has(this.#projectionBindingKey(binding.captureId, binding.sourceArtifact, binding.projectionArtifact));
  }

  #projectionBindingKey(captureId: string, sourceArtifact: VerificationArtifactHandle, projectionArtifact: VerificationArtifactHandle): string {
    return digestCanonicalJson({ captureId, sourceArtifact, projectionArtifact });
  }

  async #hydrateExact(tenantId: string, expected: { readonly artifactId: string; readonly digest: string }): Promise<{ registration: VerificationArtifactHandle; bytes: Uint8Array }> {
    const hydrated = await this.#hydrateExpected(tenantId, expected);
    return { registration: hydrated.artifact, bytes: hydrated.bytes };
  }

  async #hydrateExpected(tenantId: string, expected: { readonly artifactId: string; readonly digest: string }): Promise<{ artifact: VerificationArtifactHandle; bytes: Uint8Array }> {
    await this.dependencies.artifactResolver.authorizeArtifact({ tenantId, artifactId: expected.artifactId, purpose: "verification_admission" });
    const hydrated = await this.dependencies.artifactResolver.hydrateRegisteredArtifact({ tenantId, artifactId: expected.artifactId });
    const registration = VerificationArtifactHandleSchema.parse(hydrated.registration);
    if (registration.tenantId !== tenantId || registration.artifactId !== expected.artifactId || registration.digest !== expected.digest
      || sha256Digest(hydrated.bytes) !== registration.digest || hydrated.bytes.byteLength !== registration.byteLength) {
      throw new Error("VERIFICATION_METRIC_ARTIFACT_REGISTRATION_MISMATCH");
    }
    return { artifact: registration, bytes: hydrated.bytes };
  }
}
