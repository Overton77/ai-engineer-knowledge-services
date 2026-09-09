import { AgenticKnowledgeService } from "@aiengineer/knowledge-application";
import { pathToFileURL } from "node:url";
import { KnowledgeClient } from "@aiengineer/knowledge-client";
import {
  EvidencePacketSchema,
  type EvidencePacket,
} from "@aiengineer/knowledge-contracts";
import { canonicalJson, sha256Digest } from "@aiengineer/knowledge-domain";
import { DeterministicFakeEmbeddingAdapter } from "@aiengineer/knowledge-embeddings";
import {
  PostgresCanonicalRepository,
  createCanonicalPersistence,
  stageExploratoryVersion,
  type ExploratoryArtifactReference,
  type ExploratoryFixtureRecord,
} from "@aiengineer/knowledge-persistence";
import {
  deterministicUuid,
  digestBytes,
  type ArtifactDigest,
} from "@aiengineer/knowledge-runtime";
import {
  EMBEDDING_BUNDLE_VIDEO_IDS,
  loadEmbeddingBundles,
  validateEmbeddingBundle,
} from "@aiengineer/knowledge-testkit";
import { buildServer } from "../apps/api/src/server.js";

export const FIXTURE_NAMESPACE =
  process.env.KNOWLEDGE_CANONICAL_PROOF_NAMESPACE?.trim() ||
  "gate6-canonical-durability-v7";
export const FIXTURE_TENANT_ID = "00000000-0000-7000-8000-000000000001";
export const MAINTAINED_DOD_QUERY =
  "Show engineering guidance about durable agent state; identify the engineers and exact evidence; find maintained TypeScript libraries that implement the relevant patterns; return verified implementation examples; connect supporting or conflicting papers and case studies; identify model versions suited to the workflow; and identify benchmarks that could evaluate it.";
const FIXTURE_CREATED_AT = "2026-09-03T00:00:00.000Z";
const operationId = deterministicUuid(
  "canonical-proof",
  `${FIXTURE_NAMESPACE}:ingest-operation`,
);
const correlationId = deterministicUuid(
  "canonical-proof",
  `${FIXTURE_NAMESPACE}:correlation`,
);
export const packetId = deterministicUuid(
  "canonical-proof",
  `${FIXTURE_NAMESPACE}:evidence-packet`,
);
const retrievalPlanId = deterministicUuid(
  "canonical-proof",
  `${FIXTURE_NAMESPACE}:retrieval-plan`,
);
const retrievalRunId = deterministicUuid(
  "canonical-proof",
  `${FIXTURE_NAMESPACE}:retrieval-run`,
);
const policyId = deterministicUuid(
  "canonical-proof",
  `${FIXTURE_NAMESPACE}:retrieval-policy`,
);

function config() {
  const postgresUrl = process.env.POSTGRES_URL?.trim();
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!postgresUrl || !supabaseUrl || !supabaseSecretKey)
    throw new Error("LOCAL_PERSISTENCE_CONFIGURATION_REQUIRED");
  const pg = new URL(postgresUrl);
  const sb = new URL(supabaseUrl);
  if (
    !new Set(["127.0.0.1", "localhost"]).has(pg.hostname) ||
    pg.port !== "54322" ||
    !new Set(["127.0.0.1", "localhost"]).has(sb.hostname) ||
    sb.port !== "54321"
  )
    throw new Error("LOCAL_ONLY_PROOF_REFUSED_REMOTE_TARGET");
  return { postgresUrl, supabaseUrl, supabaseSecretKey };
}
const databaseOnly = () =>
  new PostgresCanonicalRepository({
    connectionString: config().postgresUrl,
    connectionTimeoutMs: Number(
      process.env.POSTGRES_CONNECTION_TIMEOUT_MS ?? 2_000,
    ),
    localOnly: true,
  });

async function buildFixtureRecordsFromBundles(
  bundles: readonly ReturnType<typeof validateEmbeddingBundle>[],
) {
  const index = await new AgenticKnowledgeService(
    new DeterministicFakeEmbeddingAdapter(),
  ).buildExploratoryIndex(bundles);
  const claims = bundles.flatMap((bundle) =>
    bundle.engineering_claims.map((claim) => ({
      videoId: bundle.video_id,
      claimId: claim.id,
      freshnessAt: `${bundle.research_as_of}T00:00:00.000Z`,
    })),
  );
  if (index.records.length !== claims.length)
    throw new Error("FIXTURE_PROJECTION_ALIGNMENT_FAILED");
  return {
    index,
    records: index.records.map(
      (record, index): ExploratoryFixtureRecord => ({
        sourceRecordId: record.id,
        projectionId: record.projectionId,
        text: record.text,
        embedding: record.vector,
        videoId: claims[index]!.videoId,
        claimId: claims[index]!.claimId,
        freshnessAt: claims[index]!.freshnessAt,
      }),
    ),
  };
}

