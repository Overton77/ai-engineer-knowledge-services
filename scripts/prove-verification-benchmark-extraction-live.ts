import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DiagnosticsBenchmarkLiveCallCheckpointSchema,
  DiagnosticsBenchmarkLiveFailedCallCheckpointSchema,
  DiagnosticsBenchmarkProviderObservationSchema,
  DiagnosticsBenchmarkExtractionOutputSchema,
  SemanticJudgeOutputSchema,
  type DiagnosticsBenchmarkExtractionExperimentManifest,
  type DiagnosticsBenchmarkLiveCallCheckpoint,
  type DiagnosticsBenchmarkLiveFailedCallCheckpoint,
  type DiagnosticsBenchmarkProviderObservation,
  type VerificationArtifactHandle,
  type VerificationBenchmarkCase,
  type VerificationBenchmarkDataset,
  type VerificationSource,
  type VerificationSourceCapture,
} from "@aiengineer/knowledge-contracts";
import { VERIFICATION_PARSER_LIMITS, type VerificationParserOutput } from "@aiengineer/knowledge-conversion";
import {
  AccountedVerificationProviderSink,
  assertDiagnosticsExtractionWireRequest,
  composeDiagnosticsRecordedArm,
  createDiagnosticsFieldLedgerArtifact,
  createDiagnosticsExtractionJudgeInput,
  createDiagnosticsExtractionPrompt,
  createDiagnosticsExtractionProviderInput,
  DIAGNOSTICS_EXTRACTION_OUTPUT_SCHEMA,
  loadDiagnosticsExtractionExperiment,
  replayDiagnosticsCapturedResponse,
  VerificationProviderArtifactComposer,
  verifyDiagnosticsExtractionOutput,
  VerificationAdmissionService,
  type DiagnosticsExtractionAuthority,
  type VerificationAdmissionRepositoryPort,
} from "@aiengineer/knowledge-application";
import { PostgresCanonicalRepository, PostgresVerificationProviderAccounting, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { deterministicUuid, SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import {
  canonicalizeJson,
  GatewaySemanticJudgeAdapter,
  GatewayStructuredExtractionProvider,
  gatewaySemanticConfigurationDigest,
  gatewaySemanticOutputSchemaDigest,
  gatewaySemanticPromptDigest,
  InterfazeStructuredExtractionProvider,
  projectionSelectorResolver,
  providerDigest,
  sha256Digest,
  type ProviderArtifactSink,
} from "@aiengineer/knowledge-verification";
import { verificationBenchmarkDigest } from "../packages/evaluation/dist/index.js";

type Digest = `sha256:${string}`;
type Role = DiagnosticsBenchmarkProviderObservation["role"];
type CallPlan = DiagnosticsBenchmarkExtractionExperimentManifest["providerCallPlan"][number];
type CallCheckpoint = DiagnosticsBenchmarkLiveCallCheckpoint | DiagnosticsBenchmarkLiveFailedCallCheckpoint;
type Json = Record<string, any>;

const repositoryRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(repositoryRoot, "..");
const catalogDirectory = resolve(repositoryRoot, "catalog/verification-benchmarks/diagnostics-companies-pilot-v4");
const internalDirectory = resolve(workspaceRoot, "internal");
const tenantId = "6d057f43-6aaf-48d9-b3ba-374169abb989";
const datasetVersionId = "292cdfbf-21c5-5109-aabe-e681106db717";
const budget = Object.freeze({ tenantId, budgetId: "5890d523-561b-55db-a724-890d642885d9", budgetKey: "ws07-pilot-recovery-20260905", ceilingCostMicros: 17_928_167 });
const recoveryLineage = Object.freeze({ missionId: "c8d91c6a-911e-51fc-a6c3-1e3dc5b58110", workItemId: "da171205-de29-5935-ae7f-cd383a2930aa", attemptId: "31fc1b6f-c8bf-5486-a16a-994d4e5abcb6", custodyArtifactId: "a42c0e79-075a-55db-acfc-34b32b09ef0c", custodyDigest: "sha256:d0fcb8f429876303af26e862966b5118bb725bab17204bd19183fc4f4fa9ad93" });
const v4PersistenceReviewDigest = "sha256:2cca8d2f9963f81193f344faced641817bb6c17eaee030bb87ac5c7e1eeccce5" as const;
const v4PersistenceReceiptDigest = "sha256:55ac984c48dadc5e2c5970a1ded76641715418d17d7ec833c182d9f75b6a2903" as const;
const runnerVersion = "verification-benchmark-extraction-live.v1";
const sourcePreparationDirectory = resolve(internalDirectory, "verification-offline-source-preparation-9093b465-16c2-4cc1-b7f4-728d3958b0ed");

// Replaced only after root records an immutable source review of this runner.
// Until then --live always fails before reading credentials or touching the DB.
const dispatchReviewDigest: Digest | null = "sha256:51bffa632ac44da2f7a6861b0b06b8f9e5b04ff5ab7fac29c9b7599605b4212e";

const encodeCanonical = (value: unknown) => new TextEncoder().encode(canonicalizeJson(value));
const withoutDigest = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== "checkpointDigest"));
const required = (name: string) => { const value = process.env[name]?.trim(); if (!value) throw new Error(`BENCHMARK_EXTRACTION_LIVE_${name}_MISSING`); return value; };
const writeOnce = async (path: string, bytes: Uint8Array) => {
  try { await access(path); if (!Buffer.from(await readFile(path)).equals(bytes)) throw new Error(`IMMUTABLE_OUTPUT_CONFLICT:${path}`); }
  catch (error: any) { if (error?.code === "ENOENT") await writeFile(path, bytes, { flag: "wx" }); else throw error; }
};

async function providerKeys() {
  const source = await readFile(resolve(repositoryRoot, ".env"), "utf8");
  const get = (name: string) => source.split(/\r?\n/u).find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1).trim().replace(/^(['"])(.*)\1$/u, "$2");
  const gateway = get("AI_GATEWAY_API_KEY"), interfaze = get("INTERFAZE_API_KEY");
  if (!gateway || !interfaze) throw new Error("BENCHMARK_EXTRACTION_LIVE_PROVIDER_KEYS_UNAVAILABLE");
  return { gateway, interfaze };
}

function exactUsage(rawBytes: Uint8Array, provider: "gateway" | "interfaze") {
  let payload: Json;
  try { payload = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(rawBytes)); }
  catch { throw new Error("BENCHMARK_EXTRACTION_RAW_USAGE_INVALID"); }
  const usage = payload.usage && typeof payload.usage === "object" && !Array.isArray(payload.usage) ? payload.usage as Json : {};
  const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
  const promptTokens = integer(usage.prompt_tokens), completionTokens = integer(usage.completion_tokens);
  // Only non-BYOK Gateway wire billing is reconciled as actual. Interfaze
  // pricing estimates never release the reservation without supplier evidence.
  const actualCostMicros = provider === "gateway" && usage.is_byok !== true && typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0
    ? Math.ceil(usage.cost * 1_000_000) : null;
  return { promptTokens, completionTokens, actualCostMicros };
}

const loopback = (url: URL) => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname.toLowerCase());

class GuardedExtractionSink implements ProviderArtifactSink {
  constructor(
    readonly inner: AccountedVerificationProviderSink,
    readonly testCase: VerificationBenchmarkCase,
    readonly authority: DiagnosticsExtractionAuthority,
    readonly policy: { readonly provider: "gateway" | "interfaze"; readonly model: CallPlan["model"] },
  ) {}
  assertExternalProcessingAdmission(input: { providerId: string; modality: "text" | "image" | "audio" }) { return this.inner.assertExternalProcessingAdmission(input); }
  persistBeforeDispatch(input: { requestDigest: Digest; requestBytes: Uint8Array }) { assertDiagnosticsExtractionWireRequest(this.testCase, this.authority, input.requestBytes, this.policy); return this.inner.persistBeforeDispatch(input); }
  persistAfterResponse(input: { requestDigest: Digest; rawResponseBytes: Uint8Array; precontextBytes?: Uint8Array }) { return this.inner.persistAfterResponse(input); }
}

function profile(plan: CallPlan) {
  if (plan.role === "luna_extractor") return { providerId: "gateway-benchmark.v2", estimatedCostMicros: 5_000 };
  if (plan.role === "interfaze_extractor") return { providerId: "interfaze-benchmark.v2", estimatedCostMicros: 50_000 };
  return { providerId: "gateway-benchmark.v2", estimatedCostMicros: 20_000 };
}

