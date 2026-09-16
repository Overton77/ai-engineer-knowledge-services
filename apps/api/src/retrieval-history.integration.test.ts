import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EvidencePacketSchema,
  RetrievalCitationReplaySchema,
  RetrievalUnsupportedResponseSchema,
  type EvidencePacket,
  type RetrievalPlan,
} from "@aiengineer/knowledge-contracts";
import { sha256Digest } from "@aiengineer/knowledge-domain";
import { apiOwnedOperationKinds } from "@aiengineer/knowledge-application";
import {
  PostgresKnowledgeOperationService,
  createRemoteRetrievalArtifactReader,
} from "@aiengineer/knowledge-persistence";
import { disposableDatabaseUrl, disposableStorageConfig } from "../../../packages/persistence/test/disposable.mjs";
import { buildRetrievalHistoryFixture, retrievalHistoryEvents } from "../../../packages/persistence/test/retrieval-history-fixture.mjs";
import { createSelectedCandidateFixture, type SelectedCandidateFixture, type SelectedCandidateFixtureOptions } from "../../verification-executor/src/knowledge/selected-candidate-fixture.js";
import { PUBLICATION_SPACE, evaluateCandidate, publicationIdFor, publishCandidate } from "../../verification-executor/src/knowledge/selected-candidate-publication.js";
import type { LocalApiIdentity } from "./auth.js";
import { CanonicalRetrievalExecutor } from "./retrieval-executor.js";
import { buildServer } from "./server.js";

const CURRENT_QUERY = "Synthetic Child and Parent organizations operate together in preview";
const PRE_VALIDITY_WORLD = "2025-06-01T00:00:00.000Z";
const FIXTURE_TIMEOUT_MS = 240_000;
const TEMPORAL_CORPUS_TIMEOUT_MS = 480_000;
const TOKEN_A = "t7-retrieval-tenant-a-token";
const TOKEN_B = "t7-retrieval-tenant-b-token";
const databaseUrl = disposableDatabaseUrl();
const storage = disposableStorageConfig();

const HISTORY_ACTOR_ENCODING = "Official publication must be authorized by the persisted operation identities";

interface RetrievalHarness {
  readonly fixture: SelectedCandidateFixture;
  readonly policyVersionId: string;
  readonly publicationId: string;
  readonly publicationAuthorized: boolean;
  readonly api: ReturnType<typeof buildServer>;
  readonly actor: LocalApiIdentity["actor"];
  readonly tenantB: string;
  currentOperationId?: string;
  currentPacket?: EvidencePacket;
}

function operatorIdentity(tenantId: string, actor: LocalApiIdentity["actor"]): LocalApiIdentity {
  return { actor, grants: [{ tenantId, roles: ["knowledge_operator"], scopes: [] }] };
}

function readerIdentity(tenantId: string, actor: LocalApiIdentity["actor"]): LocalApiIdentity {
  return { actor, grants: [{ tenantId, roles: ["knowledge_reader"], scopes: [] }] };
}

async function admitRetrievalPolicy(fixture: SelectedCandidateFixture, maxPerSource = 3): Promise<string> {
  const policyId = randomUUID();
  const policyVersionId = randomUUID();
  const policy = {
    admittedSpaces: [PUBLICATION_SPACE],
    allowedFilterFields: ["language", "visibility", "classification", "source_kind", "authority_level", "freshness_after"],
    allowedVisibilities: ["internal"],
    maxCandidateK: 100, maxFinalK: 20, rrfK: 60, minimumCoverage: 0,
    providerRoute: ["deterministic-fake"], maximumRerankCandidates: 20, maxPerSource, contextRadius: 0,
  };
  await fixture.db.transaction({ tenantId: fixture.tenantId }, async client => {
    await client.query("insert into retrieval.retrieval_policy(id,tenant_id,slug,purpose,lifecycle) values($1,$2,$3,$4,'active')",
      [policyId, fixture.tenantId, `t7-retrieval-${policyId.slice(0, 8)}`, "T7 official retrieval policy"]);
    await client.query(`insert into retrieval.retrieval_policy_version
      (id,tenant_id,retrieval_policy_id,version,policy,policy_schema,policy_sha256,status)
      values($1,$2,$3,1,$4::jsonb,$5::jsonb,$6,'active')`,
    [policyVersionId, fixture.tenantId, policyId, JSON.stringify(policy),
      JSON.stringify({ schemaVersion: "retrieval-runtime-policy/v1" }), sha256Digest(policy).slice(7)]);
  });
  return policyVersionId;
}