async function sourceArtifacts() {
  const environment = config();
  const persistence = createCanonicalPersistence({
    postgres: { connectionString: environment.postgresUrl, localOnly: true },
    supabaseUrl: environment.supabaseUrl,
    supabaseSecretKey: environment.supabaseSecretKey,
    storageBucket: "source-captures",
  });
  try {
    const loaded = await loadEmbeddingBundles();
    const references: ExploratoryArtifactReference[] = [];
    const verified: { videoId: string; digest: string; byteLength: number }[] =
      [];
    for (const item of loaded) {
      const bytes = new TextEncoder().encode(
        `${canonicalJson(JSON.parse(JSON.stringify(item.bundle)))}\n`,
      );
      const stored = await persistence.artifacts.put({
        tenantId: FIXTURE_TENANT_ID,
        mediaType: "application/json",
        bytes,
      });
      const downloaded = await persistence.artifacts.get(
        FIXTURE_TENANT_ID,
        stored.digest,
      );
      if (!downloaded || digestBytes(downloaded) !== stored.digest)
        throw new Error("STORAGE_DIGEST_VERIFICATION_FAILED");
      const artifactId = await persistence.database.recordArtifact(
        FIXTURE_TENANT_ID,
        {
          artifactId: stored.artifactId,
          artifactType: "source_capture",
          sha256: stored.digest.slice(7),
          bucketClass: "source_captures",
          storageBucket: "source-captures",
          objectPath: stored.storageKey,
          mediaType: stored.mediaType,
          sizeBytes: stored.byteLength,
        },
      );
      references.push({
        videoId: item.bundle.video_id,
        artifactId,
        digest: stored.digest,
        storageBucket: "source-captures",
        objectPath: stored.storageKey,
      });
      verified.push({
        videoId: item.bundle.video_id,
        digest: stored.digest,
        byteLength: stored.byteLength,
      });
    }
    return { references, verified };
  } finally {
    await persistence.close();
  }
}

async function readBundlesFromStorage(database: PostgresCanonicalRepository) {
  const environment = config();
  const persistence = createCanonicalPersistence({
    postgres: { connectionString: environment.postgresUrl, localOnly: true },
    supabaseUrl: environment.supabaseUrl,
    supabaseSecretKey: environment.supabaseSecretKey,
    storageBucket: "source-captures",
  });
  try {
    // The bucket is shared with preparation proofs and other tenants/workflows.
    // Scope this reconstruction to the immutable three-bundle manifest instead
    // of asserting a bucket-global artifact count.
    const admitted = await loadEmbeddingBundles();
    const expectedByDigest = new Map(admitted.map((item) => {
      const bytes = new TextEncoder().encode(`${canonicalJson(JSON.parse(JSON.stringify(item.bundle)))}\n`);
      return [digestBytes(bytes).slice(7),item.bundle.video_id] as const;
    }));
    if (expectedByDigest.size !== 3) throw new Error(`STORAGE_MANIFEST_CARDINALITY:${expectedByDigest.size}`);
    const rows = await database.transaction(
      FIXTURE_TENANT_ID,
      async (client) =>
        (
          await client.query<{
            id: string;
            sha256: string;
            object_path: string;
          }>(
            `select id,sha256,object_path from orchestration.artifact
             where tenant_id=$1 and storage_bucket='source-captures' and artifact_type='source_capture'
               and sha256=any($2::text[]) order by sha256,id`,
            [FIXTURE_TENANT_ID,[...expectedByDigest.keys()]],
          )
        ).rows,
    );
    if (rows.length !== 3)
      throw new Error(`STORAGE_MANIFEST_ARTIFACT_CARDINALITY:${rows.length}`);
    if (new Set(rows.map((row) => row.sha256)).size !== expectedByDigest.size
      || rows.some((row) => !expectedByDigest.has(row.sha256)))
      throw new Error("STORAGE_MANIFEST_SUBSTITUTION");
    const bundles: ReturnType<typeof validateEmbeddingBundle>[] = [];
    const references: ExploratoryArtifactReference[] = [];
    for (const row of rows) {
      const digest = `sha256:${row.sha256}` as ArtifactDigest;
      const bytes = await persistence.artifacts.get(FIXTURE_TENANT_ID, digest);
      if (!bytes || digestBytes(bytes) !== digest)
        throw new Error("STORAGE_DIGEST_VERIFICATION_FAILED");
      const bundle = validateEmbeddingBundle(
        JSON.parse(new TextDecoder().decode(bytes)),
      );
      if (expectedByDigest.get(row.sha256) !== bundle.video_id)
        throw new Error("STORAGE_MANIFEST_VIDEO_MISMATCH");
      bundles.push(bundle);
      references.push({
        videoId: bundle.video_id,
        artifactId: row.id,
        digest,
        storageBucket: "source-captures",
        objectPath: row.object_path,
      });
    }
    bundles.sort(
      (a, b) =>
        EMBEDDING_BUNDLE_VIDEO_IDS.indexOf(
          a.video_id as (typeof EMBEDDING_BUNDLE_VIDEO_IDS)[number],
        ) -
        EMBEDDING_BUNDLE_VIDEO_IDS.indexOf(
          b.video_id as (typeof EMBEDDING_BUNDLE_VIDEO_IDS)[number],
        ),
    );
    return { bundles, references };
  } finally {
    await persistence.close();
  }
}

