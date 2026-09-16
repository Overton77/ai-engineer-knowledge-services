import { randomUUID } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ContentLinkIntentSchema, ContentLinkOperationSchema, JsonValueSchema, PromotionSelectionSchema, type ContentLinkOperation, type DeterministicVerificationResult, type VerificationBundle } from "@aiengineer/knowledge-contracts";
import { IngestionIntentSchema, deterministicId, proposalEffect, contentEvidenceAssessmentDigest, type ContentLinkPlan, type ContentLinkReceipt, type ContentSummaryPreparationResult } from "@aiengineer/knowledge-ingestion";
import { convertStructuralDocument } from "@aiengineer/knowledge-documents";
import { chunkDocument, defaultChunkProfileRegistry } from "@aiengineer/knowledge-chunking";
import { canonicalJson, sha256Digest } from "@aiengineer/knowledge-domain";
import { TenantPostgres, PostgresCanonicalRepository, PostgresPreparationRepository, PostgresGovernedIndexRepository, PostgresKnowledgeOperationService, validatePromotionSelection, type PersistedPreparationArtifact, type PromotionSelectionConfiguration, type GovernedProjectionProposal } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore, deterministicUuid } from "@aiengineer/knowledge-runtime";
import { PromotionProposalInputSchema } from "@aiengineer/knowledge-contracts";
import { digestCanonicalJson, verifyAssertionSemantics } from "@aiengineer/knowledge-verification";
import { disposableDatabaseUrl, disposableStorageConfig } from "../../../../packages/persistence/test/disposable.mjs";
import { withSnapshot } from "../../../../packages/ingestion/test/snapshot-fixture.mjs";
import { contentLinkEffect } from "../../../../packages/ingestion/src/content-links/operations.js";
import { DeterministicFakeEmbeddingAdapter } from "../../../../packages/embeddings/src/index.js";
import { VerificationExecutor, loadExecutorConfig } from "../executor.js";
import { PolicyDefinitionInputSchema } from "../intents.js";
import { loadSealedContentClaim } from "./evidence-oracle.js";
import { createKnowledgeServices, type KnowledgeServices } from "./context.js";
import { knowledgeOperations } from "./operations.js";
import { createCanonicalEvidenceReader } from "../evidence-reader.js";
import { createCanonicalActivityExecutor, createProductionActivityRegistry } from "../../../worker/src/activity-registry.js";
import { CanonicalDurableKnowledgeWorker } from "../../../worker/src/canonical-worker.js";
import { composePromotionSelectionHost, createPromotionSelectionAdvance } from "./promotion-selection-host.js";

const databaseUrl = disposableDatabaseUrl();
const storage = disposableStorageConfig();
const statement = "Since 2026, Synthetic Child and Parent organizations operate together in preview.";
const qualifiers = ["in preview"];
const policyDigest = digestCanonicalJson({ schemaVersion: "verification-policy.v1", definitionId: "policy-executor-default.v1", ...PolicyDefinitionInputSchema.parse({}) });
type Row = Record<string, unknown>;
type Claim = { claimId: string; value: string; entityBindings: { role: string; canonicalId: string }[]; downstreamUse: string[] };
const relationshipStart = "2026-01-01T00:00:00.000001Z";

function contentOperations(services: KnowledgeServices) {
  return {
    plan: async (intent: unknown) => (await knowledgeOperations.invoke("content_link_plan", { intent }, services)).output as ContentLinkPlan,
    apply: async (intent: unknown) => (await knowledgeOperations.invoke("content_link_apply", { intent }, services)).output as ContentLinkReceipt,
    receipt: async (receiptId: string) => (await knowledgeOperations.invoke("content_link_receipt", { receiptId }, services)).output as ContentLinkReceipt,
    prepareSummary: async (operation: unknown) => (await knowledgeOperations.invoke("content_summary_prepare", { operation }, services)).output as ContentSummaryPreparationResult,
  };
}

async function sealSyntheticClaims(input: { verifier: VerificationExecutor; runId: string; captureId: string; claims: Claim[] }) {
  const { verifier, runId, captureId } = input;
  await verifier.verifyClaims({ runId, intent: { schemaVersion: "verification-claims-intent.v1", intentId: `content-${runId}`,
    claims: input.claims.map(claim => ({ ...claim, claimType: "capability", proposition: statement, qualifiers,
      evidence: [{ captureId, quote: statement }] })) } });
  const { state } = await verifier.runStatus({ runId });
  const bundle = await verifier.store.json<VerificationBundle>(await verifier.store.resolveHandle({ artifactId: state.bundleArtifactId! }));
  const deterministicResult = await verifier.store.json<DeterministicVerificationResult>(await verifier.store.resolveHandle({ artifactId: state.resultArtifactId! }));
  const identity = { deploymentId: "p3-content-synthetic-judge", provider: "synthetic", family: "synthetic", model: "disposable-proof",
    capability: "llm_evidence_rubric" as const, graderVersion: "synthetic.v1", promptDigest: sha256Digest("prompt"),
    outputSchemaDigest: sha256Digest("schema"), configurationDigest: sha256Digest("config") };
  const assessments = [];
  for (const assertion of bundle.assertions) {
    const edge = assertion.evidence[0]!;
    assessments.push(await verifyAssertionSemantics({ bundle, deterministicResult, assertionId: assertion.assertionId,
      selectedFragments: [{ evidenceId: edge.evidenceId, fragmentId: edge.fragment.fragmentId, exactText: statement, selectedContentDigest: sha256Digest(statement) }],
      adapters: { primary: { identity, maximumInputCharacters: 64000, judge: async () => ({ schemaVersion: "verification-semantic-judge.v1",
        assertionId: assertion.assertionId, verdict: "directly_supported", nliLabel: "entailed", supportingFragmentIds: [edge.fragment.fragmentId],
        contradictingFragmentIds: [], unsupportedFacets: [], qualifiersPreserved: true,
        publicRationale: "Synthetic deterministic fixture judgment; preview qualification retained. Not a live model result." }) } } }));
  }
  const semantic = await verifier.store.putJson({ schemaVersion: "verification-semantic-assessments.v1", runId, assessments, skipped: [] }, {
    mediaType: "application/json", producerActivityId: "p3-content:synthetic-judge", producerVersion: "synthetic.v1",
    parentArtifactIds: [state.resultArtifactId!], transformation: { kind: "synthetic_test_judgment" } });
  state.semanticArtifactId = semantic.handle.artifactId;
  await verifier.store.writeRun(state);
  await verifier.evaluatePolicy({ runId });
  return verifier.sealRun({ runId });
}

async function createOperation(database: PostgresCanonicalRepository, tenantId: string, input: { kind: string; actorIdentity?: string; attemptId?: string }) {
  const id = randomUUID();
  await database.createOperation({ id, tenantId, operationKind: input.kind, idempotencyKey: `content-fixture:${id}`,
    correlationId: randomUUID(), actorIdentity: input.actorIdentity ?? "p3-content-fixture", ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    request: { schemaVersion: "content-fixture.v1" }, steps: [] });
  return id;
}

async function reviewRepresentation(database: PostgresCanonicalRepository, input: { tenantId: string; representationId: string; digest: `sha256:${string}`; operationId: string; decision: "accept" | "reject"; reviewerIdentity?: string; reviewerAttemptId?: string; expiresAt?: string }) {
  const reviewerIdentity = input.reviewerIdentity ?? "p3-content-independent-reviewer";
  const subjectId = randomUUID(), decisionOperationId = await createOperation(database, input.tenantId,
    { kind: "representation_decision", actorIdentity: reviewerIdentity, ...(input.reviewerAttemptId ? { attemptId: input.reviewerAttemptId } : {}) });
  await database.createReviewSubject(input.tenantId, { id: subjectId, operationId: input.operationId, subjectKind: "representation",
    subjectRef: { representationId: input.representationId, artifactDigest: input.digest }, guardedSha256: input.digest.slice(7), eligibleRoles: ["human_reviewer"] });
  const knowledgeReviewDecisionId = await database.recordReviewDecision(input.tenantId, { id: randomUUID(), reviewSubjectId: subjectId,
    guardedSha256: input.digest.slice(7), reviewerIdentity, reviewerRole: "human_reviewer",
    decision: input.decision === "accept" ? "approve" : "reject", rationale: "Fixture review checked exact representation bytes and source locators.", decisionOperationId });
  const decisionId = await new PostgresGovernedIndexRepository(database).persistRepresentationDecision(input.tenantId, { operationId: decisionOperationId,
    representationId: input.representationId, guardedDigest: input.digest, knowledgeReviewDecisionId,
    reviewerIdentity, decision: input.decision, policyVersion: "p3-content-fixture.v1", rationale: "Exact representation custody reviewed.",
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}) });
  await database.reconcileOperation(input.tenantId, decisionOperationId);
  return decisionId;
}

