import {
  DeterministicVerificationResultSchema,
  SemanticProviderResponseObservationBodySchema,
  VerificationArtifactHandleSchema,
  VerificationBundleSchema,
  type SemanticAssessmentRecord,
  type VerificationBundle,
  type VerificationSourceCapture,
} from "@aiengineer/knowledge-contracts";
import { VERIFICATION_PARSER_LIMITS } from "@aiengineer/knowledge-conversion";
import {
  authorizeSemanticCase,
  canonicalizeJson,
  digestCanonicalJson,
  projectionSelectorResolver,
  resolveWithAdmittedResolver,
  sha256Digest,
  verifyDeterministicBundle,
  type RuntimePrincipalBinding,
  type VerificationArtifactHandle,
} from "@aiengineer/knowledge-verification";
import { loadDiagnosticsOfflineCatalog } from "./verification-diagnostics-offline-catalog.js";
import { loadDiagnosticsSemanticReplayFixture, type DiagnosticsSemanticReplayFixture } from "./verification-diagnostics-semantic-fixture.js";
import { replayCapturedSemanticAssessment } from "./verification-semantic-replay.js";
import { VerificationAdmissionService } from "./verification-admission.js";

const decoder = new TextDecoder("utf-8", { fatal: true });
type RuntimeBindingBody = Readonly<{ schemaVersion: "verification-runtime-principal-binding.v1"; tenantId: string; operationId: string; operationStepId: string; producerAttemptId: string; verifierAttemptId: string; assertionsArtifact: VerificationArtifactHandle; runtimePrincipals: RuntimePrincipalBinding }>;
const RuntimePrincipalBindingSchema = {
  parse(value: unknown): RuntimeBindingBody {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_RUNTIME_BINDING");
    const body = value as Record<string, unknown>, runtime = body.runtimePrincipals;
    const exact = (candidate: Record<string, unknown>, keys: readonly string[]) => Object.keys(candidate).length === keys.length && keys.every((key) => Object.hasOwn(candidate, key));
    const uuid = (candidate: unknown) => typeof candidate === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(candidate);
    if (body.schemaVersion !== "verification-runtime-principal-binding.v1" || typeof body.tenantId !== "string" || typeof body.operationId !== "string"
      || !exact(body, ["schemaVersion", "tenantId", "operationId", "operationStepId", "producerAttemptId", "verifierAttemptId", "assertionsArtifact", "runtimePrincipals"])
      || !uuid(body.tenantId) || !uuid(body.operationId) || !uuid(body.operationStepId) || !uuid(body.producerAttemptId) || !uuid(body.verifierAttemptId) || !runtime || typeof runtime !== "object" || Array.isArray(runtime))
      throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_RUNTIME_BINDING");
    const principals = runtime as Record<string, unknown>;
    if (!exact(principals, ["basis", "producerDeploymentId", "verifierDeploymentId", "producerPrincipalDigest", "verifierPrincipalDigest"])
      || principals.basis !== "runtime_principal_binding" || typeof principals.producerDeploymentId !== "string" || typeof principals.verifierDeploymentId !== "string"
      || !/^sha256:[a-f0-9]{64}$/u.test(String(principals.producerPrincipalDigest)) || !/^sha256:[a-f0-9]{64}$/u.test(String(principals.verifierPrincipalDigest)))
      throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_RUNTIME_BINDING");
    return Object.freeze({ schemaVersion: "verification-runtime-principal-binding.v1", tenantId: body.tenantId as string, operationId: body.operationId as string,
      operationStepId: body.operationStepId as string, producerAttemptId: body.producerAttemptId as string, verifierAttemptId: body.verifierAttemptId as string,
      assertionsArtifact: VerificationArtifactHandleSchema.parse(body.assertionsArtifact), runtimePrincipals: principals as unknown as RuntimePrincipalBinding });
  },
};