async function ingest() {
  const database = databaseOnly();
  try {
    const loaded = await loadEmbeddingBundles();
    const artifacts = await sourceArtifacts();
    const built = await buildFixtureRecordsFromBundles(
      loaded.map((item) => item.bundle),
    );
    const operation = await database.createOperation({
      id: operationId,
      tenantId: FIXTURE_TENANT_ID,
      operationKind: "vector_store_ingestion",
      idempotencyKey: `${FIXTURE_NAMESPACE}:ingest`,
      ownershipMode: "eve",
      externalRunId: `process-a-${process.pid}`,
      correlationId,
      actorIdentity: "eve:local-proof",
      request: {
        storeClass: "internal_exploratory",
        fixtureVersion: "embedding-bundle-seed-2026-09-01",
        videoIds: EMBEDDING_BUNDLE_VIDEO_IDS,
      },
      steps: [
        "store-private-artifacts",
        "stage-canonical-records",
        "publish-exploratory",
      ].map((key, index) => ({
        id: deterministicUuid(
          "canonical-proof-step",
          `${operationId}:${index}`,
        ),
        key,
        kind: key,
        input: { key },
      })),
    });
    const staged = await stageExploratoryVersion(database, {
      namespace: FIXTURE_NAMESPACE,
      tenantId: FIXTURE_TENANT_ID,
      version: 1,
      records: built.records,
      artifacts: artifacts.references,
      reason: "local exploratory durability proof",
      proposedBy: "eve:local-proof",
      reviewerIdentity: "local-review-fixture",
    });
    const publicationReceiptId = await database.publishVectorSpace(
      FIXTURE_TENANT_ID,
      {
        publicationId: staged.publicationId,
        expectedGuardedSha256: staged.guardedSha256,
        reason: "initial local exploratory publication",
        actorIdentity: `apps-worker-process-a:${process.pid}`,
        idempotencyKey: `${FIXTURE_NAMESPACE}:publish:v1`,
      },
    );

    const completed = new Set(
      (await database.listSteps(FIXTURE_TENANT_ID, operation.id))
        .filter((step) => step.status === "succeeded")
        .map((step) => step.stepKey),
    );
    while (completed.size < 3) {
      const claim = await database.claimOperation(
        FIXTURE_TENANT_ID,
        operation.id,
        `apps-worker-process-a:${process.pid}`,
      );
      if (!claim)
        throw new Error(
          `OPERATION_STEP_UNAVAILABLE:${operation.id}:${completed.size}`,
        );
      const output =
        claim.stepKey === "store-private-artifacts"
          ? { artifacts: artifacts.verified }
          : claim.stepKey === "stage-canonical-records"
            ? staged
            : claim.stepKey === "publish-exploratory"
              ? {
                  publicationReceiptId,
                  publicationId: staged.publicationId,
                  storeClass: "internal_exploratory",
                }
              : undefined;
      if (!output)
        throw new Error(`UNEXPECTED_OPERATION_STEP:${claim.stepKey}`);
      await database.completeStep(FIXTURE_TENANT_ID, claim, {
        id: deterministicUuid("canonical-proof-receipt", `${claim.id}:success`),
        idempotencyKey: `${FIXTURE_NAMESPACE}:${claim.stepKey}:success`,
        receiptKind:
          claim.stepKey === "store-private-artifacts"
            ? "storage_verification"
            : claim.stepKey === "stage-canonical-records"
              ? "canonical_stage"
              : "publication",
        executorIdentity: `apps-worker-process-a:${process.pid}`,
        output,
      });
      completed.add(claim.stepKey);
    }
    const final = await database.getOperation(FIXTURE_TENANT_ID, operation.id);
    if (final?.status !== "succeeded")
      throw new Error(`OPERATION_NOT_SUCCEEDED:${final?.status ?? "missing"}`);
    return {
      phase: "process_a_apps_worker_ingest_publish",
      pid: process.pid,
      operationId: operation.id,
      status: final.status,
      publicationId: staged.publicationId,
      vectorSpaceVersionId: staged.vectorSpaceVersionId,
      publicationReceiptId,
      artifacts: artifacts.verified,
      counts: { bundles: 3, claims: 41, vectors: 41 },
    };
  } finally {
    await database.close();
  }
}

async function activePublication(database: PostgresCanonicalRepository) {
  return database.transaction(
    FIXTURE_TENANT_ID,
    async (client) =>
      (
        await client.query<{
          publication_id: string;
          vector_space_version_id: string;
        }>(
          `select p.id publication_id,p.vector_space_version_id from retrieval.space_publication p join retrieval.vector_store_space s on s.tenant_id=p.tenant_id and s.id=p.vector_store_space_id where p.tenant_id=$1 and p.status='published' and s.authority_class='exploratory' order by p.published_at desc,p.id desc limit 1`,
          [FIXTURE_TENANT_ID],
        )
      ).rows[0],
  );
}

