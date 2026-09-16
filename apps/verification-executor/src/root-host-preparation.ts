import { z } from "zod";
import { DeterministicTextConversionProvider } from "@aiengineer/knowledge-conversion";
import { ExactHttpAcquisitionAdapter } from "@aiengineer/knowledge-acquisition";
import { PostgresPreparationRepository, PostgresKnowledgeOperationService, type PostgresCanonicalRepository,
  type PersistedPreparationArtifact } from "@aiengineer/knowledge-persistence";
import { deterministicUuid, type ArtifactStore } from "@aiengineer/knowledge-runtime";
import { createCanonicalActivityExecutor, createProductionActivityRegistry } from "../../worker/src/activity-registry.js";
import { CanonicalDurableKnowledgeWorker } from "../../worker/src/canonical-worker.js";
import type { VerificationExecutor } from "./executor.js";

const Request = z.strictObject({ captureId: z.string().min(1).max(255), title: z.string().min(1).max(500), version: z.string().min(1).max(100) });

/** Bridges an already captured, remotely registered executor source into durable preparation. */
export function createRootPreparationHost(config: {
  readonly database: PostgresCanonicalRepository;
  readonly verification: VerificationExecutor;
  readonly artifacts: ArtifactStore;
  readonly derivativeArtifacts: ArtifactStore;
  readonly tenantId: string;
  readonly attemptId: string;
  readonly missionId: string;
  readonly actorId: string;
  readonly origin: string;
}) {
  const repository = new PostgresPreparationRepository(config.database);
  const operations = new PostgresKnowledgeOperationService(config.database);
  const conversionArtifacts: ArtifactStore = { put: input => config.derivativeArtifacts.put(input),
    get: (tenantId, digest) => config.artifacts.get(tenantId, digest) };
  const registry = createProductionActivityRegistry({ retrieval: config.database, review: config.database,
    durablePreparation: { repository, sourceArtifacts: config.artifacts, derivativeArtifacts: config.derivativeArtifacts,
      sourceStorageBucket: "ai-engineer-cloud-bucket", derivativeStorageBucket: "content-derivatives",
      // Capture dispatch is excluded from the worker below. Only retained executor bytes enter this bridge.
      acquisition: new ExactHttpAcquisitionAdapter(config.artifacts, { allowedProtocols: ["https:"], allowedPorts: [443],
        allowedHosts: ["t14.invalid"], maximumRedirects: 0, timeoutMs: 1000, maximumBytes: 64000, maximumDecompressionRatio: 1 }),
      conversionProviders: [new DeterministicTextConversionProvider(conversionArtifacts)] } });
  const worker = new CanonicalDurableKnowledgeWorker(`root-preparation-${config.attemptId}`, config.tenantId,
    config.database, createCanonicalActivityExecutor(config.database, registry), 30000, ["transformation", "chunk_set"]);
  async function run(kind: "transformation" | "chunk_set", operationId: string, input: unknown) {
    await operations.submit(kind, { context: { tenantId: config.tenantId, operationId, attemptId: config.attemptId,
      correlationId: config.missionId, actor: { kind: "service", id: config.actorId, serviceIdentity: "control_plane" },
      capabilityVersion: "root-preparation.v1", idempotencyKey: `root-preparation:${operationId}`,
      reason: "Prepare exact remotely retained source bytes", contractVersion: "v1" }, input,
      expectedVersions: { api: "v1" } }, config.origin);
    for (let step = 0; step < 2; step++) await worker.runOperationOnce(operationId);
    const operation = await operations.get(operationId, config.tenantId);
    const receipts = await config.database.listReceipts(config.tenantId, operationId);
    if (operation?.state !== "succeeded") return { status: "incomplete" as const, operationId, operation, receipts };
    return { status: "succeeded" as const, operationId, receipts };
  }
  return { async prepare(proposed: unknown) {
    const input = Request.parse(proposed);
    const capture = await config.verification.store.readCapture(input.captureId);
    if (capture.captureMethod !== "file_text" || capture.originalArtifact) throw new Error("ROOT_PREPARATION_NATIVE_TEXT_CAPTURE_REQUIRED");
    const bytes = await config.verification.store.bytes(capture.contentArtifact);
    if (!/^text\/(plain|markdown)(?:;\s*charset=utf-8)?$/i.test(capture.contentArtifact.mediaType)) throw new Error("ROOT_PREPARATION_TEXT_ONLY");
    const physical = await config.database.transaction(config.tenantId, async client =>
      (await client.query<{ media_type: string; size_bytes: string; object_path: string; artifact_type: string; bucket_class: string; storage_state: string; sha256: string; storage_bucket: string }>(
        "select media_type,size_bytes,object_path,artifact_type,bucket_class,storage_state,sha256,storage_bucket from orchestration.artifact where tenant_id=$1 and id=$2",
        [config.tenantId, capture.contentArtifact.artifactId])).rows[0]);
    if (!physical || physical.storage_state !== "available" || physical.storage_bucket !== "ai-engineer-cloud-bucket"
      || physical.media_type !== capture.contentArtifact.mediaType || physical.artifact_type !== "source_capture"
      || physical.bucket_class !== "source_captures"
      || physical.object_path !== `${config.tenantId}/${physical.sha256.slice(0, 2)}/${physical.sha256}`
      || `sha256:${physical.sha256}` !== capture.contentArtifact.digest || Number(physical.size_bytes) !== bytes.byteLength) throw new Error("ROOT_PREPARATION_REMOTE_CUSTODY_REQUIRED");
    const artifact: PersistedPreparationArtifact = { artifactId: capture.contentArtifact.artifactId, digest: `sha256:${physical.sha256}`,
      mediaType: physical.media_type, byteLength: bytes.byteLength, storageKey: physical.object_path,
      artifactType: physical.artifact_type, bucketClass: "source_captures", storageBucket: "ai-engineer-cloud-bucket" };
    const captureOperationId = deterministicUuid("root-capture-bridge", `${config.tenantId}:${capture.captureId}:${artifact.digest}`);
    await config.database.createOperation({ id: captureOperationId, tenantId: config.tenantId, operationKind: "capture",
      idempotencyKey: `root-capture-bridge:${captureOperationId}`, correlationId: config.missionId, attemptId: config.attemptId,
      actorIdentity: config.actorId, request: { schemaVersion: "root-capture-bridge.v1", captureId: input.captureId, digest: artifact.digest }, steps: [] });
    const retained = await repository.persistCapture(config.tenantId, { operationId: captureOperationId,
      sourceId: deterministicUuid("root-source", `${config.tenantId}:${capture.finalUrl}`),
      captureId: deterministicUuid("root-capture", captureOperationId), sourceClass: "other", canonicalUrl: capture.finalUrl,
      sensitivity: "public", artifact, capturedAt: capture.capturedAt, captureMethod: capture.captureMethod,
      captureMethodVersion: "verification-executor-capture.v2", requestUrl: capture.requestedUrl,
      observations: { executorCaptureId: capture.captureId, bridge: "root-preparation.v1" } });
    await config.database.reconcileOperation(config.tenantId, captureOperationId);
    const transformationOperationId = deterministicUuid("root-transformation", `${captureOperationId}:${input.title}:${input.version}`);
    const transformation = await run("transformation", transformationOperationId, { schemaVersion: "knowledge.transformation/v1", captureOperationId,
      document: { documentKind: "official_docs", canonicalTitle: input.title, versionLabel: input.version },
      profile: { profileKey: "root-exact-text", version: "1", mediaType: artifact.mediaType, managedProcessingAllowed: false },
      providerRoute: ["deterministic-structural-text"] });
    if (transformation.status !== "succeeded") return { capture: retained, transformation };
    const representation = await repository.getRepresentationByOperation(config.tenantId, transformationOperationId);
    if (!representation) throw new Error("ROOT_PREPARATION_REPRESENTATION_MISSING");
    const chunkOperationId = deterministicUuid("root-chunks", transformationOperationId);
    const chunks = await run("chunk_set", chunkOperationId, { schemaVersion: "knowledge.chunk-set/v1",
      representationId: representation.structuralRepresentationId, profileName: "heading-sections-v1", profileVersion: "1.0.0" });
    return { capture: retained, transformation, representation, chunks, requiresIndependentReview: true, publishable: false };
  } };
}
