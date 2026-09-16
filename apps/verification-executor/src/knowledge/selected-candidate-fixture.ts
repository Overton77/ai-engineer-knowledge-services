import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ContentLinkIntentSchema, ContentLinkOperationSchema, JsonValueSchema, PromotionProposalInputSchema,
  PromotionSelectionSchema, type ContentLinkOperation, type DeterministicVerificationResult, type JsonValue,
  type OperationKind, type PromotionSelection, type SelectedCandidateIndexInput, type ServiceIdentity,
  type VerificationBundle } from "@aiengineer/knowledge-contracts";
import { IngestionIntentSchema, contentEvidenceAssessmentDigest, deterministicId, proposalEffect,
  type ContentLinkReceipt } from "@aiengineer/knowledge-ingestion";
import { convertStructuralDocument } from "@aiengineer/knowledge-documents";
import { chunkDocument, defaultChunkProfileRegistry } from "@aiengineer/knowledge-chunking";
import { canonicalJson, sha256Digest } from "@aiengineer/knowledge-domain";
import { PostgresCanonicalRepository, PostgresGovernedIndexRepository, PostgresKnowledgeOperationService,
  PostgresPreparationRepository, TenantPostgres, type GovernedProjectionProposal, type GovernedPublishedAnswer,
  type GovernedPublicationBaselineComparison, type GovernedSelectedCandidateResult, type PersistedPreparationArtifact,
  type PromotionSelectionConfiguration, type PublishedQueryMode } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore, deterministicUuid } from "@aiengineer/knowledge-runtime";
import { digestCanonicalJson, verifyAssertionSemantics } from "@aiengineer/knowledge-verification";
import { withSnapshot } from "../../../../packages/ingestion/test/snapshot-fixture.mjs";
import { contentLinkEffect } from "../../../../packages/ingestion/src/content-links/operations.js";
import { DeterministicFakeEmbeddingAdapter } from "../../../../packages/embeddings/src/index.js";
import { VerificationExecutor, loadExecutorConfig } from "../executor.js";
import { PolicyDefinitionInputSchema } from "../intents.js";
import { loadSealedContentClaim } from "./evidence-oracle.js";
import { createKnowledgeServices, type KnowledgeServices } from "./context.js";
import { knowledgeOperations } from "./operations.js";
import { createCanonicalEvidenceReader } from "../evidence-reader.js";
import { createPromotionSelectionPorts } from "./promotion-selection.js";
import { createCanonicalActivityExecutor, createProductionActivityRegistry } from "../../../worker/src/activity-registry.js";
import { CanonicalDurableKnowledgeWorker } from "../../../worker/src/canonical-worker.js";
import { createCanonicalPromotionSelectionApplication, createPromotionSelectionConfiguration } from "../../../worker/src/promotion-selection.js";

type Row = Record<string, unknown>;
type Space = PromotionSelection["selected"][number]["targetSpaces"][number];
const STATEMENT = "Since 2026, Synthetic Child and Parent organizations operate together in preview.";
const QUALIFIERS = ["in preview"];
const RELATIONSHIP_START = "2026-01-01T00:00:00.000001Z";
export const FIXTURE_POLICY_DIGEST = digestCanonicalJson({ schemaVersion: "verification-policy.v1",
  definitionId: "policy-executor-default.v1", ...PolicyDefinitionInputSchema.parse({}) });

export interface SelectedCandidateFixtureOptions {
  /** Fresh native preparation and selection using an existing tenant/store, never reuse an old admission. */
  readonly rebuildOf?: SelectedCandidateFixture;
  readonly databaseUrl: string;
  readonly storage: { readonly projectUrl: string; readonly secretKey: string };
  readonly spaces: readonly Space[];
  readonly derivedSummaryStatements?: readonly string[];
  readonly temporalEvents?: readonly {
    readonly key: string;
    readonly statement: string;
    readonly eventKind?: "product_announced" | "product_generally_available";
    readonly availability?: { readonly scope: "api" | "chatgpt"; readonly status: "announced" | "preview" | "ga" };
    readonly challengeOf?: string;
    readonly sourceFamily?: string;
    readonly from: string;
    readonly to: string | null;
  }[];
}

export interface SelectedCandidateSpacePin {
  readonly space: Space;
  readonly vectorSpaceVersionId: string;
  readonly vectorSpaceId: string;
  readonly modelSlug: string;
  readonly providerRoute: readonly string[];
}

export interface ReplacementCandidate {
  readonly candidateInput: SelectedCandidateIndexInput;
  readonly candidate: GovernedSelectedCandidateResult;
  readonly vectorSpaceVersionId: string;
}

export interface DurablePublicationActor {
  readonly kind: "service";
  readonly id: string;
  readonly serviceIdentity: Extract<ServiceIdentity, "control_plane" | "embedding_executor" | "evaluation_executor">;
}

/** Everything the publication proof needs from the verified selected candidate. */
export interface SelectedCandidateFixture {
  readonly entityIds: { readonly child: string; readonly parent: string };
  readonly temporalClaims: readonly { key: string; claimId: string; entityId: string; knowledgeSeq: number; statement: string }[];
  readonly tenantId: string;
  readonly missionId: string;
  readonly db: TenantPostgres;
  readonly database: PostgresCanonicalRepository;
  readonly selection: PromotionSelection;
  readonly selectionArtifact: { id: string; digest: string };
  readonly candidateInput: SelectedCandidateIndexInput;
  readonly candidate: GovernedSelectedCandidateResult;
  readonly spacePins: readonly SelectedCandidateSpacePin[];
  readonly projectionIds: readonly string[];
  readonly promotionDecisionId: string;
  readonly proposalDigest: `sha256:${string}`;
  readonly representationId: string;
  readonly representationDigest: `sha256:${string}`;
  readonly preparedSummaryRepresentationId: string;
  readonly transformOperationId: string;
  readonly reviewerIdentity: string;
  readonly proposerIdentity: string;
  readonly evaluatorIdentity: string;
  readonly publisherIdentity: string;
  readonly vectorStoreId: string;
  readonly vectorStoreSpaceId: string;
  readonly embeddingAdapter: DeterministicFakeEmbeddingAdapter;
  /** Local verification-store scratch; citation replay must not depend on these files. */
  readonly producerDirectory: string;
  withSelectionAuthority<T>(action: (configuration: PromotionSelectionConfiguration) => Promise<T>): Promise<T>;
  createOperationId(kind: string, actorIdentity?: string): Promise<string>;
  reviewRepresentation(input: { representationId: string; digest: `sha256:${string}`; operationId: string;
    decision: "accept" | "reject"; expiresAt?: string }): Promise<string>;
  submitDurable(input: { kind: OperationKind; actor: DurablePublicationActor; payload: JsonValue; reason: string }): Promise<string>;
  runDurable(input: { name: string; kinds: readonly string[]; operationId: string; steps: number }): Promise<void>;
  queryPublished(input: { embedding: readonly number[]; mode: PublishedQueryMode; resultLimit?: number }): Promise<GovernedPublishedAnswer>;
  verifyBaseline(queries: readonly { queryId: string; embedding: readonly number[] }[]): Promise<GovernedPublicationBaselineComparison>;
  createReplacementCandidate(): Promise<ReplacementCandidate>;
  close(): Promise<void>;
}

/**
 * Builds one real selected candidate on the guarded disposable PostgreSQL and
 * Storage: sealed native claims, canonical ContentLink receipts, an
 * independently reviewed summary representation, exact selected membership and
 * physically indexed 1536-dimension halfvec vectors. It publishes nothing.
 */