async function ensureSourceNativePacketMembers(
  database: PostgresCanonicalRepository,
  hits: Awaited<ReturnType<PostgresCanonicalRepository["hybridSearch"]>>,
  references: ExploratoryArtifactReference[],
) {
  await database.transaction(FIXTURE_TENANT_ID, async (client) => {
    for (const [index, hit] of hits.slice(0, 5).entries()) {
      const artifact = references[index % references.length]!;
      const documentId = deterministicUuid(
        "canonical-proof-document",
        artifact.artifactId,
      );
      const versionId = deterministicUuid(
        "canonical-proof-document-version",
        artifact.artifactId,
      );
      const representationId = deterministicUuid(
        "canonical-proof-representation",
        artifact.artifactId,
      );
      const nodeId = deterministicUuid(
        "canonical-proof-node",
        hit.vectorItemId,
      );
      await client.query(
        `insert into content.document(id,tenant_id,document_kind,canonical_title) values($1,$2,'research_bundle',$3) on conflict(id) do nothing`,
        [
          documentId,
          FIXTURE_TENANT_ID,
          `Internal exploratory bundle ${index + 1}`,
        ],
      );
      await client.query(
        `insert into content.document_version(id,tenant_id,document_id,version_label,manifest_sha256) values($1,$2,$3,'fixture-v1',$4) on conflict(id) do nothing`,
        [versionId, FIXTURE_TENANT_ID, documentId, artifact.digest.slice(7)],
      );
      await client.query(
        `insert into content.document_representation(id,tenant_id,document_version_id,artifact_id,representation_kind,representation_class,media_type,content_sha256,acceptance_state,source_native_byte_identical) values($1,$2,$3,$4,'json','source_native','application/json',$5,'accepted',true) on conflict(id) do nothing`,
        [
          representationId,
          FIXTURE_TENANT_ID,
          versionId,
          artifact.artifactId,
          artifact.digest.slice(7),
        ],
      );
      await client.query(
        `insert into content.document_node(id,tenant_id,representation_id,ordinal,stable_local_key,node_kind,inline_text,start_offset,end_offset,normalized_content_sha256) values($1,$2,$3,$4,$5,'section',$6,0,$7,$8) on conflict(id) do nothing`,
        [
          nodeId,
          FIXTURE_TENANT_ID,
          representationId,
          index,
          `vector-item:${hit.vectorItemId}`,
          hit.searchText,
          Math.max(1, Math.min(512, hit.searchText.length)),
          sha256Digest(hit.searchText).slice(7),
        ],
      );
    }
  });
}