async function canonicalReference(input: { db: TenantPostgres; verifier: VerificationExecutor; tenantId: string; runId: string; claimKey: string; manifestDigest: string }) {
  const sealed = await loadSealedContentClaim(input.verifier, { ...input, policyVersion: "executor-default.v1", policyDigest });
  const row = await input.db.transaction({ tenantId: input.tenantId, readOnly: true }, async client => (await client.query<Row>(`
    select c.id claim_id,a.id assessment_id,a.verdict,a.authority_assessment,a.replay_signature_match,a.properties,a.public_rationale,
      l.role,l.locator_id,loc.capture_id,r.run_manifest_artifact_id,art.sha256 audit_sha256
    from evidence.claim c join evidence.claim_evidence_link l on l.tenant_id=c.tenant_id and l.claim_id=c.id
    join evidence.claim_evidence_assessment a on a.tenant_id=l.tenant_id and a.claim_evidence_link_id=l.id
    join evidence.locator loc on loc.tenant_id=l.tenant_id and loc.id=l.locator_id
    join evidence.verification_run r on r.tenant_id=a.tenant_id and r.id=a.run_id
    join orchestration.artifact art on art.tenant_id=r.tenant_id and art.id=r.run_manifest_artifact_id
    where c.tenant_id=$1 and a.run_id=$2 and c.structured->'verification'->>'claimId'=$3 and l.role='supports'`,
  [input.tenantId, input.runId, input.claimKey])).rows[0]);
  if (!row) throw new Error(`Canonical admitted claim missing: ${input.claimKey}`);
  const binding = { tenantId: input.tenantId, assessmentId: String(row.assessment_id), claimId: String(row.claim_id), runId: input.runId,
    locatorId: String(row.locator_id), captureId: String(row.capture_id), role: String(row.role), verdict: String(row.verdict),
    authority: row.authority_assessment, replaySignatureMatch: row.replay_signature_match === true, properties: row.properties,
    publicRationale: row.public_rationale === null ? null : String(row.public_rationale) };
  return { claimId: binding.claimId, claimKey: input.claimKey, claimDigest: sealed.assertionDigest, runId: input.runId,
    manifest: { id: String(row.run_manifest_artifact_id), digest: `sha256:${String(row.audit_sha256)}` },
    assessment: { id: binding.assessmentId, digest: contentEvidenceAssessmentDigest(binding) }, locatorId: binding.locatorId,
    captureId: binding.captureId, role: "supports" as const };
}

