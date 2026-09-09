import { lstat, readFile, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { z } from "zod";
import {
  SemanticAssessmentRecordSchema,
  SemanticJudgeIdentitySchema,
  SemanticProviderResponseObservationBodySchema,
  VerificationArtifactHandleSchema,
  type SemanticAssessmentRecord,
  type SemanticJudgeIdentity,
  type VerificationArtifactHandle,
} from "@aiengineer/knowledge-contracts";
import { verificationBenchmarkDigest } from "@aiengineer/knowledge-evaluation";
import { canonicalizeJson, sha256Digest, type TrustedArtifactResolver } from "@aiengineer/knowledge-verification";
import { prepareVerificationProviderTransportResponse, VerificationProviderTransportBindingSchema, VerificationProviderTransportResponseSchema } from "./verification-provider-transport.js";
import { loadDiagnosticsOfflineCatalog } from "./verification-diagnostics-offline-catalog.js";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const CaptureSchema = VerificationProviderTransportBindingSchema.extend({
  httpStatus: z.int().min(200).max(599),
  responseEnvelopeArtifactId: z.uuid(),
  transportArtifactId: z.uuid(),
  transportDigest: digest,
  capturedAt: z.iso.datetime(),
});

const ArtifactSchema = z.strictObject({ file: z.string().min(1).max(512), handle: VerificationArtifactHandleSchema });
const JudgeSchema = z.strictObject({
  identity: SemanticJudgeIdentitySchema,
  profileArtifact: VerificationArtifactHandleSchema,
  observationArtifact: VerificationArtifactHandleSchema,
  capture: CaptureSchema,
});
const EntrySchema = z.strictObject({
  caseId: z.string().trim().min(1).max(255),
  caseDigest: digest,
  inputManifestArtifactId: z.uuid(),
  verificationBundleArtifact: VerificationArtifactHandleSchema,
  deterministicResultArtifact: VerificationArtifactHandleSchema,
  /** Absent only for historical fixture manifests; replay requires it. */
  runtimePrincipalBindingArtifact: VerificationArtifactHandleSchema.optional(),
  producerDeploymentId: z.string().trim().min(1).max(255),
  expectedAssessment: SemanticAssessmentRecordSchema,
  judges: z.array(JudgeSchema).min(1).max(2),
});
const FixtureManifestSchema = z.strictObject({
  schemaVersion: z.literal("diagnostics-offline-semantic-replay-fixture.v1"),
  datasetManifestDigest: digest,
  fixtureDigest: digest,
  entries: z.array(EntrySchema).min(1).max(180),
  artifacts: z.array(ArtifactSchema).min(1).max(2_000),
});

export type DiagnosticsSemanticReplayEntry = z.infer<typeof EntrySchema>;
export type DiagnosticsSemanticReplayFixture = Readonly<{
  datasetManifestDigest: `sha256:${string}`;
  fixtureDigest: `sha256:${string}`;
  entries: readonly DiagnosticsSemanticReplayEntry[];
  /** Creates an offline resolver over exactly the sealed fixture bytes. It grants replay hydration only. */
  createResolver: () => TrustedArtifactResolver;
}>;

type FixtureArtifact = z.infer<typeof ArtifactSchema>;
type LoadedArtifact = Readonly<{ handle: VerificationArtifactHandle; bytes: Uint8Array }>;

const canonical = (value: unknown) => verificationBenchmarkDigest(value);
const same = (left: unknown, right: unknown) => canonicalizeJson(left) === canonicalizeJson(right);
function freezeClone<T>(value: T): T {
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

function withoutFixtureDigest(manifest: z.infer<typeof FixtureManifestSchema>): Omit<z.infer<typeof FixtureManifestSchema>, "fixtureDigest"> {
  const { fixtureDigest: _ignored, ...material } = manifest;
  return material;
}

function safeRelativeFile(value: string): boolean {
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/u.test(value)) return false;
  const parts = value.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function requireExactHandle(map: ReadonlyMap<string, LoadedArtifact>, handle: VerificationArtifactHandle, code: string): void {
  const loaded = map.get(handle.artifactId);
  if (!loaded || !same(loaded.handle, handle)) throw new Error(code);
}

function collectObservationClosure(entry: DiagnosticsSemanticReplayEntry, artifactMap: ReadonlyMap<string, LoadedArtifact>): void {
  const declaredIds = new Set<string>();
  for (const judge of entry.judges) {
    if (declaredIds.has(judge.identity.deploymentId)) throw new Error("DIAGNOSTICS_SEMANTIC_FIXTURE_JUDGE_DUPLICATE");
    declaredIds.add(judge.identity.deploymentId);
    requireExactHandle(artifactMap, judge.profileArtifact, "DIAGNOSTICS_SEMANTIC_FIXTURE_PROFILE_CLOSURE");
    requireExactHandle(artifactMap, judge.observationArtifact, "DIAGNOSTICS_SEMANTIC_FIXTURE_OBSERVATION_CLOSURE");
    const transport = artifactMap.get(judge.capture.transportArtifactId);
    if (!transport || transport.handle.digest !== judge.capture.transportDigest || transport.handle.tenantId !== judge.capture.tenantId)
      throw new Error("DIAGNOSTICS_SEMANTIC_FIXTURE_TRANSPORT_CLOSURE");
    const observationHandle = artifactMap.get(judge.observationArtifact.artifactId)!.handle;
    const observationBytes = new TextDecoder("utf-8", { fatal: true }).decode(artifactMap.get(judge.observationArtifact.artifactId)!.bytes);
    const body = SemanticProviderResponseObservationBodySchema.parse(JSON.parse(observationBytes));
    if (body.context.tenantId !== judge.capture.tenantId || body.context.operationId !== judge.capture.operationId
      || body.context.operationStepId !== judge.capture.operationStepId || body.context.providerAttemptId !== judge.capture.providerAttemptId
      || body.context.fencingToken !== judge.capture.dispatchFencingToken || !same(body.profileArtifact, judge.profileArtifact)
      || !same(body.judgeIdentity, judge.identity) || body.responseEnvelopeArtifact.artifactId !== judge.capture.responseEnvelopeArtifactId
      || observationBytes !== canonicalizeJson(body) || !same(observationHandle.parentArtifactIds, [body.blindedInputArtifact.artifactId, body.responseEnvelopeArtifact.artifactId, body.profileArtifact.artifactId]))
      throw new Error("DIAGNOSTICS_SEMANTIC_FIXTURE_OBSERVATION_BINDING");
    for (const handle of [body.blindedInputArtifact, body.requestArtifact, body.rawResponseArtifact, body.responseEnvelopeArtifact])
      requireExactHandle(artifactMap, handle, "DIAGNOSTICS_SEMANTIC_FIXTURE_ARTIFACT_CLOSURE");
    const transportText = new TextDecoder("utf-8", { fatal: true }).decode(transport.bytes);
    const transportBody = VerificationProviderTransportResponseSchema.parse(JSON.parse(transportText));
    const preparedTransport = prepareVerificationProviderTransportResponse(transportBody);
    if (transportText !== canonicalizeJson(transportBody) || !same(transportBody.binding, {
      tenantId: judge.capture.tenantId, operationId: judge.capture.operationId, operationStepId: judge.capture.operationStepId,
      providerAttemptId: judge.capture.providerAttemptId, profileArtifactId: judge.capture.profileArtifactId,
      profileDigest: judge.capture.profileDigest, dispatchFencingToken: judge.capture.dispatchFencingToken,
    }) || transportBody.httpStatus !== judge.capture.httpStatus || transportBody.responseEnvelope.artifactId !== judge.capture.responseEnvelopeArtifactId
      || !same(transport.handle.parentArtifactIds, preparedTransport.parentArtifactIds) || transport.handle.transformationSignature !== preparedTransport.transformationSignature)
      throw new Error("DIAGNOSTICS_SEMANTIC_FIXTURE_TRANSPORT_BINDING");
  }
}

/**
 * Loads a caller-pinned, sealed local fixture for semantic *replay*. It creates
 * neither provider grants nor human-gold/admission authority. Callers must still
 * authorize the exact semantic case before passing an entry to replay.
 */
export async function loadDiagnosticsSemanticReplayFixture(input: {
  readonly directory: string;
  readonly catalogDirectory: string;
  readonly expectedFixtureDigest: `sha256:${string}`;
}): Promise<DiagnosticsSemanticReplayFixture> {
  const root = await realpath(input.directory);
  const manifestPath = resolve(root, "manifest.json");
  const manifestRelative = relative(root, manifestPath);
  if (manifestRelative === ".." || manifestRelative.startsWith(`..${sep}`)) throw new Error("DIAGNOSTICS_SEMANTIC_FIXTURE_PATH_ESCAPE");
  const manifestStat = await lstat(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error("DIAGNOSTICS_SEMANTIC_FIXTURE_MANIFEST_PATH_INVALID");
  const manifest = FixtureManifestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readFile(manifestPath))));
  if (manifest.fixtureDigest !== canonical(withoutFixtureDigest(manifest)) || manifest.fixtureDigest !== input.expectedFixtureDigest)
    throw new Error("DIAGNOSTICS_SEMANTIC_FIXTURE_SEAL_MISMATCH");

  const catalog = await loadDiagnosticsOfflineCatalog("diagnostics-companies-v1", input.catalogDirectory);
  if (catalog.datasetManifestDigest !== manifest.datasetManifestDigest) throw new Error("DIAGNOSTICS_SEMANTIC_FIXTURE_DATASET_SEAL_MISMATCH");
  const cases = new Map(catalog.dataset.cases.map((item) => [item.caseId, item]));
  const seenCases = new Set<string>();
  for (const entry of manifest.entries) {
    const item = cases.get(entry.caseId);
    if (!item || seenCases.has(entry.caseId) || item.caseDigest !== entry.caseDigest || item.inputManifestArtifactId !== entry.inputManifestArtifactId)
      throw new Error("DIAGNOSTICS_SEMANTIC_FIXTURE_CASE_BINDING");
    seenCases.add(entry.caseId);
  }

  const artifactMap = new Map<string, LoadedArtifact>();
  const fileNames = new Set<string>();
  for (const artifact of manifest.artifacts as readonly FixtureArtifact[]) {
    if (!safeRelativeFile(artifact.file) || fileNames.has(artifact.file) || artifactMap.has(artifact.handle.artifactId))
      throw new Error("DIAGNOSTICS_SEMANTIC_FIXTURE_ARTIFACT_IDENTITY");
    fileNames.add(artifact.file);
    const path = resolve(root, artifact.file), pathRelative = relative(root, path);
    if (pathRelative === ".." || pathRelative.startsWith(`..${sep}`)) throw new Error("DIAGNOSTICS_SEMANTIC_FIXTURE_PATH_ESCAPE");
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || await realpath(path) !== path) throw new Error("DIAGNOSTICS_SEMANTIC_FIXTURE_ARTIFACT_PATH_INVALID");
    const bytes = new Uint8Array(await readFile(path));
    if (bytes.byteLength !== artifact.handle.byteLength || sha256Digest(bytes) !== artifact.handle.digest)
      throw new Error("DIAGNOSTICS_SEMANTIC_FIXTURE_ARTIFACT_DIGEST_MISMATCH");
    artifactMap.set(artifact.handle.artifactId, Object.freeze({ handle: freezeClone(artifact.handle), bytes: new Uint8Array(bytes) }));
  }
  for (const { handle } of artifactMap.values()) {
    if (handle.parentArtifactIds.some((parentId) => !artifactMap.has(parentId)))
      throw new Error("DIAGNOSTICS_SEMANTIC_FIXTURE_PARENT_CLOSURE");
  }
  for (const entry of manifest.entries) {
    requireExactHandle(artifactMap, entry.verificationBundleArtifact, "DIAGNOSTICS_SEMANTIC_FIXTURE_BUNDLE_CLOSURE");
    requireExactHandle(artifactMap, entry.deterministicResultArtifact, "DIAGNOSTICS_SEMANTIC_FIXTURE_RESULT_CLOSURE");
    if (entry.runtimePrincipalBindingArtifact) requireExactHandle(artifactMap, entry.runtimePrincipalBindingArtifact, "DIAGNOSTICS_SEMANTIC_FIXTURE_RUNTIME_BINDING_CLOSURE");
    collectObservationClosure(entry, artifactMap);
  }

  const entries = Object.freeze(manifest.entries.map((entry) => freezeClone(entry)));
  const createResolver = (): TrustedArtifactResolver => ({
    async authorizeArtifact({ tenantId, artifactId, purpose }) {
      const artifact = artifactMap.get(artifactId);
      if (purpose !== "verification_admission" || !artifact || artifact.handle.tenantId !== tenantId)
        throw new Error("DIAGNOSTICS_SEMANTIC_FIXTURE_HYDRATION_DENIED");
    },
    async hydrateRegisteredArtifact({ tenantId, artifactId }) {
      const artifact = artifactMap.get(artifactId);
      if (!artifact || artifact.handle.tenantId !== tenantId) throw new Error("DIAGNOSTICS_SEMANTIC_FIXTURE_HYDRATION_DENIED");
      return { registration: freezeClone(artifact.handle), bytes: new Uint8Array(artifact.bytes) };
    },
  });
  return Object.freeze({ datasetManifestDigest: manifest.datasetManifestDigest, fixtureDigest: manifest.fixtureDigest, entries, createResolver });
}