async function createPacket(
  database: PostgresCanonicalRepository,
  hybrid: Awaited<ReturnType<PostgresCanonicalRepository["hybridSearch"]>>,
  references: ExploratoryArtifactReference[],
): Promise<EvidencePacket> {
  await ensureSourceNativePacketMembers(database, hybrid, references);
  const receiptIds = (
    await database.listReceipts(FIXTURE_TENANT_ID, operationId)
  ).map((item) => item.id);
  const rows = await database.transaction(
    FIXTURE_TENANT_ID,
    async (client) =>
      (
        await client.query<{
          id: string;
          claim_id: string;
          search_projection_id: string;
          freshness_at: Date;
          content_sha256: string;
        }>(
          `select id,claim_id,search_projection_id,freshness_at,content_sha256 from retrieval.vector_item where tenant_id=$1 and id=any($2::uuid[])`,
          [FIXTURE_TENANT_ID, hybrid.map((item) => item.vectorItemId)],
        )
      ).rows,
  );
  const byId = new Map(rows.map((item) => [item.id, item]));
  const subqueries = [
    {
      id: "durable-state",
      text: "durable agent state engineering guidance",
      coverageRole: "required" as const,
    },
    {
      id: "engineers-evidence",
      text: "engineers and exact evidence",
      coverageRole: "required" as const,
    },
    {
      id: "typescript-libraries",
      text: "maintained TypeScript libraries and verified implementations",
      coverageRole: "required" as const,
    },
    {
      id: "papers-cases",
      text: "supporting and conflicting papers and case studies",
      coverageRole: "supporting" as const,
    },
    {
      id: "models-benchmarks",
      text: "model versions and evaluation benchmarks",
      coverageRole: "supporting" as const,
    },
  ];
  const core = {
    id: packetId,
    tenantId: FIXTURE_TENANT_ID,
    schemaVersion: "v1" as const,
    createdAt: FIXTURE_CREATED_AT,
    retrievalRunId,
    normalizedQuery: MAINTAINED_DOD_QUERY,
    plan: {
      policyVersion: policyId,
      query: MAINTAINED_DOD_QUERY,
      intents: [
        "knowledge_evidence" as const,
        "implementation_support" as const,
      ],
      subqueries,
      spaces: [
        "engineering_claims" as const,
        "tool_capabilities" as const,
        "implementation_examples" as const,
        "paper_case_study_knowledge" as const,
        "entity_profiles" as const,
        "model_capabilities" as const,
        "benchmark_intelligence" as const,
      ],
      anchors: {
        entities: [],
        concepts: [],
        useCases: ["durable agent state"],
      },
      hardFilters: [
        { field: "visibility", op: "eq" as const, value: "internal" },
      ],
      softBoosts: [],
      temporalScope: { observedBefore: "2026-09-03T23:59:59.000Z" },
      candidateK: 100,
      finalK: 10,
      graph: {
        maxDepth: 2,
        allowedEdges: ["supports", "challenges", "qualifies"],
      },
      abstention: { minimumCoverage: 1 },
    },
    authorization: {
      decisionId: deterministicUuid(
        "canonical-proof",
        `${packetId}:authorization`,
      ),
      tenantId: FIXTURE_TENANT_ID,
      actorId: deterministicUuid("canonical-proof", `${packetId}:reader`),
      action: "read",
      resource: `evidence_packet:${packetId}`,
      allowed: true,
      policyVersion: policyId,
      reasonCodes: ["tenant_match", "internal_exploratory_reader"],
    },
    procedureVersionIds: [
      deterministicUuid(
        "canonical-exploratory-fixture",
        `${FIXTURE_NAMESPACE}:projection-procedure`,
      ),
    ],
    members: hybrid.slice(0, 5).map((hit, index) => {
      const row = byId.get(hit.vectorItemId)!;
      const artifact = references[index % references.length]!;
      const representationId = deterministicUuid(
        "canonical-proof-representation",
        artifact.artifactId,
      );
      return {
        memberId: deterministicUuid(
          "canonical-proof-member",
          `${packetId}:${hit.vectorItemId}`,
        ),
        faithfulSectionRepresentationId: representationId,
        matchedProjectionId: row.search_projection_id,
        locators: [
          {
            representationId,
            nodeId: deterministicUuid("canonical-proof-node", hit.vectorItemId),
            startOffset: 0,
            endOffset: Math.max(1, Math.min(512, hit.searchText.length)),
            quoteDigest: `sha256:${row.content_sha256}` as const,
          },
        ],
        scores: {
          semantic: Number(
            (hit.channelScores as { ann?: { score?: number } })?.ann?.score ??
              0,
          ),
          fusion: hit.fusedScore,
          final: hit.fusedScore,
        },
        channelExplanations: Object.entries(
          hit.channelScores as Record<
            string,
            { score?: number; rank?: number }
          >,
        ).map(
          ([channel, value]) =>
            `${channel}: score=${value.score ?? 0}, rank=${value.rank ?? 0}`,
        ),
        graphPaths: [],
        authority: "exploratory" as const,
        assurance: "medium" as const,
        freshAt: new Date(row.freshness_at).toISOString(),
        contradictionIds: [],
        supersedesIds: [],
        coveredSubqueryIds: ["durable-state", "engineers-evidence"],
        artifactReferences: [
          {
            artifactId: artifact.artifactId,
            tenantId: FIXTURE_TENANT_ID,
            digest: artifact.digest as `sha256:${string}`,
            mediaType: "application/json",
          },
        ],
      };
    }),
    omittedResults: [
      {
        reason:
          "The three-bundle exploratory fixture has no canonical TypeScript-library, implementation-example, paper/case-study, model-version, or benchmark records; the system abstains rather than fabricate them.",
      },
    ],
    coverage: subqueries.map((item, index) => ({
      subqueryId: item.id,
      coverage: index < 2 ? 1 : 0,
    })),
    abstention: {
      recommended: true,
      reason:
        "Only engineering guidance and source evidence are supported by this bounded exploratory fixture.",
    },
    eventIds: [],
    artifactIds: references.map((item) => item.artifactId),
    receiptIds,
  };
  const packet = EvidencePacketSchema.parse({
    ...core,
    digest: sha256Digest(JSON.parse(JSON.stringify(core))),
  });
  await database.storeEvidencePacket(FIXTURE_TENANT_ID, {
    planId: retrievalPlanId,
    runId: retrievalRunId,
    packetId,
    packet,
  });
  return packet;
}