async function authenticateNativeMechanics(dataset: VerificationBenchmarkDataset, cases: readonly VerificationBenchmarkCase[]) {
  const manifestBytes = await readFile(resolve(sourcePreparationDirectory, "manifest.json"));
  if (sha256Digest(manifestBytes) !== dataset.sourcePreparationDigest) throw new Error("BENCHMARK_EXTRACTION_SOURCE_PREPARATION_DIGEST_MISMATCH");
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as { artifacts: { file: string; handle: VerificationArtifactHandle }[]; captures: { sourceKey: string; source: VerificationSource; capture: VerificationSourceCapture }[] };
  const artifacts = new Map(manifest.artifacts.map((item) => [item.handle.artifactId, item]));
  const captures = new Map(manifest.captures.map((item) => [item.capture.captureId, item]));
  if (artifacts.size !== manifest.artifacts.length || captures.size !== manifest.captures.length) throw new Error("BENCHMARK_EXTRACTION_SOURCE_PREPARATION_DUPLICATE_IDENTITY");
  let ticket: string | undefined;
  const localRepository: VerificationAdmissionRepositoryPort = {
    createTrustedArtifactResolver: () => ({
      authorizeArtifact: async ({ tenantId: requestedTenant, artifactId }) => { const item = artifacts.get(artifactId); if (!item || item.handle.tenantId !== requestedTenant) throw new Error("BENCHMARK_EXTRACTION_SOURCE_ARTIFACT_DENIED"); ticket = `${requestedTenant}:${artifactId}`; },
      hydrateRegisteredArtifact: async ({ tenantId: requestedTenant, artifactId }) => { const item = artifacts.get(artifactId); if (!item || ticket !== `${requestedTenant}:${artifactId}`) throw new Error("BENCHMARK_EXTRACTION_SOURCE_ARTIFACT_NOT_AUTHORIZED"); ticket = undefined; const bytes = await readFile(resolve(sourcePreparationDirectory, item.file)); if (bytes.byteLength !== item.handle.byteLength || sha256Digest(bytes) !== item.handle.digest) throw new Error("BENCHMARK_EXTRACTION_SOURCE_ARTIFACT_BYTES_INVALID"); return { registration: item.handle, bytes }; },
    }),
    getRegisteredCapture: async ({ tenantId: requestedTenant, captureId }) => { const item = captures.get(captureId); if (!item || item.capture.contentArtifact.tenantId !== requestedTenant) throw new Error("BENCHMARK_EXTRACTION_SOURCE_CAPTURE_MISSING"); return item; },
    registerContentAddressedArtifact: async () => { throw new Error("BENCHMARK_EXTRACTION_SOURCE_PREPARATION_READ_ONLY"); },
  };
  const admission = new VerificationAdmissionService(localRepository, { parse: async (): Promise<VerificationParserOutput> => { throw new Error("BENCHMARK_EXTRACTION_SOURCE_PARSER_DISABLED"); } }, { parserVersion: "verification-native-parser.v1", imageDigest: "sha256:1669a3f9674b2e0a70ba1c8686c1cb3647492b8268bdfa7a9a4452fb0530fb37", limits: VERIFICATION_PARSER_LIMITS }, { storageBucket: "offline-read-only", producerVersion: "verification-admission.v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", now: () => new Date(0).toISOString() });
  const results = new Map<string, { locatorValid: boolean; selectorResolutionDigest: Digest }>();
  for (const testCase of cases) {
    const evidence = testCase.evidence[0], capture = evidence ? captures.get(evidence.captureId) : undefined;
    if (!evidence || !capture) throw new Error(`BENCHMARK_EXTRACTION_SOURCE_CASE_BINDING_MISSING:${testCase.caseId}`);
    const hydrated = await admission.hydrateAdmittedProjection({ tenantId: capture.capture.contentArtifact.tenantId, captureId: evidence.captureId, expectedSourceArtifact: { artifactId: capture.capture.contentArtifact.artifactId, digest: capture.capture.contentArtifact.digest as Digest }, transformationArtifactId: evidence.transformationArtifactId, projectionArtifactId: evidence.projectionArtifactId });
    if (hydrated.receipt.projectionArtifact.digest !== evidence.projectionDigest) throw new Error(`BENCHMARK_EXTRACTION_SOURCE_PROJECTION_MISMATCH:${testCase.caseId}`);
    const selection = projectionSelectorResolver.resolve({ captureId: evidence.captureId, representationArtifactId: evidence.projectionArtifactId, representationDigest: evidence.projectionDigest, selector: evidence.selector, content: hydrated.content });
    const locatorValid = selection.resolution.status === "resolved" && selection.resolution.occurrenceCount === 1 && selection.resolution.selectedContentDigest === evidence.selectedContentDigest && sha256Digest(selection.selectedContent) === evidence.selectedContentDigest;
    results.set(testCase.caseId, { locatorValid, selectorResolutionDigest: verificationBenchmarkDigest(selection.resolution) });
  }
  return results;
}