export async function createSelectedCandidateFixture(options: SelectedCandidateFixtureOptions): Promise<SelectedCandidateFixture> {
  if (options.rebuildOf && (options.temporalEvents?.length || options.derivedSummaryStatements?.length))
    throw new Error("REBUILD_FIXTURE_DEFAULT_MEMBERS_ONLY");
  const { databaseUrl, storage } = options;
  const tenantId = options.rebuildOf?.tenantId ?? randomUUID(), missionId = randomUUID(), workItemId = randomUUID();
  const fixtureKey = options.rebuildOf ? missionId : tenantId;
  const intentKey = (value: string) => options.rebuildOf ? `${value}-${fixtureKey}` : value;
  const attemptId = randomUUID(), verifierAttemptId = randomUUID(), reviewerAttemptId = randomUUID();
  const directory = await mkdtemp(join(tmpdir(), "ks-p5-publication-"));
  const db = new TenantPostgres({ connectionString: databaseUrl });
  const database = new PostgresCanonicalRepository({ connectionString: databaseUrl });
  let services: KnowledgeServices | undefined;
  try {
    await db.transaction({ tenantId }, async client => {
      await client.query("insert into orchestration.mission(id,tenant_id,goal) values($1,$2,'P5 evaluated activation proof')", [missionId, tenantId]);
      await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind) values($1,$2,$3,'build_vectors')", [workItemId, tenantId, missionId]);
      await client.query(`insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id)
        values($1,$2,$3,1,'p5-publication-producer'),($4,$2,$3,2,'p5-publication-verifier'),($5,$2,$3,3,'p5-publication-reviewer')`,
      [attemptId, tenantId, workItemId, verifierAttemptId, reviewerAttemptId]);
    });
    const verifier = await VerificationExecutor.create(loadExecutorConfig({ VERIFY_STORE_DIR: directory, VERIFY_TENANT_ID: tenantId,
      VERIFY_GIT_SHA: "p5-publication-fixture", VERIFY_PRODUCER_ATTEMPT_ID: attemptId, VERIFY_VERIFIER_ATTEMPT_ID: verifierAttemptId,
      VERIFY_PRODUCER_DEPLOYMENT_ID: "p5-publication-producer", VERIFY_VERIFIER_DEPLOYMENT_ID: "p5-publication-verifier" }));
    services = createKnowledgeServices({ databaseUrl, defaultTenantId: tenantId, producerAttemptId: attemptId, missionId,
      workspaceDir: resolve(import.meta.dirname, "../../../../../ai-engineer-db-contract/workspace"), artifactDir: join(directory, "knowledge"),
      allowStale: false, contentLinksEnabled: true, evidenceOracle: "verification-store", evidencePolicyVersion: "executor-default.v1",
      evidencePolicyDigest: FIXTURE_POLICY_DIGEST, storage }, { verification: verifier });
    const { artifacts, workspace, reads, ingestion } = services;
    const sourceStore = new SupabaseArtifactStore({ ...storage, serviceRoleKey: storage.secretKey,
      bucket: "ai-engineer-cloud-bucket", maximumBytes: 64000000 });
    const ledgerStore = new SupabaseArtifactStore({ ...storage, serviceRoleKey: storage.secretKey,
      bucket: "research-ingestion-intents", maximumBytes: 64000000 });

    const createOperationId = async (kind: string, actorIdentity?: string) => {
      const id = randomUUID();
      await database.createOperation({ id, tenantId, operationKind: kind, idempotencyKey: `p5-publication:${id}`,
        correlationId: randomUUID(), actorIdentity: actorIdentity ?? "p5-publication-fixture",
        request: { schemaVersion: "p5-publication-fixture.v1" }, steps: [] });
      return id;
    };
    const reviewRepresentation = async (input: { representationId: string; digest: `sha256:${string}`; operationId: string;
      decision: "accept" | "reject"; expiresAt?: string }) => {
      const reviewerIdentity = "p5-publication-independent-reviewer", subjectId = randomUUID();
      const decisionOperationId = await createOperationId("representation_decision", reviewerIdentity);
      await database.createReviewSubject(tenantId, { id: subjectId, operationId: input.operationId, subjectKind: "representation",
        subjectRef: { representationId: input.representationId, artifactDigest: input.digest },
        guardedSha256: input.digest.slice(7), eligibleRoles: ["human_reviewer"] });
      const knowledgeReviewDecisionId = await database.recordReviewDecision(tenantId, { id: randomUUID(), reviewSubjectId: subjectId,
        guardedSha256: input.digest.slice(7), reviewerIdentity, reviewerRole: "human_reviewer",
        decision: input.decision === "accept" ? "approve" : "reject",
        rationale: "Publication fixture reviewed exact representation bytes.", decisionOperationId });
      const decisionId = await new PostgresGovernedIndexRepository(database).persistRepresentationDecision(tenantId, {
        operationId: decisionOperationId, representationId: input.representationId, guardedDigest: input.digest,
        knowledgeReviewDecisionId, reviewerIdentity, decision: input.decision, policyVersion: "p5-publication-fixture.v1",
        rationale: "Exact representation custody reviewed.", ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}) });
      await database.reconcileOperation(tenantId, decisionOperationId);
      return decisionId;
    };

    const sealClaims = async (runId: string, captureId: string,
      claims: { claimId: string; value: string; entityBindings: { role: string; canonicalId: string }[]; downstreamUse: string[];
        proposition?: string; qualifiers?: string[]; quote?: string }[]) => {
      await verifier.verifyClaims({ runId, intent: { schemaVersion: "verification-claims-intent.v1", intentId: `content-${runId}`,
        claims: claims.map(({ quote, ...claim }) => ({ ...claim, claimType: "capability", proposition: claim.proposition ?? STATEMENT, qualifiers: claim.qualifiers ?? QUALIFIERS,
          evidence: [{ captureId, quote: quote ?? claim.proposition ?? STATEMENT }] })) } });
      const { state } = await verifier.runStatus({ runId });
      const bundle = await verifier.store.json<VerificationBundle>(await verifier.store.resolveHandle({ artifactId: state.bundleArtifactId! }));
      const deterministicResult = await verifier.store.json<DeterministicVerificationResult>(await verifier.store.resolveHandle({ artifactId: state.resultArtifactId! }));
      const identity = { deploymentId: "p5-publication-synthetic-judge", provider: "synthetic", family: "synthetic", model: "disposable-proof",
        capability: "llm_evidence_rubric" as const, graderVersion: "synthetic.v1", promptDigest: sha256Digest("prompt"),
        outputSchemaDigest: sha256Digest("schema"), configurationDigest: sha256Digest("config") };
      const assessments = [];
      for (const assertion of bundle.assertions) {
        const edge = assertion.evidence[0]!;
        const sourceClaim = claims.find(claim => claim.claimId === assertion.assertionId);
        const quote = sourceClaim?.quote ?? sourceClaim?.proposition ?? STATEMENT;
        assessments.push(await verifyAssertionSemantics({ bundle, deterministicResult, assertionId: assertion.assertionId,
          selectedFragments: [{ evidenceId: edge.evidenceId, fragmentId: edge.fragment.fragmentId, exactText: quote, selectedContentDigest: sha256Digest(quote) }],
          adapters: { primary: { identity, maximumInputCharacters: 64000, judge: async () => ({ schemaVersion: "verification-semantic-judge.v1",
            assertionId: assertion.assertionId, verdict: "directly_supported", nliLabel: "entailed", supportingFragmentIds: [edge.fragment.fragmentId],
            contradictingFragmentIds: [], unsupportedFacets: [], qualifiersPreserved: true,
            publicRationale: "Synthetic deterministic fixture judgment. Not a live model result." }) } } }));
      }
      const semantic = await verifier.store.putJson({ schemaVersion: "verification-semantic-assessments.v1", runId, assessments, skipped: [] }, {
        mediaType: "application/json", producerActivityId: "p5-publication:synthetic-judge", producerVersion: "synthetic.v1",
        parentArtifactIds: [state.resultArtifactId!], transformation: { kind: "synthetic_test_judgment" } });
      state.semanticArtifactId = semantic.handle.artifactId;
      await verifier.store.writeRun(state);
      await verifier.evaluatePolicy({ runId });
      return verifier.sealRun({ runId });
    };

    const canonicalReference = async (input: { runId: string; claimKey: string; manifestDigest: string }) => {
      const sealed = await loadSealedContentClaim(verifier, { tenantId, ...input, policyVersion: "executor-default.v1", policyDigest: FIXTURE_POLICY_DIGEST });
      const row = await db.transaction({ tenantId, readOnly: true }, async client => (await client.query<Row>(`
        select c.id claim_id,a.id assessment_id,a.verdict,a.authority_assessment,a.replay_signature_match,a.properties,a.public_rationale,
          l.role,l.locator_id,loc.capture_id,r.run_manifest_artifact_id,art.sha256 audit_sha256
        from evidence.claim c join evidence.claim_evidence_link l on l.tenant_id=c.tenant_id and l.claim_id=c.id
        join evidence.claim_evidence_assessment a on a.tenant_id=l.tenant_id and a.claim_evidence_link_id=l.id
        join evidence.locator loc on loc.tenant_id=l.tenant_id and loc.id=l.locator_id
        join evidence.verification_run r on r.tenant_id=a.tenant_id and r.id=a.run_id
        join orchestration.artifact art on art.tenant_id=r.tenant_id and art.id=r.run_manifest_artifact_id
        where c.tenant_id=$1 and a.run_id=$2 and c.structured->'verification'->>'claimId'=$3 and l.role='supports'`,
      [tenantId, input.runId, input.claimKey])).rows[0]);
      if (!row) throw new Error(`CANONICAL_CLAIM_MISSING:${input.claimKey}`);
      const binding = { tenantId, assessmentId: String(row.assessment_id), claimId: String(row.claim_id), runId: input.runId,
        locatorId: String(row.locator_id), captureId: String(row.capture_id), role: String(row.role), verdict: String(row.verdict),
        authority: row.authority_assessment, replaySignatureMatch: row.replay_signature_match === true, properties: row.properties,
        publicRationale: row.public_rationale === null ? null : String(row.public_rationale) };
      return { claimId: binding.claimId, claimKey: input.claimKey, claimDigest: sealed.assertionDigest, runId: input.runId,
        manifest: { id: String(row.run_manifest_artifact_id), digest: `sha256:${String(row.audit_sha256)}` },
        assessment: { id: binding.assessmentId, digest: contentEvidenceAssessmentDigest(binding) }, locatorId: binding.locatorId,
        captureId: binding.captureId, role: "supports" as const, sealed };
    };

    const runId = randomUUID();
    const captureText = [STATEMENT, ...(options.temporalEvents ?? []).filter(event => !event.sourceFamily).map(event => event.statement),
      ...(options.rebuildOf ? [`Replacement source revision ${fixtureKey}, prepared after withdrawal of the prior representation.`] : [])].join("\n");
    const capture = await verifier.captureFile({ runId, bytes: new TextEncoder().encode(captureText),
      filename: "publication-source.txt", sourceUri: `https://synthetic.invalid/publication/${tenantId}` });
    const captures = new Map<string, typeof capture>([["primary", capture]]);
    const common = { proposition: STATEMENT, qualifiers: QUALIFIERS };
    const ingestIntent = IngestionIntentSchema.parse({ schemaVersion: "knowledge-ingestion-intent.v1", intentId: intentKey("publication-authority"),
      context: { tenantId, missionId, attemptId }, evidence: { verificationRuns: [{ runId }] },
      subjects: (["child", "parent"] as const).map(ref => options.rebuildOf
        ? { mode: "resolved", ref, kind: "organization", entityId: options.rebuildOf.entityIds[ref] }
        : { mode: "new", ref, kind: "organization", displayName: `Synthetic ${ref} ${tenantId}`, onMatch: "fail" }),
      proposals: [
        { kind: "claim.materialize", proposalId: "claims", runId, claimIds: options.rebuildOf ? ["relationship", "record"] : ["child", "parent", "relationship", "record"] },
        ...(options.rebuildOf ? [] : ["child", "parent"].map(ref => ({ kind: "entity.create", proposalId: ref, subjectRef: ref, ...common, evidence: [{ runId, claimId: ref }] }))),
        { kind: "relationship.assert", proposalId: "relationship", relationshipKind: "subsidiary_of", fromRef: "child", toRef: "parent", qualifier: "in preview",
          worldInterval: { from: RELATIONSHIP_START, to: null }, temporalBasis: "explicit",
          extent: { sourceText: "2026", precision: "year", earliest: "2026-01-01", latest: "2026-12-31" }, ...common, evidence: [{ runId, claimId: "relationship" }] },
        { kind: "record.materialize", proposalId: "record", recordKind: "compatibility_constraint", subjectRef: "child", title: "Preview restriction",
          constraintKind: "capability_restriction", expression: "preview_only", ...common, evidence: [{ runId, claimId: "record" }] },
      ] });
    const predicted = (ref: string) => options.rebuildOf?.entityIds[ref as "child" | "parent"]
      ?? deterministicId("corpus.entity", [tenantId, ingestIntent.intentId, ref].join("\0"));
    const sealed = await sealClaims(runId, capture.captureId, ingestIntent.proposals
      .filter(proposal => proposal.kind !== "claim.materialize").map(proposal => ({
        claimId: proposal.evidence[0]!.claimId, value: proposalEffect(ingestIntent, proposal),
        entityBindings: proposal.kind === "relationship.assert"
          ? [{ role: "subject", canonicalId: predicted("child") }, { role: "object", canonicalId: predicted("parent") }]
          : [{ role: "subject", canonicalId: predicted(proposal.proposalId === "parent" ? "parent" : "child") }],
        downstreamUse: ["knowledge_ingestion:claim.materialize", `knowledge_ingestion:${proposal.kind}`,
          "content_link:chunk.claim.link", "content_link:chunk.relationship.link", "content_link:projection.target.link"],
      })));
    ingestIntent.evidence.verificationRuns[0]!.manifestDigest = sealed.manifestDigest;
    const ingested = await ingestion.apply(await withSnapshot(reads, ingestIntent));
    if (ingested.outcome !== "applied") throw new Error(`INGESTION_NOT_APPLIED:${JSON.stringify(ingested.failure)}`);
    const entityId = ingested.subjects.find(subject => subject.ref === "child")!.entityId!;
    const relationshipId = ingested.proposals.find(proposal => proposal.proposalId === "relationship")!.created!.relationshipId as string;
    const recordId = ingested.proposals.find(proposal => proposal.proposalId === "record")!.created!.recordId as string;
    const recordEvidence = await canonicalReference({ runId, claimKey: "record", manifestDigest: sealed.manifestDigest });
    const relationshipEvidence = await canonicalReference({ runId, claimKey: "relationship", manifestDigest: sealed.manifestDigest });

    const temporalEvidence: (NonNullable<SelectedCandidateFixtureOptions["temporalEvents"]>[number] & {
      entityId: string; knowledgeSeq: number; reference: Awaited<ReturnType<typeof canonicalReference>>;
    })[] = [];
    let productId: string | undefined;
    const featureIds = new Map<string, string>();
    for (const event of options.temporalEvents ?? []) {
      const eventRunId = randomUUID();
      const family = event.sourceFamily ?? "primary";
      if (!captures.has(family)) {
        const statements = options.temporalEvents!.filter(item => item.sourceFamily === family).map(item => item.statement);
        captures.set(family, await verifier.captureFile({ runId: eventRunId, bytes: new TextEncoder().encode(statements.join("\n")),
          filename: `${family}.txt`, sourceUri: `https://synthetic.invalid/${family}/${tenantId}` }));
      }
      const eventCapture = captures.get(family)!;
      const intentId = `history-${event.key}`;
      const challenged = event.challengeOf ? temporalEvidence.find(item => item.key === event.challengeOf) : undefined;
      if (event.challengeOf && !challenged) throw new Error(`CHALLENGE_TARGET_MISSING:${event.challengeOf}`);
      const challengeTarget = challenged ? await db.transaction({ tenantId, readOnly: true }, async client =>
        (await client.query<{ id: string }>("select id from temporal.segment where tenant_id=$1 and primary_claim_id=$2 and k_to is null order by k_from desc limit 1",
          [tenantId, challenged.reference.claimId])).rows[0]?.id) : undefined;
      if (challenged && !challengeTarget) throw new Error("CHALLENGE_CURRENT_SEGMENT_MISSING");
      const predictedProduct = productId ?? deterministicId("corpus.entity", [tenantId, intentId, "product"].join("\0"));
      const featureId = event.availability ? featureIds.get(event.availability.scope) : undefined;
      const predictedFeature = challenged?.entityId ?? (event.availability ? featureId ?? deterministicId("corpus.entity", [tenantId, intentId, "feature"].join("\0")) : undefined);
      const entityProposals = [
        ...(!productId ? [{ kind: "entity.create", proposalId: "product", subjectRef: "product", proposition: event.statement,
          qualifiers: [], evidence: [{ runId: eventRunId, claimId: "product" }] }] : []),
        ...(event.availability && !featureId ? [{ kind: "entity.create", proposalId: "feature", subjectRef: "feature", proposition: event.statement,
          qualifiers: [], evidence: [{ runId: eventRunId, claimId: "feature" }] }] : []),
      ];
      const eventIntent = IngestionIntentSchema.parse({ schemaVersion: "knowledge-ingestion-intent.v1",
        intentId, context: { tenantId, missionId, attemptId },
        evidence: { verificationRuns: [{ runId: eventRunId }] },
        subjects: [productId ? { mode: "resolved", ref: "product", kind: "product", entityId: productId }
          : { mode: "new", ref: "product", kind: "product", displayName: `Synthetic Model X ${tenantId}`, onMatch: "fail" },
          ...(challenged ? [{ mode: "resolved", ref: "feature", kind: "product_feature", entityId: challenged.entityId }] : []),
          ...(event.availability ? [featureId ? { mode: "resolved", ref: "feature", kind: "product_feature", entityId: featureId }
            : { mode: "new", ref: "feature", kind: "product_feature", displayName: `Synthetic Model X ${event.availability.scope} ${tenantId}`, onMatch: "fail",
              typedPayload: { product_id: predictedProduct, feature_key: event.availability.scope } }] : [])],
        proposals: [
          { kind: "claim.materialize", proposalId: "claims", runId: eventRunId, claimIds: [...entityProposals.map(proposal => proposal.proposalId), event.key] },
          ...entityProposals,
          { ...(challenged ? { kind: "support.admit", targetRef: challengeTarget, supportRole: "challenges" }
            : event.availability ? { kind: "fact.assert_state", subjectRef: "feature", streamKind: "product_feature_availability",
            status: event.availability.status, worldInterval: { from: event.from, to: event.to }, temporalBasis: "explicit",
            extent: { sourceText: event.statement, precision: "day", earliest: event.from, ...(event.to ? { latest: event.to } : {}) } }
            : { kind: "event.assert", subjectRef: "product", eventKind: event.eventKind, occurredDuring: { from: event.from, to: event.to }, precision: "day" }),
            proposalId: event.key, proposition: event.statement, qualifiers: [], evidence: [{ runId: eventRunId, claimId: event.key }] },
        ] });
      const eventSealed = await sealClaims(eventRunId, eventCapture.captureId, eventIntent.proposals
        .filter(proposal => proposal.kind !== "claim.materialize").map(proposal => ({
          claimId: proposal.evidence[0]!.claimId, value: proposalEffect(eventIntent, proposal), proposition: event.statement, qualifiers: [],
          entityBindings: [{ role: "subject", canonicalId: proposal.proposalId === "product" ? predictedProduct : predictedFeature ?? predictedProduct }],
          downstreamUse: ["knowledge_ingestion:claim.materialize", `knowledge_ingestion:${proposal.kind}`,
            "content_link:chunk.claim.link", "content_link:projection.target.link"],
        })));
      eventIntent.evidence.verificationRuns[0]!.manifestDigest = eventSealed.manifestDigest;
      const eventReceipt = await ingestion.apply(await withSnapshot(reads, eventIntent));
      if (eventReceipt.outcome !== "applied") throw new Error(`TEMPORAL_INGESTION_NOT_APPLIED:${JSON.stringify(eventReceipt.failure)}`);
      productId = predictedProduct;
      if (event.availability && predictedFeature) featureIds.set(event.availability.scope, predictedFeature);
      temporalEvidence.push({ ...event, entityId: predictedFeature ?? predictedProduct, knowledgeSeq: eventReceipt.head.after,
        reference: await canonicalReference({ runId: eventRunId, claimKey: event.key, manifestDigest: eventSealed.manifestDigest }) });
    }

    const preparation = new PostgresPreparationRepository(database);
    const chunkProcedureVersionId = options.rebuildOf ? await db.transaction({ tenantId, readOnly: true }, async client => {
      const profile = defaultChunkProfileRegistry.get("heading-sections-v1");
      const existing = (await client.query<{ id: string }>(
        "select id from retrieval.chunking_procedure_version where tenant_id=$1 and slug=$2 and version=$3",
        [tenantId, profile.name, profile.version])).rows[0];
      if (!existing) throw new Error("REBUILD_CHUNK_PROCEDURE_REQUIRED");
      return existing.id;
    }) : randomUUID();
    const prepareSource = async (capture: typeof captures extends Map<string, infer T> ? T : never, statements: readonly string[]) => {
      const captureOperationId = await createOperationId("capture");
      const physical = await db.transaction({ tenantId, readOnly: true }, async client =>
        (await client.query<Row>("select * from orchestration.artifact where tenant_id=$1 and id=$2", [tenantId, capture.contentArtifact.artifactId])).rows[0]!);
      const sourceArtifact: PersistedPreparationArtifact = { artifactId: capture.contentArtifact.artifactId,
        digest: `sha256:${capture.contentArtifact.digest.slice(7)}`, mediaType: String(physical.media_type),
        byteLength: Number(physical.size_bytes), storageKey: String(physical.object_path), artifactType: String(physical.artifact_type),
        bucketClass: "source_captures", storageBucket: "ai-engineer-cloud-bucket" };
      const preparedCapture = await preparation.persistCapture(tenantId, { operationId: captureOperationId, sourceId: randomUUID(),
        captureId: randomUUID(), sourceClass: "other", canonicalUrl: capture.finalUrl, sensitivity: "public", artifact: sourceArtifact,
        capturedAt: capture.capturedAt, captureMethod: capture.captureMethod, captureMethodVersion: "verification-executor-capture.v2",
        requestUrl: capture.finalUrl, observations: { fixture: "p5 publication" } });
      const representationId = randomUUID(), documentId = randomUUID(), documentVersionId = randomUUID();
      const blocks = statements
        .map((text, ordinal) => ({ localKey: `paragraph-${ordinal}`, ordinal, kind: "paragraph" as const, text, locator: { page: 1, sectionPath: [`Statement ${ordinal}`] } }));
      const document = convertStructuralDocument({ tenantId, representationId, createdAt: new Date().toISOString(), blocks });
      const persistedNodes = document.nodes.map(({ parentId, role, language, ...node }, index) => ({ ...node,
        ...(parentId === undefined ? {} : { parentId }), ...(role === undefined ? {} : { role }),
        ...(language === undefined ? {} : { language }), digest: sha256Digest(node.text), stableLocalKey: blocks[index]!.localKey }));
      const structuralBytes = new TextEncoder().encode(canonicalJson(JsonValueSchema.parse(document)));
      const stored = await sourceStore.put({ tenantId, mediaType: "application/json", bytes: structuralBytes });
      const structuralArtifact: PersistedPreparationArtifact = { artifactId: randomUUID(), digest: stored.digest, mediaType: "application/json",
        byteLength: structuralBytes.length, storageKey: stored.storageKey, artifactType: "report_json", bucketClass: "candidate",
        storageBucket: "ai-engineer-cloud-bucket" };
      const transformOperationId = await createOperationId("transformation");
      const manifestDigest = sha256Digest({ source: sourceArtifact.digest, structure: document.digest });
      const conversionReceipt = { converter: "convertStructuralDocument", inputDigest: sourceArtifact.digest,
        outputDigest: structuralArtifact.digest, documentDigest: document.digest, nodeCount: document.nodes.length };
      await preparation.persistRepresentation(tenantId, { operationId: transformOperationId, transformationRunId: randomUUID(),
        sourceCaptureId: preparedCapture.captureId, sourceArtifact, documentId, documentKind: "official_docs",
        canonicalTitle: "Synthetic preview source", canonicalSourceId: preparedCapture.sourceId, documentVersionId, versionLabel: "v1",
        manifestDigest, sourceNativeRepresentationId: randomUUID(), structuralRepresentationId: representationId,
        providerKey: "deterministic-structural-fixture", providerVersion: "1", profileDigest: sha256Digest("profile"),
        requestDigest: sourceArtifact.digest, receiptDigest: sha256Digest(conversionReceipt), outputArtifacts: [structuralArtifact],
        structuralArtifactId: structuralArtifact.artifactId, structuralArtifactDigest: structuralArtifact.digest, nodes: persistedNodes,
        fidelity: { grade: "high", coverage: 1, locatorCoverage: 1, findings: [] }, receipt: conversionReceipt, completedAt: new Date().toISOString() });
      await artifacts.reconcile({ tenantId, artifactId: structuralArtifact.artifactId });
      await reviewRepresentation({ representationId, digest: structuralArtifact.digest, operationId: transformOperationId, decision: "accept" });
      const profile = defaultChunkProfileRegistry.get(options.temporalEvents ? "atomic-claims-v1" : "heading-sections-v1"), chunked = chunkDocument(persistedNodes, profile);
      await preparation.persistChunkSet(tenantId, { operationId: await createOperationId("chunk"), representationId,
        procedureVersionId: chunkProcedureVersionId, procedureSlug: profile.name, procedureVersion: profile.version, tokenizer: profile.tokenizer, profile,
        inputDigest: chunked.inputDigest, outputDigest: chunked.outputDigest, chunkSetId: randomUUID(), chunks: chunked.chunks.map(chunk => ({ ...chunk,
          spans: chunk.spans.map(span => ({ ...span, selectedTextDigest: sha256Digest(document.nodes.find(node => node.id === span.nodeId)!.text.slice(span.startOffset, span.endOffset)) })) })) });

      return { representationId, documentId, documentVersionId, preparedCapture, structuralArtifact, transformOperationId,
        manifestDigest, persistedNodes, chunked };
    };
    const primarySource = await prepareSource(capture, [STATEMENT, ...(options.temporalEvents ?? []).filter(event => !event.sourceFamily).map(event => event.statement)]);
    const { representationId, documentId, documentVersionId, preparedCapture, structuralArtifact, transformOperationId,
      manifestDigest, persistedNodes, chunked } = primarySource;
    const preparedSources = new Map([["primary", primarySource]]);
    for (const [family, familyCapture] of captures) {
      if (family === "primary") continue;
      preparedSources.set(family, await prepareSource(familyCapture, options.temporalEvents!.filter(event => event.sourceFamily === family).map(event => event.statement)));
    }
    const node = persistedNodes[0]!, preparedChunk = chunked.chunks[0]!;
    const sourceNode = { id: node.id, digest: node.digest, representationId };
    const chunk = { id: preparedChunk.id, digest: preparedChunk.sourceTextDigest, documentVersionId,
      representation: { id: representationId, digest: structuralArtifact.digest }, captureId: preparedCapture.captureId, sourceNodes: [sourceNode] };
    const linkEvidence = <T extends { sealed: unknown }>({ sealed: _sealed, ...link }: T) => link;
    const base = { dependsOn: [], evidence: [linkEvidence(recordEvidence)], rationale: "Exact native admitted source linkage.",
      applicability: { validFrom: null, validTo: null, qualifiers: QUALIFIERS } };
    const summaryText = [STATEMENT, ...QUALIFIERS].join("\n"), summaryId = randomUUID();
    const documentEntity = ContentLinkOperationSchema.parse({ ...base, operationId: "document-entity", kind: "document.entity.link", documentId,
      documentVersion: { id: documentVersionId, digest: manifestDigest }, entityId, role: "mention", method: "extraction", sourceNodes: [sourceNode] });
    const chunkEntity = ContentLinkOperationSchema.parse({ ...base, operationId: "chunk-entity", kind: "chunk.entity.link", chunk, entityId, verb: "mentions", method: "extraction" });
    const summary = ContentLinkOperationSchema.parse({ ...base, operationId: "summary", kind: "summary.materialize", summaryId,
      documentVersion: { id: documentVersionId, digest: manifestDigest }, representation: { id: randomUUID(), digest: sha256Digest(summaryText) },
      derivedFrom: { id: representationId, digest: structuralArtifact.digest }, transformationRunId: randomUUID(),
      summaryKind: "technical", scope: "document", audience: "engineer", text: summaryText, tokenCount: summaryText.split(/\s+/).length,
      sources: [{ ...sourceNode, weight: 1 }] });
    const summarySource = ContentLinkOperationSchema.parse({ ...base, operationId: "summary-source", kind: "summary.source.link",
      summaryId, source: { ...sourceNode, weight: 1 } });
    const effectRunId = randomUUID();
    const effectOperations = [documentEntity, chunkEntity, summary, summarySource];
    const effectsSealed = await sealClaims(effectRunId, capture.captureId, effectOperations.map(operation => ({
      claimId: operation.operationId, value: contentLinkEffect(operation),
      entityBindings: [{ role: "subject", canonicalId: entityId }],
      downstreamUse: ["knowledge_ingestion:claim.materialize", `content_link:${operation.kind}`] })));
    const contentIngested = await ingestion.apply(await withSnapshot(reads, IngestionIntentSchema.parse({
      schemaVersion: "knowledge-ingestion-intent.v1", intentId: intentKey("content-effect-claims"), context: { tenantId, missionId, attemptId },
      evidence: { verificationRuns: [{ runId: effectRunId, manifestDigest: effectsSealed.manifestDigest }] },
      subjects: [{ mode: "resolved", ref: "child", kind: "organization", entityId }],
      proposals: [{ kind: "claim.materialize", proposalId: "claims", runId: effectRunId, claimIds: effectOperations.map(operation => operation.operationId) }] })));
    if (contentIngested.outcome !== "applied") throw new Error(`CONTENT_INGESTION_NOT_APPLIED:${JSON.stringify(contentIngested.failure)}`);
    const documentEvidence = await canonicalReference({ runId: effectRunId, claimKey: "document-entity", manifestDigest: effectsSealed.manifestDigest });
    const chunkEvidence = await canonicalReference({ runId: effectRunId, claimKey: "chunk-entity", manifestDigest: effectsSealed.manifestDigest });
    const summaryEvidence = await canonicalReference({ runId: effectRunId, claimKey: "summary", manifestDigest: effectsSealed.manifestDigest });
    const summarySourceEvidence = await canonicalReference({ runId: effectRunId, claimKey: "summary-source", manifestDigest: effectsSealed.manifestDigest });
    const authenticatedSummary = { ...summary, evidence: [linkEvidence(summaryEvidence)] } as ContentLinkOperation;
    const preparedSummary = await (async () => {
      const result = (await knowledgeOperations.invoke("content_summary_prepare", { operation: authenticatedSummary }, services!)).output as { representationId: string; outputArtifact: { digest: `sha256:${string}` } };
      await reviewRepresentation({ representationId: result.representationId, digest: result.outputArtifact.digest,
        operationId: await createOperationId("representation_review"), decision: "accept" });
      return result;
    })();

    const operations: ContentLinkOperation[] = [
      { ...documentEntity, evidence: [linkEvidence(documentEvidence)] }, { ...chunkEntity, evidence: [linkEvidence(chunkEvidence)] },
      ContentLinkOperationSchema.parse({ ...base, operationId: "chunk-claim", kind: "chunk.claim.link", chunk, claimId: recordEvidence.claimId, verb: "supports" }),
      ...(options.rebuildOf ? [] : [ContentLinkOperationSchema.parse({ ...base, operationId: "chunk-relationship", kind: "chunk.relationship.link", chunk, relationshipId, verb: "supports",
        evidence: [linkEvidence(relationshipEvidence)], applicability: { validFrom: RELATIONSHIP_START, validTo: null, qualifiers: QUALIFIERS } })]),
      ContentLinkOperationSchema.parse({ ...base, operationId: "record-target", kind: "projection.target.link",
        target: { kind: "record", canonicalId: recordId }, sourceChunks: [chunk], dependsOn: ["chunk-claim"] }),
      authenticatedSummary, { ...summarySource, evidence: [linkEvidence(summarySourceEvidence)] } as ContentLinkOperation,
      ContentLinkOperationSchema.parse({ ...base, operationId: "summary-target", kind: "projection.target.link",
        target: { kind: "summary", canonicalId: summaryId }, sourceChunks: [chunk], dependsOn: ["summary"] }),
    ];
    const temporalChunks = temporalEvidence.map(event => {
      const source = preparedSources.get(event.sourceFamily ?? "primary")!;
      const eventChunk = source.chunked.chunks.find(candidate => candidate.sourceText === event.statement);
      if (!eventChunk) throw new Error(`TEMPORAL_CHUNK_MISSING:${event.key}`);
      const eventSourceNodes = eventChunk.spans.map(span => {
        const sourceNode = source.persistedNodes.find(candidate => candidate.id === span.nodeId)!;
        return { id: sourceNode.id, digest: sourceNode.digest, representationId: source.representationId };
      });
      const sourceChunk = { id: eventChunk.id, digest: eventChunk.sourceTextDigest, sourceNodes: eventSourceNodes,
        documentVersionId: source.documentVersionId, captureId: source.preparedCapture.captureId,
        representation: { id: source.representationId, digest: source.structuralArtifact.digest } };
      const evidence = [linkEvidence(event.reference)];
      operations.push(ContentLinkOperationSchema.parse({ ...base, evidence, applicability: { validFrom: null, validTo: null, qualifiers: [] },
        operationId: `${event.key}-claim`, kind: "chunk.claim.link", chunk: sourceChunk, claimId: event.reference.claimId, verb: "supports" }),
      ContentLinkOperationSchema.parse({ ...base, evidence, applicability: { validFrom: null, validTo: null, qualifiers: [] },
        operationId: `${event.key}-target`, kind: "projection.target.link", target: { kind: "claim", canonicalId: event.reference.claimId },
        sourceChunks: [sourceChunk], dependsOn: [`${event.key}-claim`] }));
      return { event, chunk: sourceChunk, source };
    });
    const summaryOrigin = temporalChunks[0];
    const derivedDefinitions = (options.derivedSummaryStatements ?? []).map((statement, index) => {
      if (!summaryOrigin) throw new Error("DERIVED_SUMMARY_SOURCE_REQUIRED");
      const { source, chunk: sourceChunk, event } = summaryOrigin;
      return ContentLinkOperationSchema.parse({ ...base, operationId: `derived-${index}`, kind: "summary.materialize",
        applicability: { validFrom: null, validTo: null, qualifiers: [] }, summaryId: randomUUID(),
        evidence: [linkEvidence(event.reference)], documentVersion: { id: source.documentVersionId, digest: source.manifestDigest },
        representation: { id: randomUUID(), digest: sha256Digest(statement) },
        derivedFrom: { id: source.representationId, digest: source.structuralArtifact.digest }, transformationRunId: randomUUID(),
        summaryKind: ["abstract", "executive", "key_claims", "timeline", "faq"][index], scope: "document", audience: "engineer", text: statement,
        tokenCount: statement.split(/\s+/).length, sources: sourceChunk.sourceNodes.map(node => ({ ...node, weight: 1 })) });
    });
    const derivedSummaries = [];
    if (derivedDefinitions.length && summaryOrigin) {
      const derivedRunId = randomUUID();
      const event = summaryOrigin.event;
      const sealedDerived = await sealClaims(derivedRunId, captures.get(event.sourceFamily ?? "primary")!.captureId, derivedDefinitions.map(operation => ({
        claimId: operation.operationId, value: contentLinkEffect(operation),
        proposition: operation.kind === "summary.materialize" ? operation.text : event.statement, quote: event.statement, qualifiers: [],
        entityBindings: [{ role: "subject", canonicalId: event.entityId }], downstreamUse: ["knowledge_ingestion:claim.materialize",
          "content_link:summary.materialize", "content_link:chunk.claim.link", "content_link:projection.target.link"] })));
      const derivedReceipt = await ingestion.apply(await withSnapshot(reads, IngestionIntentSchema.parse({ schemaVersion: "knowledge-ingestion-intent.v1",
        intentId: intentKey("derived-summary-effects"), context: { tenantId, missionId, attemptId },
        evidence: { verificationRuns: [{ runId: derivedRunId, manifestDigest: sealedDerived.manifestDigest }] },
        subjects: [{ mode: "resolved", ref: "subject", kind: event.availability ? "product_feature" : "product", entityId: event.entityId }],
        proposals: [{ kind: "claim.materialize", proposalId: "claims", runId: derivedRunId, claimIds: derivedDefinitions.map(operation => operation.operationId) }] })));
      if (derivedReceipt.outcome !== "applied") throw new Error("DERIVED_SUMMARY_CLAIMS_NOT_ADMITTED");
      for (const operation of derivedDefinitions) {
        if (operation.kind !== "summary.materialize") throw new Error("DERIVED_SUMMARY_KIND");
        const reference = await canonicalReference({ runId: derivedRunId, claimKey: operation.operationId, manifestDigest: sealedDerived.manifestDigest });
        const evidence = [linkEvidence(reference)];
        const authenticated = { ...operation, evidence };
        const prepared = (await knowledgeOperations.invoke("content_summary_prepare", { operation: authenticated }, services)).output as {
          representationId: string; outputArtifact: { digest: `sha256:${string}` } };
        await reviewRepresentation({ representationId: prepared.representationId, digest: prepared.outputArtifact.digest,
          operationId: await createOperationId("representation_review"), decision: "accept" });
        operations.push(authenticated,
          ContentLinkOperationSchema.parse({ ...base, evidence, applicability: operation.applicability,
            operationId: `${operation.operationId}-claim`, kind: "chunk.claim.link", chunk: summaryOrigin.chunk, claimId: reference.claimId, verb: "supports" }),
          ContentLinkOperationSchema.parse({ ...base, evidence, applicability: operation.applicability,
            operationId: `${operation.operationId}-target`, kind: "projection.target.link", target: { kind: "summary", canonicalId: operation.summaryId },
            sourceChunks: [summaryOrigin.chunk], dependsOn: [operation.operationId, `${operation.operationId}-claim`] }));
        derivedSummaries.push({ operation, reference });
      }
    }
    const snapshot = await reads.runIntent({ schemaVersion: "knowledge-read-intent.v1", intentId: intentKey("publication-clock"),
      context: { tenantId, missionId, attemptId }, operations: [{ opId: "head", query: "knowledge.head" }] }, { persist: true });
    const snapshotArtifact = await artifacts.get(tenantId, snapshot.storage!.artifactId!);
    const intent = ContentLinkIntentSchema.parse({ schemaVersion: "content-link-intent.v1", intentId: intentKey("publication-seven-kinds"),
      context: { tenantId, missionId, attemptId, actor: { kind: "agent", id: "content-reconciler" } },
      contract: { migrationHead: workspace.migrationHead, workspaceFingerprint: workspace.fingerprint, policyDigest: FIXTURE_POLICY_DIGEST },
      inputSnapshot: { artifact: { id: snapshotArtifact.record.artifactId, digest: snapshotArtifact.record.digest }, knowledgeSeq: snapshot.atKnowledgeSeq },
      expectedKnowledgeHead: snapshot.atKnowledgeSeq, asOf: new Date().toISOString(), operations });
    const receipt = (await knowledgeOperations.invoke("content_link_apply", { intent }, services)).output as ContentLinkReceipt;
    if (receipt.outcome !== "applied") throw new Error(`CONTENT_LINKS_NOT_APPLIED:${JSON.stringify(receipt.operations
      .filter(operation => operation.reasons.length).map(({ operationId, reasons }) => ({ operationId, reasons })))}`);
    const targetRef = (operationId: string) => receipt.operations.find(operation => operation.operationId === operationId)!
      .canonicalRefs.find(ref => ref.table === "projection_target")!.key.id;

    const representationClass = await db.transaction({ tenantId, readOnly: true }, async client =>
      (await client.query<{ representation_class: string }>("select representation_class from content.document_representation where tenant_id=$1 and id=$2",
        [tenantId, representationId])).rows[0]!.representation_class);
    const proposerIdentity = randomUUID(), reviewerIdentity = randomUUID();
    const evaluatorIdentity = randomUUID(), publisherIdentity = options.rebuildOf?.publisherIdentity ?? randomUUID();
    if (new Set([proposerIdentity, reviewerIdentity, evaluatorIdentity, publisherIdentity]).size !== 4)
      throw new Error("PUBLICATION_FIXTURE_SEPARATION_OF_DUTY_COLLISION");
    const selectedSource = { chunkId: chunk.id, chunkDigest: chunk.digest, representationId, representationDigest: structuralArtifact.digest,
      representationClass, captureId: preparedCapture.captureId, sourceFamilyId: preparedCapture.sourceId };
    const selectedClaims = [{ runId, claimId: "record", claimDigest: recordEvidence.claimDigest,
      admissionDigest: sha256Digest(canonicalJson(JsonValueSchema.parse(recordEvidence.sealed.claim.provenance))) }];
    const selection = PromotionSelectionSchema.parse({ schemaVersion: "promotion-selection.v1", tenantId,
      expectedKnowledgeHead: receipt.head.after, runPinDigest: sha256Digest("p5-publication-selection-pin"), policyDigest: FIXTURE_POLICY_DIGEST,
      proposedBy: proposerIdentity, requiredReviewer: reviewerIdentity,
      budget: { maxMembers: Math.max(2, temporalChunks.length + derivedSummaries.length), maxBytes: 65536, maxTokens: 65536, maxCostMicros: 0, deadline: new Date(Date.now() + 3600000).toISOString() },
      selected: temporalChunks.length ? [...temporalChunks.map(({ event, chunk: eventChunk, source }) => ({
        memberId: event.key, content: { kind: "claim", id: event.reference.claimId, digest: sha256Digest(event.statement) },
        target: { kind: "claim", canonicalId: event.reference.claimId, projectionTargetId: targetRef(`${event.key}-target`) },
        targetSpaces: options.spaces, sourceChunks: [{ ...selectedSource, chunkId: eventChunk.id, chunkDigest: eventChunk.digest,
          representationId: source.representationId, representationDigest: source.structuralArtifact.digest,
          captureId: source.preparedCapture.captureId, sourceFamilyId: source.preparedCapture.sourceId }],
        admittedClaims: [{ runId: event.reference.runId, claimId: event.key, claimDigest: event.reference.claimDigest,
          admissionDigest: sha256Digest(canonicalJson(JsonValueSchema.parse(event.reference.sealed.claim.provenance))) }],
        contentLinkReceiptIds: [receipt.receiptId], reason: "Retain the exact admitted temporal event and its captured quote.",
        estimatedBytes: 0, estimatedTokens: 0, estimatedCostMicros: 0,
      })), ...derivedSummaries.map(({ operation, reference }) => ({
        memberId: operation.operationId, content: { kind: "summary", id: operation.summaryId, digest: sha256Digest(operation.text) },
        target: { kind: "summary", canonicalId: operation.summaryId, projectionTargetId: targetRef(`${operation.operationId}-target`) },
        targetSpaces: options.spaces, sourceChunks: [{ ...selectedSource, chunkId: summaryOrigin!.chunk.id, chunkDigest: summaryOrigin!.chunk.digest }],
        admittedClaims: [{ runId: reference.runId, claimId: reference.claimKey, claimDigest: reference.claimDigest,
          admissionDigest: sha256Digest(canonicalJson(JsonValueSchema.parse(reference.sealed.claim.provenance))) }],
        contentLinkReceiptIds: [receipt.receiptId], reason: "Derivation fan-out must retain the original source family.",
        estimatedBytes: 0, estimatedTokens: 0, estimatedCostMicros: 0,
      }))] : [
        { memberId: "qualified-record", content: { kind: "record", id: recordId, digest: sha256Digest(summaryText) },
          target: { kind: "record", canonicalId: recordId, projectionTargetId: targetRef("record-target") }, targetSpaces: options.spaces,
          sourceChunks: [selectedSource], admittedClaims: selectedClaims, contentLinkReceiptIds: [receipt.receiptId],
          reason: "Select the admitted qualified engineering record.", estimatedBytes: 0, estimatedTokens: 0, estimatedCostMicros: 0 },
        { memberId: "prepared-summary", content: { kind: "summary", id: summaryId, digest: sha256Digest(summaryText) },
          target: { kind: "summary", canonicalId: summaryId, projectionTargetId: targetRef("summary-target") }, targetSpaces: options.spaces,
          sourceChunks: [selectedSource], admittedClaims: selectedClaims, contentLinkReceiptIds: [receipt.receiptId],
          reason: "Select the independently reviewed prepared summary representation.", estimatedBytes: 0, estimatedTokens: 0, estimatedCostMicros: 0 },
      ],
      excluded: [{ content: { kind: "entity", id: entityId, digest: sha256Digest("unselected entity") },
        targetSpaces: options.spaces, reason: "The entity is linked but outside this selected publication." }] });
    const selectionHandle = await verifier.store.put({ bytes: new TextEncoder().encode(JSON.stringify(selection)),
      mediaType: "application/vnd.aiengineer.promotion-selection+json", producerActivityId: "p5-publication-selection", producerVersion: "1" });
    const authorityHandle = await verifier.store.put({ bytes: new TextEncoder().encode(JSON.stringify({
      schemaVersion: "promotion-selection-authority.v1", tenantId, runPinDigest: selection.runPinDigest,
      policyDigest: FIXTURE_POLICY_DIGEST, proposedBy: selection.proposedBy, requiredReviewer: selection.requiredReviewer,
      budget: selection.budget })), mediaType: "application/vnd.aiengineer.promotion-selection-authority+json",
      producerActivityId: "p5-publication-authority", producerVersion: "1" });
    const selectionArtifact = { id: selectionHandle.artifactId, digest: selectionHandle.digest };
    const withSelectionAuthority = async <T>(action: (configuration: PromotionSelectionConfiguration) => Promise<T>): Promise<T> => {
      const evidence = createCanonicalEvidenceReader({ databaseUrl, tenantId, projectUrl: storage.projectUrl,
        secretKey: storage.secretKey, policyVersion: "executor-default.v1", policyDigest: FIXTURE_POLICY_DIGEST });
      try {
        const ports = createPromotionSelectionPorts({ tenantId, policyDigest: FIXTURE_POLICY_DIGEST, artifacts, evidence,
          artifactStores: { "ai-engineer-cloud-bucket": sourceStore, "research-ingestion-intents": ledgerStore },
          async measure({ text }) { return { tokens: Buffer.byteLength(text, "utf8"), costMicros: 0 }; } });
        return await action(createPromotionSelectionConfiguration({ ports,
          authorityArtifact: { id: authorityHandle.artifactId, digest: authorityHandle.digest } }));
      } finally { await evidence.close(); }
    };

    const projectionProcedureId = randomUUID();
    const vectorStoreId = options.rebuildOf?.vectorStoreId ?? randomUUID();
    if (options.rebuildOf && (options.spaces.length !== 1 || options.spaces[0] !== options.rebuildOf.spacePins[0]?.space))
      throw new Error("REBUILD_FIXTURE_SINGLE_EXISTING_SPACE_REQUIRED");
    const storeSpaces = options.spaces.map(space => ({ space, vectorSpaceId: options.rebuildOf?.spacePins[0]!.vectorSpaceId ?? randomUUID(),
      vectorStoreSpaceId: options.rebuildOf?.vectorStoreSpaceId ?? randomUUID(),
      vectorSpaceVersionId: randomUUID(), modelSlug: "deterministic-fake/local-proof" as const, providerRoute: ["deterministic-fake"] as const }));
    const spacePins: SelectedCandidateSpacePin[] = storeSpaces.map(pin => ({ space: pin.space, vectorSpaceId: pin.vectorSpaceId,
      vectorSpaceVersionId: pin.vectorSpaceVersionId, modelSlug: pin.modelSlug, providerRoute: pin.providerRoute }));
    const primaryStore = storeSpaces[0];
    if (!primaryStore) throw new Error("PUBLICATION_FIXTURE_SPACE_REQUIRED");
    await db.transaction({ tenantId }, async client => {
      await client.query(`insert into retrieval.projection_procedure(id,slug,version,description,code_ref,implementation_sha256,projection_policy)
        values($1,$2,1,'Exact admitted selected membership','packages/persistence/src/promotion-selection.ts',$3,$4::jsonb)`,
      [projectionProcedureId, `selected-${fixtureKey}`, sha256Digest("p5-publication-procedure").slice(7), JSON.stringify({ exactSelection: true, contextualPrefix: "" })]);
      if (!options.rebuildOf) await client.query(`insert into retrieval.vector_store
        (id,tenant_id,owner_identity,store_class,slug,name,purpose,visibility)
        values($1,$2,$3,'exploratory',$4,$5,$6,'internal')`,
      [vectorStoreId, tenantId, publisherIdentity, `publication-${tenantId.slice(0, 8)}`,
        "Selected candidate publication fixture", "Exploratory activation proof store"]);
      for (const pin of storeSpaces) {
        if (!options.rebuildOf) await client.query("insert into retrieval.vector_space(id,tenant_id,slug,purpose,class) values($1,$2,$3,'Selected projection publication fixture','exploratory')",
          [pin.vectorSpaceId, tenantId, pin.space]);
        await client.query(`insert into retrieval.vector_space_version
          (id,tenant_id,vector_space_id,version,embedding_model,dims,projection_procedure_id,backend,precision,index_configuration,provider_routing_policy)
          values($1,$2,$3,(select coalesce(max(version),0)+1 from retrieval.vector_space_version where tenant_id=$2 and vector_space_id=$3),'deterministic-fake/local-proof',1536,$4,'pgvector','halfvec',$5::jsonb,$6::jsonb)`,
        [pin.vectorSpaceVersionId, tenantId, pin.vectorSpaceId, projectionProcedureId,
          JSON.stringify({ type: "hnsw", operator: "halfvec_cosine_ops" }), JSON.stringify({ ordered: ["deterministic-fake"] })]);
        if (!options.rebuildOf) await client.query(`insert into retrieval.vector_store_space
          (id,tenant_id,vector_store_id,vector_space_id,authority_class)
          values($1,$2,$3,$4,'exploratory')`,
        [pin.vectorStoreSpaceId, tenantId, vectorStoreId, pin.vectorSpaceId]);
      }
    });

    const chunkSetId = await db.transaction({ tenantId, readOnly: true }, async client =>
      (await client.query<{ chunk_set_id: string }>("select chunk_set_id from retrieval.retrieval_chunk where tenant_id=$1 and id=$2",
        [tenantId, chunk.id])).rows[0]!.chunk_set_id);
    const representationDecisionId = await db.transaction({ tenantId, readOnly: true }, async client =>
      (await client.query<{ id: string }>(`select id from content.representation_decision where tenant_id=$1 and representation_id=$2
        order by created_at desc limit 1`, [tenantId, representationId])).rows[0]!.id);
    const embeddingAdapter = new DeterministicFakeEmbeddingAdapter(1536);
    const embeddingExecutorId = randomUUID();
    const proposalInput = { selection, selectionArtifact, chunkSetId, representationDecisionId, projectionProcedureId,
      operationId: deterministicUuid("promotion-selection-operation", `promotion-selection:${selectionArtifact.digest}:prepare`),
      purpose: "Retrieve this selected qualified engineering knowledge", contextualPrefix: "", language: "en",
      visibility: "internal", classification: "internal", targetDomains: [...options.spaces],
      expectedValue: "Two admitted selected members with original evidence", risks: ["Synthetic fixture"], exclusions: [],
      reason: "Evaluated activation proof", proposedBy: selection.proposedBy };
    const advance = () => withSelectionAuthority(configuration => {
      const { operationId: _operationId, proposedBy: _proposedBy, ...payload } = proposalInput;
      return createCanonicalPromotionSelectionApplication({ database,
        governance: new PostgresGovernedIndexRepository(database, configuration), authority: configuration,
        proposal: PromotionProposalInputSchema.parse({ schemaVersion: "knowledge.promotion-proposal/v1", ...payload }),
        attemptId, reviewerAttemptId, correlationId: missionId, capabilityVersion: "selected-publication-fixture.v1",
        embeddingExecutorId, origin: "http://127.0.0.1:4100", spaces: spacePins.map(pin => ({ space: pin.space,
          vectorSpaceVersionId: pin.vectorSpaceVersionId, modelSlug: pin.modelSlug, providerRoute: pin.providerRoute })),
      }).advance({ selection, artifact: selectionArtifact });
    });
    const runWorker = (name: string, kinds: readonly string[], operationId: string, steps: number) =>
      withSelectionAuthority(async configuration => {
        const registry = createProductionActivityRegistry({ retrieval: database, review: database, governedIndex: {
          repository: new PostgresGovernedIndexRepository(database, configuration), embeddingAdapter,
          embeddingAdapterVersion: "deterministic-fake.v1" } });
        const worker = new CanonicalDurableKnowledgeWorker(`${name}-${tenantId}`, tenantId, database,
          createCanonicalActivityExecutor(database, registry), 30000, kinds as never);
        for (let step = 0; step < steps; step += 1) {
          if (!await worker.runOperationOnce(operationId)) throw new Error(`OPERATION_STEP_NOT_CLAIMED:${name}:${step}`);
        }
      });

    const prepared = await advance();
    await runWorker("publication-prepare", ["promotion_proposal"], prepared.operations[0]!.operationId, 1);
    const preparationReceipts = await database.listReceipts(tenantId, proposalInput.operationId);
    const proposal = { ...(preparationReceipts[0]!.body as unknown as GovernedProjectionProposal & { reviewSubjectId: string }),
      preparationReceiptId: preparationReceipts[0]!.id };
    const reviewOperationId = randomUUID();
    await withSelectionAuthority(async () => {
      await new PostgresKnowledgeOperationService(database).submit("promotion_decision", { context: { tenantId,
        operationId: reviewOperationId, attemptId: reviewerAttemptId, correlationId: missionId,
        actor: { kind: "service" as const, id: reviewerIdentity, serviceIdentity: "human_reviewer" as const },
        capabilityVersion: "selected-publication-fixture.v1", idempotencyKey: `selected-publication-review:${fixtureKey}`,
        reason: "Independent review of the retained candidate bytes", contractVersion: "v1" as const },
        input: { schemaVersion: "knowledge.promotion-decision/v1", proposalId: proposal.proposalId,
          reviewSubjectId: proposal.reviewSubjectId, guardedDigest: proposal.proposalDigest, decision: "accept",
          gates: { exactMembership: true, retainedQualifications: true }, policyVersion: "p5-publication-fixture.v1",
          rationale: "Independent reviewer accepts the exact selected membership." }, expectedVersions: { api: "v1" } },
      "http://127.0.0.1:4100");
    });
    await runWorker("publication-review", ["promotion_decision"], reviewOperationId, 1);
    const reviewReceipts = await database.listReceipts(tenantId, reviewOperationId);
    const promotionDecisionId = String((reviewReceipts[0]!.body as Row).decisionId);

    const embeddings: SelectedCandidateIndexInput["embeddings"][number][] = [];
    for (const pin of spacePins) {
      const progress = await advance();
      const work = progress.operations.find(item => item.stage === "embed" && item.targetSpace === pin.space)!;
      await runWorker(`publication-embed-${pin.space}`, ["embedding_run"], work.operationId, 2);
      const receipts = await database.listReceipts(tenantId, work.operationId);
      const verified = receipts.find(item => item.receiptKind === "verify.succeeded")!;
      embeddings.push({ operationId: work.operationId, receiptId: verified.id,
        embeddingRunId: String((verified.body as Row).embeddingRunId), vectorSpaceVersionId: pin.vectorSpaceVersionId,
        projectionIds: [...proposal.projectionIds].sort() });
    }
    const indexProgress = await advance();
    const indexWork = indexProgress.operations.find(item => item.stage === "index")!;
    await runWorker("publication-index", ["vector_store_ingestion"], indexWork.operationId, 3);
    const complete = await advance();
    if (complete.status !== "complete") throw new Error(`SELECTED_CANDIDATE_INCOMPLETE:${complete.status}`);

    const candidateInput: SelectedCandidateIndexInput = { schemaVersion: "knowledge.selected-candidate-index/v1",
      selection, selectionArtifact, preparation: { operationId: proposalInput.operationId,
        receiptId: proposal.preparationReceiptId, proposalId: proposal.proposalId },
      review: { operationId: reviewOperationId, receiptId: reviewReceipts[0]!.id, decisionId: promotionDecisionId }, embeddings };
    const candidate = await withSelectionAuthority(configuration =>
      new PostgresGovernedIndexRepository(database, configuration).verifySelectedCandidate(tenantId, candidateInput));
    if (candidate.publishable !== false) throw new Error("PUBLICATION_FIXTURE_CANDIDATE_PUBLISHABLE");

    const submitDurable = async (input: { kind: OperationKind; actor: DurablePublicationActor; payload: JsonValue; reason: string }) => {
      const operationId = randomUUID();
      await new PostgresKnowledgeOperationService(database).submit(input.kind, { context: { tenantId, operationId, attemptId,
        correlationId: missionId, actor: input.actor, capabilityVersion: "selected-publication-fixture.v1",
        idempotencyKey: `p5-publication:${input.kind}:${operationId}`, reason: input.reason, contractVersion: "v1" as const },
        input: input.payload, expectedVersions: { api: "v1" } }, "http://127.0.0.1:4100");
      return operationId;
    };
    const runDurable = (input: { name: string; kinds: readonly string[]; operationId: string; steps: number }) =>
      runWorker(input.name, input.kinds, input.operationId, input.steps);
    const governed = <T>(action: (repository: PostgresGovernedIndexRepository) => Promise<T>) =>
      withSelectionAuthority(configuration => action(new PostgresGovernedIndexRepository(database, configuration)));
    const queryPublished = (input: { embedding: readonly number[]; mode: PublishedQueryMode; resultLimit?: number }) =>
      governed(repository => repository.queryPublishedSpace(tenantId, { vectorStoreSpaceId: primaryStore.vectorStoreSpaceId,
        queryEmbedding: input.embedding, mode: input.mode, ...(input.resultLimit === undefined ? {} : { resultLimit: input.resultLimit }) }));
    const verifyBaseline = (queries: readonly { queryId: string; embedding: readonly number[] }[]) =>
      governed(repository => repository.verifyPublicationBaseline(tenantId, { vectorStoreSpaceId: primaryStore.vectorStoreSpaceId, queries }));
    const createReplacementCandidate = async (): Promise<ReplacementCandidate> => {
      const replacementEmbeddings: SelectedCandidateIndexInput["embeddings"][number][] = [];
      for (const pin of spacePins) {
        const nextVersionId = randomUUID();
        await db.transaction({ tenantId }, async client => {
          const current = (await client.query<{ projection_procedure_id: string; index_configuration: unknown; provider_routing_policy: unknown }>(
            `select projection_procedure_id, index_configuration, provider_routing_policy
              from retrieval.vector_space_version where tenant_id=$1 and id=$2`,
            [tenantId, pin.vectorSpaceVersionId])).rows[0];
          const next = (await client.query<{ version: string }>(
            "select (coalesce(max(version),0)+1)::text version from retrieval.vector_space_version where tenant_id=$1 and vector_space_id=$2",
            [tenantId, pin.vectorSpaceId])).rows[0];
          if (!current || !next) throw new Error("REPLACEMENT_SPACE_VERSION_MISSING");
          await client.query(`insert into retrieval.vector_space_version
            (id,tenant_id,vector_space_id,version,embedding_model,dims,projection_procedure_id,backend,precision,index_configuration,provider_routing_policy)
            values($1,$2,$3,$4,'deterministic-fake/local-proof',1536,$5,'pgvector','halfvec',$6::jsonb,$7::jsonb)`,
          [nextVersionId, tenantId, pin.vectorSpaceId, Number(next.version), current.projection_procedure_id,
            JSON.stringify(current.index_configuration), JSON.stringify(current.provider_routing_policy)]);
        });
        const operationId = await submitDurable({ kind: "embedding_run",
          actor: { kind: "service", id: embeddingExecutorId, serviceIdentity: "embedding_executor" },
          payload: { schemaVersion: "knowledge.embedding-run/v1", vectorSpaceVersionId: nextVersionId, promotionDecisionId,
            projectionIds: [...proposal.projectionIds].sort(), providerRoute: [...pin.providerRoute], expectedDimensions: 1536,
            modelSlug: pin.modelSlug },
          reason: "Independently embed the replacement space version on the same store-space" });
        await runDurable({ name: `publication-replace-embed-${pin.space}`, kinds: ["embedding_run"], operationId, steps: 2 });
        const receipts = await database.listReceipts(tenantId, operationId);
        const verified = receipts.find(item => item.receiptKind === "verify.succeeded");
        if (!verified) throw new Error("REPLACEMENT_EMBEDDING_VERIFY_MISSING");
        replacementEmbeddings.push({ operationId, receiptId: verified.id, embeddingRunId: String((verified.body as Row).embeddingRunId),
          vectorSpaceVersionId: nextVersionId, projectionIds: [...proposal.projectionIds].sort() });
      }
      const replacementInput: SelectedCandidateIndexInput = { ...candidateInput, embeddings: replacementEmbeddings };
      const replacement = await governed(repository => repository.verifySelectedCandidate(tenantId, replacementInput));
      if (replacement.publishable !== false) throw new Error("REPLACEMENT_CANDIDATE_PUBLISHABLE");
      return { candidateInput: replacementInput, candidate: replacement, vectorSpaceVersionId: replacementEmbeddings[0]!.vectorSpaceVersionId };
    };

    const host = services;
    return { tenantId, missionId, db, database, selection, selectionArtifact, candidateInput, candidate, spacePins,
      entityIds: { child: entityId, parent: ingested.subjects.find(subject => subject.ref === "parent")!.entityId! },
      temporalClaims: temporalEvidence.map(event => ({ key: event.key, claimId: event.reference.claimId, entityId: event.entityId,
        knowledgeSeq: event.knowledgeSeq, statement: event.statement })),
      projectionIds: [...proposal.projectionIds].sort(), promotionDecisionId, proposalDigest: proposal.proposalDigest,
      representationId, representationDigest: structuralArtifact.digest as `sha256:${string}`,
      preparedSummaryRepresentationId: preparedSummary.representationId, transformOperationId,
      reviewerIdentity, proposerIdentity, evaluatorIdentity, publisherIdentity, vectorStoreId,
      vectorStoreSpaceId: primaryStore.vectorStoreSpaceId, embeddingAdapter, producerDirectory: directory,
      withSelectionAuthority, createOperationId,
      reviewRepresentation, submitDurable, runDurable, queryPublished, verifyBaseline,
      createReplacementCandidate,
      async close() { await host.close(); await database.close(); await db.close(); } };
  } catch (error) {
    await services?.close(); await database.close(); await db.close();
    throw error;
  }
}