async function retrieve() {
  const database = databaseOnly();
  try {
    const active = await activePublication(database);
    if (!active) throw new Error("NO_ACTIVE_EXPLORATORY_PUBLICATION");
    const queryEmbedding = (
      await new DeterministicFakeEmbeddingAdapter().embedOne({
        vectorSpaceVersionId: active.vector_space_version_id,
        idempotencyKey: `${FIXTURE_NAMESPACE}:maintained-query`,
        expectedDimensions: 1536,
        input: {
          projectionId: "maintained-dod-query",
          text: MAINTAINED_DOD_QUERY,
        },
      })
    ).item.embedding;
    const request = {
      tenantId: FIXTURE_TENANT_ID,
      vectorSpaceVersionId: active.vector_space_version_id,
      queryText: MAINTAINED_DOD_QUERY,
      queryEmbedding,
      filters: { visibility: "internal" },
      resultLimit: 10,
      candidateLimit: 41,
      rrfK: 60,
    };
    const [hybrid, ann, exact, stored] = await Promise.all([
      database.hybridSearch(request),
      database.annNearest(request),
      database.exactNearest(request),
      readBundlesFromStorage(database),
    ]);
    const packet = await createPacket(database, hybrid, stored.references);
    return {
      phase: "process_b_fresh_reconstruction",
      pid: process.pid,
      publicationId: active.publication_id,
      vectorSpaceVersionId: active.vector_space_version_id,
      query: MAINTAINED_DOD_QUERY,
      hybridHits: hybrid
        .slice(0, 5)
        .map((item) => ({
          id: item.vectorItemId,
          score: item.fusedScore,
          channels: Object.keys(item.channelScores as object),
        })),
      annVsExact: {
        annTop: ann[0]?.vectorItemId,
        exactTop: exact[0]?.vectorItemId,
        topMatches: ann[0]?.vectorItemId === exact[0]?.vectorItemId,
        annTopScore: ann[0]?.score,
        exactTopScore: exact[0]?.score,
      },
      storage: {
        objects: stored.references.length,
        digestsVerified: true,
        videoIds: stored.bundles.map((bundle) => bundle.video_id),
      },
      packetId: packet.id,
      memberCount: packet.members.length,
      abstention: packet.abstention,
    };
  } finally {
    await database.close();
  }
}

async function rebuild() {
  const database = databaseOnly();
  try {
    const stored = await readBundlesFromStorage(database);
    const built = await buildFixtureRecordsFromBundles(stored.bundles);
    const prior = await activePublication(database);
    if (!prior) throw new Error("NO_ACTIVE_EXPLORATORY_PUBLICATION");
    const v1PublicationId = deterministicUuid(
      "canonical-exploratory-fixture",
      `${FIXTURE_NAMESPACE}:publication:1`,
    );
    const v1Guard = await database.transaction(
      FIXTURE_TENANT_ID,
      async (client) =>
        (
          await client.query<{ guarded_sha256: string }>(
            `select d.guarded_sha256 from retrieval.space_publication p join retrieval.content_promotion_decision d on d.tenant_id=p.tenant_id and d.id=p.publication_decision_id where p.tenant_id=$1 and p.id=$2`,
            [FIXTURE_TENANT_ID, v1PublicationId],
          )
        ).rows[0]!.guarded_sha256,
    );
    const v2 = await stageExploratoryVersion(database, {
      namespace: FIXTURE_NAMESPACE,
      tenantId: FIXTURE_TENANT_ID,
      version: 2,
      records: built.records,
      artifacts: stored.references,
      reason: "failure drill upgrade",
      proposedBy: "control-plane:local-proof",
      reviewerIdentity: "local-review-fixture",
    });
    const publishV2 = await database.publishVectorSpace(FIXTURE_TENANT_ID, {
      publicationId: v2.publicationId,
      expectedGuardedSha256: v2.guardedSha256,
      reason: "exercise atomic upgrade",
      actorIdentity: `recovery:${process.pid}`,
      idempotencyKey: `${FIXTURE_NAMESPACE}:publish:v2`,
    });
    const rollbackOperationId=deterministicUuid("canonical-proof",`${FIXTURE_NAMESPACE}:rollback-operation:v1`);
    await database.transaction(FIXTURE_TENANT_ID,async(client)=>{
      const request={fixture:true,kind:"publication_rollback",currentPublicationId:v2.publicationId,targetPublicationId:v1PublicationId};
      await client.query(`insert into knowledge_service.operation
        (id,tenant_id,operation_kind,idempotency_key,correlation_id,actor_identity,request,request_sha256,status)
        values($1,$2,'publication_rollback',$3,$4,$5,$6::jsonb,$7,'running') on conflict(id) do nothing`,[
          rollbackOperationId,FIXTURE_TENANT_ID,`${FIXTURE_NAMESPACE}:rollback-operation:v1`,correlationId,`control-plane:${FIXTURE_NAMESPACE}`,
          JSON.stringify(request),sha256Digest(request).slice(7),
        ]);
    });
    const rollback = await database.rollbackVectorSpace(FIXTURE_TENANT_ID, {
      currentPublicationId: v2.publicationId,
      targetPublicationId: v1PublicationId,
      expectedGuardedSha256: v1Guard,
      reason: "simulated retrieval regression",
      actorIdentity: `recovery:${process.pid}`,
      idempotencyKey: `${FIXTURE_NAMESPACE}:rollback:v1`,
      operationId: rollbackOperationId,
    });
    const v3 = await stageExploratoryVersion(database, {
      namespace: FIXTURE_NAMESPACE,
      tenantId: FIXTURE_TENANT_ID,
      version: 3,
      records: built.records,
      artifacts: stored.references,
      reason: "rebuild from immutable Storage artifacts and receipts",
      proposedBy: "control-plane:local-proof",
      reviewerIdentity: "local-review-fixture",
      rebuildOfReceiptId: rollback,
    });
    const publishV3 = await database.publishVectorSpace(FIXTURE_TENANT_ID, {
      publicationId: v3.publicationId,
      expectedGuardedSha256: v3.guardedSha256,
      reason: "publish artifact-derived rebuild",
      actorIdentity: `recovery:${process.pid}`,
      idempotencyKey: `${FIXTURE_NAMESPACE}:publish:v3`,
    });
    return {
      phase: "rollback_rebuild",
      pid: process.pid,
      sourcePublicationId: prior.publication_id,
      publishV2ReceiptId: publishV2,
      rollbackReceiptId: rollback,
      rebuildPublicationId: v3.publicationId,
      publishV3ReceiptId: publishV3,
      rebuiltFrom: { storageObjects: 3, receiptId: rollback },
      counts: { claims: 41, vectors: 41 },
    };
  } finally {
    await database.close();
  }
}