function retrievalPlan(policyVersion: string, query: string, scope: Partial<Pick<RetrievalPlan, "worldScope" | "knowledgeScope" | "graph" | "optionalCapabilities" | "temporalScope">> = {}): RetrievalPlan {
  return {
    policyVersion, query, intents: ["knowledge_evidence"],
    subqueries: [{ id: "preview", text: query, coverageRole: "required" }],
    spaces: [PUBLICATION_SPACE],
    anchors: { entities: [], concepts: [], useCases: [] },
    hardFilters: [{ field: "visibility", op: "eq", value: "internal" }],
    softBoosts: [], temporalScope: scope.temporalScope ?? {},
    ...(scope.worldScope ? { worldScope: scope.worldScope } : {}),
    ...(scope.knowledgeScope ? { knowledgeScope: scope.knowledgeScope } : {}),
    ...(scope.optionalCapabilities ? { optionalCapabilities: scope.optionalCapabilities } : {}),
    candidateK: 20, finalK: 5,
    graph: scope.graph ?? { maxDepth: 0, allowedEdges: [] },
    abstention: { minimumCoverage: 0 },
  };
}

function createRetrievalApi(input: {
  fixture: SelectedCandidateFixture;
  actor: LocalApiIdentity["actor"];
  tenantB: string;
}) {
  const readArtifact = createRemoteRetrievalArtifactReader(input.fixture.database, {
    projectUrl: storage!.projectUrl, serviceRoleKey: storage!.secretKey, buckets: ["ai-engineer-cloud-bucket"],
  });
  return buildServer({
    operationService: new PostgresKnowledgeOperationService(input.fixture.database, { admittedOperationKinds: [...apiOwnedOperationKinds] }),
    resourceReader: input.fixture.database,
    getEvidencePacket: async (tenantId, packetId) => {
      const packet = await input.fixture.database.getEvidencePacket(tenantId, packetId);
      return packet === undefined ? undefined : EvidencePacketSchema.parse(packet);
    },
    replayEvidencePacketCitations: (tenantId, packetId) =>
      input.fixture.database.replayEvidencePacketCitations(tenantId, packetId, readArtifact),
    canonicalRetrievalExecutor: new CanonicalRetrievalExecutor(input.fixture.database, input.fixture.embeddingAdapter),
    publicOrigin: "http://127.0.0.1:54431",
    resolveIdentity: token => {
      if (token === TOKEN_A) return operatorIdentity(input.fixture.tenantId, input.actor);
      if (token === TOKEN_B) return readerIdentity(input.tenantB, input.actor);
      return undefined;
    },
  });
}

async function postRetrieval(input: {
  api: ReturnType<typeof buildServer>;
  tenantId: string;
  token: string;
  actor: LocalApiIdentity["actor"];
  plan: RetrievalPlan;
}) {
  const operationId = randomUUID();
  const correlationId = `t7-${operationId}`;
  const response = await input.api.inject({
    method: "POST", url: "/v1/retrieval-runs",
    headers: { authorization: `Bearer ${input.token}`, "x-tenant-id": input.tenantId, "x-correlation-id": correlationId },
    payload: {
      context: {
        tenantId: input.tenantId, operationId, attemptId: randomUUID(), correlationId,
        actor: input.actor, capabilityVersion: "retrieval/v1", idempotencyKey: `t7:${operationId}`,
        reason: "T7 official retrieval", contractVersion: "v1",
      },
      input: { plan: input.plan },
      expectedVersions: { api: "v1", retrieval: "v1" },
    },
  });
  return { operationId, response };
}

async function readAuthorizedPacket(input: {
  api: ReturnType<typeof buildServer>;
  tenantId: string;
  token: string;
  operationId: string;
}): Promise<EvidencePacket> {
  const run = await input.api.inject({
    method: "GET", url: `/v1/retrieval-runs/${input.operationId}`,
    headers: { authorization: `Bearer ${input.token}`, "x-tenant-id": input.tenantId, "x-correlation-id": `read-${input.operationId}` },
  });
  expect(run.statusCode, run.body).toBe(200);
  const packetIds = run.json().evidencePacketIds as string[];
  expect(packetIds).toHaveLength(1);
  const packet = await input.api.inject({
    method: "GET", url: `/v1/evidence-packets/${packetIds[0]}`,
    headers: { authorization: `Bearer ${input.token}`, "x-tenant-id": input.tenantId, "x-correlation-id": `packet-${packetIds[0]}` },
  });
  expect(packet.statusCode, packet.body).toBe(200);
  return EvidencePacketSchema.parse(packet.json());
}