function decodeCanonical(bytes: Uint8Array, code: string): unknown {
  const text = decoder.decode(bytes);
  const value = JSON.parse(text);
  if (canonicalizeJson(value) !== text) throw new Error(code);
  return value;
}

async function hydrateExact(createResolver: DiagnosticsSemanticReplayFixture["createResolver"], tenantId: string, handle: VerificationArtifactHandle) {
  const resolver = createResolver();
  await resolver.authorizeArtifact({ tenantId, artifactId: handle.artifactId, purpose: "verification_admission" });
  const retained = await resolver.hydrateRegisteredArtifact({ tenantId, artifactId: handle.artifactId });
  const registration = VerificationArtifactHandleSchema.parse(retained.registration);
  if (digestCanonicalJson(registration) !== digestCanonicalJson(handle) || retained.bytes.byteLength !== handle.byteLength || sha256Digest(retained.bytes) !== handle.digest)
    throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_ARTIFACT_INTEGRITY");
  return { registration, bytes: retained.bytes };
}

async function reAdmitProjection(input: { readonly fixture: DiagnosticsSemanticReplayFixture; readonly bundle: VerificationBundle; readonly capture: VerificationSourceCapture; readonly transformationArtifactId: string }) {
  const { fixture, bundle, capture, transformationArtifactId } = input;
  const resolver = fixture.createResolver();
  await resolver.authorizeArtifact({ tenantId: capture.contentArtifact.tenantId, artifactId: transformationArtifactId, purpose: "verification_admission" });
  const retained = await resolver.hydrateRegisteredArtifact({ tenantId: capture.contentArtifact.tenantId, artifactId: transformationArtifactId });
  const envelope = decodeCanonical(retained.bytes, "DIAGNOSTICS_SEMANTIC_REPLAY_ADMISSION_ENCODING");
  const parser = envelope && typeof envelope === "object" && !Array.isArray(envelope) ? (envelope as Record<string, unknown>).parser : undefined;
  if (!parser || typeof parser !== "object" || Array.isArray(parser) || (parser as Record<string, unknown>).parserVersion !== "verification-native-parser.v1" || typeof (parser as Record<string, unknown>).imageDigest !== "string") throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_ADMISSION_BINDING");
  const source = bundle.sources.find((item) => item.sourceId === capture.sourceId);
  if (!source || !capture.canonicalProjectionArtifact) throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_PROJECTION_REQUIRED");
  const admission = new VerificationAdmissionService({
    createTrustedArtifactResolver: fixture.createResolver,
    async getRegisteredCapture(value) { if (value.tenantId !== capture.contentArtifact.tenantId || value.captureId !== capture.captureId) throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_CAPTURE_DENIED"); return { source, capture }; },
    async registerContentAddressedArtifact(): Promise<never> { throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_WRITE_FORBIDDEN"); },
  }, { async parse(): Promise<never> { throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_PARSER_FORBIDDEN"); } }, {
    parserVersion: "verification-native-parser.v1", imageDigest: (parser as Record<string, unknown>).imageDigest as `sha256:${string}`, limits: VERIFICATION_PARSER_LIMITS,
  }, { storageBucket: "offline-replay", producerVersion: "verification-admission.v1", encryptionClass: "offline", retentionClass: "verification-audit", now: () => "1970-01-01T00:00:00.000Z" });
  return admission.hydrateAdmittedProjection({ tenantId: capture.contentArtifact.tenantId, captureId: capture.captureId, expectedSourceArtifact: { artifactId: capture.contentArtifact.artifactId, digest: capture.contentArtifact.digest as `sha256:${string}` }, transformationArtifactId, projectionArtifactId: capture.canonicalProjectionArtifact.artifactId });
}

async function hydrateRuntimeBinding(input: { readonly fixture: DiagnosticsSemanticReplayFixture; readonly entry: Awaited<ReturnType<typeof loadDiagnosticsSemanticReplayFixture>>["entries"][number]; readonly bundle: VerificationBundle }) {
  const handle = input.entry.runtimePrincipalBindingArtifact;
  if (!handle) throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_RUNTIME_BINDING_REQUIRED");
  const retained = await hydrateExact(input.fixture.createResolver, handle.tenantId, handle);
  const body = RuntimePrincipalBindingSchema.parse(decodeCanonical(retained.bytes, "DIAGNOSTICS_SEMANTIC_REPLAY_RUNTIME_BINDING_ENCODING"));
  const expectedParent = [body.assertionsArtifact.artifactId];
  const assertions = await hydrateExact(input.fixture.createResolver, body.tenantId, body.assertionsArtifact);
  if (body.tenantId !== handle.tenantId || handle.mediaType !== "application/vnd.aiengineer.verification-runtime-principal-binding+json"
    || digestCanonicalJson(handle.parentArtifactIds) !== digestCanonicalJson(expectedParent)
    || digestCanonicalJson(input.entry.verificationBundleArtifact.parentArtifactIds) !== digestCanonicalJson(expectedParent)
    || body.producerAttemptId !== input.bundle.producer.attemptId || body.verifierAttemptId !== input.bundle.verifier.attemptId
    || body.runtimePrincipals.producerDeploymentId !== input.bundle.producer.deploymentId || body.runtimePrincipals.verifierDeploymentId !== input.bundle.verifier.deploymentId)
    throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_RUNTIME_BINDING");
  if (digestCanonicalJson(assertions.registration) !== digestCanonicalJson(body.assertionsArtifact)) throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_RUNTIME_BINDING");
  const expectedTransformation = { kind: "verification_runtime_principal_binding.v1", tenantId: body.tenantId, operationId: body.operationId,
    operationStepId: body.operationStepId, producerAttemptId: body.producerAttemptId, verifierAttemptId: body.verifierAttemptId,
    assertionsArtifact: body.assertionsArtifact, bindingDigest: sha256Digest(retained.bytes) };
  if (handle.transformationSignature !== digestCanonicalJson(expectedTransformation)) throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_RUNTIME_BINDING");
  for (const judge of input.entry.judges) {
    const observation = await hydrateExact(input.fixture.createResolver, judge.observationArtifact.tenantId, judge.observationArtifact);
    const observed = SemanticProviderResponseObservationBodySchema.parse(decodeCanonical(observation.bytes, "DIAGNOSTICS_SEMANTIC_REPLAY_OBSERVATION_ENCODING"));
    if (observed.context.tenantId !== body.tenantId || observed.context.operationId !== body.operationId || observed.context.operationStepId !== body.operationStepId
      || observed.context.producerAttemptId !== body.verifierAttemptId || observed.context.operationId !== judge.capture.operationId || observed.context.operationStepId !== judge.capture.operationStepId)
      throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_RUNTIME_BINDING");
  }
  return body.runtimePrincipals;
}

/** Rehydrates an existing native admission; parser and all writes are forbidden. */
export async function reAdmitDiagnosticsSemanticFixtureProjection(input: { readonly directory: string; readonly catalogDirectory: string; readonly expectedFixtureDigest: `sha256:${string}`; readonly caseId: string }) {
  const fixture = await loadDiagnosticsSemanticReplayFixture(input);
  const entry = fixture.entries.find((item) => item.caseId === input.caseId);
  const benchmarkCase = (await loadDiagnosticsOfflineCatalog("diagnostics-companies-v1", input.catalogDirectory)).dataset.cases.find((item) => item.caseId === input.caseId);
  if (!entry || !benchmarkCase || benchmarkCase.caseDigest !== entry.caseDigest) throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_CASE_BINDING");
  const bundleBytes = await hydrateExact(fixture.createResolver, entry.verificationBundleArtifact.tenantId, entry.verificationBundleArtifact);
  const bundle = VerificationBundleSchema.parse(decodeCanonical(bundleBytes.bytes, "DIAGNOSTICS_SEMANTIC_REPLAY_BUNDLE_ENCODING"));
  const capture = bundle.captures[0], evidence = benchmarkCase.evidence[0];
  if (!capture || !evidence || capture.captureId !== evidence.captureId) throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_CASE_BINDING");
  return reAdmitProjection({ fixture, bundle, capture, transformationArtifactId: evidence.transformationArtifactId });
}

/**
 * Replays a sealed local semantic observation without dispatching a provider.
 * It is intentionally not an admission or human-gold authority.
 */
export async function replayDiagnosticsSemanticFixture(input: {
  readonly directory: string;
  readonly catalogDirectory: string;
  readonly expectedFixtureDigest: `sha256:${string}`;
}) {
  const fixture = await loadDiagnosticsSemanticReplayFixture(input);
  const catalog = await loadDiagnosticsOfflineCatalog("diagnostics-companies-v1", input.catalogDirectory);
  const results = [] as Array<{
    caseId: string;
    assessment: SemanticAssessmentRecord;
    deterministicResult: typeof DeterministicVerificationResultSchema._output;
    authenticatedEvidence: {
      assertionId: string;
      caseDigest: `sha256:${string}`;
      proposition: string;
      sourceFamilyId: string;
      sourceClass: string;
      sourceKey: string;
      captureId: string;
      fragmentId: string;
      selector: unknown;
      representationArtifactId: string;
      selectedContentDigest: `sha256:${string}`;
      sourceArtifact: typeof VerificationArtifactHandleSchema._output;
      projectionArtifact: typeof VerificationArtifactHandleSchema._output;
    };
    replayedArtifactIds: readonly string[];
    externalRequests: 0;
  }>;
  for (const entry of fixture.entries) {
    const benchmarkCase = catalog.dataset.cases.find((item) => item.caseId === entry.caseId);
    if (!benchmarkCase || benchmarkCase.caseDigest !== entry.caseDigest || benchmarkCase.inputManifestArtifactId !== entry.inputManifestArtifactId)
      throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_CASE_BINDING");
    const bundleBytes = await hydrateExact(fixture.createResolver, entry.verificationBundleArtifact.tenantId, entry.verificationBundleArtifact);
    const resultBytes = await hydrateExact(fixture.createResolver, entry.deterministicResultArtifact.tenantId, entry.deterministicResultArtifact);
    const bundle = VerificationBundleSchema.parse(decodeCanonical(bundleBytes.bytes, "DIAGNOSTICS_SEMANTIC_REPLAY_BUNDLE_ENCODING"));
    const retainedDeterministic = DeterministicVerificationResultSchema.parse(decodeCanonical(resultBytes.bytes, "DIAGNOSTICS_SEMANTIC_REPLAY_RESULT_ENCODING"));
    if (bundle.producer.deploymentId !== entry.producerDeploymentId || bundle.assertions.length !== 1 || bundle.captures.length !== 1)
      throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_BUNDLE_BINDING");
    const assertion = bundle.assertions[0]!, capture = bundle.captures[0]!, edge = assertion.evidence[0];
    const benchmarkEvidence = benchmarkCase.evidence[0];
    if (!edge || !benchmarkEvidence || benchmarkCase.assertion !== assertion.proposition || edge.fragment.captureId !== benchmarkEvidence.captureId
      || edge.fragment.fragmentId !== benchmarkEvidence.fragmentId || edge.fragment.representationArtifactId !== benchmarkEvidence.projectionArtifactId
      || digestCanonicalJson(edge.fragment.selector) !== digestCanonicalJson(benchmarkEvidence.selector)
      || edge.expectedSelectedContentDigest !== benchmarkEvidence.selectedContentDigest)
      throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_BENCHMARK_BINDING");

    const representations = [capture.contentArtifact, ...(capture.canonicalProjectionArtifact ? [capture.canonicalProjectionArtifact] : [])];
    const hydratedArtifacts = await Promise.all(representations.map((handle) => hydrateExact(fixture.createResolver, handle.tenantId, handle)));
    const reAdmitted = await reAdmitProjection({ fixture, bundle, capture, transformationArtifactId: benchmarkEvidence.transformationArtifactId });
    if (digestCanonicalJson(reAdmitted.receipt.sourceArtifact) !== digestCanonicalJson(capture.contentArtifact)
      || digestCanonicalJson(reAdmitted.receipt.projectionArtifact) !== digestCanonicalJson(capture.canonicalProjectionArtifact)) throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_ADMISSION_BINDING");
    const principals = await hydrateRuntimeBinding({ fixture, entry, bundle });
    if (principals.producerDeploymentId !== bundle.producer.deploymentId || principals.verifierDeploymentId !== bundle.verifier.deploymentId)
      throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_PRINCIPAL_BINDING");
    const deterministic = verifyDeterministicBundle({ bundle, artifacts: hydratedArtifacts.map((item) => ({ artifactId: item.registration.artifactId, content: item.bytes })), runtimePrincipals: principals }, {
      selectorResolvers: [projectionSelectorResolver],
      isProjectionLineageAdmitted: (binding) => digestCanonicalJson(binding) === digestCanonicalJson({ captureId: reAdmitted.receipt.captureId, sourceArtifact: reAdmitted.receipt.sourceArtifact, projectionArtifact: reAdmitted.receipt.projectionArtifact }),
    });
    if (digestCanonicalJson(deterministic) !== digestCanonicalJson(retainedDeterministic)) throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_DETERMINISTIC_DRIFT");
    const representation = capture.canonicalProjectionArtifact;
    if (!representation) throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_PROJECTION_REQUIRED");
    const bytes = hydratedArtifacts.find((item) => item.registration.artifactId === representation.artifactId)?.bytes;
    if (!bytes) throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_PROJECTION_REQUIRED");
    const selected = resolveWithAdmittedResolver({ captureId: capture.captureId, representationArtifactId: representation.artifactId, representationDigest: representation.digest, selector: edge.fragment.selector, content: bytes }, [projectionSelectorResolver]);
    if (!selected) throw new Error("DIAGNOSTICS_SEMANTIC_REPLAY_SELECTOR_UNRESOLVED");
    const semanticCase = authorizeSemanticCase(bundle, deterministic, assertion.assertionId, [{ evidenceId: edge.evidenceId, fragmentId: edge.fragment.fragmentId, exactText: decoder.decode(selected.selectedContent), selectedContentDigest: sha256Digest(selected.selectedContent) }]);
    const replayed = await replayCapturedSemanticAssessment({ semanticCase, producerDeploymentId: entry.producerDeploymentId, expectedAssessment: entry.expectedAssessment, judges: entry.judges, createResolver: fixture.createResolver });
    results.push({
      caseId: entry.caseId,
      assessment: replayed.assessment,
      deterministicResult: retainedDeterministic,
      authenticatedEvidence: {
        assertionId: assertion.assertionId,
        caseDigest: benchmarkCase.caseDigest as `sha256:${string}`,
        proposition: assertion.proposition,
        sourceFamilyId: benchmarkCase.sourceFamily,
        sourceClass: benchmarkEvidence.sourceClass,
        sourceKey: benchmarkEvidence.sourceKey,
        captureId: capture.captureId,
        fragmentId: edge.fragment.fragmentId,
        selector: edge.fragment.selector,
        representationArtifactId: representation.artifactId,
        selectedContentDigest: sha256Digest(selected.selectedContent),
        sourceArtifact: capture.contentArtifact,
        projectionArtifact: representation,
      },
      replayedArtifactIds: replayed.replayedArtifactIds,
      externalRequests: replayed.externalRequests,
    });
  }
  return Object.freeze({ fixtureDigest: fixture.fixtureDigest, results: Object.freeze(results), externalRequests: 0 as const });
}