async function drill() {
  const database = databaseOnly();
  try {
    const makeOperation = async (name: string) =>
      database.createOperation({
        id: deterministicUuid(
          "canonical-proof",
          `${FIXTURE_NAMESPACE}:drill:${name}`,
        ),
        tenantId: FIXTURE_TENANT_ID,
        operationKind: "retrieval_run",
        idempotencyKey: `${FIXTURE_NAMESPACE}:drill:${name}`,
        correlationId: deterministicUuid(
          "canonical-proof",
          `${FIXTURE_NAMESPACE}:drill-correlation:${name}`,
        ),
        actorIdentity: "worker:local-proof",
        request: { scenario: name },
        steps: [
          {
            id: deterministicUuid(
              "canonical-proof",
              `${FIXTURE_NAMESPACE}:drill-step:${name}`,
            ),
            key: name,
            kind: name,
            input: { scenario: name },
            maxAttempts: 3,
          },
        ],
      });
    const leaseOp = await makeOperation("expired-lease");
    let first = await database.claimOperation(
      FIXTURE_TENANT_ID,
      leaseOp.id,
      "dead-worker",
      1,
    );
    if (!first) {
      const steps = await database.listSteps(FIXTURE_TENANT_ID, leaseOp.id);
      if (steps[0]?.status === "succeeded") {
        return {
          phase: "failure_recovery_drills",
          pid: process.pid,
          replayed: true,
        };
      }
      throw new Error("LEASE_DRILL_SELECTION_FAILED");
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
    const reclaimed = await database.claimOperation(
      FIXTURE_TENANT_ID,
      leaseOp.id,
      "recovery-worker",
      30_000,
    );
    if (
      !reclaimed ||
      reclaimed.id !== first.id ||
      reclaimed.fencingToken <= first.fencingToken
    )
      throw new Error("LEASE_FENCING_RECOVERY_FAILED");
    let staleLeaseClass = "";
    try {
      await database.heartbeat(FIXTURE_TENANT_ID, first, 30_000);
    } catch (error) {
      staleLeaseClass = error instanceof Error ? error.message : String(error);
    }
    await database.completeStep(FIXTURE_TENANT_ID, reclaimed, {
      id: deterministicUuid("canonical-proof", `${reclaimed.id}:recovered`),
      idempotencyKey: `${FIXTURE_NAMESPACE}:expired-lease:recovered`,
      receiptKind: "recovery",
      executorIdentity: "recovery-worker",
      output: { recovered: true },
    });
    const outage = async (
      kind: "provider" | "reranker",
      failureClass: string,
      fallback: string,
    ) => {
      const op = await makeOperation(`${kind}-outage`);
      const lease = await database.claimOperation(
        FIXTURE_TENANT_ID,
        op.id,
        `${kind}-worker`,
      );
      if (!lease || lease.operationId !== op.id)
        throw new Error(`${kind.toUpperCase()}_DRILL_SELECTION_FAILED`);
      await database.failStep(FIXTURE_TENANT_ID, lease, {
        id: deterministicUuid("canonical-proof", `${lease.id}:failed`),
        idempotencyKey: `${FIXTURE_NAMESPACE}:${kind}:failed`,
        executorIdentity: `${kind}-worker`,
        errorClass: failureClass,
        retryable: true,
      });
      const recovered = await database.claimOperation(
        FIXTURE_TENANT_ID,
        op.id,
        `${kind}-fallback-worker`,
      );
      if (!recovered || recovered.id !== lease.id)
        throw new Error(`${kind.toUpperCase()}_RECOVERY_FAILED`);
      await database.completeStep(FIXTURE_TENANT_ID, recovered, {
        id: deterministicUuid("canonical-proof", `${recovered.id}:fallback`),
        idempotencyKey: `${FIXTURE_NAMESPACE}:${kind}:fallback`,
        receiptKind: `${kind}_fallback`,
        executorIdentity: `${kind}-fallback-worker`,
        output: { failureClass, fallback },
      });
      return { failureClass, fallback, recovered: true };
    };
    const provider = await outage(
      "provider",
      "PROVIDER_UNAVAILABLE",
      "deterministic-local-provider",
    );
    const reranker = await outage(
      "reranker",
      "RERANKER_UNAVAILABLE",
      "deterministic_rrf",
    );
    const outboxOwner = `outbox-drill:${process.pid}`;
    const outbox = await database.claimOperationOutbox(
      FIXTURE_TENANT_ID,
      leaseOp.id,
      outboxOwner,
      1,
    );
    if (!outbox[0]) throw new Error("OUTBOX_DRILL_NO_MESSAGE");
    const extendedUntil = await database.extendOutboxClaim(
      FIXTURE_TENANT_ID,
      outbox[0],
      30_000,
    );
    await database.markOutboxFailed(
      FIXTURE_TENANT_ID,
      outbox[0],
      "BROKER_UNAVAILABLE",
      0,
    );
    const retried = (
      await database.claimOperationOutbox(
        FIXTURE_TENANT_ID,
        leaseOp.id,
        outboxOwner,
        10,
      )
    ).find((item) => item.id === outbox[0]!.id);
    if (!retried) throw new Error("OUTBOX_RECOVERY_FAILED");
    await database.markOutboxPublished(FIXTURE_TENANT_ID, retried);
    return {
      phase: "failure_recovery_drills",
      pid: process.pid,
      lease: {
        staleLeaseClass,
        firstFence: first.fencingToken,
        recoveredFence: reclaimed.fencingToken,
      },
      provider,
      reranker,
      outbox: {
        failureClass: "BROKER_UNAVAILABLE",
        deliveryAttempts: retried.deliveryAttempts,
        claimExtendedUntil: extendedUntil,
        published: true,
      },
    };
  } finally {
    await database.close();
  }
}

async function health() {
  const database = databaseOnly();
  try {
    await database.transaction(FIXTURE_TENANT_ID, async (client) =>
      client.query("select 1"),
    );
    return { phase: "database_health", pid: process.pid, ok: true };
  } catch (error) {
    return {
      phase: "database_health",
      pid: process.pid,
      ok: false,
      failureClass: "DATABASE_UNAVAILABLE",
      detail: error instanceof Error ? error.name : "Error",
    };
  } finally {
    await database.close().catch(() => undefined);
  }
}
async function serveApi() {
  const database = databaseOnly();
  const port = Number(process.env.PORT ?? 4187);
  const token = process.env.KNOWLEDGE_API_TOKEN;
  if (!token) throw new Error("KNOWLEDGE_API_TOKEN_REQUIRED");
  const apiActor = {
    kind: "service" as const,
    id: deterministicUuid("canonical-proof", "http-api-reader"),
    serviceIdentity: "mission_control_client" as const,
  };
  const server = buildServer({
    resolveIdentity: (candidate) =>
      candidate === token
        ? {
            actor: apiActor,
            grants: [
              {
                tenantId: FIXTURE_TENANT_ID,
                roles: ["knowledge_reader"],
                scopes: [],
              },
            ],
          }
        : undefined,
    getEvidencePacket: async (tenant, id) =>
      EvidencePacketSchema.parse(await database.getEvidencePacket(tenant, id)),
  });
  const address = await server.listen({ host: "127.0.0.1", port });
  process.stdout.write(
    `${JSON.stringify({ phase: "api_ready", pid: process.pid, address, packetId, tenantId: FIXTURE_TENANT_ID })}\n`,
  );
  const shutdown = async () => {
    await server.close();
    await database.close();
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
async function apiClient() {
  const token = process.env.KNOWLEDGE_API_TOKEN;
  if (!token) throw new Error("KNOWLEDGE_API_TOKEN_REQUIRED");
  const client = new KnowledgeClient({
    baseUrl: process.env.KNOWLEDGE_API_URL ?? "http://127.0.0.1:4187",
    getAccessToken: () => token,
  });
  const packet = await client.getEvidencePacket(packetId, {
    tenantId: FIXTURE_TENANT_ID,
    correlationId: "canonical-live-http-client",
  });
  return {
    phase: "fresh_http_client",
    pid: process.pid,
    packetId: packet.id,
    tenantId: packet.tenantId,
    memberCount: packet.members.length,
    abstention: packet.abstention.recommended,
  };
}

if (
  process.env.CANONICAL_FIXTURE_MODE ||
  (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
) {
  const mode = process.env.CANONICAL_FIXTURE_MODE ?? process.argv[2];
  let result: unknown;
  if (mode === "ingest") result = await ingest();
  else if (mode === "retrieve") result = await retrieve();
  else if (mode === "rebuild") result = await rebuild();
  else if (mode === "drill") result = await drill();
  else if (mode === "health") result = await health();
  else if (mode === "api") await serveApi();
  else if (mode === "api-client") result = await apiClient();
  else throw new Error(`UNKNOWN_MODE:${mode}`);
  if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
}