async function main(mode: "preflight" | "admission-preflight" | "live") {
  const loaded = await loadDiagnosticsExtractionExperiment(catalogDirectory);
  const fresh = loaded.experiment.casePlan.filter((item) => item.execution === "fresh_dispatch");
  if (fresh.length !== 39 || loaded.experiment.maximumFreshProviderCalls !== 117 || loaded.experiment.maximumFreshReservationMicros !== 2_925_000) throw new Error("BENCHMARK_EXTRACTION_LIVE_MATRIX_MISMATCH");
  const freshCases = fresh.map((item) => loaded.dataset.cases.find((candidate) => candidate.caseId === item.caseId)!).filter(Boolean);
  const nativeMechanics = await authenticateNativeMechanics(loaded.dataset, freshCases);
  if (freshCases.length !== 39 || freshCases.some((item) => nativeMechanics.get(item.caseId)?.locatorValid !== true)) throw new Error("BENCHMARK_EXTRACTION_LIVE_NATIVE_SELECTOR_GATE_FAILED");
  const runIdentityMaterial = { schemaVersion: "diagnostics-benchmark-live-run-identity.v1", runnerVersion, experimentManifestDigest: loaded.experiment.manifestDigest, datasetManifestDigest: loaded.dataset.manifestDigest, grantDigest: loaded.experiment.grantDigest, datasetVersionId, budget, dispatchReviewDigest };
  const runIdentityDigest = verificationBenchmarkDigest(runIdentityMaterial);
  const runId = deterministicUuid("verification-benchmark-live-run", runIdentityDigest);
  if (mode === "preflight") {
    process.stdout.write(`${JSON.stringify({ mode, runnerVersion, runId, runIdentityDigest, freshCases: fresh.length, authenticatedNativeSelectors: nativeMechanics.size, calls: fresh.length * loaded.experiment.providerCallPlan.length, maximumReservationMicros: loaded.experiment.maximumFreshReservationMicros, dispatchEnabled: dispatchReviewDigest !== null }, null, 2)}\n`);
    return;
  }
  if (mode === "live") {
    if (!dispatchReviewDigest) throw new Error("BENCHMARK_EXTRACTION_LIVE_REVIEW_NOT_ADMITTED");
    const reviewPath = required("DISPATCH_REVIEW_RECEIPT");
    const reviewBytes = await readFile(reviewPath);
    if (sha256Digest(reviewBytes) !== dispatchReviewDigest) throw new Error("BENCHMARK_EXTRACTION_LIVE_REVIEW_DIGEST_MISMATCH");
  }

  const postgresUrl = required("POSTGRES_URL"), supabaseUrl = required("SUPABASE_URL");
  const postgresTarget = new URL(postgresUrl), supabaseTarget = new URL(supabaseUrl);
  if (!loopback(postgresTarget) || !loopback(supabaseTarget) || postgresTarget.port !== "54322" || supabaseTarget.port !== "54321") throw new Error("BENCHMARK_EXTRACTION_LIVE_REFUSED_NONLOCAL_TARGET");
  const supabaseSecret = required("SUPABASE_SECRET_KEY");
  const database = new PostgresCanonicalRepository({ connectionString: postgresUrl, localOnly: true, connectionTimeoutMs: 3_000 });
  try {
  const store = new SupabaseArtifactStore({ projectUrl: supabaseUrl, serviceRoleKey: supabaseSecret, bucket: "ai-engineer-cloud-bucket", maximumBytes: 4_194_304 });
  const repository = new PostgresVerificationRepository(database, store, { async authorize(input) { if (input.tenantId !== tenantId) throw new Error("BENCHMARK_EXTRACTION_LIVE_HYDRATION_DENIED"); } });
  const accounting = new PostgresVerificationProviderAccounting(database);
  const missionId = deterministicUuid("verification-benchmark-live-mission", runIdentityDigest);
  const outputDirectory = resolve(internalDirectory, `verification-benchmark-extraction-live-${runId}`);
  await mkdir(outputDirectory, { recursive: true });
  const existingFailure = resolve(outputDirectory, "terminal-failure.json");
  try { await access(existingFailure); throw new Error("BENCHMARK_EXTRACTION_LIVE_PRIOR_TERMINAL_FAILURE"); } catch (error: any) { if (error?.code !== "ENOENT") throw error; }
  const finalPath = resolve(outputDirectory, "run-replay-pack.json");

  const hydrate = async (handle: VerificationArtifactHandle) => {
    const resolver = repository.createTrustedArtifactResolver();
    await resolver.authorizeArtifact({ tenantId, artifactId: handle.artifactId, purpose: "verification_replay" });
    const value = await resolver.hydrateRegisteredArtifact({ tenantId, artifactId: handle.artifactId });
    if (verificationBenchmarkDigest(value.registration) !== verificationBenchmarkDigest(handle) || value.bytes.byteLength !== handle.byteLength || sha256Digest(value.bytes) !== handle.digest) throw new Error(`BENCHMARK_EXTRACTION_LIVE_ARTIFACT_REPLAY_FAILED:${handle.artifactId}`);
    return value.bytes;
  };
  const packedArtifact = async (role: DiagnosticsBenchmarkLiveCallCheckpoint["artifacts"][number]["role"], handle: VerificationArtifactHandle) => ({ role, handle, bytesBase64: Buffer.from(await hydrate(handle)).toString("base64") });
  const checkpointPath = (caseIndex: number, caseId: string, role: Role) => resolve(outputDirectory, `${String(caseIndex + 1).padStart(2, "0")}-${caseId}-${role}.json`);
  const failurePath = (caseIndex: number, caseId: string, role: Role) => resolve(outputDirectory, `${String(caseIndex + 1).padStart(2, "0")}-${caseId}-${role}-failure.json`);
  const missionGoal = "Run the accepted D-013 V4 diagnostics extraction experiment with append-only per-call custody";
  const replayPackPath = resolve(internalDirectory, "verification-benchmark-v4-replay-pack-a6bc1cf3-ecbb-435e-8f5e-f49165798d29.json");
  const [persistenceReceiptBytes, registryBytes, datasetBytes, replayPackBytes] = await Promise.all([
    readFile(resolve(internalDirectory, "verification-benchmark-v4-persistence-receipt-a6bc1cf3-ecbb-435e-8f5e-f49165798d29.json")),
    readFile(resolve(catalogDirectory, "case-artifact-registry.json")),
    readFile(resolve(catalogDirectory, "dataset.json")),
    readFile(replayPackPath),
  ]);
  if (sha256Digest(persistenceReceiptBytes) !== v4PersistenceReceiptDigest) throw new Error("BENCHMARK_EXTRACTION_LIVE_DATASET_RECEIPT_INVALID");
  const persistenceReceipt = JSON.parse(persistenceReceiptBytes.toString("utf8")) as Json;
  const registry = JSON.parse(registryBytes.toString("utf8")) as Json;
  if (persistenceReceipt.offlineReplayPack?.path !== replayPackPath || persistenceReceipt.offlineReplayPack?.digest !== sha256Digest(replayPackBytes) || Number(persistenceReceipt.offlineReplayPack?.byteLength) !== replayPackBytes.byteLength) throw new Error("BENCHMARK_EXTRACTION_LIVE_V4_REPLAY_PACK_INVALID");
  const replayPack = JSON.parse(replayPackBytes.toString("utf8")) as Json;
  if (replayPack.datasetVersionId !== datasetVersionId || replayPack.semanticDatasetManifestDigest !== loaded.dataset.manifestDigest || !Array.isArray(replayPack.artifacts) || replayPack.artifacts.length !== 87) throw new Error("BENCHMARK_EXTRACTION_LIVE_V4_REPLAY_PACK_BINDING_INVALID");
  const fullHandles = new Map<string, VerificationArtifactHandle>();
  for (const artifact of replayPack.artifacts as Json[]) {
    const handle = artifact.handle as VerificationArtifactHandle, bytes = Buffer.from(String(artifact.bytesBase64), "base64");
    if (!handle?.artifactId || fullHandles.has(handle.artifactId) || bytes.byteLength !== handle.byteLength || sha256Digest(bytes) !== handle.digest) throw new Error("BENCHMARK_EXTRACTION_LIVE_V4_REPLAY_ARTIFACT_INVALID");
    fullHandles.set(handle.artifactId, handle);
  }
  const inputEntries = (registry.artifacts as Json[]).filter((item) => item.role === "case_input");
  if (persistenceReceipt.datasetVersionId !== datasetVersionId || persistenceReceipt.semanticDatasetManifestDigest !== loaded.dataset.manifestDigest || inputEntries.length !== loaded.dataset.cases.length) throw new Error("BENCHMARK_EXTRACTION_LIVE_DATASET_RECEIPT_BINDING_INVALID");
  const persisted = await database.transaction(tenantId, async (client) => ({
    version: (await client.query<Json>("select * from evaluation.eval_dataset_version where tenant_id=$1 and id=$2", [tenantId, datasetVersionId])).rows[0],
    cases: (await client.query<Json>("select * from evaluation.eval_case where tenant_id=$1 and dataset_version_id=$2 order by external_key", [tenantId, datasetVersionId])).rows,
    artifacts: (await client.query<Json>("select id,artifact_type,sha256,storage_state from orchestration.artifact where tenant_id=$1 and id=any($2::uuid[])", [tenantId, [persistenceReceipt.datasetManifestArtifactId, ...inputEntries.map((item) => item.handle.artifactId)]])).rows,
    budget: (await client.query<Json>("select * from orchestration.verification_provider_budget where tenant_id=$1 and id=$2", [tenantId, budget.budgetId])).rows[0],
    recovery: (await client.query<Json>(`select m.status mission_status,w.status work_status,w.terminal_evidence,a.outcome,a.ended_at,
      r.artifact_type,r.sha256,r.storage_state from orchestration.mission m
      join orchestration.work_item w on w.tenant_id=m.tenant_id and w.mission_id=m.id and w.id=$3
      join orchestration.attempt a on a.tenant_id=w.tenant_id and a.work_item_id=w.id and a.id=$4
      join orchestration.artifact r on r.tenant_id=m.tenant_id and r.id=$5
      where m.tenant_id=$1 and m.id=$2`, [tenantId, recoveryLineage.missionId, recoveryLineage.workItemId, recoveryLineage.attemptId, recoveryLineage.custodyArtifactId])).rows[0],
  }));
  const expectedVersionManifest = { artifactId: persistenceReceipt.datasetManifestArtifactId, rawByteDigest: persistenceReceipt.datasetManifestRawByteDigest, semanticManifestDigest: loaded.dataset.manifestDigest, catalogManifestDigest: persistenceReceipt.catalogManifestDigest };
  if (!persisted.version || persisted.version.dataset_id !== persistenceReceipt.datasetId || persisted.version.manifest_artifact_id !== persistenceReceipt.datasetManifestArtifactId || persisted.version.manifest_sha256 !== String(persistenceReceipt.datasetManifestRawByteDigest).slice(7) || persisted.version.contract_version !== "verification.v1" || persisted.version.label_provenance !== "agent_generated" || Number(persisted.version.version) !== 4 || Number(persisted.version.case_count) !== loaded.dataset.cases.length || new Date(persisted.version.frozen_at).toISOString() !== loaded.dataset.sealedAt || verificationBenchmarkDigest(persisted.version.manifest) !== verificationBenchmarkDigest(expectedVersionManifest) || persisted.cases.length !== loaded.dataset.cases.length) throw new Error("BENCHMARK_EXTRACTION_LIVE_DATASET_VERSION_INVALID");
  if (!persisted.budget || persisted.budget.tenant_id !== tenantId || persisted.budget.id !== budget.budgetId || persisted.budget.budget_key !== budget.budgetKey || Number(persisted.budget.ceiling_cost_micros) !== budget.ceilingCostMicros || Number(persisted.budget.reserved_cost_micros) < 0 || Number(persisted.budget.settled_cost_micros) < 0 || Number(persisted.budget.reserved_cost_micros) + Number(persisted.budget.settled_cost_micros) > budget.ceilingCostMicros) throw new Error("BENCHMARK_EXTRACTION_LIVE_SUCCESSOR_BUDGET_INVALID");
  if (!persisted.recovery || persisted.recovery.mission_status !== "succeeded" || persisted.recovery.work_status !== "succeeded" || persisted.recovery.outcome !== "succeeded" || persisted.recovery.ended_at === null || persisted.recovery.terminal_evidence?.custodyManifestArtifactId !== recoveryLineage.custodyArtifactId || persisted.recovery.terminal_evidence?.custodyManifestDigest !== recoveryLineage.custodyDigest || persisted.recovery.artifact_type !== "verification_run_manifest" || persisted.recovery.sha256 !== recoveryLineage.custodyDigest.slice(7) || persisted.recovery.storage_state !== "available") throw new Error("BENCHMARK_EXTRACTION_LIVE_RECOVERY_LINEAGE_INVALID");
  const artifactRows = new Map(persisted.artifacts.map((item) => [item.id, item]));
  const manifestRow = artifactRows.get(persistenceReceipt.datasetManifestArtifactId);
  if (!manifestRow || manifestRow.artifact_type !== "evaluation_dataset_manifest" || manifestRow.sha256 !== String(persistenceReceipt.datasetManifestRawByteDigest).slice(7) || manifestRow.storage_state !== "available") throw new Error("BENCHMARK_EXTRACTION_LIVE_DATASET_MANIFEST_REGISTRATION_INVALID");
  const resolver = repository.createTrustedArtifactResolver();
  await resolver.authorizeArtifact({ tenantId, artifactId: persistenceReceipt.datasetManifestArtifactId, purpose: "verification_replay" });
  const hydratedManifest = await resolver.hydrateRegisteredArtifact({ tenantId, artifactId: persistenceReceipt.datasetManifestArtifactId });
  if (!Buffer.from(hydratedManifest.bytes).equals(datasetBytes) || sha256Digest(hydratedManifest.bytes) !== persistenceReceipt.datasetManifestRawByteDigest) throw new Error("BENCHMARK_EXTRACTION_LIVE_DATASET_MANIFEST_BYTES_INVALID");
  const sourceBindings = new Map<string, DiagnosticsBenchmarkLiveCallCheckpoint["sourceBinding"]>();
  for (const testCase of loaded.dataset.cases) {
    const entry = inputEntries.find((item) => item.caseId === testCase.caseId), row = persisted.cases.find((item) => item.external_key === testCase.caseId), mechanics = nativeMechanics.get(testCase.caseId);
    const expectedInput = { assertion: testCase.assertion, evidence: testCase.evidence, inputManifestArtifactId: testCase.inputManifestArtifactId };
    const expectedOutput = { expectation: testCase.expectation, engineeringExpectationArtifactId: testCase.goldArtifactId, humanGoldScoringEligible: false };
    const expectedMetadata = { partition: testCase.partition, sourceFamily: testCase.sourceFamily, entityFamily: testCase.entityFamily, reportCluster: testCase.reportCluster, pairCluster: testCase.pairCluster, independentObservation: testCase.independentObservation };
    if (!entry || !row || row.id !== deterministicUuid("verification-benchmark-case", `${datasetVersionId}:${testCase.caseId}`) || row.tenant_id !== tenantId || row.dataset_id !== persistenceReceipt.datasetId || row.dataset_version_id !== datasetVersionId || row.verification_contract_version !== "verification.v1" || row.input_manifest_artifact_id !== testCase.inputManifestArtifactId || row.gold_artifact_id !== testCase.goldArtifactId || row.case_sha256 !== testCase.caseDigest.slice(7) || verificationBenchmarkDigest(row.input) !== verificationBenchmarkDigest(expectedInput) || verificationBenchmarkDigest(row.expected) !== verificationBenchmarkDigest(expectedOutput) || verificationBenchmarkDigest(row.metadata) !== verificationBenchmarkDigest(expectedMetadata)) throw new Error(`BENCHMARK_EXTRACTION_LIVE_CASE_REGISTRATION_INVALID:${testCase.caseId}`);
    const fullHandle = fullHandles.get(entry.handle.artifactId);
    if (!fullHandle || Object.entries(entry.handle).some(([key, value]) => (fullHandle as unknown as Json)[key] !== value)) throw new Error(`BENCHMARK_EXTRACTION_LIVE_CASE_INPUT_FULL_HANDLE_INVALID:${testCase.caseId}`);
    const artifactRow = artifactRows.get(fullHandle.artifactId);
    if (!artifactRow || artifactRow.artifact_type !== "evaluation_case_input" || artifactRow.sha256 !== String(fullHandle.digest).slice(7) || artifactRow.storage_state !== "available") throw new Error(`BENCHMARK_EXTRACTION_LIVE_CASE_INPUT_REGISTRATION_INVALID:${testCase.caseId}`);
    const fileBytes = await readFile(resolve(catalogDirectory, entry.file));
    if (!Buffer.from(await hydrate(fullHandle)).equals(fileBytes) || sha256Digest(fileBytes) !== fullHandle.digest) throw new Error(`BENCHMARK_EXTRACTION_LIVE_CASE_INPUT_BYTES_INVALID:${testCase.caseId}`);
    if (mechanics) sourceBindings.set(testCase.caseId, { datasetVersionId, evalCaseId: row.id, inputManifestArtifact: fullHandle, locatorValid: mechanics.locatorValid, selectorResolutionDigest: mechanics.selectorResolutionDigest });
  }
  if (sourceBindings.size !== 39) throw new Error("BENCHMARK_EXTRACTION_LIVE_SOURCE_BINDING_MATRIX_INVALID");
  if (mode === "admission-preflight") {
    process.stdout.write(`${JSON.stringify({ mode, runnerVersion, runId, runIdentityDigest, freshCases: fresh.length, authenticatedNativeSelectors: nativeMechanics.size, authenticatedDatasetCases: persisted.cases.length, authenticatedFullInputHandles: sourceBindings.size, successorBudget: { budgetId: budget.budgetId, ceilingCostMicros: budget.ceilingCostMicros, reservedCostMicros: Number(persisted.budget.reserved_cost_micros), settledCostMicros: Number(persisted.budget.settled_cost_micros) }, providerDispatches: 0, missionWrites: 0, credentialsRead: false }, null, 2)}\n`);
    return;
  }
  await database.transaction(tenantId, async (client) => {
    await client.query("insert into orchestration.mission(id,tenant_id,slug,goal,status,started_at) values($1,$2,$3,$4,'running',clock_timestamp()) on conflict(id) do nothing", [missionId, tenantId, `ws07-extraction-${runId}`, missionGoal]);
    const row = (await client.query<Json>("select * from orchestration.mission where tenant_id=$1 and id=$2 for update", [tenantId, missionId])).rows[0];
    if (!row || row.slug !== `ws07-extraction-${runId}` || row.goal !== missionGoal || !["running", "succeeded"].includes(row.status)) throw new Error("BENCHMARK_EXTRACTION_LIVE_MISSION_CONFLICT");
  });

  const accountingSnapshot = async (attemptId: string) => database.transaction(tenantId, async (client) => ({
    attempt: (await client.query<Json>("select * from orchestration.verification_provider_attempt where tenant_id=$1 and id=$2", [tenantId, attemptId])).rows[0],
    budget: (await client.query<Json>("select * from orchestration.verification_provider_budget where tenant_id=$1 and id=$2", [tenantId, budget.budgetId])).rows[0],
    run: (await client.query<Json>(`select count(*)::int attempt_count,
      coalesce(sum(case when p.state in ('reserved','dispatched','uncertain') then p.reservation_cost_micros else 0 end),0)::bigint reserved_micros,
      coalesce(sum(case when p.state='settled' then p.actual_cost_micros else 0 end),0)::bigint settled_micros
      from orchestration.verification_provider_attempt p join orchestration.attempt a on a.tenant_id=p.tenant_id and a.id=p.id
      join orchestration.work_item w on w.tenant_id=a.tenant_id and w.id=a.work_item_id where p.tenant_id=$1 and w.mission_id=$2`, [tenantId, missionId])).rows[0],
  }));
  const checkpointAccounting = (snapshot: { attempt: Json; budget: Json; run: Json }, requestHandle: VerificationArtifactHandle, envelopeHandle: VerificationArtifactHandle) => {
    if (!snapshot.attempt || !snapshot.budget || !snapshot.run || !["settled", "uncertain"].includes(snapshot.attempt.state) || snapshot.attempt.request_artifact_id !== requestHandle.artifactId || snapshot.attempt.response_artifact_id !== envelopeHandle.artifactId || snapshot.budget.id !== budget.budgetId || snapshot.budget.budget_key !== budget.budgetKey || Number(snapshot.budget.ceiling_cost_micros) !== budget.ceilingCostMicros) throw new Error("BENCHMARK_EXTRACTION_LIVE_ACCOUNTING_SNAPSHOT_INVALID");
    return { budgetId: budget.budgetId, budgetKey: budget.budgetKey, ceilingCostMicros: Number(snapshot.budget.ceiling_cost_micros), reservedCostMicros: Number(snapshot.budget.reserved_cost_micros), settledCostMicros: Number(snapshot.budget.settled_cost_micros), attemptState: snapshot.attempt.state as "settled" | "uncertain", reservationCostMicros: Number(snapshot.attempt.reservation_cost_micros), estimatedCostMicros: snapshot.attempt.estimated_cost_micros === null ? null : Number(snapshot.attempt.estimated_cost_micros), actualCostMicros: snapshot.attempt.actual_cost_micros === null ? null : Number(snapshot.attempt.actual_cost_micros), requestArtifactId: requestHandle.artifactId, responseArtifactId: envelopeHandle.artifactId, runAttemptCount: Number(snapshot.run.attempt_count), runReservedCostMicros: Number(snapshot.run.reserved_micros), runSettledCostMicros: Number(snapshot.run.settled_micros) };
  };

  const loadCheckpoint = async (path: string, testCase: VerificationBenchmarkCase, plan: CallPlan): Promise<DiagnosticsBenchmarkLiveCallCheckpoint | undefined> => {
    try {
      const parsed = DiagnosticsBenchmarkLiveCallCheckpointSchema.parse(JSON.parse(await readFile(path, "utf8")));
      if (parsed.checkpointDigest !== verificationBenchmarkDigest(withoutDigest(parsed as unknown as Record<string, unknown>)) || parsed.runIdentityDigest !== runIdentityDigest || parsed.experimentManifestDigest !== loaded.experiment.manifestDigest || parsed.datasetManifestDigest !== loaded.dataset.manifestDigest || parsed.caseId !== testCase.caseId || parsed.caseDigest !== testCase.caseDigest || parsed.role !== plan.role || parsed.provider !== plan.provider || parsed.model !== plan.model) throw new Error("BENCHMARK_EXTRACTION_LIVE_CHECKPOINT_BINDING_INVALID");
      const expectedSource = sourceBindings.get(testCase.caseId);
      if (!expectedSource || verificationBenchmarkDigest(parsed.sourceBinding) !== verificationBenchmarkDigest(expectedSource)) throw new Error("BENCHMARK_EXTRACTION_LIVE_CHECKPOINT_SOURCE_BINDING_INVALID");
      const artifactBytes = new Map<string, Uint8Array>();
      for (const artifact of parsed.artifacts) { const decoded = Buffer.from(artifact.bytesBase64, "base64"); if (decoded.byteLength !== artifact.handle.byteLength || sha256Digest(decoded) !== artifact.handle.digest || !Buffer.from(await hydrate(artifact.handle)).equals(decoded)) throw new Error("BENCHMARK_EXTRACTION_LIVE_CHECKPOINT_BYTES_INVALID"); artifactBytes.set(artifact.role, decoded); }
      const request = artifactBytes.get("request")!, raw = artifactBytes.get("raw_response")!, envelope = JSON.parse(new TextDecoder().decode(artifactBytes.get("response_envelope")!));
      assertDiagnosticsExtractionWireRequest(testCase, loaded.authority, request, { provider: plan.provider, model: plan.model });
      const adapterReplay = await replayDiagnosticsCapturedResponse({ testCase, authority: loaded.authority, role: plan.role, rawResponseBytes: raw, httpStatus: parsed.providerHttpStatus });
      if (!adapterReplay.accepted || verificationBenchmarkDigest(adapterReplay.output) !== verificationBenchmarkDigest(parsed.observation.output) || envelope.requestDigest !== parsed.observation.requestDigest || envelope.requestArtifactId !== parsed.accounting.requestArtifactId || envelope.rawResponseArtifactId !== parsed.artifacts.find((item) => item.role === "raw_response")?.handle.artifactId || envelope.rawResponseDigest !== parsed.observation.rawResponseDigest) throw new Error("BENCHMARK_EXTRACTION_LIVE_CHECKPOINT_RAW_BINDING_INVALID");
      const precontext = parsed.artifacts.find((item) => item.role === "provider_precontext"), precontextEnvelope = parsed.artifacts.find((item) => item.role === "precontext_envelope");
      if ((adapterReplay.precontextBytes === null) !== (!precontext && !precontextEnvelope)) throw new Error("BENCHMARK_EXTRACTION_LIVE_CHECKPOINT_PRECONTEXT_PRESENCE_INVALID");
      if (adapterReplay.precontextBytes !== null) {
        if (!precontext || !precontextEnvelope || !Buffer.from(artifactBytes.get("provider_precontext")!).equals(adapterReplay.precontextBytes)) throw new Error("BENCHMARK_EXTRACTION_LIVE_CHECKPOINT_PRECONTEXT_BYTES_INVALID");
        const decodedEnvelope = JSON.parse(new TextDecoder().decode(artifactBytes.get("precontext_envelope")!));
        if (decodedEnvelope.schemaVersion !== "verification-provider-precontext-envelope.v1" || decodedEnvelope.requestDigest !== parsed.observation.requestDigest || decodedEnvelope.responseEnvelopeArtifactId !== parsed.artifacts.find((item) => item.role === "response_envelope")!.handle.artifactId || decodedEnvelope.precontextArtifactId !== precontext.handle.artifactId || decodedEnvelope.precontextDigest !== precontext.handle.digest) throw new Error("BENCHMARK_EXTRACTION_LIVE_CHECKPOINT_PRECONTEXT_ENVELOPE_INVALID");
      }
      if (!Buffer.from(artifactBytes.get("observation")!).equals(encodeCanonical(parsed.observation))) throw new Error("BENCHMARK_EXTRACTION_LIVE_CHECKPOINT_OBSERVATION_ARTIFACT_INVALID");
      if (plan.role !== "haiku_judge") {
        const recomputed = verifyDiagnosticsExtractionOutput({ testCase, authority: loaded.authority, output: DiagnosticsBenchmarkExtractionOutputSchema.parse(parsed.observation.output), fragmentArtifact: parsed.artifacts.find((item) => item.role === "granted_fragment")!.handle, fragmentBytes: artifactBytes.get("granted_fragment")! });
        const ledgerArtifact = createDiagnosticsFieldLedgerArtifact({ runIdentityDigest, caseDigest: testCase.caseDigest as Digest, role: plan.role, observationArtifactId: parsed.artifacts.find((item) => item.role === "observation")!.handle.artifactId, fieldResult: recomputed });
        if (verificationBenchmarkDigest(recomputed) !== verificationBenchmarkDigest(parsed.fieldLedger) || !Buffer.from(artifactBytes.get("field_ledger")!).equals(encodeCanonical(ledgerArtifact))) throw new Error("BENCHMARK_EXTRACTION_LIVE_CHECKPOINT_FIELD_LEDGER_INVALID");
      }
      const current = await accountingSnapshot(parsed.attemptId);
      const currentAccounting = checkpointAccounting(current, parsed.artifacts.find((item) => item.role === "request")!.handle, parsed.artifacts.find((item) => item.role === "response_envelope")!.handle);
      if (currentAccounting.attemptState !== parsed.accounting.attemptState || currentAccounting.reservationCostMicros !== parsed.accounting.reservationCostMicros || currentAccounting.actualCostMicros !== parsed.accounting.actualCostMicros || currentAccounting.runAttemptCount < parsed.accounting.runAttemptCount || currentAccounting.runReservedCostMicros < parsed.accounting.runReservedCostMicros || currentAccounting.runSettledCostMicros < parsed.accounting.runSettledCostMicros) throw new Error("BENCHMARK_EXTRACTION_LIVE_CHECKPOINT_ACCOUNTING_INVALID");
      return parsed;
    } catch (error: any) { if (error?.code === "ENOENT") return undefined; throw error; }
  };

  const loadFailedCheckpoint = async (path: string, testCase: VerificationBenchmarkCase, plan: CallPlan): Promise<DiagnosticsBenchmarkLiveFailedCallCheckpoint | undefined> => {
    try {
      const parsed = DiagnosticsBenchmarkLiveFailedCallCheckpointSchema.parse(JSON.parse(await readFile(path, "utf8")));
      if (parsed.checkpointDigest !== verificationBenchmarkDigest(withoutDigest(parsed as unknown as Record<string, unknown>)) || parsed.runIdentityDigest !== runIdentityDigest || parsed.experimentManifestDigest !== loaded.experiment.manifestDigest || parsed.datasetManifestDigest !== loaded.dataset.manifestDigest || parsed.caseId !== testCase.caseId || parsed.caseDigest !== testCase.caseDigest || parsed.role !== plan.role || parsed.provider !== plan.provider || parsed.model !== plan.model || verificationBenchmarkDigest(parsed.sourceBinding) !== verificationBenchmarkDigest(sourceBindings.get(testCase.caseId))) throw new Error("BENCHMARK_EXTRACTION_LIVE_FAILED_CHECKPOINT_BINDING_INVALID");
      const bytes = new Map<string, Uint8Array>();
      for (const artifact of parsed.artifacts) { const decoded = Buffer.from(artifact.bytesBase64, "base64"); if (decoded.byteLength !== artifact.handle.byteLength || sha256Digest(decoded) !== artifact.handle.digest || !Buffer.from(await hydrate(artifact.handle)).equals(decoded)) throw new Error("BENCHMARK_EXTRACTION_LIVE_FAILED_CHECKPOINT_BYTES_INVALID"); bytes.set(artifact.role, decoded); }
      assertDiagnosticsExtractionWireRequest(testCase, loaded.authority, bytes.get("request")!, { provider: plan.provider, model: plan.model });
      const envelope = JSON.parse(new TextDecoder().decode(bytes.get("response_envelope")!)), requestHandle = parsed.artifacts.find((item) => item.role === "request")!.handle, rawHandle = parsed.artifacts.find((item) => item.role === "raw_response")!.handle, envelopeHandle = parsed.artifacts.find((item) => item.role === "response_envelope")!.handle;
      if (envelope.requestArtifactId !== requestHandle.artifactId || envelope.rawResponseArtifactId !== rawHandle.artifactId || envelope.rawResponseDigest !== rawHandle.digest) throw new Error("BENCHMARK_EXTRACTION_LIVE_FAILED_CHECKPOINT_CHAIN_INVALID");
      const adapterReplay = await replayDiagnosticsCapturedResponse({ testCase, authority: loaded.authority, role: plan.role, rawResponseBytes: bytes.get("raw_response")!, httpStatus: parsed.providerHttpStatus });
      if (parsed.failureCode === "PROVIDER_HTTP_FAILURE_CAPTURED") {
        if (adapterReplay.accepted || adapterReplay.failureCode !== "PROVIDER_HTTP_FAILURE" || parsed.adapterFailureCode !== adapterReplay.failureCode) throw new Error("BENCHMARK_EXTRACTION_LIVE_FAILED_CHECKPOINT_ADAPTER_REPLAY_INVALID");
      } else if (parsed.failureCode === "PROVIDER_OUTPUT_SCHEMA_INVALID_CAPTURED") {
        if (adapterReplay.accepted || parsed.adapterFailureCode !== adapterReplay.failureCode || !["PROVIDER_RESPONSE_INVALID", "PROVIDER_RESPONSE_SCHEMA_INVALID", "PROVIDER_RESPONSE_TOO_LARGE"].includes(adapterReplay.failureCode)) throw new Error("BENCHMARK_EXTRACTION_LIVE_FAILED_CHECKPOINT_ADAPTER_REPLAY_INVALID");
      } else {
        if (!adapterReplay.accepted || parsed.adapterFailureCode !== null || plan.role === "haiku_judge") throw new Error("BENCHMARK_EXTRACTION_LIVE_FAILED_CHECKPOINT_MATRIX_REPLAY_INVALID");
        let matrixRejected = false;
        try { verifyDiagnosticsExtractionOutput({ testCase, authority: loaded.authority, output: DiagnosticsBenchmarkExtractionOutputSchema.parse(adapterReplay.output), fragmentArtifact: parsed.artifacts.find((item) => item.role === "granted_fragment")!.handle, fragmentBytes: bytes.get("granted_fragment")! }); } catch (error) { matrixRejected = error instanceof Error && error.message === "BENCHMARK_EXTRACTION_FIELD_MATRIX_INVALID"; }
        if (!matrixRejected) throw new Error("BENCHMARK_EXTRACTION_LIVE_FAILED_CHECKPOINT_MATRIX_REPLAY_INVALID");
      }
      const currentAccounting = checkpointAccounting(await accountingSnapshot(parsed.attemptId), requestHandle, envelopeHandle);
      if (currentAccounting.attemptState !== parsed.accounting.attemptState || currentAccounting.reservationCostMicros !== parsed.accounting.reservationCostMicros || currentAccounting.actualCostMicros !== parsed.accounting.actualCostMicros || currentAccounting.runAttemptCount < parsed.accounting.runAttemptCount) throw new Error("BENCHMARK_EXTRACTION_LIVE_FAILED_CHECKPOINT_ACCOUNTING_INVALID");
      return parsed;
    } catch (error: any) { if (error?.code === "ENOENT") return undefined; throw error; }
  };

  let keys: Awaited<ReturnType<typeof providerKeys>> | undefined;
  const getKeys = async () => keys ??= await providerKeys();
  const allCheckpoints: CallCheckpoint[] = [];
    for (const [caseIndex, casePlan] of fresh.entries()) {
      const testCase = loaded.dataset.cases.find((item) => item.caseId === casePlan.caseId);
      if (!testCase || testCase.caseDigest !== casePlan.caseDigest) throw new Error(`BENCHMARK_EXTRACTION_LIVE_CASE_MISSING:${casePlan.caseId}`);
      const caseCheckpoints: CallCheckpoint[] = [];
      for (const callPlan of loaded.experiment.providerCallPlan) {
        const path = checkpointPath(caseIndex, testCase.caseId, callPlan.role);
        const cached = await loadCheckpoint(path, testCase, callPlan);
        if (cached) { caseCheckpoints.push(cached); allCheckpoints.push(cached); continue; }
        const failed = await loadFailedCheckpoint(failurePath(caseIndex, testCase.caseId, callPlan.role), testCase, callPlan);
        if (failed) { caseCheckpoints.push(failed); allCheckpoints.push(failed); continue; }
        const callKeys = await getKeys();

        const attemptId = deterministicUuid("verification-benchmark-live-attempt", `${runIdentityDigest}:${testCase.caseDigest}:${callPlan.role}`);
        const workItemId = deterministicUuid("verification-benchmark-live-work-item", `${runIdentityDigest}:${testCase.caseDigest}:${callPlan.role}`);
        const startedAt = new Date().toISOString();
        const workSpec = { runIdentityDigest, experimentManifestDigest: loaded.experiment.manifestDigest, caseId: testCase.caseId, caseDigest: testCase.caseDigest, role: callPlan.role, provider: callPlan.provider, model: callPlan.model, reservationCostMicros: callPlan.reservationCostMicros };
        await database.transaction(tenantId, async (client) => {
          await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind,spec,status,max_attempts,attempt_count) values($1,$2,$3,'verify_claims',$4::jsonb,'pending',1,1) on conflict(id) do nothing", [workItemId, tenantId, missionId, canonicalizeJson(workSpec)]);
          const work = (await client.query<Json>("select * from orchestration.work_item where tenant_id=$1 and id=$2 for update", [tenantId, workItemId])).rows[0];
          if (!work || work.mission_id !== missionId || work.status !== "pending" || verificationBenchmarkDigest(work.spec) !== verificationBenchmarkDigest(workSpec) || Number(work.max_attempts) !== 1 || Number(work.attempt_count) !== 1) throw new Error("BENCHMARK_EXTRACTION_LIVE_WORK_ITEM_CONFLICT");
          await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id,started_at) values($1,$2,$3,1,$4,$5) on conflict(id) do nothing", [attemptId, tenantId, workItemId, runnerVersion, startedAt]);
          const attempt = (await client.query<Json>("select * from orchestration.attempt where tenant_id=$1 and id=$2 for update", [tenantId, attemptId])).rows[0];
          if (!attempt || attempt.work_item_id !== workItemId || Number(attempt.attempt_no) !== 1 || attempt.agent_deployment_id !== runnerVersion || attempt.outcome !== null || attempt.ended_at !== null) throw new Error("BENCHMARK_EXTRACTION_LIVE_ATTEMPT_CONFLICT");
        });

        const common = { tenantId, storageBucket: "ai-engineer-cloud-bucket", producerActivityId: "verification-benchmark-extraction-live", producerVersion: runnerVersion, encryptionClass: "supabase-managed", retentionClass: "verification-audit", now: () => new Date().toISOString(), producerAttemptId: attemptId, missionId, externalProcessingGrant: { providerId: callPlan.provider, dataClassification: "public" as const, modalities: ["text" as const], ...(callPlan.provider === "interfaze" ? { zdrPolicy: "required" as const } : {}) } };
        const composer = new VerificationProviderArtifactComposer(repository, common);
        const providerInput = createDiagnosticsExtractionProviderInput(testCase, loaded.authority);
        const transmission = { schemaVersion: "diagnostics-benchmark-transmission.v1", decision: "D-013", runIdentityDigest, experimentManifestDigest: loaded.experiment.manifestDigest, datasetManifestDigest: loaded.dataset.manifestDigest, grantDigest: loaded.experiment.grantDigest, caseId: testCase.caseId, caseDigest: testCase.caseDigest, inputManifestArtifactId: testCase.inputManifestArtifactId, captureId: testCase.evidence[0]!.captureId, selectedContentDigest: testCase.evidence[0]!.selectedContentDigest, role: callPlan.role, provider: callPlan.provider, model: callPlan.model, labelsExcluded: true, mutationMetadataExcluded: true, tools: false, maximumOutputTokens: 900, createdAt: startedAt };
        const transmissionHandle = await composer.registerInput(encodeCanonical(transmission), "application/vnd.aiengineer.diagnostics-benchmark-transmission+json");
        const providerInputHandle = await composer.registerInput(encodeCanonical(providerInput), "application/vnd.aiengineer.diagnostics-benchmark-provider-input+json");
        const fragmentBytes = new TextEncoder().encode(testCase.evidence[0]!.excerpt);
        const fragmentHandle = await composer.registerInput(fragmentBytes, "text/plain");
        const selectedProfile = profile(callPlan);
        const accounted = new AccountedVerificationProviderSink(composer, accounting, budget, { attemptId, providerId: selectedProfile.providerId, model: callPlan.model, reservationCostMicros: callPlan.reservationCostMicros, estimatedCostMicros: selectedProfile.estimatedCostMicros });
        const sink = new GuardedExtractionSink(accounted, testCase, loaded.authority, { provider: callPlan.provider, model: callPlan.model });
        const callStarted = Date.now();
        let providerHttpStatus: number | null = null;
        const trackedFetch: typeof fetch = async (request, init) => { const response = await fetch(request, init); providerHttpStatus = response.status; return response; };
        let stage = "provider_setup";
        let capturedObservationHandle: VerificationArtifactHandle | undefined;
        let capturedFieldLedgerHandle: VerificationArtifactHandle | undefined;
        try {
          let output: unknown;
          stage = "provider_dispatch";
          if (callPlan.role === "luna_extractor") {
            const result = await new GatewayStructuredExtractionProvider({ apiKey: callKeys.gateway, artifactSink: sink, fetch: trackedFetch }).extract({ prompt: createDiagnosticsExtractionPrompt(testCase, loaded.authority), schemaName: "benchmark_extraction", schema: DIAGNOSTICS_EXTRACTION_OUTPUT_SCHEMA, execution: { deadlineEpochMs: Date.now() + 45_000 } });
            output = DiagnosticsBenchmarkExtractionOutputSchema.parse(result.output);
          } else if (callPlan.role === "interfaze_extractor") {
            const result = await new InterfazeStructuredExtractionProvider({ apiKey: callKeys.interfaze, artifactSink: sink, fetch: trackedFetch }).extract({ prompt: createDiagnosticsExtractionPrompt(testCase, loaded.authority), schemaName: "benchmark_extraction", schema: DIAGNOSTICS_EXTRACTION_OUTPUT_SCHEMA, execution: { deadlineEpochMs: Date.now() + 45_000 } });
            output = DiagnosticsBenchmarkExtractionOutputSchema.parse(result.output);
          } else {
            const judge = new GatewaySemanticJudgeAdapter({ apiKey: callKeys.gateway, model: "anthropic/claude-haiku-4.5", identity: { deploymentId: "gateway-haiku-ws07-extraction", provider: "vercel-ai-gateway", family: "anthropic", model: "anthropic/claude-haiku-4.5", capability: "llm_evidence_rubric", graderVersion: "evidence-only.v1", promptDigest: gatewaySemanticPromptDigest, outputSchemaDigest: gatewaySemanticOutputSchemaDigest, configurationDigest: gatewaySemanticConfigurationDigest("anthropic/claude-haiku-4.5") }, artifactSink: sink, fetch: trackedFetch });
            output = SemanticJudgeOutputSchema.parse(await judge.judge(createDiagnosticsExtractionJudgeInput(testCase, loaded.authority), { deadlineEpochMs: Date.now() + 45_000 }));
          }
          if (providerHttpStatus === null || providerHttpStatus < 200 || providerHttpStatus > 299) throw new Error("BENCHMARK_EXTRACTION_LIVE_HTTP_STATUS_MISSING");
          stage = "artifact_replay";
          const requestDigest = accounted.requestDigest(), requestHandle = requestDigest ? composer.requestArtifact(requestDigest) : undefined, rawHandle = requestDigest ? composer.rawResponseArtifact(requestDigest) : undefined, envelopeHandle = requestDigest ? composer.responseEnvelopeArtifact(requestDigest) : undefined;
          if (!requestDigest || !requestHandle || !rawHandle || !envelopeHandle) throw new Error("BENCHMARK_EXTRACTION_LIVE_PROVIDER_CHAIN_INCOMPLETE");
          const rawBytes = await hydrate(rawHandle), usage = exactUsage(rawBytes, callPlan.provider);
          const adapterReplay = await replayDiagnosticsCapturedResponse({ testCase, authority: loaded.authority, role: callPlan.role, rawResponseBytes: rawBytes, httpStatus: providerHttpStatus });
          if (!adapterReplay.accepted || verificationBenchmarkDigest(adapterReplay.output) !== verificationBenchmarkDigest(output)) throw new Error("BENCHMARK_EXTRACTION_LIVE_RAW_OUTPUT_MISMATCH");
          const replayPrecontextHandle = composer.precontextArtifact(requestDigest), replayPrecontextEnvelopeHandle = composer.precontextEnvelopeArtifact(requestDigest);
          if ((adapterReplay.precontextBytes === null) !== (!replayPrecontextHandle && !replayPrecontextEnvelopeHandle)) throw new Error("BENCHMARK_EXTRACTION_LIVE_PRECONTEXT_PRESENCE_INVALID");
          if (adapterReplay.precontextBytes !== null) {
            if (!replayPrecontextHandle || !replayPrecontextEnvelopeHandle || !Buffer.from(await hydrate(replayPrecontextHandle)).equals(adapterReplay.precontextBytes)) throw new Error("BENCHMARK_EXTRACTION_LIVE_PRECONTEXT_BYTES_INVALID");
            const replayEnvelope = JSON.parse(new TextDecoder().decode(await hydrate(replayPrecontextEnvelopeHandle)));
            if (replayEnvelope.schemaVersion !== "verification-provider-precontext-envelope.v1" || replayEnvelope.requestDigest !== requestDigest || replayEnvelope.responseEnvelopeArtifactId !== envelopeHandle.artifactId || replayEnvelope.precontextArtifactId !== replayPrecontextHandle.artifactId || replayEnvelope.precontextDigest !== replayPrecontextHandle.digest) throw new Error("BENCHMARK_EXTRACTION_LIVE_PRECONTEXT_ENVELOPE_INVALID");
          }
          stage = "accounting_reconciliation";
          const settlement = await accounted.settleOrRetain(usage.actualCostMicros === null ? {} : { costMicros: usage.actualCostMicros });
          const capturedAt = new Date().toISOString();
          const observationMaterial = { schemaVersion: "verification-benchmark-provider-observation.v1" as const, caseId: testCase.caseId, caseDigest: testCase.caseDigest, role: callPlan.role, provider: callPlan.provider, model: callPlan.model, requestDigest, rawResponseDigest: rawHandle.digest, envelopeDigest: envelopeHandle.digest, output, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, actualCostMicros: usage.actualCostMicros, reservationCostMicros: callPlan.reservationCostMicros, latencyMs: Date.now() - callStarted, costState: usage.actualCostMicros === null ? "unknown_dispatched" as const : "actual" as const, runDisposition: "fresh_in_run" as const, capturedAt, custody: { state: "registered" as const, sourceReceiptDigest: v4PersistenceReviewDigest, recoveryInventoryDigest: null, recoveryWrapperArtifactId: null } };
          const observation = DiagnosticsBenchmarkProviderObservationSchema.parse({ ...observationMaterial, observationDigest: verificationBenchmarkDigest(observationMaterial) });
          stage = "mechanics_replay";
          const fieldLedger = callPlan.role === "haiku_judge" ? null : verifyDiagnosticsExtractionOutput({ testCase, authority: loaded.authority, output: DiagnosticsBenchmarkExtractionOutputSchema.parse(output), fragmentArtifact: fragmentHandle, fragmentBytes });
          const registrationCommon = { tenantId, createdAt: capturedAt, producerActivityId: "verification-benchmark-extraction-live", producerVersion: runnerVersion, encryptionClass: "supabase-managed", retentionClass: "verification-audit", dataClassification: "restricted" as const, storageBucket: "ai-engineer-cloud-bucket", producerAttemptId: attemptId, missionId };
          const observationHandle = await repository.registerContentAddressedArtifact({ ...registrationCommon, bytes: encodeCanonical(observation), mediaType: "application/vnd.aiengineer.diagnostics-benchmark-provider-observation+json", artifactType: "deterministic_verification_result", bucketClass: "ledger", parentArtifactIds: [requestHandle.artifactId, rawHandle.artifactId, envelopeHandle.artifactId], transformationSignature: providerDigest({ kind: "diagnostics_benchmark_observation.v1", runIdentityDigest, caseDigest: testCase.caseDigest, role: callPlan.role }) });
          capturedObservationHandle = observationHandle;
          const fieldLedgerArtifact = fieldLedger === null || callPlan.role === "haiku_judge" ? null : createDiagnosticsFieldLedgerArtifact({ runIdentityDigest, caseDigest: testCase.caseDigest as Digest, role: callPlan.role, observationArtifactId: observationHandle.artifactId, fieldResult: fieldLedger });
          const fieldLedgerHandle = fieldLedgerArtifact === null ? null : await repository.registerContentAddressedArtifact({ ...registrationCommon, bytes: encodeCanonical(fieldLedgerArtifact), mediaType: "application/vnd.aiengineer.diagnostics-benchmark-field-ledger+json", artifactType: "deterministic_verification_result", bucketClass: "ledger", parentArtifactIds: [fragmentHandle.artifactId, observationHandle.artifactId], transformationSignature: providerDigest({ kind: "diagnostics_benchmark_field_ledger.v1", runIdentityDigest, caseDigest: testCase.caseDigest, role: callPlan.role }) });
          capturedFieldLedgerHandle = fieldLedgerHandle ?? undefined;
          stage = "checkpoint_export";
          const snapshot = await accountingSnapshot(attemptId), checkpointAccountingSnapshot = checkpointAccounting(snapshot, requestHandle, envelopeHandle);
          const precontextHandle = replayPrecontextHandle, precontextEnvelopeHandle = replayPrecontextEnvelopeHandle;
          if ((precontextHandle === undefined) !== (precontextEnvelopeHandle === undefined)) throw new Error("BENCHMARK_EXTRACTION_LIVE_PRECONTEXT_CHAIN_INCOMPLETE");
          const artifacts = await Promise.all([
            packedArtifact("transmission_manifest", transmissionHandle), packedArtifact("provider_input", providerInputHandle), packedArtifact("granted_fragment", fragmentHandle), packedArtifact("request", requestHandle), packedArtifact("raw_response", rawHandle), packedArtifact("response_envelope", envelopeHandle), ...(precontextHandle && precontextEnvelopeHandle ? [packedArtifact("provider_precontext", precontextHandle), packedArtifact("precontext_envelope", precontextEnvelopeHandle)] : []), packedArtifact("observation", observationHandle), ...(fieldLedgerHandle ? [packedArtifact("field_ledger", fieldLedgerHandle)] : []),
          ]);
          const checkpointMaterial = { schemaVersion: "diagnostics-benchmark-live-call-checkpoint.v1" as const, runIdentityDigest, experimentManifestDigest: loaded.experiment.manifestDigest, datasetManifestDigest: loaded.dataset.manifestDigest, caseId: testCase.caseId, caseDigest: testCase.caseDigest, role: callPlan.role, provider: callPlan.provider, model: callPlan.model, attemptId, providerHttpStatus, sourceBinding: sourceBindings.get(testCase.caseId)!, observation, fieldLedger, artifacts, accounting: checkpointAccountingSnapshot, completedAt: capturedAt };
          const checkpoint = DiagnosticsBenchmarkLiveCallCheckpointSchema.parse({ ...checkpointMaterial, checkpointDigest: verificationBenchmarkDigest(checkpointMaterial) });
          await writeOnce(path, new TextEncoder().encode(`${JSON.stringify(checkpoint, null, 2)}\n`));
          await database.transaction(tenantId, async (client) => {
            await client.query("update orchestration.attempt set outcome='succeeded',ended_at=clock_timestamp() where tenant_id=$1 and id=$2 and outcome is null", [tenantId, attemptId]);
            await client.query("update orchestration.work_item set status='succeeded',terminal_evidence=$3::jsonb where tenant_id=$1 and id=$2 and status='pending'", [tenantId, workItemId, canonicalizeJson({ checkpointDigest: checkpoint.checkpointDigest, observationArtifactId: observationHandle.artifactId, fieldLedgerArtifactId: fieldLedgerHandle?.artifactId ?? null })]);
          });
          caseCheckpoints.push(checkpoint); allCheckpoints.push(checkpoint);
        } catch (error) {
          const requestDigest = accounted.requestDigest(), requestHandle = requestDigest ? composer.requestArtifact(requestDigest) : undefined, rawHandle = requestDigest ? composer.rawResponseArtifact(requestDigest) : undefined, envelopeHandle = requestDigest ? composer.responseEnvelopeArtifact(requestDigest) : undefined;
          let actualCostMicros: number | null = null;
          if (rawHandle) { try { actualCostMicros = exactUsage(await hydrate(rawHandle), callPlan.provider).actualCostMicros; } catch {} }
          const retained = await accounted.settleOrRetain(actualCostMicros === null ? {} : { costMicros: actualCostMicros }).catch(() => ({ state: "accounting_reconciliation_failed" }));
          const knownHandles: [DiagnosticsBenchmarkLiveCallCheckpoint["artifacts"][number]["role"], VerificationArtifactHandle][] = [["transmission_manifest", transmissionHandle], ["provider_input", providerInputHandle], ["granted_fragment", fragmentHandle]];
          if (requestHandle) knownHandles.push(["request", requestHandle]);
          if (rawHandle) knownHandles.push(["raw_response", rawHandle]);
          if (envelopeHandle) knownHandles.push(["response_envelope", envelopeHandle]);
          const precontextHandle = requestDigest ? composer.precontextArtifact(requestDigest) : undefined, precontextEnvelopeHandle = requestDigest ? composer.precontextEnvelopeArtifact(requestDigest) : undefined;
          if (precontextHandle) knownHandles.push(["provider_precontext", precontextHandle]);
          if (precontextEnvelopeHandle) knownHandles.push(["precontext_envelope", precontextEnvelopeHandle]);
          if (capturedObservationHandle) knownHandles.push(["observation", capturedObservationHandle]);
          if (capturedFieldLedgerHandle) knownHandles.push(["field_ledger", capturedFieldLedgerHandle]);
          const packedResults = await Promise.allSettled(knownHandles.map(async ([role, handle]) => ({ role, packed: await packedArtifact(role, handle) })));
          const artifacts = packedResults.flatMap((result) => result.status === "fulfilled" ? [result.value.packed] : []);
          const missingArtifacts = packedResults.flatMap((result, index) => result.status === "rejected" ? [{ role: knownHandles[index]![0], artifactId: knownHandles[index]![1].artifactId, failureCode: "ARTIFACT_HYDRATION_FAILED" as const }] : []);
          const responseReplay = rawHandle && providerHttpStatus !== null ? await replayDiagnosticsCapturedResponse({ testCase, authority: loaded.authority, role: callPlan.role, rawResponseBytes: await hydrate(rawHandle), httpStatus: providerHttpStatus }).catch(() => null) : null;
          const capturedCode = responseReplay && !responseReplay.accepted && responseReplay.failureCode === "PROVIDER_HTTP_FAILURE" && requestHandle && rawHandle && envelopeHandle ? "PROVIDER_HTTP_FAILURE_CAPTURED" as const
            : responseReplay && !responseReplay.accepted && ["PROVIDER_RESPONSE_INVALID", "PROVIDER_RESPONSE_SCHEMA_INVALID", "PROVIDER_RESPONSE_TOO_LARGE"].includes(responseReplay.failureCode) && requestHandle && rawHandle && envelopeHandle ? "PROVIDER_OUTPUT_SCHEMA_INVALID_CAPTURED" as const
            : responseReplay?.accepted && error instanceof Error && error.message === "BENCHMARK_EXTRACTION_FIELD_MATRIX_INVALID" && callPlan.role !== "haiku_judge" && requestHandle && rawHandle && envelopeHandle ? "EXTRACTION_FIELD_MATRIX_INVALID_CAPTURED" as const : null;
          const packedPrecontext = artifacts.find((item) => item.role === "provider_precontext"), packedPrecontextEnvelope = artifacts.find((item) => item.role === "precontext_envelope");
          let capturedPrecontextValid = true;
          if (responseReplay?.accepted) {
            capturedPrecontextValid = responseReplay.precontextBytes === null ? !packedPrecontext && !packedPrecontextEnvelope : !!packedPrecontext && !!packedPrecontextEnvelope;
            if (responseReplay.precontextBytes !== null && packedPrecontext && packedPrecontextEnvelope && envelopeHandle && requestDigest) {
              const decodedEnvelope = JSON.parse(Buffer.from(packedPrecontextEnvelope.bytesBase64, "base64").toString("utf8"));
              capturedPrecontextValid = capturedPrecontextValid && Buffer.from(packedPrecontext.bytesBase64, "base64").equals(responseReplay.precontextBytes) && decodedEnvelope.schemaVersion === "verification-provider-precontext-envelope.v1" && decodedEnvelope.requestDigest === requestDigest && decodedEnvelope.responseEnvelopeArtifactId === envelopeHandle.artifactId && decodedEnvelope.precontextArtifactId === packedPrecontext.handle.artifactId && decodedEnvelope.precontextDigest === packedPrecontext.handle.digest;
            }
          }
          if (capturedCode && requestHandle && rawHandle && envelopeHandle && retained.state !== "accounting_reconciliation_failed" && missingArtifacts.length === 0 && capturedPrecontextValid) {
            const accountingRecord = checkpointAccounting(await accountingSnapshot(attemptId), requestHandle, envelopeHandle);
            const completedAt = new Date().toISOString();
            const failureMaterial = { schemaVersion: "diagnostics-benchmark-live-failed-call-checkpoint.v1" as const, runIdentityDigest, experimentManifestDigest: loaded.experiment.manifestDigest, datasetManifestDigest: loaded.dataset.manifestDigest, caseId: testCase.caseId, caseDigest: testCase.caseDigest, role: callPlan.role, provider: callPlan.provider, model: callPlan.model, attemptId, providerHttpStatus, sourceBinding: sourceBindings.get(testCase.caseId)!, failureClass: capturedCode === "PROVIDER_HTTP_FAILURE_CAPTURED" ? "provider" as const : "schema" as const, failureCode: capturedCode, adapterFailureCode: responseReplay && !responseReplay.accepted ? responseReplay.failureCode : null, artifacts, accounting: accountingRecord, latencyMs: Date.now() - callStarted, completedAt, automaticRetry: false as const };
            const failure = DiagnosticsBenchmarkLiveFailedCallCheckpointSchema.parse({ ...failureMaterial, checkpointDigest: verificationBenchmarkDigest(failureMaterial) });
            await writeOnce(failurePath(caseIndex, testCase.caseId, callPlan.role), new TextEncoder().encode(`${JSON.stringify(failure, null, 2)}\n`));
            await database.transaction(tenantId, async (client) => {
              await client.query("update orchestration.attempt set outcome='failed',ended_at=clock_timestamp() where tenant_id=$1 and id=$2 and outcome is null", [tenantId, attemptId]);
              await client.query("update orchestration.work_item set status='failed',terminal_evidence=$3::jsonb where tenant_id=$1 and id=$2 and status='pending'", [tenantId, workItemId, canonicalizeJson({ checkpointDigest: failure.checkpointDigest, failureClass: failure.failureClass, failureCode: failure.failureCode, automaticRetry: false })]);
            });
            caseCheckpoints.push(failure); allCheckpoints.push(failure);
            continue;
          }
          const terminalCode = "BENCHMARK_EXTRACTION_LIVE_UNCLASSIFIED_INFRASTRUCTURE_FAILURE";
          const terminal = { schemaVersion: "diagnostics-benchmark-live-terminal-failure.v1", runIdentityDigest, experimentManifestDigest: loaded.experiment.manifestDigest, datasetManifestDigest: loaded.dataset.manifestDigest, caseId: testCase.caseId, caseDigest: testCase.caseDigest, role: callPlan.role, provider: callPlan.provider, model: callPlan.model, attemptId, providerHttpStatus, sourceBinding: sourceBindings.get(testCase.caseId)!, stage, failureCode: terminalCode, dispatchState: retained.state, artifacts, missingArtifacts, failedAt: new Date().toISOString(), automaticRetry: false };
          await writeOnce(existingFailure, new TextEncoder().encode(`${JSON.stringify(terminal, null, 2)}\n`));
          await database.transaction(tenantId, async (client) => {
            await client.query("update orchestration.attempt set outcome='failed',ended_at=clock_timestamp() where tenant_id=$1 and id=$2 and outcome is null", [tenantId, attemptId]);
            await client.query("update orchestration.work_item set status='failed',terminal_evidence=$3::jsonb where tenant_id=$1 and id=$2 and status='pending'", [tenantId, workItemId, canonicalizeJson({ failureCode: terminalCode, automaticRetry: false })]);
            await client.query("update orchestration.mission set status='failed',ended_at=clock_timestamp(),terminal_reason=$3 where tenant_id=$1 and id=$2 and status='running'", [tenantId, missionId, terminalCode]);
          }).catch(() => undefined);
          throw new Error(terminalCode);
        }
      }
      const successes = caseCheckpoints.filter((item): item is DiagnosticsBenchmarkLiveCallCheckpoint => item.schemaVersion === "diagnostics-benchmark-live-call-checkpoint.v1");
      const failures = caseCheckpoints.filter((item): item is DiagnosticsBenchmarkLiveFailedCallCheckpoint => item.schemaVersion === "diagnostics-benchmark-live-failed-call-checkpoint.v1");
      const observations = successes.map((item) => item.observation), locatorValid = nativeMechanics.get(testCase.caseId)?.locatorValid === true;
      const mechanics = { locatorValid, fieldMechanics: false, fieldMechanicsByRole: { luna_extractor: (successes.find((item) => item.role === "luna_extractor")?.fieldLedger as Json | null)?.fieldMechanics === true, interfaze_extractor: (successes.find((item) => item.role === "interfaze_extractor")?.fieldLedger as Json | null)?.fieldMechanics === true } };
      const arms = loaded.experiment.arms.map((arm) => ({ armId: arm.armId, decision: composeDiagnosticsRecordedArm({ arm, testCase, mechanics, observations }) }));
      const completedAt = [...caseCheckpoints.map((item) => item.completedAt)].sort().at(-1)!;
      const caseReceiptMaterial = { schemaVersion: "diagnostics-benchmark-live-case-receipt.v1", runIdentityDigest, experimentManifestDigest: loaded.experiment.manifestDigest, caseId: testCase.caseId, caseDigest: testCase.caseDigest, locatorValid, callCheckpointDigests: caseCheckpoints.map((item) => item.checkpointDigest), successfulCallCount: successes.length, failedCallCount: failures.length, failedCalls: failures.map((item) => ({ role: item.role, failureClass: item.failureClass, failureCode: item.failureCode, latencyMs: item.latencyMs, actualCostMicros: item.accounting.actualCostMicros, attemptState: item.accounting.attemptState })), arms, completedAt };
      const caseReceipt = { ...caseReceiptMaterial, receiptDigest: verificationBenchmarkDigest(caseReceiptMaterial) };
      await writeOnce(resolve(outputDirectory, `${String(caseIndex + 1).padStart(2, "0")}-${testCase.caseId}-complete.json`), new TextEncoder().encode(`${JSON.stringify(caseReceipt, null, 2)}\n`));
    }
    const successfulCallCount = allCheckpoints.filter((item) => item.schemaVersion === "diagnostics-benchmark-live-call-checkpoint.v1").length;
    const finalMaterial = { schemaVersion: "diagnostics-benchmark-live-run-replay.v1", runId, runIdentity: runIdentityMaterial, runIdentityDigest, missionId, experimentManifestDigest: loaded.experiment.manifestDigest, datasetManifestDigest: loaded.dataset.manifestDigest, callCount: allCheckpoints.length, successfulCallCount, failedCallCount: allCheckpoints.length - successfulCallCount, caseCount: fresh.length, checkpoints: allCheckpoints, completedAt: [...allCheckpoints.map((item) => item.completedAt)].sort().at(-1)!, limitations: ["Agent-generated engineering expectations are not human gold.", "Authority and world correctness remain unassessed.", "Interfaze reservations remain held where supplier billing is unavailable.", "One repetition does not estimate provider stochastic variation."] };
    const finalPack = { ...finalMaterial, replayDigest: verificationBenchmarkDigest(finalMaterial) };
    await writeOnce(finalPath, new TextEncoder().encode(`${JSON.stringify(finalPack, null, 2)}\n`));
    await database.transaction(tenantId, async (client) => { await client.query("update orchestration.mission set status='succeeded',ended_at=clock_timestamp() where tenant_id=$1 and id=$2 and status='running'", [tenantId, missionId]); });
    process.stdout.write(`${JSON.stringify({ runId, runIdentityDigest, outputDirectory, finalPath, replayDigest: finalPack.replayDigest, cases: fresh.length, calls: allCheckpoints.length }, null, 2)}\n`);
  } finally { await database.close(); }
}

const mode = process.argv.includes("--live") ? "live" : process.argv.includes("--admission-preflight") ? "admission-preflight" : "preflight";
await main(mode);