describe.skipIf(!databaseUrl || !storage)("outer content-link executor on guarded disposable PostgreSQL and Storage", () => {
  it.each([false, true])("applies canonical links with summaries=%s through native seals, prepared bytes and independent review", async includeSummaries => {
    const tenantId = randomUUID(), missionId = randomUUID(), workItemId = randomUUID(), attemptId = randomUUID(), verifierAttemptId = randomUUID();
    const promotionReviewerAttemptId = randomUUID(), aliasedReviewerAttemptId = randomUUID();
    const directory = await mkdtemp(join(tmpdir(), "ks-p3-content-links-"));
    console.info(`P3 content-link fixture evidence: ${directory}`);
    const db = new TenantPostgres({ connectionString: databaseUrl! });
    const database = new PostgresCanonicalRepository({ connectionString: databaseUrl! });
    let services: KnowledgeServices | undefined;
    try {
      await db.transaction({ tenantId }, async client => {
        await client.query("insert into orchestration.mission(id,tenant_id,goal) values($1,$2,'P3 isolated five-kind content-link proof')", [missionId, tenantId]);
        await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind) values($1,$2,$3,'build_vectors')", [workItemId, tenantId, missionId]);
        await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,1,'p3-content-producer'),($4,$2,$3,2,'p3-content-verifier')", [attemptId, tenantId, workItemId, verifierAttemptId]);
        await client.query(`insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id)
          values($1,$2,$3,3,'p5-promotion-reviewer'),($4,$2,$3,4,'p3-content-producer')`, [promotionReviewerAttemptId, tenantId, workItemId, aliasedReviewerAttemptId]);
      });
      const verifier = await VerificationExecutor.create(loadExecutorConfig({ VERIFY_STORE_DIR: directory, VERIFY_TENANT_ID: tenantId,
        VERIFY_GIT_SHA: "p3-content-synthetic-fixture", VERIFY_PRODUCER_ATTEMPT_ID: attemptId, VERIFY_VERIFIER_ATTEMPT_ID: verifierAttemptId,
        VERIFY_PRODUCER_DEPLOYMENT_ID: "p3-content-producer", VERIFY_VERIFIER_DEPLOYMENT_ID: "p3-content-verifier" }));
      services = createKnowledgeServices({ databaseUrl: databaseUrl!, defaultTenantId: tenantId, producerAttemptId: attemptId, missionId,
        workspaceDir: resolve(import.meta.dirname, "../../../../../ai-engineer-db-contract/workspace"), artifactDir: join(directory, "knowledge"),
        allowStale: false, contentLinksEnabled: true, evidenceOracle: "verification-store", evidencePolicyVersion: "executor-default.v1",
        evidencePolicyDigest: policyDigest, storage: storage! }, { verification: verifier });
      const { artifacts, workspace, reads, ingestion } = services;
      const executor = contentOperations(services);
      const sourceStore = new SupabaseArtifactStore({ ...storage!, serviceRoleKey: storage!.secretKey, bucket: "ai-engineer-cloud-bucket", maximumBytes: 64000000 });
      const runId = randomUUID();
      const capture = await verifier.captureFile({ runId, bytes: new TextEncoder().encode(statement), filename: "content-source.txt", sourceUri: `https://synthetic.invalid/content/${tenantId}` });
      const common = { proposition: statement, qualifiers };
      const ingestIntent = IngestionIntentSchema.parse({ schemaVersion: "knowledge-ingestion-intent.v1", intentId: "content-authority", context: { tenantId, missionId, attemptId },
        evidence: { verificationRuns: [{ runId }] }, subjects: ["child", "parent"].map(ref => ({ mode: "new", ref, kind: "organization", displayName: `Synthetic ${ref} ${tenantId}`, onMatch: "fail" })),
        proposals: [
          { kind: "claim.materialize", proposalId: "claims", runId, claimIds: ["child", "parent", "relationship", "record"] },
          ...["child", "parent"].map(ref => ({ kind: "entity.create", proposalId: ref, subjectRef: ref, ...common, evidence: [{ runId, claimId: ref }] })),
          { kind: "relationship.assert", proposalId: "relationship", relationshipKind: "subsidiary_of", fromRef: "child", toRef: "parent", qualifier: "in preview",
            worldInterval: { from: relationshipStart, to: null }, temporalBasis: "explicit",
            extent: { sourceText: "2026", precision: "year", earliest: "2026-01-01", latest: "2026-12-31" }, ...common, evidence: [{ runId, claimId: "relationship" }] },
          { kind: "record.materialize", proposalId: "record", recordKind: "compatibility_constraint", subjectRef: "child", title: "Preview restriction",
            constraintKind: "capability_restriction", expression: "preview_only", ...common, evidence: [{ runId, claimId: "record" }] },
        ] });
      const predicted = (ref: string) => deterministicId("corpus.entity", [tenantId, ingestIntent.intentId, ref].join("\0"));
      const claims: Claim[] = ingestIntent.proposals.filter(proposal => proposal.kind !== "claim.materialize").map(proposal => ({
        claimId: proposal.evidence[0]!.claimId, value: proposalEffect(ingestIntent, proposal),
        entityBindings: proposal.kind === "relationship.assert" ? [{ role: "subject", canonicalId: predicted("child") }, { role: "object", canonicalId: predicted("parent") }]
          : [{ role: "subject", canonicalId: predicted(proposal.proposalId === "parent" ? "parent" : "child") }],
        downstreamUse: ["knowledge_ingestion:claim.materialize", `knowledge_ingestion:${proposal.kind}`, "content_link:chunk.claim.link", "content_link:chunk.relationship.link", "content_link:projection.target.link"],
      }));
      const sealed = await sealSyntheticClaims({ verifier, runId, captureId: capture.captureId, claims });
      ingestIntent.evidence.verificationRuns[0]!.manifestDigest = sealed.manifestDigest;
      const ingested = await ingestion.apply(await withSnapshot(reads, ingestIntent));
      expect(ingested.outcome, JSON.stringify(ingested.failure)).toBe("applied");
      const entityId = ingested.subjects.find(subject => subject.ref === "child")!.entityId!;
      expect(entityId).toBe(predicted("child"));
      const relationshipId = ingested.proposals.find(proposal => proposal.proposalId === "relationship")!.created!.relationshipId as string;
      const temporalSource = await db.transaction({ tenantId, readOnly: true }, async client => (await client.query<Row>(`
        select lower(s.valid_during)::text valid_from from temporal.segment s join temporal.stream t on t.tenant_id=s.tenant_id and t.id=s.stream_id
        where t.tenant_id=$1 and t.subject_relationship_id=$2 and t.kind='relationship_active' and s.k_to is null`, [tenantId, relationshipId])).rows[0]);
      expect(temporalSource?.valid_from).toBe("2026-01-01 00:00:00.000001+00");
      const recordId = ingested.proposals.find(proposal => proposal.proposalId === "record")!.created!.recordId as string;
      const recordEvidence = await canonicalReference({ db, verifier, tenantId, runId, claimKey: "record", manifestDigest: sealed.manifestDigest });
      const remoteReader = createCanonicalEvidenceReader({ databaseUrl: databaseUrl!, tenantId,
        projectUrl: storage!.projectUrl, secretKey: storage!.secretKey, policyVersion: "executor-default.v1", policyDigest });
      try {
        const request = { tenantId, claimId: recordEvidence.claimId, runId, claimKey: "record", manifestDigest: sealed.manifestDigest, policyDigest };
        const remoteClaim = await remoteReader.loadClaim(request);
        expect(remoteClaim.assertionDigest).toBe(recordEvidence.claimDigest);
        expect(remoteClaim.claim.statement).toBe(statement);
        expect(remoteClaim.claim.qualifiers).toEqual(qualifiers);
        expect([...remoteClaim.selectedText.values()]).toContain(statement);
        await expect(remoteReader.loadClaim({ ...request, tenantId: randomUUID() })).rejects.toThrow("EVIDENCE_READER_AUTHORITY_MISMATCH");
        await expect(remoteReader.loadClaim({ ...request, manifestDigest: sha256Digest("wrong manifest") })).rejects.toThrow("EVIDENCE_READER_CANONICAL_RUN_MISSING");
      } finally { await remoteReader.close(); }
      const relationshipEvidence = await canonicalReference({ db, verifier, tenantId, runId, claimKey: "relationship", manifestDigest: sealed.manifestDigest });

      const preparation = new PostgresPreparationRepository(database);
      const captureOperationId = await createOperation(database, tenantId, { kind: "capture" });
      const physical = await db.transaction({ tenantId, readOnly: true }, async client => (await client.query<Row>("select * from orchestration.artifact where tenant_id=$1 and id=$2", [tenantId, capture.contentArtifact.artifactId])).rows[0]!);
      const sourceArtifact: PersistedPreparationArtifact = { artifactId: capture.contentArtifact.artifactId, digest: `sha256:${capture.contentArtifact.digest.slice(7)}`,
        mediaType: String(physical.media_type), byteLength: Number(physical.size_bytes), storageKey: String(physical.object_path),
        artifactType: String(physical.artifact_type), bucketClass: "source_captures", storageBucket: "ai-engineer-cloud-bucket" };
      const preparedCapture = await preparation.persistCapture(tenantId, { operationId: captureOperationId, sourceId: randomUUID(), captureId: randomUUID(),
        sourceClass: "other", canonicalUrl: capture.finalUrl, sensitivity: "public", artifact: sourceArtifact, capturedAt: capture.capturedAt,
        captureMethod: capture.captureMethod, captureMethodVersion: "verification-executor-capture.v2", requestUrl: capture.finalUrl, observations: { fixture: "native content links" } });
      expect(preparedCapture.captureId).toBe(recordEvidence.captureId);
      const representationId = randomUUID(), documentId = randomUUID(), documentVersionId = randomUUID();
      const blocks = [{ localKey: "paragraph", ordinal: 0, kind: "paragraph" as const, text: statement, locator: { page: 1, sectionPath: ["Preview"] } }];
      const document = convertStructuralDocument({ tenantId, representationId, createdAt: new Date().toISOString(), blocks });
      const persistedNodes = document.nodes.map((node, index) => ({ ...node, digest: sha256Digest(node.text), stableLocalKey: blocks[index]!.localKey }));
      const structuralBytes = new TextEncoder().encode(canonicalJson(JsonValueSchema.parse(document)));
      const stored = await sourceStore.put({ tenantId, mediaType: "application/json", bytes: structuralBytes });
      const structuralArtifact: PersistedPreparationArtifact = { artifactId: randomUUID(), digest: stored.digest, mediaType: "application/json", byteLength: structuralBytes.length,
        storageKey: stored.storageKey, artifactType: "report_json", bucketClass: "candidate", storageBucket: "ai-engineer-cloud-bucket" };
      const transformOperationId = await createOperation(database, tenantId, { kind: "transformation" }), transformationRunId = randomUUID();
      const manifestDigest = sha256Digest({ source: sourceArtifact.digest, structure: document.digest });
      const conversionReceipt = { converter: "convertStructuralDocument", inputDigest: sourceArtifact.digest,
        outputDigest: structuralArtifact.digest, documentDigest: document.digest, nodeCount: document.nodes.length };
      await preparation.persistRepresentation(tenantId, { operationId: transformOperationId, transformationRunId, sourceCaptureId: preparedCapture.captureId, sourceArtifact,
        documentId, documentKind: "official_docs", canonicalTitle: "Synthetic preview source", canonicalSourceId: preparedCapture.sourceId,
        documentVersionId, versionLabel: "v1", manifestDigest, sourceNativeRepresentationId: randomUUID(), structuralRepresentationId: representationId,
        providerKey: "deterministic-structural-fixture", providerVersion: "1", profileDigest: sha256Digest("profile"), requestDigest: sourceArtifact.digest,
        receiptDigest: sha256Digest(conversionReceipt), outputArtifacts: [structuralArtifact], structuralArtifactId: structuralArtifact.artifactId,
        structuralArtifactDigest: structuralArtifact.digest, nodes: persistedNodes,
        fidelity: { grade: "high", coverage: 1, locatorCoverage: 1, findings: [] }, receipt: conversionReceipt, completedAt: new Date().toISOString() });
      await artifacts.reconcile({ tenantId, artifactId: structuralArtifact.artifactId });
      const representationDecisionId = await reviewRepresentation(database, { tenantId, representationId, digest: structuralArtifact.digest, operationId: transformOperationId, decision: "accept" });
      const profile = defaultChunkProfileRegistry.get("heading-sections-v1"), chunked = chunkDocument(persistedNodes, profile);
      await preparation.persistChunkSet(tenantId, { operationId: await createOperation(database, tenantId, { kind: "chunk" }), representationId,
        procedureVersionId: randomUUID(), procedureSlug: profile.name, procedureVersion: profile.version, tokenizer: profile.tokenizer, profile,
        inputDigest: chunked.inputDigest, outputDigest: chunked.outputDigest, chunkSetId: randomUUID(), chunks: chunked.chunks.map(chunk => ({ ...chunk,
          spans: chunk.spans.map(span => ({ ...span, selectedTextDigest: sha256Digest(document.nodes.find(node => node.id === span.nodeId)!.text.slice(span.startOffset, span.endOffset)) })) })) });
      const node = persistedNodes[0]!, preparedChunk = chunked.chunks[0]!;
      const sourceNode = { id: node.id, digest: node.digest, representationId };
      const chunk = { id: preparedChunk.id, digest: preparedChunk.sourceTextDigest, documentVersionId,
        representation: { id: representationId, digest: structuralArtifact.digest }, captureId: preparedCapture.captureId, sourceNodes: [sourceNode] };
      const base = { dependsOn: [], evidence: [recordEvidence], rationale: "Exact native admitted source linkage.", applicability: { validFrom: null, validTo: null, qualifiers } };
      const documentEntity = ContentLinkOperationSchema.parse({ ...base, operationId: "document-entity", kind: "document.entity.link", documentId,
        documentVersion: { id: documentVersionId, digest: manifestDigest }, entityId, role: "mention", method: "extraction", sourceNodes: [sourceNode] });
      const chunkEntity = ContentLinkOperationSchema.parse({ ...base, operationId: "chunk-entity", kind: "chunk.entity.link", chunk, entityId, verb: "mentions", method: "extraction" });
      const summaryText = `${statement}\n${qualifiers.join("\n")}`, summaryId = randomUUID();
      const summary = ContentLinkOperationSchema.parse({ ...base, operationId: "summary", kind: "summary.materialize", summaryId,
        documentVersion: { id: documentVersionId, digest: manifestDigest }, representation: { id: randomUUID(), digest: sha256Digest(summaryText) },
        derivedFrom: { id: representationId, digest: structuralArtifact.digest }, transformationRunId: randomUUID(),
        summaryKind: "technical", scope: "document", audience: "engineer", text: summaryText, tokenCount: summaryText.split(/\s+/).length,
        sources: [{ ...sourceNode, weight: 1 }] });
      const summarySource = ContentLinkOperationSchema.parse({ ...base, operationId: "summary-source", kind: "summary.source.link", summaryId,
        source: { ...sourceNode, weight: 1 } });
      const effectRunId = randomUUID();
      const effectOperations = [documentEntity, chunkEntity, ...(includeSummaries ? [summary, summarySource] : [])];
      const contentClaims: Claim[] = effectOperations.map(operation => ({ claimId: operation.operationId, value: contentLinkEffect(operation),
        entityBindings: [{ role: "subject", canonicalId: entityId }], downstreamUse: ["knowledge_ingestion:claim.materialize", `content_link:${operation.kind}`] }));
      const effectsSealed = await sealSyntheticClaims({ verifier, runId: effectRunId, captureId: capture.captureId, claims: contentClaims });
      const contentIngestion = IngestionIntentSchema.parse({ schemaVersion: "knowledge-ingestion-intent.v1", intentId: "content-effect-claims",
        context: { tenantId, missionId, attemptId }, evidence: { verificationRuns: [{ runId: effectRunId, manifestDigest: effectsSealed.manifestDigest }] },
        subjects: [{ mode: "resolved", ref: "child", kind: "organization", entityId }],
        proposals: [{ kind: "claim.materialize", proposalId: "claims", runId: effectRunId, claimIds: contentClaims.map(claim => claim.claimId) }] });
      const contentIngested = await ingestion.apply(await withSnapshot(reads, contentIngestion));
      expect(contentIngested.outcome, JSON.stringify(contentIngested.failure)).toBe("applied");
      const documentEvidence = await canonicalReference({ db, verifier, tenantId, runId: effectRunId, claimKey: documentEntity.operationId, manifestDigest: effectsSealed.manifestDigest });
      const chunkEvidence = await canonicalReference({ db, verifier, tenantId, runId: effectRunId, claimKey: chunkEntity.operationId, manifestDigest: effectsSealed.manifestDigest });
      const operations: ContentLinkOperation[] = [
        { ...documentEntity, evidence: [documentEvidence] }, { ...chunkEntity, evidence: [chunkEvidence] },
        ContentLinkOperationSchema.parse({ ...base, operationId: "chunk-claim", kind: "chunk.claim.link", chunk, claimId: recordEvidence.claimId, verb: "supports" }),
        ContentLinkOperationSchema.parse({ ...base, operationId: "chunk-relationship", kind: "chunk.relationship.link", chunk, relationshipId, verb: "supports",
          evidence: [relationshipEvidence], applicability: { validFrom: relationshipStart, validTo: null, qualifiers } }),
        ContentLinkOperationSchema.parse({ ...base, operationId: "record-target", kind: "projection.target.link", target: { kind: "record", canonicalId: recordId }, sourceChunks: [chunk], dependsOn: ["chunk-claim"] }),
      ];
      if (includeSummaries && summary.kind === "summary.materialize") {
        const summaryEvidence = await canonicalReference({ db, verifier, tenantId, runId: effectRunId, claimKey: summary.operationId, manifestDigest: effectsSealed.manifestDigest });
        const summarySourceEvidence = await canonicalReference({ db, verifier, tenantId, runId: effectRunId, claimKey: summarySource.operationId, manifestDigest: effectsSealed.manifestDigest });
        const authenticatedSummary = { ...summary, evidence: [summaryEvidence] };
        const prepared = await executor.prepareSummary(authenticatedSummary);
        expect(prepared.acceptanceState).toBe("pending");
        expect((await artifacts.get(tenantId, prepared.outputArtifact.artifactId)).text).toBe(summaryText);
        const summaryReviewOperationId = await createOperation(database, tenantId, { kind: "representation_review" });
        await reviewRepresentation(database, { tenantId, representationId: prepared.representationId, digest: prepared.outputArtifact.digest,
          operationId: summaryReviewOperationId, decision: "accept" });
        expect((await executor.prepareSummary(authenticatedSummary)).acceptanceState).toBe("accepted");
        await reviewRepresentation(database, { tenantId, representationId: prepared.representationId, digest: prepared.outputArtifact.digest,
          operationId: summaryReviewOperationId, decision: "accept", reviewerIdentity: "apparently-independent-reviewer", reviewerAttemptId: attemptId });
        expect((await executor.prepareSummary(authenticatedSummary)).acceptanceState).toBe("unaccepted");
        await reviewRepresentation(database, { tenantId, representationId: prepared.representationId, digest: prepared.outputArtifact.digest,
          operationId: summaryReviewOperationId, decision: "accept", reviewerIdentity: "aliased-deployment-reviewer", reviewerAttemptId: aliasedReviewerAttemptId });
        expect((await executor.prepareSummary(authenticatedSummary)).acceptanceState).toBe("unaccepted");
        await reviewRepresentation(database, { tenantId, representationId: prepared.representationId, digest: prepared.outputArtifact.digest,
          operationId: summaryReviewOperationId, decision: "accept" });
        const replayed = await executor.prepareSummary(authenticatedSummary);
        expect(replayed.acceptanceState).toBe("accepted");
        expect(replayed.outputArtifact.artifactId).toBe(prepared.outputArtifact.artifactId);
        expect(replayed.receiptArtifact.artifactId).toBe(prepared.receiptArtifact.artifactId);
        operations.push(authenticatedSummary, { ...summarySource, evidence: [summarySourceEvidence] },
          ContentLinkOperationSchema.parse({ ...base, operationId: "summary-target", kind: "projection.target.link",
            target: { kind: "summary", canonicalId: summaryId }, sourceChunks: [chunk], dependsOn: ["summary"] }));
      }
      const snapshot = await reads.runIntent({ schemaVersion: "knowledge-read-intent.v1", intentId: "content-clock", context: { tenantId, missionId, attemptId },
        operations: [{ opId: "head", query: "knowledge.head" }] }, { persist: true });
      const snapshotArtifact = await artifacts.get(tenantId, snapshot.storage!.artifactId!);
      const intent = ContentLinkIntentSchema.parse({ schemaVersion: "content-link-intent.v1", intentId: includeSummaries ? "content-seven-kinds" : "content-five-kinds",
        context: { tenantId, missionId, attemptId, actor: { kind: "agent", id: "content-reconciler" } },
        contract: { migrationHead: workspace.migrationHead, workspaceFingerprint: workspace.fingerprint, policyDigest },
        inputSnapshot: { artifact: { id: snapshotArtifact.record.artifactId, digest: snapshotArtifact.record.digest }, knowledgeSeq: snapshot.atKnowledgeSeq },
        expectedKnowledgeHead: snapshot.atKnowledgeSeq, asOf: new Date().toISOString(), operations });
      const plan = await executor.plan(intent);
      expect(plan.operations.map(operation => [operation.operationId, operation.outcome, operation.reasons])).toEqual(operations.map(operation => [operation.operationId, operation.kind === "summary.source.link" ? "no_op" : "applied", []]));
      const admittedRelationship = operations.find(operation => operation.kind === "chunk.relationship.link")!;
      const truncatedTimePlan = await executor.plan({ ...intent, intentId: "truncated-microsecond", operations: [{ ...admittedRelationship,
        applicability: { ...admittedRelationship.applicability, validFrom: "2026-01-01T00:00:00.000000Z" } }] });
      expect(truncatedTimePlan.operations[0]).toMatchObject({ outcome: "held", reasons: ["CONTENT_TEMPORAL_AUTHORITY_REQUIRED"] });
      const admittedDocument = operations[0]!;
      const forgedClaimPlan = await executor.plan({ ...intent, intentId: "forged-claim-digest", operations: [{ ...admittedDocument,
        evidence: [{ ...admittedDocument.evidence[0], claimDigest: sha256Digest("foreign claim") }] }] });
      expect(forgedClaimPlan.operations[0]!.outcome).toBe("held");
      if (admittedDocument.kind === "document.entity.link") {
        const forgedNodePlan = await executor.plan({ ...intent, intentId: "forged-node-digest", operations: [{ ...admittedDocument,
          sourceNodes: [{ ...sourceNode, digest: sha256Digest("foreign source") }] }] });
        expect(forgedNodePlan.operations[0]!.outcome).toBe("held");
      }
      const receipt = await executor.apply(intent);
      expect(receipt.outcome).toBe("applied");
      expect(receipt.operations).toHaveLength(includeSummaries ? 8 : 5);
      expect(receipt.operations.every(operation => operation.canonicalRefs.length > 0)).toBe(true);
      expect(await executor.receipt(receipt.receiptId)).toEqual(receipt);
      expect((await executor.apply(intent)).duplicateOf).toBe(receipt.receiptId);
      const storedReceipt = await artifacts.get(tenantId, receipt.artifacts.receiptId);
      expect(storedReceipt.json).toMatchObject({ intent, operations: receipt.operations });
      await expect(executor.plan({ ...intent, context: { ...intent.context, tenantId: randomUUID() } })).rejects.toBeDefined();
      const targetRef = receipt.operations.find(operation => operation.operationId === "record-target")!.canonicalRefs.find(ref => ref.table === "projection_target")!;
      const admitted = await loadSealedContentClaim(verifier, { tenantId, runId, claimKey: "record", manifestDigest: sealed.manifestDigest,
        policyVersion: "executor-default.v1", policyDigest });
      const representationClass = await db.transaction({ tenantId, readOnly: true }, async client =>
        (await client.query<{ representation_class: string }>("select representation_class from content.document_representation where tenant_id=$1 and id=$2", [tenantId, representationId])).rows[0]!.representation_class);
      const targetSpaces: ("engineering_claims" | "tool_capabilities")[] = includeSummaries ? ["engineering_claims", "tool_capabilities"] : ["engineering_claims"];
      const summaryTargetRef = includeSummaries
        ? receipt.operations.find(operation => operation.operationId === "summary-target")!.canonicalRefs.find(ref => ref.table === "projection_target")!
        : undefined;
      const selectedSource = { chunkId: chunk.id, chunkDigest: chunk.digest, representationId, representationDigest: structuralArtifact.digest,
        representationClass, captureId: preparedCapture.captureId, sourceFamilyId: preparedCapture.sourceId };
      const selectedClaims = [{ runId, claimId: "record", claimDigest: recordEvidence.claimDigest,
        admissionDigest: sha256Digest(canonicalJson(JsonValueSchema.parse(admitted.claim.provenance))) }];
      const selectedMembers = [
        { memberId: "qualified-record", content: { kind: "record", id: recordId, digest: sha256Digest([statement, ...qualifiers].join("\n")) },
          target: { kind: "record", canonicalId: recordId, projectionTargetId: targetRef.key.id }, targetSpaces,
          sourceChunks: [selectedSource], admittedClaims: selectedClaims, contentLinkReceiptIds: [receipt.receiptId],
          reason: "Select the admitted qualified engineering record.", estimatedBytes: 0, estimatedTokens: 0, estimatedCostMicros: 0 },
        ...(summaryTargetRef ? [{ memberId: "prepared-summary", content: { kind: "summary", id: summaryId, digest: sha256Digest(summaryText) },
          target: { kind: "summary", canonicalId: summaryId, projectionTargetId: summaryTargetRef.key.id }, targetSpaces,
          sourceChunks: [selectedSource], admittedClaims: selectedClaims, contentLinkReceiptIds: [receipt.receiptId],
          reason: "Select the independently reviewed prepared summary representation.",
          estimatedBytes: 0, estimatedTokens: 0, estimatedCostMicros: 0 }] : []),
      ];
      const selection = PromotionSelectionSchema.parse({ schemaVersion: "promotion-selection.v1", tenantId,
        expectedKnowledgeHead: receipt.head.after, runPinDigest: sha256Digest("p5-isolated-selection-pin"), policyDigest,
        proposedBy: randomUUID(), requiredReviewer: randomUUID(),
        budget: { maxMembers: selectedMembers.length, maxBytes: 4096, maxTokens: 4096, maxCostMicros: 0, deadline: new Date(Date.now() + 3600000).toISOString() },
        selected: selectedMembers,
        excluded: [{ content: { kind: "entity", id: entityId, digest: sha256Digest("unselected entity") },
          targetSpaces, reason: "The entity is linked but outside this selected publication." }] });
      const selectionHandle = await verifier.store.put({ bytes: new TextEncoder().encode(JSON.stringify(selection)),
        mediaType: "application/vnd.aiengineer.promotion-selection+json", producerActivityId: "p5-selection-fixture", producerVersion: "1" });
      const authorityHandle = await verifier.store.put({ bytes: new TextEncoder().encode(JSON.stringify({
        schemaVersion: "promotion-selection-authority.v1", tenantId, runPinDigest: selection.runPinDigest, policyDigest,
        proposedBy: selection.proposedBy, requiredReviewer: selection.requiredReviewer, budget: selection.budget })),
        mediaType: "application/vnd.aiengineer.promotion-selection-authority+json",
        producerActivityId: "p5-selection-authority-fixture", producerVersion: "1" });
      const ledgerStore = new SupabaseArtifactStore({ ...storage!, serviceRoleKey: storage!.secretKey,
        bucket: "research-ingestion-intents", maximumBytes: 64000000 });
      const withSelectionAuthority = async <T>(action: (configuration: PromotionSelectionConfiguration) => Promise<T>,
        measure: (input: { text: string; targetSpaces: typeof selectedMembers[number]["targetSpaces"] }) => Promise<{ tokens: number; costMicros: number }>
          = async ({ text }) => ({ tokens: Buffer.byteLength(text, "utf8"), costMicros: 0 })): Promise<T> => {
        const evidence = createCanonicalEvidenceReader({ databaseUrl: databaseUrl!, tenantId, projectUrl: storage!.projectUrl,
          secretKey: storage!.secretKey, policyVersion: "executor-default.v1", policyDigest });
        try {
          return await action(composePromotionSelectionHost({ tenantId, policyDigest, artifacts, evidence,
            artifactStores: { "ai-engineer-cloud-bucket": sourceStore, "research-ingestion-intents": ledgerStore },
            measure, authorityArtifact: { id: authorityHandle.artifactId, digest: authorityHandle.digest } }).promotionSelection);
        } finally { await evidence.close(); }
      };
      const selectionArtifact = { id: selectionHandle.artifactId, digest: selectionHandle.digest };
      const validateSelected = () => withSelectionAuthority(configuration => db.transaction({ tenantId, readOnly: true }, async client =>
        validatePromotionSelection(client, { selection, artifact: selectionArtifact, ports: configuration.selectionPorts,
          authority: await configuration.selectionAuthority(client, tenantId) })));
      const selected = await validateSelected();
      const selectedText = [statement, ...qualifiers].join("\n");
      expect(selected.members.map(member => member.memberId)).toEqual(selectedMembers.map(member => member.memberId));
      expect(selected.members.map(member => member.embeddingText)).toEqual(selectedMembers.map(() => selectedText));
      const representationBindings = [...new Set(selected.members.flatMap(member => member.representations.map(item => item.id)))];
      expect(representationBindings).toContain(representationId);
      expect(representationBindings).toHaveLength(includeSummaries ? 2 : 1);
      expect(selected.selection.excluded).toEqual(selection.excluded);
      expect(selected.actual.bytes).toBe(selectedMembers.length * Buffer.byteLength(selectedText, "utf8"));
      await expect(withSelectionAuthority(configuration => db.transaction({ tenantId, readOnly: true }, async client =>
        validatePromotionSelection(client, { selection: { ...selection, proposedBy: randomUUID() }, artifact: selectionArtifact,
          ports: configuration.selectionPorts, authority: await configuration.selectionAuthority(client, tenantId) }))))
        .rejects.toThrow("PROMOTION_SELECTION_AUTHORITY_MISMATCH");
      const extraMember = { ...selectedMembers[0]!, memberId: "unselected-extra",
        target: { ...selectedMembers[0]!.target, projectionTargetId: randomUUID() } };
      expect(() => PromotionSelectionSchema.parse({ ...selection, selected: [...selectedMembers, extraMember] }))
        .toThrow(/selected membership exceeds the reserved member limit/);
      expect(() => PromotionSelectionSchema.parse({ ...selection, selected: [] }))
        .toThrow(/Too small: expected array to have >=1 items/);
      if (includeSummaries) {
        await expect(withSelectionAuthority(configuration => db.transaction({ tenantId, readOnly: true }, async client =>
          validatePromotionSelection(client, { selection: { ...selection, selected: [selectedMembers[0]!] }, artifact: selectionArtifact,
            ports: configuration.selectionPorts, authority: await configuration.selectionAuthority(client, tenantId) }))))
          .rejects.toThrow("PROMOTION_SELECTION_ARTIFACT_CONTENT_MISMATCH");
      }
      await expect(withSelectionAuthority(configuration => db.transaction({ tenantId, readOnly: true }, async client =>
        validatePromotionSelection(client, { selection, artifact: selectionArtifact,
          ports: configuration.selectionPorts, authority: await configuration.selectionAuthority(client, tenantId) })),
        async () => ({ tokens: selection.budget.maxTokens + 1, costMicros: 0 })))
        .rejects.toThrow("PROMOTION_SELECTION_BUDGET_EXCEEDED");
      const forgedReceiptSelection = { ...selection, selected: selection.selected.map(member => ({ ...member, contentLinkReceiptIds: [randomUUID()] })) };
      const forgedReceiptArtifact = await verifier.store.put({ bytes: new TextEncoder().encode(JSON.stringify(forgedReceiptSelection)),
        mediaType: "application/vnd.aiengineer.promotion-selection+json", producerActivityId: "p5-forged-receipt", producerVersion: "1" });
      await expect(withSelectionAuthority(configuration => db.transaction({ tenantId, readOnly: true }, async client =>
        validatePromotionSelection(client, { selection: forgedReceiptSelection,
          artifact: { id: forgedReceiptArtifact.artifactId, digest: forgedReceiptArtifact.digest },
          ports: configuration.selectionPorts, authority: await configuration.selectionAuthority(client, tenantId) }))))
        .rejects.toThrow(/CONTENT_LEDGER_CONFLICT|Content receipt is missing/);
      const changedSourceSelection = { ...selection, selected: selection.selected.map(member => ({
        ...member, sourceChunks: member.sourceChunks.map(source => ({ ...source, chunkDigest: sha256Digest("changed source bytes") })) })) };
      const changedSourceArtifact = await verifier.store.put({ bytes: new TextEncoder().encode(JSON.stringify(changedSourceSelection)),
        mediaType: "application/vnd.aiengineer.promotion-selection+json", producerActivityId: "p5-changed-source", producerVersion: "1" });
      await expect(withSelectionAuthority(configuration => db.transaction({ tenantId, readOnly: true }, async client =>
        validatePromotionSelection(client, { selection: changedSourceSelection,
          artifact: { id: changedSourceArtifact.artifactId, digest: changedSourceArtifact.digest },
          ports: configuration.selectionPorts, authority: await configuration.selectionAuthority(client, tenantId) }))))
        .rejects.toThrow("PROMOTION_SELECTION_SOURCE_MISMATCH");
      const projectionProcedureId = randomUUID();
      const implementationDigest = sha256Digest(await readFile(resolve(import.meta.dirname, "../../../../packages/persistence/src/promotion-selection.ts"), "utf8"));
      const chunkSetId = await db.transaction({ tenantId }, async client => {
        await client.query(`insert into retrieval.projection_procedure(id,slug,version,description,code_ref,implementation_sha256,projection_policy)
          values($1,$2,1,'Exact admitted selected membership','packages/persistence/src/promotion-selection.ts',$3,$4::jsonb)`,
        [projectionProcedureId, `selected-${tenantId}`, implementationDigest.slice(7), JSON.stringify({ exactSelection: true, contextualPrefix: "" })]);
        return (await client.query<{ chunk_set_id: string }>("select chunk_set_id from retrieval.retrieval_chunk where tenant_id=$1 and id=$2", [tenantId, chunk.id])).rows[0]!.chunk_set_id;
      });
      const spacePins = targetSpaces.map(space => ({ space, vectorSpaceVersionId: randomUUID(), modelSlug: "deterministic-fake/local-proof", providerRoute: ["deterministic-fake"] }));
      const vectorSpaceVersionId = spacePins[0]!.vectorSpaceVersionId;
      await db.transaction({ tenantId }, async client => {
        for (const pin of spacePins) {
        const vectorSpaceId = randomUUID();
        await client.query("insert into retrieval.vector_space(id,tenant_id,slug,purpose,class) values($1,$2,$3,'Selected projection fixture','exploratory')", [vectorSpaceId, tenantId, pin.space]);
        await client.query(`insert into retrieval.vector_space_version
          (id,tenant_id,vector_space_id,version,embedding_model,dims,projection_procedure_id,backend,precision,index_configuration,provider_routing_policy)
          values($1,$2,$3,1,'deterministic-fake/local-proof',1536,$4,'pgvector','halfvec',$5::jsonb,$6::jsonb)`,
        [pin.vectorSpaceVersionId, tenantId, vectorSpaceId, projectionProcedureId,
          JSON.stringify({ type: "hnsw", operator: "halfvec_cosine_ops" }), JSON.stringify({ ordered: ["deterministic-fake"] })]);
        }
      });
      const embeddingExecutorId = randomUUID();
      const proposalInput = { selection, selectionArtifact, chunkSetId, representationDecisionId, projectionProcedureId,
        operationId: deterministicUuid("promotion-selection-operation", `promotion-selection:${selectionArtifact.digest}:prepare`),
        purpose: "Retrieve this selected qualified engineering record", contextualPrefix: "", language: "en", visibility: "internal", classification: "internal",
        targetDomains: targetSpaces, expectedValue: "One admitted record with original evidence", risks: ["Synthetic fixture"], exclusions: [],
        reason: "Selective close-out proof", proposedBy: selection.proposedBy };
      const advanceSelection = (overrides: { capabilityVersion?: string; reviewerAttemptId?: string; embeddingExecutorId?: string; attemptId?: string } = {}) => withSelectionAuthority(configuration => {
        const { operationId, proposedBy, ...payload } = proposalInput;
        return createPromotionSelectionAdvance({ database,
          governance: new PostgresGovernedIndexRepository(database, configuration), authority: configuration,
          proposal: PromotionProposalInputSchema.parse({ schemaVersion: "knowledge.promotion-proposal/v1", ...payload }),
          attemptId, reviewerAttemptId: promotionReviewerAttemptId, correlationId: missionId,
          capabilityVersion: "selected-promotion-fixture.v1", embeddingExecutorId, origin: "http://127.0.0.1:4100",
          spaces: spacePins, ...overrides })({ selection, artifact: selectionArtifact });
      });
      const persistSelected = () => withSelectionAuthority(configuration => new PostgresGovernedIndexRepository(database, configuration).persistProjectionProposal(tenantId, proposalInput));
      const proposed = await withSelectionAuthority(async configuration => {
        const governance = new PostgresGovernedIndexRepository(database, configuration);
        const registry = createProductionActivityRegistry({ retrieval: database, review: database, governedIndex: {
          repository: governance, embeddingAdapter: new DeterministicFakeEmbeddingAdapter(1536), embeddingAdapterVersion: "deterministic-fake.v1" } });
        const worker = new CanonicalDurableKnowledgeWorker(`selected-prepare-${tenantId}`, tenantId, database,
          createCanonicalActivityExecutor(database, registry), 30000, ["promotion_proposal"]);
        const operations = new PostgresKnowledgeOperationService(database);
        const createOperation = database.createOperation.bind(database);
        const acknowledgement = vi.spyOn(database, "createOperation").mockImplementationOnce(async input => {
          await createOperation(input);
          throw new Error("selected preparation acknowledgement lost after commit");
        });
        await expect(advanceSelection()).rejects.toThrow("selected preparation acknowledgement lost after commit");
        const progress = await advanceSelection();
        expect(acknowledgement).toHaveBeenCalledOnce();
        acknowledgement.mockRestore();
        expect(progress.status).toBe("waiting");
        const operationId = progress.operations[0]!.operationId;
        expect(operationId).toBe(proposalInput.operationId);
        expect(await worker.runOperationOnce(operationId)).toBeTruthy();
        expect((await operations.get(operationId, tenantId))?.state).toBe("succeeded");
        const receipts = await database.listReceipts(tenantId, operationId);
        expect(receipts).toHaveLength(1);
        expect(receipts[0]!.receiptKind).toBe("propose.succeeded");
        expect((await advanceSelection()).status).toBe("review_required");
        expect(await database.listReceipts(tenantId, operationId)).toEqual(receipts);
        return { ...(receipts[0]!.body as unknown as GovernedProjectionProposal & { reviewSubjectId: string }), preparationReceiptId: receipts[0]!.id };
      });
      expect(proposed.projectionIds).toHaveLength(selectedMembers.length);
      await expect(advanceSelection({ attemptId: randomUUID() })).rejects.toThrow(/PROMOTION_(REVIEW_PIN|RETAINED_CONTEXT|RETAINED_OPERATION)_MISMATCH/);
      await expect(advanceSelection({ capabilityVersion: "substituted-capability.v1" })).rejects.toThrow("PROMOTION_RETAINED_CONTEXT_MISMATCH");
      expect(proposed.selectionDigest).toBe(selectionHandle.digest);
      expect(proposed).toMatchObject(await persistSelected());
      await db.transaction({ tenantId, readOnly: true }, async client => {
        const projections = (await client.query<Row>("select id,projection_target_id,embedding_text,promotion_state from retrieval.search_projection where tenant_id=$1 order by id", [tenantId])).rows;
        expect(projections.map(row => row.id).sort()).toEqual([...proposed.projectionIds].sort());
        expect(projections.map(row => row.projection_target_id).sort()).toEqual(selectedMembers.map(member => member.target.projectionTargetId).sort());
        expect(projections.every(row => row.embedding_text === selectedText && row.promotion_state === "candidate")).toBe(true);
        const saved = (await client.query<Row>("select projection_manifest from retrieval.content_promotion_proposal where tenant_id=$1 and id=$2", [tenantId, proposed.proposalId])).rows[0]!;
        expect(saved.projection_manifest).toMatchObject({ selectionDigest: selectionHandle.digest, selection, exclusions: selection.excluded,
          projectionIds: proposed.projectionIds });
      });
      const promotionReview = await withSelectionAuthority(async configuration => {
        const registry = createProductionActivityRegistry({ retrieval: database, review: database, governedIndex: {
          repository: new PostgresGovernedIndexRepository(database, configuration),
          embeddingAdapter: new DeterministicFakeEmbeddingAdapter(1536), embeddingAdapterVersion: "deterministic-fake.v1" } });
        const worker = new CanonicalDurableKnowledgeWorker(`selected-review-${tenantId}`, tenantId, database,
          createCanonicalActivityExecutor(database, registry), 30000, ["promotion_decision"]);
        const operations = new PostgresKnowledgeOperationService(database);
        const operationId = randomUUID();
        const envelope = { context: { tenantId, operationId, attemptId: promotionReviewerAttemptId, correlationId: missionId,
          actor: { kind: "service" as const, id: selection.requiredReviewer, serviceIdentity: "human_reviewer" as const },
          capabilityVersion: "selected-promotion-fixture.v1", idempotencyKey: `selected-review:${tenantId}`,
          reason: "Synthetic independent review of retained candidate bytes", contractVersion: "v1" as const },
          input: { schemaVersion: "knowledge.promotion-decision/v1", proposalId: proposed.proposalId,
            reviewSubjectId: proposed.reviewSubjectId, guardedDigest: proposed.proposalDigest, decision: "accept",
            gates: { exactMembership: true, retainedQualifications: true }, policyVersion: "p5-selected-fixture.v1",
            rationale: "Synthetic fixture reviewer accepts only the selected qualified record." }, expectedVersions: { api: "v1" } };
        await operations.submit("promotion_decision", envelope, "http://127.0.0.1:4100");
        expect(await worker.runOperationOnce(operationId)).toBeTruthy();
        expect((await operations.get(operationId, tenantId))?.state).toBe("succeeded");
        const receipts = await database.listReceipts(tenantId, operationId);
        expect(receipts).toHaveLength(1);
        expect(receipts[0]!.receiptKind).toBe("decide.succeeded");
        await operations.submit("promotion_decision", envelope, "http://127.0.0.1:4100");
        expect(await database.listReceipts(tenantId, operationId)).toEqual(receipts);
        return { operationId, receiptId: receipts[0]!.id, decisionId: String((receipts[0]!.body as Record<string, unknown>).decisionId) };
      });
      const promotionDecisionId = promotionReview.decisionId;
      await expect(advanceSelection({ reviewerAttemptId: verifierAttemptId })).rejects.toThrow("PROMOTION_REVIEW_PIN_MISMATCH");
      const embeddingContext = await withSelectionAuthority(configuration => new PostgresGovernedIndexRepository(database, configuration)
        .loadEmbeddingContext(tenantId, vectorSpaceVersionId, promotionDecisionId, proposed.projectionIds));
      expect(embeddingContext.inputs).toEqual(proposed.projectionIds.map(projectionId => ({ projectionId, text: selectedText,
        textDigest: sha256Digest(selectedText) })));
      const settlement = { operationId: randomUUID(), embeddingRunId: randomUUID(), context: embeddingContext,
        idempotencyKey: "selection-settlement-negative", adapterVersion: "negative-test", providerRoutePolicy: {},
        receipt: { requestId: "not-dispatched", observedProviderRoute: "none", inputManifestDigest: sha256Digest("no-request"),
          outputManifestDigest: sha256Digest("no-output"), usageTokens: 0, costUsd: 0, latencyMs: 0, retryHistory: [], items: [] } };
      await expect(withSelectionAuthority(configuration => new PostgresGovernedIndexRepository(database, configuration).persistEmbeddingRun(tenantId,
        { ...settlement, context: { ...embeddingContext, inputs: embeddingContext.inputs.map((item, index) =>
          index === 0 ? { ...item, text: "Caller substituted unsupported text" } : item) } })))
        .rejects.toThrow("EMBEDDING_CONTEXT_AUTHORITY_MISMATCH");
      const nativeEmbeddings = await withSelectionAuthority(async configuration => {
        const adapter = new DeterministicFakeEmbeddingAdapter(1536);
        const dispatch = vi.spyOn(adapter, "embedMany");
        const repository = new PostgresGovernedIndexRepository(database, configuration);
        const registry = createProductionActivityRegistry({ retrieval: database, review: database, governedIndex: {
          repository, embeddingAdapter: adapter, embeddingAdapterVersion: "deterministic-fake.v1" } });
        const worker = new CanonicalDurableKnowledgeWorker(`selected-embedding-${tenantId}`, tenantId, database,
          createCanonicalActivityExecutor(database, registry), 30000, ["embedding_run"]);
        const operations = new PostgresKnowledgeOperationService(database);
        const runs = [];
        for (const [index, pin] of spacePins.entries()) {
          const progress = await advanceSelection();
          expect(progress.status).toBe("waiting");
          expect(progress.operations.some(item => item.stage === "index")).toBe(false);
          const operationId = progress.operations.find(item => item.stage === "embed" && item.targetSpace === pin.space)!.operationId;
          expect(await worker.runOperationOnce(operationId)).toBeTruthy();
          expect((await operations.get(operationId, tenantId))?.state).not.toBe("succeeded");
          expect(await worker.runOperationOnce(operationId)).toBeTruthy();
          expect((await operations.get(operationId, tenantId))?.state).toBe("succeeded");
          const receipts = await database.listReceipts(tenantId, operationId);
          expect(receipts.map(value => value.receiptKind).sort()).toEqual(["embed.succeeded", "verify.succeeded"]);
          expect(receipts.find(value => value.receiptKind === "verify.succeeded")!.body).toMatchObject({ publishable: false });
          expect((await advanceSelection()).stage).toBe(index === spacePins.length - 1 ? "index" : "embed");
          expect(await database.listReceipts(tenantId, operationId)).toEqual(receipts);
          expect(dispatch).toHaveBeenCalledTimes(index + 1);
          runs.push({ operationId, receiptId: receipts.find(value => value.receiptKind === "verify.succeeded")!.id,
            run: (await repository.getEmbeddingRunByOperation(tenantId, operationId))!,
            receipt: await dispatch.mock.results[index]!.value });
        }
        return runs;
      });
      const nativeEmbedding = nativeEmbeddings[0]!;
      const embeddingReceipt = nativeEmbedding.receipt;
      await expect(advanceSelection({ embeddingExecutorId: randomUUID() })).rejects.toThrow("PROMOTION_RETAINED_OPERATION_MISMATCH");
      const embeddingInput = { operationId: nativeEmbedding.operationId, embeddingRunId: nativeEmbedding.run.embeddingRunId,
        context: embeddingContext, idempotencyKey: embeddingReceipt.idempotencyKey, adapterVersion: "deterministic-fake.v1",
        providerRoutePolicy: { ordered: ["deterministic-fake"] }, receipt: embeddingReceipt };
      const persistEmbedded = () => withSelectionAuthority(configuration => new PostgresGovernedIndexRepository(database, configuration).persistEmbeddingRun(tenantId, embeddingInput));
      const embedded = nativeEmbedding.run;
      expect(embedded.itemCount).toBe(selectedMembers.length);
      expect(await persistEmbedded()).toEqual(embedded);
      const candidateInput = { schemaVersion: "knowledge.selected-candidate-index/v1" as const, selection, selectionArtifact,
        preparation: { operationId: proposalInput.operationId, receiptId: proposed.preparationReceiptId, proposalId: proposed.proposalId },
        review: promotionReview, embeddings: nativeEmbeddings.map(item => ({ operationId: item.operationId, receiptId: item.receiptId,
          embeddingRunId: item.run.embeddingRunId, vectorSpaceVersionId: item.run.vectorSpaceVersionId,
          projectionIds: [...proposed.projectionIds].sort() })) };
      const verifyCandidate = () => withSelectionAuthority(configuration =>
        new PostgresGovernedIndexRepository(database, configuration).verifySelectedCandidate(tenantId, candidateInput));
      const candidate = await verifyCandidate();
      expect(candidate).toMatchObject({ indexed: true, publishable: false, selectionDigest: selectionArtifact.digest,
        spaces: spacePins.map((pin, index) => ({ space: pin.space, embeddingRunId: nativeEmbeddings[index]!.run.embeddingRunId,
          vectorIds: selectedMembers.map(() => expect.any(String)) })) });
      expect(await verifyCandidate()).toEqual(candidate);
      if (spacePins.length > 1) {
        await expect(withSelectionAuthority(configuration => new PostgresGovernedIndexRepository(database, configuration)
          .verifySelectedCandidate(tenantId, { ...candidateInput, embeddings: candidateInput.embeddings.slice(0, 1) })))
          .rejects.toThrow("CANDIDATE_INDEX_SPACE_CENSUS_MISMATCH");
      }
      await withSelectionAuthority(async configuration => {
        const registry = createProductionActivityRegistry({ retrieval: database, review: database, governedIndex: {
          repository: new PostgresGovernedIndexRepository(database, configuration),
          embeddingAdapter: new DeterministicFakeEmbeddingAdapter(1536), embeddingAdapterVersion: "deterministic-fake.v1" } });
        const worker = new CanonicalDurableKnowledgeWorker(`selected-index-${tenantId}`, tenantId, database,
          createCanonicalActivityExecutor(database, registry), 30000, ["vector_store_ingestion"]);
        const operations = new PostgresKnowledgeOperationService(database);
        const progress = await advanceSelection();
        expect(progress.status).toBe("waiting");
        const operationId = progress.operations.find(item => item.stage === "index")!.operationId;
        for (const step of ["prepare", "embed", "index"]) {
          expect(await worker.runOperationOnce(operationId)).toBeTruthy();
          const state = (await operations.get(operationId, tenantId))?.state;
          expect(state === "succeeded").toBe(step === "index");
        }
        const receipts = await database.listReceipts(tenantId, operationId);
        expect(receipts.map(value => value.receiptKind).sort()).toEqual(["embed.succeeded", "index.succeeded", "prepare.succeeded"]);
        expect(receipts.find(value => value.receiptKind === "index.succeeded")!.body).toMatchObject({
          ...candidate, stage: "index", indexed: true, publishable: false });
        expect((await advanceSelection()).status).toBe("complete");
        expect(await database.listReceipts(tenantId, operationId)).toEqual(receipts);
      });
      await expect(withSelectionAuthority(configuration => new PostgresGovernedIndexRepository(database, configuration)
        .verifySelectedCandidate(tenantId, { ...candidateInput, preparation: { ...candidateInput.preparation, receiptId: nativeEmbedding.receiptId } })))
        .rejects.toThrow("CANDIDATE_INDEX_RECEIPT_INVALID");
      await db.transaction({ tenantId, readOnly: true }, async client => {
        const vectors = (await client.query<Row>(`select v.projection_target_id,v.content_kind,v.knowledge_seq,e.vector_space_key,
            extensions.vector_dims(e.embedding::extensions.vector) dimensions
          from retrieval.vector_item v join retrieval.vector_item_embedding_1536 e on e.tenant_id=v.tenant_id and e.vector_item_id=v.id
          where v.tenant_id=$1 order by e.vector_space_key,v.content_kind`, [tenantId])).rows;
        expect(vectors).toEqual(targetSpaces.flatMap(space => [...selectedMembers]
          .sort((left, right) => left.target.kind.localeCompare(right.target.kind))
          .map(member => ({ projection_target_id: member.target.projectionTargetId, content_kind: member.target.kind,
            knowledge_seq: String(selection.expectedKnowledgeHead), vector_space_key: space, dimensions: 1536 }))));
        expect((await client.query("select id from retrieval.space_publication where tenant_id=$1", [tenantId])).rows).toHaveLength(0);
      });
      const forgedSubjectId = randomUUID();
      await database.createReviewSubject(tenantId, { id: forgedSubjectId,
        operationId: await createOperation(database, tenantId, { kind: "representation_review" }), subjectKind: "content_promotion",
        subjectRef: { proposalId: proposed.proposalId, projectionIds: [...proposed.projectionIds],
          projectionManifestDigest: proposed.projectionManifestDigest, selectionDigest: sha256Digest("forged selection"),
          selectionArtifactId: selectionArtifact.id },
        guardedSha256: proposed.proposalDigest.slice(7), eligibleRoles: ["human_reviewer"] });
      const forgedReview = await withSelectionAuthority(async configuration => {
        const registry = createProductionActivityRegistry({ retrieval: database, review: database, governedIndex: {
          repository: new PostgresGovernedIndexRepository(database, configuration),
          embeddingAdapter: new DeterministicFakeEmbeddingAdapter(1536), embeddingAdapterVersion: "deterministic-fake.v1" } });
        const worker = new CanonicalDurableKnowledgeWorker(`forged-subject-review-${tenantId}`, tenantId, database,
          createCanonicalActivityExecutor(database, registry), 30000, ["promotion_decision"]);
        const operations = new PostgresKnowledgeOperationService(database);
        const operationId = randomUUID();
        await operations.submit("promotion_decision", { context: { tenantId, operationId,
          attemptId: promotionReviewerAttemptId, correlationId: missionId,
          actor: { kind: "service" as const, id: selection.requiredReviewer, serviceIdentity: "human_reviewer" as const },
          capabilityVersion: "selected-promotion-fixture.v1", idempotencyKey: `forged-subject-review:${tenantId}`,
          reason: "Adversarial probe: a later decision bound to a forged review subject", contractVersion: "v1" as const },
          input: { schemaVersion: "knowledge.promotion-decision/v1", proposalId: proposed.proposalId,
            reviewSubjectId: forgedSubjectId, guardedDigest: proposed.proposalDigest, decision: "accept",
            gates: { exactMembership: true }, policyVersion: "p5-selected-fixture.v1",
            rationale: "Adversarial probe over a forged promotion review subject." }, expectedVersions: { api: "v1" } },
        "http://127.0.0.1:4100");
        expect(await worker.runOperationOnce(operationId)).toBeTruthy();
        expect((await operations.get(operationId, tenantId))?.state).toBe("succeeded");
        const receipts = await database.listReceipts(tenantId, operationId);
        return String((receipts[0]!.body as Record<string, unknown>).decisionId);
      });
      await expect(advanceSelection()).rejects.toThrow("PROMOTION_REVIEW_PROVENANCE_MISMATCH");
      await expect(withSelectionAuthority(configuration => new PostgresGovernedIndexRepository(database, configuration)
        .loadEmbeddingContext(tenantId, vectorSpaceVersionId, forgedReview, proposed.projectionIds)))
        .rejects.toThrow("EMBEDDING_PROMOTION_NOT_APPROVED");
      await expect(withSelectionAuthority(configuration => new PostgresGovernedIndexRepository(database, configuration)
        .loadEmbeddingContext(tenantId, vectorSpaceVersionId, promotionDecisionId, proposed.projectionIds)))
        .rejects.toThrow("EMBEDDING_PROMOTION_NOT_CURRENT");
      const expiredReviewOperationId = await createOperation(database, tenantId, { kind: "representation_review" });
      await reviewRepresentation(database, { tenantId, representationId, digest: structuralArtifact.digest,
        operationId: expiredReviewOperationId, decision: "accept", expiresAt: new Date(Date.now() - 60000).toISOString() });
      await expect(validateSelected()).rejects.toThrow("Representation has no current independent acceptance");
      await expect(validateSelected()).rejects.toMatchObject({ code: "CONTENT_SOURCE_BINDING_INVALID" });
      await reviewRepresentation(database, { tenantId, representationId, digest: structuralArtifact.digest,
        operationId: transformOperationId, decision: "reject" });
      await expect(validateSelected()).rejects.toMatchObject({ code: "CONTENT_SOURCE_BINDING_INVALID" });
      await expect(persistSelected()).rejects.toMatchObject({ code: "CONTENT_SOURCE_BINDING_INVALID" });
      await expect(withSelectionAuthority(configuration => new PostgresGovernedIndexRepository(database, configuration).persistEmbeddingRun(tenantId, settlement)))
        .rejects.toMatchObject({ code: "CONTENT_SOURCE_BINDING_INVALID" });
      await expect(persistEmbedded()).rejects.toMatchObject({ code: "CONTENT_SOURCE_BINDING_INVALID" });
      await expect(verifyCandidate()).rejects.toMatchObject({ code: "CONTENT_SOURCE_BINDING_INVALID" });
      await expect(advanceSelection()).rejects.toMatchObject({ code: "CONTENT_SOURCE_BINDING_INVALID" });
      const afterRejection = await reads.runIntent({ schemaVersion: "knowledge-read-intent.v1", intentId: "after-independent-rejection",
        context: { tenantId, missionId, attemptId }, operations: [{ opId: "head", query: "knowledge.head" }] }, { persist: true });
      const afterRejectionArtifact = await artifacts.get(tenantId, afterRejection.storage!.artifactId!);
      const rejectedPlan = await executor.plan({ ...intent, intentId: "latest-review-rejects", operations: [admittedDocument],
        inputSnapshot: { artifact: { id: afterRejectionArtifact.record.artifactId, digest: afterRejectionArtifact.record.digest }, knowledgeSeq: afterRejection.atKnowledgeSeq },
        expectedKnowledgeHead: afterRejection.atKnowledgeSeq, asOf: new Date().toISOString() });
      expect(rejectedPlan.operations[0]!.outcome).toBe("held");
    } finally {
      await services?.close(); await database.close(); await db.close();
    }
  }, 240000);
});
