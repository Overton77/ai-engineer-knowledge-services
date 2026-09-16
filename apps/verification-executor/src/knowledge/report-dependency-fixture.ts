import { randomUUID } from "node:crypto";
import { convertStructuralDocument } from "@aiengineer/knowledge-documents";
import { canonicalJson, sha256Digest } from "@aiengineer/knowledge-domain";
import { JsonValueSchema } from "@aiengineer/knowledge-contracts";
import { PostgresCanonicalRepository, PostgresGovernedIndexRepository, PostgresPreparationRepository,
  type PersistedPreparationArtifact } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import type { VerificationExecutor } from "../executor.js";

/** Actual preparation and independent review for an already sealed native report source. */
export async function prepareReportDependency(input: { databaseUrl: string; tenantId: string;
  storage: { projectUrl: string; secretKey: string }; capture: Awaited<ReturnType<VerificationExecutor["captureFile"]>>; text: string }) {
  const database = new PostgresCanonicalRepository({ connectionString: input.databaseUrl });
  const { tenantId, capture } = input;
  try {
    const operation = async (kind: string, actorIdentity = "report-dependency-producer") => {
      const id = randomUUID();
      await database.createOperation({ id, tenantId, operationKind: kind, idempotencyKey: id, correlationId: randomUUID(),
        actorIdentity, request: { schemaVersion: "report-dependency-fixture.v1" }, steps: [] });
      return id;
    };
    const preparation = new PostgresPreparationRepository(database);
    const source = await database.transaction(tenantId, async client =>
      (await client.query("select * from orchestration.artifact where tenant_id=$1 and id=$2", [tenantId, capture.contentArtifact.artifactId])).rows[0]!);
    if (source.storage_bucket !== "ai-engineer-cloud-bucket" || !/^sha256:[a-f0-9]{64}$/.test(capture.contentArtifact.digest))
      throw new Error("REPORT_FIXTURE_SOURCE_CUSTODY_REQUIRED");
    const sourceArtifact: PersistedPreparationArtifact = { artifactId: capture.contentArtifact.artifactId,
      digest: capture.contentArtifact.digest as `sha256:${string}`, mediaType: String(source.media_type), byteLength: Number(source.size_bytes),
      storageKey: String(source.object_path), artifactType: String(source.artifact_type), bucketClass: "source_captures",
      storageBucket: "ai-engineer-cloud-bucket" };
    const preparedCapture = await preparation.persistCapture(tenantId, { operationId: await operation("capture"),
      sourceId: randomUUID(), captureId: randomUUID(), sourceClass: "other", canonicalUrl: capture.finalUrl, sensitivity: "public",
      artifact: sourceArtifact, capturedAt: capture.capturedAt, captureMethod: capture.captureMethod,
      captureMethodVersion: "verification-executor-capture.v2", requestUrl: capture.finalUrl, observations: { synthetic: true } });
    const representationId = randomUUID(), sourceNativeRepresentationId = randomUUID(), transformOperationId = await operation("transformation");
    const document = convertStructuralDocument({ tenantId, representationId, createdAt: new Date().toISOString(),
      blocks: [{ localKey: "source", ordinal: 0, kind: "paragraph", text: input.text, locator: { page: 1 } }] });
    const nodes = document.nodes.map(({ parentId, role, language, ...node }) => ({ ...node,
      ...(parentId ? { parentId } : {}), ...(role ? { role } : {}), ...(language ? { language } : {}),
      digest: sha256Digest(node.text), stableLocalKey: "source" }));
    const bytes = new TextEncoder().encode(canonicalJson(JsonValueSchema.parse(document)));
    const store = new SupabaseArtifactStore({ ...input.storage, serviceRoleKey: input.storage.secretKey,
      bucket: "ai-engineer-cloud-bucket", maximumBytes: 64000000 });
    const stored = await store.put({ tenantId, mediaType: "application/json", bytes });
    const artifact: PersistedPreparationArtifact = { artifactId: randomUUID(), digest: stored.digest, mediaType: "application/json",
      byteLength: bytes.length, storageKey: stored.storageKey, artifactType: "report_json", bucketClass: "candidate", storageBucket: "ai-engineer-cloud-bucket" };
    await preparation.persistRepresentation(tenantId, { operationId: transformOperationId, transformationRunId: randomUUID(),
      sourceCaptureId: preparedCapture.captureId, sourceArtifact, documentId: randomUUID(), documentKind: "official_docs",
      canonicalTitle: "Native report source", canonicalSourceId: preparedCapture.sourceId, documentVersionId: randomUUID(), versionLabel: "1",
      manifestDigest: sha256Digest(document.digest), sourceNativeRepresentationId, structuralRepresentationId: representationId,
      providerKey: "deterministic-report-proof", providerVersion: "1", profileDigest: sha256Digest("report-proof"),
      requestDigest: sourceArtifact.digest, receiptDigest: sha256Digest(document.digest), outputArtifacts: [artifact],
      structuralArtifactId: artifact.artifactId, structuralArtifactDigest: artifact.digest, nodes,
      fidelity: { grade: "high", coverage: 1, locatorCoverage: 1, findings: [] }, receipt: { synthetic: true, documentDigest: document.digest },
      completedAt: new Date().toISOString() });
    const review = async (kind: "native" | "derived", decision: "accept" | "reject") => {
      const id = kind === "native" ? sourceNativeRepresentationId : representationId;
      const digest = kind === "native" ? sourceArtifact.digest : artifact.digest;
      const reviewerIdentity = "report-dependency-independent-reviewer", subjectId = randomUUID();
      const decisionOperationId = await operation("representation_decision", reviewerIdentity);
      await database.createReviewSubject(tenantId, { id: subjectId, operationId: transformOperationId, subjectKind: "representation",
        subjectRef: { representationId: id, artifactDigest: digest }, guardedSha256: digest.slice(7), eligibleRoles: ["human_reviewer"] });
      const reviewId = await database.recordReviewDecision(tenantId, { id: randomUUID(), reviewSubjectId: subjectId, guardedSha256: digest.slice(7),
        reviewerIdentity, reviewerRole: "human_reviewer", decision: decision === "accept" ? "approve" : "reject",
        rationale: "Synthetic independent exact source review", decisionOperationId });
      await new PostgresGovernedIndexRepository(database).persistRepresentationDecision(tenantId, { operationId: decisionOperationId,
        representationId: id, guardedDigest: digest, knowledgeReviewDecisionId: reviewId, reviewerIdentity, decision,
        policyVersion: "report-dependency-fixture.v1", rationale: "Review the exact native source or its distinct derivative" });
      await database.reconcileOperation(tenantId, decisionOperationId);
    };
    return { review, close: () => database.close() };
  } catch (error) { await database.close(); throw error; }
}