describe.skipIf(!databaseUrl || !storage)("T7 temporal retrieval and citation replay through the API", () => {
  let harness: RetrievalHarness;

  beforeAll(async () => {
    const fixture = await createSelectedCandidateFixture({ databaseUrl: databaseUrl!, storage: storage!, spaces: [PUBLICATION_SPACE] });
    expect(fixture.candidate.publishable).toBe(false);
    const evaluation = await evaluateCandidate(fixture, fixture);
    const operationId = await publishCandidate(fixture, {
      ...evaluation, candidateInput: fixture.candidateInput, candidate: fixture.candidate,
      steps: 2, reason: "Activate the independently evaluated selected candidate for T7 retrieval",
    });
    const publicationId = await publicationIdFor(fixture, operationId, "verify.succeeded");
    const policyVersionId = await admitRetrievalPolicy(fixture);
    const resolved = await fixture.database.resolveRetrievalPolicy(fixture.tenantId, policyVersionId, [PUBLICATION_SPACE]);
    if (!resolved.targets.length) throw new Error(`T7_NO_ACTIVE_TARGETS:${resolved.version}`);
    const publications = await fixture.database.retrievalPublications(fixture.tenantId, resolved.targets.map(target => target.vectorSpaceVersionId));
    await fixture.database.retrievalKnowledgeClock(fixture.tenantId);
    const actor = { kind: "service" as const, id: randomUUID(), serviceIdentity: "mission_control_client" as const };
    const tenantB = randomUUID();
    harness = {
      fixture, policyVersionId, publicationId, actor, tenantB,
      publicationAuthorized: publications.size === resolved.targets.length,
      api: createRetrievalApi({ fixture, actor, tenantB }),
    };
  }, FIXTURE_TIMEOUT_MS);

  afterAll(async () => {
    await harness?.api.close();
    await harness?.fixture.close();
  });

  it("returns an authorized current packet with full support, not a bag of ids", async () => {
    const posted = await postRetrieval({
      api: harness.api, tenantId: harness.fixture.tenantId, token: TOKEN_A, actor: harness.actor,
      plan: retrievalPlan(harness.policyVersionId, CURRENT_QUERY),
    });
    const failed = posted.response.statusCode === 202 ? undefined : await harness.api.inject({
      method: "GET", url: `/v1/operations/${posted.operationId}`,
      headers: { authorization: `Bearer ${TOKEN_A}`, "x-tenant-id": harness.fixture.tenantId, "x-correlation-id": `diag-${posted.operationId}` },
    });
    harness.currentOperationId = posted.operationId;
    if (!harness.publicationAuthorized) {
      expect(posted.response.statusCode, `${HISTORY_ACTOR_ENCODING}; ${posted.response.body}`).toBe(409);
      throw new Error(`T7_CURRENT_PACKET_BLOCKED:${HISTORY_ACTOR_ENCODING}`);
    }
    expect(posted.response.statusCode, `${posted.response.body} operation=${failed?.body}`).toBe(202);
    const packet = await readAuthorizedPacket({
      api: harness.api, tenantId: harness.fixture.tenantId, token: TOKEN_A, operationId: posted.operationId,
    });
    expect(packet.members.length).toBeGreaterThan(0);
    expect(packet.queryClock?.publications?.some(item => item.publicationId === harness.publicationId)).toBe(true);
    expect(packet.queryClock?.atKnowledgeSeq).toBeGreaterThanOrEqual(0);
    for (const member of packet.members) {
      expect(member.support).toBeDefined();
      expect(member.support!.paths.length).toBeGreaterThan(0);
      expect(member.locators.length).toBeGreaterThan(0);
      expect(member.artifactReferences.length).toBeGreaterThan(0);
      for (const path of member.support!.paths) {
        expect(path.captureId).toMatch(/^[0-9a-f-]{36}$/i);
        expect(path.captureArtifact.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(path.selectedContentDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      }
    }
    expect(harness.fixture.candidate.publishable).toBe(false);
    harness.currentPacket = packet;
  }, FIXTURE_TIMEOUT_MS);

  it("omits the preview record when no admitted world-time witness covers the query", async () => {
    const posted = await postRetrieval({
      api: harness.api, tenantId: harness.fixture.tenantId, token: TOKEN_A, actor: harness.actor,
      plan: retrievalPlan(harness.policyVersionId, CURRENT_QUERY, { worldScope: { kind: "at", at: PRE_VALIDITY_WORLD } }),
    });
    expect(posted.response.statusCode, posted.response.body).not.toBe(422);
    if (!harness.publicationAuthorized) {
      throw new Error(HISTORY_ACTOR_ENCODING);
    }
    expect(posted.response.statusCode, posted.response.body).toBe(202);
    const historical = await readAuthorizedPacket({
      api: harness.api, tenantId: harness.fixture.tenantId, token: TOKEN_A, operationId: posted.operationId,
    });
    expect(historical.plan.worldScope).toEqual({ kind: "at", at: PRE_VALIDITY_WORLD });
    expect(historical.queryClock?.worldScope).toEqual({ kind: "at", at: PRE_VALIDITY_WORLD });
    expect(historical.members).toEqual([]);
  }, FIXTURE_TIMEOUT_MS);

  it("keeps tenant B from reading tenant A's run or packet", async () => {
    const runId = harness.currentPacket?.retrievalRunId ?? harness.currentOperationId ?? (await postRetrieval({
      api: harness.api, tenantId: harness.fixture.tenantId, token: TOKEN_A, actor: harness.actor,
      plan: retrievalPlan(harness.policyVersionId, CURRENT_QUERY),
    })).operationId;
    expect(runId).toBeDefined();
    const owner = await harness.api.inject({
      method: "GET", url: `/v1/operations/${runId}`,
      headers: { authorization: `Bearer ${TOKEN_A}`, "x-tenant-id": harness.fixture.tenantId, "x-correlation-id": `owner-${runId}` },
    });
    expect(owner.statusCode, owner.body).toBe(200);
    const headers = { authorization: `Bearer ${TOKEN_B}`, "x-tenant-id": harness.tenantB, "x-correlation-id": `tenant-b-${randomUUID()}` };
    const run = await harness.api.inject({ method: "GET", url: `/v1/operations/${runId}`, headers });
    expect(run.statusCode).toBe(404);
    if (harness.currentPacket) {
      const packet = await harness.api.inject({ method: "GET", url: `/v1/evidence-packets/${harness.currentPacket.id}`, headers });
      const citations = await harness.api.inject({ method: "GET", url: `/v1/evidence-packets/${harness.currentPacket.id}/citations`, headers });
      expect(packet.statusCode).toBe(404);
      expect(citations.statusCode).toBe(404);
    }
    const forged = await harness.api.inject({
      method: "GET", url: `/v1/operations/${runId}`,
      headers: { authorization: `Bearer ${TOKEN_B}`, "x-tenant-id": harness.fixture.tenantId, "x-correlation-id": `forged-${randomUUID()}` },
    });
    expect(forged.statusCode).toBe(403);
  }, FIXTURE_TIMEOUT_MS);

  it("returns RETRIEVAL_CAPABILITY_UNSUPPORTED 422 for a required unimplemented capability", async () => {
    const posted = await postRetrieval({
      api: harness.api, tenantId: harness.fixture.tenantId, token: TOKEN_A, actor: harness.actor,
      plan: retrievalPlan(harness.policyVersionId, CURRENT_QUERY, { graph: { maxDepth: 1, allowedEdges: ["supports"] } }),
    });
    expect(posted.response.statusCode, posted.response.body).toBe(422);
    const body = RetrievalUnsupportedResponseSchema.parse(posted.response.json());
    expect(body.code).toBe("RETRIEVAL_CAPABILITY_UNSUPPORTED");
    expect(body.unsupported).toEqual([{ capability: "graph", reason: "not_implemented" }]);
  }, FIXTURE_TIMEOUT_MS);

  it("replays remote citation bytes after producer local files are gone", async () => {
    if (!harness.currentPacket) throw new Error(`T7_REPLAY_BLOCKED:${HISTORY_ACTOR_ENCODING}`);
    const current = harness.currentPacket;
    expect(current!.members.some(member => (member.support?.paths.length ?? 0) > 0)).toBe(true);
    await rm(harness.fixture.producerDirectory, { recursive: true, force: true });
    expect(existsSync(harness.fixture.producerDirectory)).toBe(false);
    const replayed = await harness.api.inject({
      method: "GET", url: `/v1/evidence-packets/${current!.id}/citations`,
      headers: {
        authorization: `Bearer ${TOKEN_A}`, "x-tenant-id": harness.fixture.tenantId,
        "x-correlation-id": `replay-${current!.id}`,
      },
    });
    expect(replayed.statusCode, replayed.body).toBe(200);
    const body = RetrievalCitationReplaySchema.parse(replayed.json());
    expect(body.evidencePacketId).toBe(current!.id);
    expect(body.citations.length).toBeGreaterThan(0);
    expect(body.failures).toEqual([]);
    for (const citation of body.citations) {
      expect(citation.selectedText.trim().length).toBeGreaterThan(0);
      expect(citation.selectedSizeBytes).toBe(Buffer.byteLength(citation.selectedText, "utf8"));
      expect(citation.selectedSizeBytes).toBeGreaterThan(0);
      expect(citation.captureDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(citation.selectedContentDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(citation.selectedText).toMatch(/preview/i);
    }
  }, FIXTURE_TIMEOUT_MS);

  it("omits revoked support from a later official current retrieval", async () => {
    if (!harness.publicationAuthorized) throw new Error(`T7_REVOCATION_BLOCKED:${HISTORY_ACTOR_ENCODING}`);
    await harness.fixture.reviewRepresentation({
      representationId: harness.fixture.representationId,
      digest: harness.fixture.representationDigest,
      operationId: harness.fixture.transformOperationId,
      decision: "reject",
    });
    const posted = await postRetrieval({
      api: harness.api, tenantId: harness.fixture.tenantId, token: TOKEN_A, actor: harness.actor,
      plan: retrievalPlan(harness.policyVersionId, CURRENT_QUERY),
    });
    expect(posted.response.statusCode, posted.response.body).toBe(202);
    const packet = await readAuthorizedPacket({
      api: harness.api, tenantId: harness.fixture.tenantId, token: TOKEN_A, operationId: posted.operationId,
    });
    expect(packet.members).toEqual([]);
    expect(packet.abstention.recommended).toBe(true);
    expect(harness.fixture.candidate.publishable).toBe(false);
  }, FIXTURE_TIMEOUT_MS);
});

describe.skipIf(!databaseUrl || !storage)("T7 announcement and GA temporal packets", () => {
  let fixture: SelectedCandidateFixture & { publicationId: string };
  let api: ReturnType<typeof buildServer>;
  let policyVersionId: string;
  const actor: LocalApiIdentity["actor"] = { kind: "service", id: randomUUID(), serviceIdentity: "mission_control_client" };

  beforeAll(async () => {
    fixture = await buildRetrievalHistoryFixture({ databaseUrl: databaseUrl!, storage: storage! });
    policyVersionId = await admitRetrievalPolicy(fixture);
    api = createRetrievalApi({ fixture, actor, tenantB: randomUUID() });
  }, FIXTURE_TIMEOUT_MS);

  afterAll(async () => { await api?.close(); await fixture?.close(); });

  async function packetAt(scope: Pick<RetrievalPlan, "worldScope" | "knowledgeScope">) {
    const posted = await postRetrieval({ api, tenantId: fixture.tenantId, token: TOKEN_A, actor,
      plan: retrievalPlan(policyVersionId, "Synthetic Model X API announcement general availability", scope) });
    expect(posted.response.statusCode, posted.response.body).toBe(202);
    const packet = await readAuthorizedPacket({ api, tenantId: fixture.tenantId, token: TOKEN_A, operationId: posted.operationId });
    expect(packet.queryClock?.worldScope).toEqual(scope.worldScope);
    if (scope.knowledgeScope) expect(packet.queryClock?.atKnowledgeSeq).toBe(scope.knowledgeScope.atKnowledgeSeq);
    expect(packet.queryClock?.publications?.some(binding => binding.publicationId === fixture.publicationId)).toBe(true);
    return packet;
  }

  function assertClaims(packet: EvidencePacket, keys: string[]) {
    const expected = fixture.temporalClaims.filter(claim => keys.includes(claim.key));
    expect(packet.members.map(member => member.support?.target.canonicalId).sort()).toEqual(expected.map(claim => claim.claimId).sort());
    for (const member of packet.members) {
      expect(member.support?.target.kind).toBe("claim");
      expect(member.support?.paths).toHaveLength(1);
      const claim = expected.find(item => item.claimId === member.support!.target.canonicalId)!;
      expect(member.support!.paths[0]!.claimId).toBe(claim.claimId);
      expect(member.support!.paths[0]!.selectedContentDigest).toBe(sha256Digest(claim.statement));
      expect(member.support!.paths[0]!.captureArtifact.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(member.locators.length).toBeGreaterThan(0);
      expect(member.artifactReferences.length).toBeGreaterThan(0);
    }
    expect(fixture.candidate.publishable).toBe(false);
  }

  it("returns only the admitted event at each world time, with exact supporting quote", async () => {
    for (const event of retrievalHistoryEvents) {
      assertClaims(await packetAt({ worldScope: { kind: "at", at: event.from } }), [event.key]);
      assertClaims(await packetAt({ worldScope: { kind: "at", at: event.to! } }), []);
    }
    assertClaims(await packetAt({ worldScope: { kind: "overlap", from: retrievalHistoryEvents[0]!.from,
      to: retrievalHistoryEvents[1]!.from } }), ["announcement"]);
    assertClaims(await packetAt({}), ["announcement", "ga"]);
  }, FIXTURE_TIMEOUT_MS);

  it("excludes GA at the earlier knowledge sequence even when world time is GA day", async () => {
    const announcement = fixture.temporalClaims.find(claim => claim.key === "announcement")!;
    const ga = fixture.temporalClaims.find(claim => claim.key === "ga")!;
    expect(ga.knowledgeSeq).toBeGreaterThan(announcement.knowledgeSeq);
    const knowledgeScope = { atKnowledgeSeq: announcement.knowledgeSeq };
    assertClaims(await packetAt({ knowledgeScope }), ["announcement"]);
    assertClaims(await packetAt({ knowledgeScope, worldScope: { kind: "at", at: retrievalHistoryEvents[1]!.from } }), []);
    assertClaims(await packetAt({ knowledgeScope: { atKnowledgeSeq: ga.knowledgeSeq },
      worldScope: { kind: "at", at: retrievalHistoryEvents[1]!.from } }), ["ga"]);
    assertClaims(await packetAt({ knowledgeScope: { atKnowledgeSeq: announcement.knowledgeSeq - 1 } }), []);
  }, FIXTURE_TIMEOUT_MS);

  it("replays each temporal packet's exact quote from remote custody after producer teardown", async () => {
    const packets = [];
    for (const event of retrievalHistoryEvents) {
      packets.push({ event, packet: await packetAt({ worldScope: { kind: "at", at: event.from } }) });
    }
    await rm(fixture.producerDirectory, { recursive: true, force: true });
    expect(existsSync(fixture.producerDirectory)).toBe(false);
    for (const { event, packet } of packets) {
      const response = await api.inject({ method: "GET", url: `/v1/evidence-packets/${packet.id}/citations`,
        headers: { authorization: `Bearer ${TOKEN_A}`, "x-tenant-id": fixture.tenantId, "x-correlation-id": `history-replay-${packet.id}` } });
      expect(response.statusCode, response.body).toBe(200);
      const replay = RetrievalCitationReplaySchema.parse(response.json());
      expect(replay.failures).toEqual([]);
      expect(replay.citations).toHaveLength(1);
      expect(replay.citations[0]!.selectedText).toBe(event.statement);
      expect(replay.citations[0]!.selectedContentDigest).toBe(sha256Digest(event.statement));
    }
  }, FIXTURE_TIMEOUT_MS);
});

const scopedAvailability: NonNullable<SelectedCandidateFixtureOptions["temporalEvents"]> = [
  { key: "api-announced", statement: "Synthetic Model X API was announced on January 15 and remained announcement-only until February 1 2026.",
    availability: { scope: "api", status: "announced" }, from: "2026-01-15T00:00:00Z", to: "2026-02-01T00:00:00Z" },
  { key: "api-preview", statement: "Synthetic Model X API was in preview from February 1 until June 10 2026.",
    availability: { scope: "api", status: "preview" }, from: "2026-02-01T00:00:00Z", to: "2026-06-10T00:00:00Z" },
  { key: "api-ga", statement: "Synthetic Model X API was reported generally available from June 10 2026.",
    availability: { scope: "api", status: "ga" }, from: "2026-06-10T00:00:00Z", to: null },
  { key: "chatgpt-preview", statement: "Synthetic Model X in ChatGPT was in preview from February 1 until July 20 2026.",
    availability: { scope: "chatgpt", status: "preview" }, from: "2026-02-01T00:00:00Z", to: "2026-07-20T00:00:00Z" },
  { key: "chatgpt-ga", statement: "Synthetic Model X in ChatGPT became generally available on July 20 2026.",
    availability: { scope: "chatgpt", status: "ga" }, from: "2026-07-20T00:00:00Z", to: null },
  { key: "api-correction", statement: "Correction: Synthetic Model X API remained in preview from June 10 until June 12 2026.",
    availability: { scope: "api", status: "preview" }, from: "2026-06-10T00:00:00Z", to: "2026-06-12T00:00:00Z" },
  { key: "api-challenge", statement: "A supported challenge disputes Synthetic Model X API general availability after June 12 2026.",
    challengeOf: "api-ga", from: "2026-06-12T00:00:00Z", to: null },
];

describe.skipIf(!databaseUrl || !storage)("T08/T09 corrected and surface-scoped temporal packets", () => {
  let fixture: SelectedCandidateFixture;
  let api: ReturnType<typeof buildServer>;
  let policyVersionId: string;
  const actor: LocalApiIdentity["actor"] = { kind: "service", id: randomUUID(), serviceIdentity: "mission_control_client" };
  const claim = (key: string) => fixture.temporalClaims.find(item => item.key === key)!;

  beforeAll(async () => {
    fixture = await buildRetrievalHistoryFixture({ databaseUrl: databaseUrl!, storage: storage!, temporalEvents: scopedAvailability });
    policyVersionId = await admitRetrievalPolicy(fixture, 20);
    api = createRetrievalApi({ fixture, actor, tenantB: randomUUID() });
  }, TEMPORAL_CORPUS_TIMEOUT_MS);
  afterAll(async () => { await api?.close(); await fixture?.close(); });

  async function scopedPacket(input: { at: string; entityId?: string; knowledgeSeq?: number }) {
    const plan = retrievalPlan(policyVersionId, "Synthetic Model X availability", { worldScope: { kind: "at", at: input.at },
      knowledgeScope: { atKnowledgeSeq: input.knowledgeSeq ?? claim("api-correction").knowledgeSeq } });
    plan.anchors.entities = input.entityId ? [input.entityId] : [];
    plan.finalK = 20;
    const posted = await postRetrieval({ api, tenantId: fixture.tenantId, token: TOKEN_A, actor, plan });
    expect(posted.response.statusCode, posted.response.body).toBe(202);
    return readAuthorizedPacket({ api, tenantId: fixture.tenantId, token: TOKEN_A, operationId: posted.operationId });
  }
  function expectMembers(packet: EvidencePacket, keys: string[]) {
    expect(packet.members.map(member => member.support!.target.canonicalId).sort()).toEqual(keys.map(key => claim(key).claimId).sort());
    for (const member of packet.members) {
      const support = member.support!;
      expect(support.paths).toHaveLength(1);
      expect(support.paths[0]!.claimId).toBe(support.target.canonicalId);
      const original = fixture.temporalClaims.find(item => item.claimId === support.target.canonicalId)!;
      expect(support.paths[0]!.selectedContentDigest).toBe(sha256Digest(original.statement));
    }
  }

  it("T09 separates announcement, preview, API GA and later ChatGPT GA through entity filters", async () => {
    const apiEntity = claim("api-ga").entityId, chatgptEntity = claim("chatgpt-ga").entityId;
    expect(apiEntity).not.toBe(chatgptEntity);
    expectMembers(await scopedPacket({ at: "2026-01-16T00:00:00Z" }), ["api-announced"]);
    expectMembers(await scopedPacket({ at: "2026-03-01T00:00:00Z", entityId: apiEntity }), ["api-preview"]);
    expectMembers(await scopedPacket({ at: "2026-06-15T00:00:00Z" }), ["api-ga", "chatgpt-preview"]);
    expectMembers(await scopedPacket({ at: "2026-06-15T00:00:00Z", entityId: chatgptEntity }), ["chatgpt-preview"]);
    expectMembers(await scopedPacket({ at: "2026-07-21T00:00:00Z", entityId: chatgptEntity }), ["chatgpt-ga"]);
    expectMembers(await scopedPacket({ at: "2026-07-21T00:00:00Z", entityId: randomUUID() }), []);
  }, FIXTURE_TIMEOUT_MS);

  it("T08 returns old belief at K0 and corrected belief at K1 while preserving adjacent worlds and original citations", async () => {
    const original = claim("api-ga"), correction = claim("api-correction");
    const k0 = claim("chatgpt-ga").knowledgeSeq;
    expect(correction.knowledgeSeq).toBeGreaterThan(k0);
    const oldPacket = await scopedPacket({ at: "2026-06-11T00:00:00Z", entityId: original.entityId, knowledgeSeq: k0 });
    expectMembers(oldPacket, ["api-ga"]);
    expectMembers(await scopedPacket({ at: "2026-06-11T00:00:00Z", entityId: original.entityId, knowledgeSeq: correction.knowledgeSeq }), ["api-correction"]);
    expectMembers(await scopedPacket({ at: "2026-06-09T23:59:59.999999Z", entityId: original.entityId }), ["api-preview"]);
    expectMembers(await scopedPacket({ at: "2026-06-11T23:59:59.999999Z", entityId: original.entityId }), ["api-correction"]);
    expectMembers(await scopedPacket({ at: "2026-06-12T02:00:00+02:00", entityId: original.entityId }), ["api-ga"]);
    const replayed = await api.inject({ method: "GET", url: `/v1/evidence-packets/${oldPacket.id}/citations`,
      headers: { authorization: `Bearer ${TOKEN_A}`, "x-tenant-id": fixture.tenantId, "x-correlation-id": `correction-replay-${oldPacket.id}` } });
    expect(replayed.statusCode, replayed.body).toBe(200);
    const replay = RetrievalCitationReplaySchema.parse(replayed.json());
    expect(replay.failures).toEqual([]);
    expect(replay.citations.map(citation => citation.selectedText)).toEqual([original.statement]);
  }, FIXTURE_TIMEOUT_MS);

  it("R03 exposes admitted challenge and canonical correction lineage only when known", async () => {
    const original = claim("api-ga"), correction = claim("api-correction"), challenge = claim("api-challenge");
    const corrected = await scopedPacket({ at: "2026-06-11T00:00:00Z", entityId: original.entityId });
    expectMembers(corrected, ["api-correction"]);
    expect(corrected.members[0]!.supersedesIds).toEqual([original.claimId]);
    expect(corrected.members[0]!.contradictionIds).toEqual([]);
    const beforeChallenge = await scopedPacket({ at: "2026-06-15T00:00:00Z", entityId: original.entityId, knowledgeSeq: correction.knowledgeSeq });
    expectMembers(beforeChallenge, ["api-ga"]);
    expect(beforeChallenge.members[0]!.contradictionIds).toEqual([]);
    const disputed = await scopedPacket({ at: "2026-06-15T00:00:00Z", entityId: original.entityId, knowledgeSeq: challenge.knowledgeSeq });
    expectMembers(disputed, ["api-ga", "api-challenge"]);
    for (const member of disputed.members) {
      const own = member.support!.target.canonicalId;
      expect(member.contradictionIds).toEqual([own === original.claimId ? challenge.claimId : original.claimId]);
    }
    const old = await scopedPacket({ at: "2026-06-11T00:00:00Z", entityId: original.entityId, knowledgeSeq: original.knowledgeSeq });
    expectMembers(old, ["api-ga"]);
    expect(old.members[0]!.contradictionIds).toEqual([]);
    expect(old.members[0]!.supersedesIds).toEqual([]);
  }, FIXTURE_TIMEOUT_MS);
});

describe.skipIf(!databaseUrl || !storage)("R02 canonical source-family diversity", () => {
  let fixture: SelectedCandidateFixture;
  let api: ReturnType<typeof buildServer>;
  let cappedPolicy: string, uncappedPolicy: string;
  const actor: LocalApiIdentity["actor"] = { kind: "service", id: randomUUID(), serviceIdentity: "mission_control_client" };
  beforeAll(async () => {
    fixture = await buildRetrievalHistoryFixture({ databaseUrl: databaseUrl!, storage: storage!, derivedSummaryStatements: [
      "On 2026-01-15, Synthetic Model X API was announced.",
      "The announcement date of Synthetic Model X API is 2026-01-15.",
      "An announcement for Synthetic Model X API occurred on 2026-01-15.",
      "Synthetic Model X API has an announcement dated 2026-01-15.",
      "2026-01-15 is the date Synthetic Model X API was announced.",
    ],
      temporalEvents: retrievalHistoryEvents.map((event, index) => index === 1 ? { ...event, sourceFamily: "independent-analyst" } : event) });
    uncappedPolicy = await admitRetrievalPolicy(fixture, 20);
    cappedPolicy = await admitRetrievalPolicy(fixture, 1);
    api = createRetrievalApi({ fixture, actor, tenantB: randomUUID() });
  }, TEMPORAL_CORPUS_TIMEOUT_MS);
  afterAll(async () => { await api?.close(); await fixture?.close(); });

  it("keeps independent captured evidence when raw material and five reviewed summaries share one source", async () => {
    async function retrieve(policy: string, finalK: number) {
      const plan = retrievalPlan(policy, "Synthetic Model X API");
      plan.finalK = finalK;
      const posted = await postRetrieval({ api, tenantId: fixture.tenantId, token: TOKEN_A, actor, plan });
      expect(posted.response.statusCode, posted.response.body).toBe(202);
      return readAuthorizedPacket({ api, tenantId: fixture.tenantId, token: TOKEN_A, operationId: posted.operationId });
    }
    const all = await retrieve(uncappedPolicy, 20);
    expect(all.members).toHaveLength(7);
    expect(all.members.filter(member => member.support!.target.kind === "summary")).toHaveLength(5);
    const groups = new Map<string, number>();
    for (const member of all.members) {
      expect(member.support!.sourceFamilyIds).toHaveLength(1);
      const family = member.support!.sourceFamilyIds[0]!;
      expect(new Set(member.support!.paths.map(path => path.sourceFamilyId))).toEqual(new Set([family]));
      groups.set(family, (groups.get(family) ?? 0) + 1);
    }
    expect([...groups.values()].sort()).toEqual([1, 6]);
    const diverse = await retrieve(cappedPolicy, 2);
    expect(diverse.members).toHaveLength(2);
    expect(new Set(diverse.members.flatMap(member => member.support!.sourceFamilyIds))).toEqual(new Set(groups.keys()));
    const independent = fixture.temporalClaims.find(claim => claim.key === "ga")!;
    expect(diverse.members.some(member => member.support!.target.canonicalId === independent.claimId)).toBe(true);
    expect(fixture.candidate.publishable).toBe(false);
  }, FIXTURE_TIMEOUT_MS);
});
