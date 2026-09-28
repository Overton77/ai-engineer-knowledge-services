// API/MCP parity rows for every former MCP HTTP shim. Each row wires the same fake
// services into the API route (ServerOptions) and the in-process MCP app, so both
// transports run the same application use case over identical fixtures.
import { vi } from "vitest";
import {
  actorsMatch,
  createKnowledgeResourceReads,
  createVerificationResourceReads,
  KnowledgeIntegrationService,
  VerificationOperationApplicationService,
  type VerificationContextResolutionInput,
  type VerificationResourceReadServices,
} from "@aiengineer/knowledge-application";
import type { Actor, OperationContext } from "@aiengineer/knowledge-contracts";
import type { ServerOptions } from "../../../api/src/server.js";
import type { KnowledgeMcpAppOptions } from "../index.js";

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const digest = (value: string) => `sha256:${value.repeat(64)}`;
export const tenant = id(1);
export const foreignTenant = id(99);
/** The bearer that owns every fixture resource; a reviewer so decision recording is eligible. */
export const owner: Actor = { kind: "service", id: id(2), serviceIdentity: "human_reviewer" };
export const stranger: Actor = { kind: "service", id: id(3), serviceIdentity: "mission_control_client" };
const grants = [{ tenantId: tenant, roles: ["knowledge_operator" as const, "knowledge_reader" as const], scopes: [] }];
export const tokens = { owner: "parity-owner-token-long-enough", stranger: "parity-stranger-token-long-enough" };
export const resolveIdentity = (token: string) =>
  token === tokens.owner ? { actor: owner, grants } : token === tokens.stranger ? { actor: stranger, grants } : undefined;
export const KNOWN = id(50);
export const UNKNOWN = id(51);
export const ORIGIN = "https://knowledge.example";
export const CORRELATION = "api-mcp-parity";
export const IDEMPOTENCY = "api-mcp-parity-001";

export const operationContext = (tenantId: string, actor: Actor): OperationContext => ({
  tenantId,
  operationId: id(40),
  attemptId: id(41),
  correlationId: CORRELATION,
  actor,
  capabilityVersion: "mcp/1",
  idempotencyKey: IDEMPOTENCY,
  reason: "API/MCP parity",
  contractVersion: "v1",
});

const missing = () => Object.assign(new Error("private missing detail"), { code: "NOT_FOUND" });
/** A read service that only returns the fixture for the owner, in the tenant, for the known id. */
const ownedRead = (fixture: (input: { tenantId: string; operationId: string }) => unknown) =>
  vi.fn(async (input: { tenantId: string; operationId: string; actor: Actor }) => {
    if (input.tenantId !== tenant || input.operationId !== KNOWN || !actorsMatch(owner, input.actor)) throw missing();
    return fixture(input);
  });
const tenantRead = <K extends string>(key: K, fixture: () => unknown) =>
  vi.fn(async (input: { tenantId: string } & Record<K, string>) => {
    if (input.tenantId !== tenant || input[key] !== KNOWN) throw missing();
    return fixture();
  });

// Schema-valid fixtures, taken from the API route tests.
const verificationArtifact = (n: number) => ({ artifactId: id(n), digest: digest("a"), mediaType: "application/json", sizeBytes: 1 });
const fixtures = {
  retrievalRun: {
    id: KNOWN, tenantId: tenant,
    plan: { id: id(21), queryIntent: "durable retrieval", decomposition: [], spaces: ["engineering_claims"], filters: {}, policyVersion: 1, validated: true, createdAt: "2026-09-04T00:00:00.000Z" },
    stageTimings: { lexicalMs: 1 }, fusionParameters: { rrfK: 60 }, executedAt: "2026-09-04T00:00:02.000Z", evidencePacketIds: [id(22)],
  },
  retrievalExplanation: {
    retrievalRunId: KNOWN, stageTimings: { lexicalMs: 1 }, fusionParameters: { rrfK: 60 },
    candidates: [{ id: id(23), stageScores: { lexical: 0.8 }, rank: 1, finalScore: 0.75, sources: [{ channel: "lexical", sourceRank: 1, score: 0.8, explanation: { match: "exact" } }] }],
    truncated: false,
  },
  evaluationFailures: { evaluationRunId: KNOWN, failures: [{ caseId: id(24), metrics: { recall: 0 }, falseAcceptance: false, falseRejection: true }], truncated: false },
  vectorStoreOperation: { operationId: KNOWN, state: "succeeded" },
  evidencePacket: {
    id: KNOWN, tenantId: tenant, digest: digest("a"), schemaVersion: "v1", createdAt: "2026-09-03T00:00:00.000Z", retrievalRunId: id(25),
    normalizedQuery: "durable agent state",
    plan: {
      policyVersion: id(26), query: "durable agent state", intents: ["knowledge_evidence"],
      subqueries: [{ id: "durable-state", text: "durable agent state", coverageRole: "required" }],
      spaces: ["engineering_claims"], anchors: { entities: [], concepts: [], useCases: [] }, hardFilters: [], softBoosts: [],
      temporalScope: {}, candidateK: 10, finalK: 5, graph: { maxDepth: 0, allowedEdges: [] }, abstention: { minimumCoverage: 1 },
    },
    authorization: { decisionId: id(27), tenantId: tenant, actorId: owner.id, action: "read", resource: `evidence_packet:${KNOWN}`, allowed: true, policyVersion: id(26), reasonCodes: ["tenant_match"] },
    procedureVersionIds: [], members: [], omittedResults: [], coverage: [{ subqueryId: "durable-state", coverage: 0 }],
    abstention: { recommended: true, reason: "fixture has no members" }, eventIds: [], artifactIds: [], receiptIds: [],
  },
  citationReplay: {
    schemaVersion: "knowledge.retrieval-citation-replay/v1", evidencePacketId: KNOWN, retrievalRunId: id(25),
    packetDigest: digest("a"), citations: [], failures: [], replayedAt: "2026-09-16T00:00:00.000Z",
  },
  structuredExtraction: {
    verificationContractVersion: "verification.v1", tenantId: tenant, operationId: KNOWN, requestDigest: digest("a"),
    publication: { artifact: { artifactId: id(28), digest: digest("a") }, signatureStatus: "verified", purpose: "artifact_custody_only" },
    output: { status: "failed", code: "PROVIDER_HTTP_FAILURE", category: "provider_http", automaticRetry: false, candidateArtifact: null,
      executionArtifact: { artifactId: id(29), digest: digest("a") }, manifestDigest: digest("a"), providerCallDigest: digest("a") },
  },
  auditInspection: {
    verificationContractVersion: "verification.v1", tenantId: tenant, operationId: KNOWN, requestDigest: digest("b"),
    resultArtifact: { artifactId: id(30), digest: digest("c") },
    output: {
      schemaVersion: "verification-audit-inspection.v1", verificationContractVersion: "verification.v1",
      auditArtifact: { artifactId: id(31), digest: digest("c"), mediaType: "application/vnd.aiengineer.verification-run-manifest+json", sizeBytes: 10 },
      run: { runId: id(32), manifestId: id(33), manifestDigest: digest("d"), deterministicResultDigest: digest("e"), policyDecisionDigest: digest("f"),
        policyOutcome: "review", startedAt: "2026-09-07T00:00:00.000Z", completedAt: "2026-09-07T00:00:00.000Z" },
      proof: { payloadDigest: digest("1"), signatureStatus: "verified", deterministicReplay: "exact", policyReplay: "exact",
        replayedArtifactCount: 2, inputArtifactCount: 1, outputArtifactCount: 2 },
    },
  },
  claims: {
    verificationContractVersion: "verification.v1", tenantId: tenant, operationId: KNOWN, useCase: "verifyClaims", requestDigest: digest("a"),
    resultArtifact: { artifactId: id(34), digest: digest("b") },
    sealedRun: { runId: id(35), manifestDigest: digest("c"), manifestArtifact: { artifactId: id(36), digest: digest("d") }, policyOutcome: "review", policy: { availability: "unavailable" } },
    output: {
      mode: "deterministic_only",
      deterministic: { status: "review_required", semanticEligibility: false, capturesTotal: 1, capturesPassed: 1, assertionsTotal: 1, assertionsPassed: 1,
        metricsTotal: 0, metricsPassed: 0, failedCheckCodes: [], reviewReasons: ["POLICY_REVIEW"] },
      assertionsArtifact: { artifactId: id(37), digest: digest("e") },
    },
  },
  adjudicationSubject: {
    verificationContractVersion: "verification.v1", tenantId: tenant, operationId: KNOWN, requestDigest: digest("a"),
    packetArtifact: { artifactId: id(38), digest: digest("b") },
    output: {
      subjectId: id(39), status: "pending_human_adjudication", target: { kind: "run", runId: id(42), objectDigest: digest("c") }, reason: "appeal",
      reviewRequirements: { eligibleReviewerRoles: ["expert"], quorumRequired: 1 }, originalPolicyOutcome: "review",
      source: { runKind: "claims", runId: id(42), manifestArtifact: { artifactId: id(43), digest: digest("d") }, manifestDigest: digest("e"),
        bundleArtifact: { artifactId: id(44), digest: digest("f") }, deterministicResultArtifact: { artifactId: id(45), digest: digest("1") },
        policyDecisionArtifact: { artifactId: id(46), digest: digest("2") } },
      proof: { payloadDigest: digest("3"), signatureStatus: "verified", deterministicReplay: "exact", policyReplay: "exact", terminalFencingToken: 1 },
      humanDecisionRecorded: false, admissionChanged: false,
    },
  },
  adjudicationDecision: {
    verificationContractVersion: "verification.v1", tenantId: tenant, operationId: KNOWN, requestDigest: digest("a"), terminalFencingToken: 2,
    output: {
      schemaVersion: "verification-adjudication-decision-result.v1", subjectId: id(47), packetArtifact: { artifactId: id(48), digest: digest("b") },
      decisionArtifact: { artifactId: id(49), digest: digest("c") }, decision: "affirm", reviewerProvenance: "synthetic_engineering",
      quorum: { required: 2, humanAffirmRecorded: 0, humanRejectRecorded: 0, humanDeferRecorded: 0, syntheticAffirmRecorded: 1, reached: false },
      admissionChanged: false, humanGoldScoringEligible: false,
    },
  },
  reconciliation: {
    tenantId: tenant, operationId: KNOWN, providerAttemptId: id(52), artifact: { artifactId: id(53), digest: digest("a") },
    actualCostMicros: 10, releasedReservationCostMicros: 20, appliedAt: "2026-09-10T00:00:00.000Z", redispatchAuthorized: false,
  },
  benchmarkRun: {
    verificationContractVersion: "verification.v1", tenantId: tenant, runId: KNOWN, operationId: id(54),
    publication: { artifact: verificationArtifact(55), payloadDigest: digest("b"), signatureStatus: "verified" },
    dataset: { artifact: verificationArtifact(56), datasetId: id(57), datasetVersionId: id(58), version: 1, caseCount: 2, manifestDigest: digest("c"), labelProvenance: "engineering_expectations" },
    experiment: { artifact: verificationArtifact(59), experimentId: id(60), runnerVersion: "verification-benchmark-runner.v1", randomSeed: 7, repetitions: 1 },
    lifecycle: { startedAt: "2026-09-10T00:00:00.000Z", completedAt: "2026-09-10T00:01:00.000Z" },
    qualityClaims: { humanGoldValidated: false, sourceAuthorityAssessed: false, calibrated: false },
    arms: [
      { armId: "control", experimentArmId: id(61), evalRunId: id(62), isControl: true, terminalStatus: "succeeded", summaryDigest: digest("d") },
      { armId: "candidate", experimentArmId: id(63), evalRunId: id(64), isControl: false, terminalStatus: "succeeded", summaryDigest: digest("e") },
    ],
  },
  run: {
    verificationContractVersion: "verification.v1", tenantId: tenant, runId: KNOWN, manifestId: id(65), manifestDigest: digest("a"), resultDigest: digest("b"),
    lifecycle: { policyOutcome: "review", networkPolicy: "disabled", startedAt: "2026-09-10T00:00:00.000Z", completedAt: "2026-09-10T00:01:00.000Z" },
    policyBinding: { policyVersion: "policy.v1", policyArtifact: verificationArtifact(66), recordedPolicyInputsArtifact: verificationArtifact(67) },
    artifacts: { inputCount: 1, outputCount: 1 },
    calls: { count: 0, reservedCostMicros: 0, estimatedCostMicros: 0, actualCostMicros: 0, actualCount: 0, estimatedCount: 0, reservedCount: 0, unknownDispatchedCount: 0 },
  },
  runCases: { verificationContractVersion: "verification.v1", tenantId: tenant, runId: KNOWN, cases: [] },
  case: {
    verificationContractVersion: "verification.v1", tenantId: tenant, runId: id(68), caseRunId: KNOWN, caseKey: "case",
    inputArtifact: verificationArtifact(69), resultArtifact: verificationArtifact(70), createdAt: "2026-09-08T00:00:00.000Z", evidence: [],
  },
  evidence: {
    verificationContractVersion: "verification.v1", tenantId: tenant, runId: id(68), caseRunId: id(71), evidenceId: KNOWN, evidenceKey: "evidence",
    kind: "artifact", ordinal: 0, artifact: verificationArtifact(72), createdAt: "2026-09-08T00:00:00.000Z",
  },
};
const benchmarkManifest = {
  ...fixtures.benchmarkRun,
  runtime: { deploymentId: "parity-deployment", attemptId: id(73), capabilityVersion: "verification-service.v1", targetCodeRef: "main", gitSha: "abc123", dirty: false },
  execution: { mode: "offline_recorded", externalProviderRequests: 0 },
  runnerManifestDigest: digest("f"), checkpointPlanDigest: digest("1"),
  arms: fixtures.benchmarkRun.arms.map((arm, index) => ({ ...arm, configurationArtifact: verificationArtifact(74 + index), policyArtifact: verificationArtifact(76 + index) })),
};
const runManifest = {
  ...fixtures.run,
  versions: { policy: "policy.v1", schema: "schema.v1", normalizer: "normalizer.v1" },
  code: { gitSha: "abc123", dirty: false },
  runtime: { platform: "node", deploymentId: "parity-deployment" },
  inputArtifacts: [verificationArtifact(78)],
  outputArtifacts: [verificationArtifact(79)],
  stages: [],
  toolPolicy: [],
  canonicalization: { algorithm: "RFC8785", implementationVersion: "canonicalize.v1", manifestDigest: digest("a") },
};

/** Knowledge services shared by one row's two transports. */
function knowledgeServices() {
  const operationGet = vi.fn(async (operationId: string, tenantId?: string) =>
    tenantId === tenant && operationId === KNOWN ? fixtures.vectorStoreOperation : undefined);
  const resources = {
    getVectorStoreResource: vi.fn(async () => undefined),
    getArtifactResource: vi.fn(async () => undefined),
    getReceiptResource: vi.fn(async () => undefined),
    getRetrievalRunResource: vi.fn(async (t: string, runId: string) => (t === tenant && runId === KNOWN ? fixtures.retrievalRun : undefined)),
    getRetrievalExplanationResource: vi.fn(async (t: string, runId: string) => (t === tenant && runId === KNOWN ? fixtures.retrievalExplanation : undefined)),
    getEvaluationReportResource: vi.fn(async () => undefined),
    getEvaluationFailuresResource: vi.fn(async (t: string, runId: string) => (t === tenant && runId === KNOWN ? fixtures.evaluationFailures : undefined)),
    operationBelongsToVectorStore: vi.fn(async (t: string, storeId: string, operationId: string) => t === tenant && storeId === id(80) && operationId === KNOWN),
  };
  const getEvidencePacket = vi.fn(async (t: string, packetId: string) => (t === tenant && packetId === KNOWN ? fixtures.evidencePacket : undefined));
  const replayEvidencePacketCitations = vi.fn(async (t: string, packetId: string) => {
    if (t !== tenant || packetId !== KNOWN) throw new Error("EVIDENCE_PACKET_NOT_FOUND");
    return fixtures.citationReplay;
  });
  return { operationGet, resources, getEvidencePacket, replayEvidencePacketCitations };
}

function knowledgeTransports(services: ReturnType<typeof knowledgeServices>, configured: boolean) {
  const operations = Object.assign(new KnowledgeIntegrationService(), { get: services.operationGet }) as never;
  const custody = configured
    ? { getEvidencePacket: services.getEvidencePacket as never, replayEvidencePacketCitations: services.replayEvidencePacketCitations as never }
    : {};
  return {
    api: { operationService: operations, ...(configured ? { resourceReader: services.resources as never } : {}), ...custody } satisfies ServerOptions,
    mcp: {
      operationService: operations,
      knowledge: {
        reads: createKnowledgeResourceReads({ operations, ...(configured ? { resources: services.resources as never } : {}), ...custody }),
      },
    } satisfies Partial<KnowledgeMcpAppOptions>,
  };
}

function verificationTransports(services: VerificationResourceReadServices, configured: boolean) {
  const used = configured ? services : {};
  return {
    api: {
      ...(used.structuredExtractionReads ? { verificationStructuredExtractionReads: used.structuredExtractionReads as never } : {}),
      ...(used.auditInspectionReads ? { verificationAuditInspectionReads: used.auditInspectionReads as never } : {}),
      ...(used.adjudicationReads ? { verificationAdjudicationReadService: used.adjudicationReads as never } : {}),
      ...(used.adjudicationDecisionReads ? { verificationAdjudicationDecisionReadService: used.adjudicationDecisionReads as never } : {}),
      ...(used.isAdjudicationDecisionReadAdmitted ? { isAdjudicationDecisionReadAdmitted: used.isAdjudicationDecisionReadAdmitted } : {}),
      ...(used.claimsReportReads ? { verificationClaimsReportReads: used.claimsReportReads as never } : {}),
      ...(used.benchmarkComparisonReads ? { verificationBenchmarkComparisonReads: used.benchmarkComparisonReads as never } : {}),
      ...(used.benchmarkReads ? { verificationBenchmarkReads: used.benchmarkReads as never } : {}),
      ...(used.runReads ? { verificationReads: used.runReads as never } : {}),
      ...(used.caseReads ? { verificationCaseReads: used.caseReads as never } : {}),
      ...(used.providerReconciliation ? { verificationProviderReconciliation: used.providerReconciliation } : {}),
    } satisfies ServerOptions,
    mcp: { verificationReads: createVerificationResourceReads(used) } satisfies Partial<KnowledgeMcpAppOptions>,
  };
}

export interface Transports {
  readonly api: ServerOptions;
  readonly mcp: Partial<KnowledgeMcpAppOptions>;
}

/**
 * How a bearer or caller-asserted actor other than the owner is treated:
 * `owned` reads answer NOT_FOUND on both transports; `tenant` reads are scoped by tenant
 * only (same success on both); `asserted` tools carry a caller actor that MCP rejects with
 * ACTOR_MISMATCH while the API rejects a mismatched envelope (POST) or has no asserted actor (GET).
 */
export type ActorCase = "owned" | "tenant" | "asserted-post" | "asserted-get";

export interface ParityRow {
  readonly tool: string;
  readonly kind?: string;
  readonly http: (resourceId: string, context: OperationContext) => { method: "GET" | "POST"; url: string; payload?: unknown };
  readonly args: (resourceId: string, context: OperationContext) => Record<string, unknown>;
  readonly transports: (configured: boolean) => Transports;
  /** Expected success body; absent where no schema-valid fixture is constructed. */
  readonly success?: unknown;
  readonly actorCase: ActorCase;
  /** API reply when the capability is not composed (MCP always answers CAPABILITY_NOT_ADMITTED). */
  readonly unavailable: { readonly status: number; readonly code: string };
  readonly notFound: boolean;
}

const readContext = (context: OperationContext) => ({ tenantId: context.tenantId, correlationId: context.correlationId });
const catalogArgs = (input: (resourceId: string) => Record<string, unknown>) =>
  (resourceId: string, context: OperationContext) => ({ context, input: input(resourceId), expectedVersions: { api: "v1" } });

const knowledgeRow = (row: Omit<ParityRow, "transports" | "actorCase"> & { actorCase?: ActorCase }): ParityRow => ({
  actorCase: "asserted-get",
  ...row,
  transports: (configured) => knowledgeTransports(knowledgeServices(), configured),
});
const verificationRow = (
  row: Omit<ParityRow, "transports" | "unavailable" | "notFound"> & { services: () => VerificationResourceReadServices },
): ParityRow => ({
  ...row,
  unavailable: { status: 503, code: "CAPABILITY_NOT_ADMITTED" },
  notFound: true,
  transports: (configured) => verificationTransports(row.services(), configured),
});

export const readRows: readonly ParityRow[] = [
  knowledgeRow({
    tool: "retrieval.read_run", kind: "retrieval_run",
    http: (runId) => ({ method: "GET", url: `/v1/retrieval-runs/${runId}` }),
    args: catalogArgs((runId) => ({ runId })),
    success: fixtures.retrievalRun, unavailable: { status: 503, code: "INTERNAL_ERROR" }, notFound: true,
  }),
  knowledgeRow({
    tool: "retrieval.explain_run", kind: "retrieval_run",
    http: (runId) => ({ method: "GET", url: `/v1/retrieval-runs/${runId}/explanation` }),
    args: catalogArgs((runId) => ({ runId })),
    success: fixtures.retrievalExplanation, unavailable: { status: 503, code: "INTERNAL_ERROR" }, notFound: true,
  }),
  knowledgeRow({
    tool: "evaluation.inspect_failures", kind: "evaluation_run",
    http: (runId) => ({ method: "GET", url: `/v1/eval-runs/${runId}/failures` }),
    args: catalogArgs((runId) => ({ runId })),
    success: fixtures.evaluationFailures, unavailable: { status: 503, code: "INTERNAL_ERROR" }, notFound: true,
  }),
  knowledgeRow({
    tool: "vector_store.ingestion_status", kind: "vector_store_ingestion",
    http: (operationId) => ({ method: "GET", url: `/v1/vector-stores/${id(80)}/operations/${operationId}` }),
    args: catalogArgs((operationId) => ({ vectorStoreId: id(80), operationId })),
    success: fixtures.vectorStoreOperation, unavailable: { status: 503, code: "INTERNAL_ERROR" }, notFound: true,
  }),
  knowledgeRow({
    tool: "retrieval.read_evidence_packet", kind: "evidence_packet",
    http: (packetId) => ({ method: "GET", url: `/v1/evidence-packets/${packetId}` }),
    args: catalogArgs((packetId) => ({ packetId })),
    // Absent packet custody is indistinguishable from absence on both transports.
    success: fixtures.evidencePacket, unavailable: { status: 404, code: "NOT_FOUND" }, notFound: true,
  }),
  knowledgeRow({
    tool: "retrieval.replay_citations", kind: "evidence_packet",
    http: (packetId) => ({ method: "GET", url: `/v1/evidence-packets/${packetId}/citations` }),
    args: catalogArgs((packetId) => ({ packetId })),
    success: fixtures.citationReplay, unavailable: { status: 503, code: "INTERNAL_ERROR" }, notFound: true,
  }),
  verificationRow({
    tool: "knowledge_get_structured_extraction", actorCase: "owned",
    services: () => ({ structuredExtractionReads: { getExtraction: ownedRead(() => fixtures.structuredExtraction) } }),
    http: (operationId) => ({ method: "GET", url: `/v1/verification/extractions/${operationId}` }),
    args: (operationId, context) => ({ context: readContext(context), operationId }),
    success: fixtures.structuredExtraction,
  }),
  verificationRow({
    tool: "knowledge_get_audit_inspection", actorCase: "owned",
    services: () => ({ auditInspectionReads: { getInspection: ownedRead(() => fixtures.auditInspection) } }),
    http: (operationId) => ({ method: "GET", url: `/v1/verification/audit-inspections/${operationId}` }),
    args: (operationId, context) => ({ context: readContext(context), operationId }),
    success: fixtures.auditInspection,
  }),
  verificationRow({
    tool: "knowledge_get_verification_claims_result", actorCase: "owned",
    services: () => ({ claimsReportReads: { getClaims: ownedRead(() => fixtures.claims), getReport: ownedRead(() => fixtures.claims) } }),
    http: (operationId) => ({ method: "GET", url: `/v1/verification/claims/${operationId}` }),
    args: (operationId, context) => ({ context: readContext(context), operationId }),
    success: fixtures.claims,
  }),
  verificationRow({
    tool: "knowledge_get_verification_report_result", actorCase: "owned",
    // A claims terminal is not a report: both transports fail it closed as integrity.
    services: () => ({ claimsReportReads: { getClaims: ownedRead(() => fixtures.claims), getReport: ownedRead(() => fixtures.claims) } }),
    http: (operationId) => ({ method: "GET", url: `/v1/verification/reports/${operationId}` }),
    args: (operationId, context) => ({ context: readContext(context), operationId }),
  }),
  verificationRow({
    tool: "knowledge_get_adjudication", actorCase: "owned",
    services: () => ({ adjudicationReads: { getPendingSubject: ownedRead(() => fixtures.adjudicationSubject) } }),
    http: (operationId) => ({ method: "GET", url: `/v1/verification/adjudications/${operationId}` }),
    args: (operationId, context) => ({ context: readContext(context), operationId }),
    success: fixtures.adjudicationSubject,
  }),
  verificationRow({
    tool: "knowledge_get_adjudication_decision", actorCase: "owned",
    services: () => ({
      adjudicationDecisionReads: { getDecision: ownedRead(() => fixtures.adjudicationDecision) },
      isAdjudicationDecisionReadAdmitted: async (input) => input.tenantId === tenant && actorsMatch(owner, input.actor),
    }),
    http: (operationId) => ({ method: "GET", url: `/v1/verification/adjudication-decisions/${operationId}` }),
    args: (operationId, context) => ({ context: readContext(context), operationId }),
    success: fixtures.adjudicationDecision,
  }),
  verificationRow({
    tool: "knowledge_get_provider_reconciliation", actorCase: "owned",
    services: () => ({
      providerReconciliation: {
        getDecision: ownedRead(() => fixtures.reconciliation),
        applyDecision: ownedRead(() => fixtures.reconciliation),
      },
    }),
    http: (operationId) => ({ method: "GET", url: `/v1/verification/extractions/${operationId}/provider-attempts/${id(52)}/reconciliation` }),
    args: (operationId, context) => ({ context: readContext(context), operationId, providerAttemptId: id(52) }),
    success: fixtures.reconciliation,
  }),
  verificationRow({
    tool: "knowledge_apply_provider_reconciliation", actorCase: "owned",
    services: () => ({
      providerReconciliation: {
        getDecision: ownedRead(() => fixtures.reconciliation),
        applyDecision: ownedRead(() => fixtures.reconciliation),
      },
    }),
    http: (operationId) => ({
      method: "POST",
      url: `/v1/verification/extractions/${operationId}/provider-attempts/${id(52)}/reconciliation`,
      payload: { artifact: reconciliationArtifact },
    }),
    args: (operationId, context) => ({ context: readContext(context), operationId, providerAttemptId: id(52), artifact: reconciliationArtifact }),
    success: fixtures.reconciliation,
  }),
  verificationRow({
    tool: "knowledge_get_benchmark_comparison", actorCase: "tenant",
    services: () => ({ benchmarkComparisonReads: { getComparison: tenantRead("comparisonId", () => ({ comparisonId: KNOWN })) } }),
    http: (comparisonId) => ({ method: "GET", url: `/v1/verification/benchmarks/comparisons/${comparisonId}` }),
    args: (comparisonId, context) => ({ context: readContext(context), comparisonId }),
  }),
  verificationRow({
    tool: "knowledge_get_benchmark_run", actorCase: "tenant",
    services: () => ({ benchmarkReads: { getRun: tenantRead("runId", () => fixtures.benchmarkRun), getManifest: tenantRead("runId", () => benchmarkManifest) } }),
    http: (runId) => ({ method: "GET", url: `/v1/verification/benchmarks/${runId}` }),
    args: (runId, context) => ({ context: readContext(context), runId }),
    success: fixtures.benchmarkRun,
  }),
  verificationRow({
    tool: "knowledge_get_benchmark_manifest", actorCase: "tenant",
    services: () => ({ benchmarkReads: { getRun: tenantRead("runId", () => fixtures.benchmarkRun), getManifest: tenantRead("runId", () => benchmarkManifest) } }),
    http: (runId) => ({ method: "GET", url: `/v1/verification/benchmarks/${runId}/manifest` }),
    args: (runId, context) => ({ context: readContext(context), runId }),
    success: benchmarkManifest,
  }),
  verificationRow({
    tool: "knowledge_get_verification_run", actorCase: "tenant",
    services: () => ({ runReads: { getRun: tenantRead("runId", () => fixtures.run), getRunManifest: tenantRead("runId", () => runManifest) } }),
    http: (runId) => ({ method: "GET", url: `/v1/verification/runs/${runId}` }),
    args: (runId, context) => ({ context: readContext(context), runId }),
    success: fixtures.run,
  }),
  verificationRow({
    tool: "knowledge_get_verification_manifest", actorCase: "tenant",
    services: () => ({ runReads: { getRun: tenantRead("runId", () => fixtures.run), getRunManifest: tenantRead("runId", () => runManifest) } }),
    http: (runId) => ({ method: "GET", url: `/v1/verification/runs/${runId}/manifest` }),
    args: (runId, context) => ({ context: readContext(context), runId }),
    success: runManifest,
  }),
  ...(["list", "case", "evidence"] as const).map((kind) => verificationRow({
    tool: kind === "list" ? "knowledge_list_verification_cases" : kind === "case" ? "knowledge_get_verification_case" : "knowledge_get_verification_evidence",
    actorCase: "tenant",
    services: () => ({
      caseReads: {
        listRunCases: tenantRead("runId", () => fixtures.runCases),
        getCase: tenantRead("caseRunId", () => fixtures.case),
        getEvidence: tenantRead("evidenceId", () => fixtures.evidence),
      },
    }),
    http: (resourceId) => ({
      method: "GET" as const,
      url: kind === "list" ? `/v1/verification/runs/${resourceId}/cases` : kind === "case" ? `/v1/verification/cases/${resourceId}` : `/v1/verification/evidence/${resourceId}`,
    }),
    args: (resourceId, context) => ({
      context: readContext(context),
      ...(kind === "list" ? { runId: resourceId } : kind === "case" ? { caseRunId: resourceId } : { evidenceId: resourceId }),
    }),
    success: kind === "list" ? fixtures.runCases : kind === "case" ? fixtures.case : fixtures.evidence,
  })),
];

const reconciliationArtifact = {
  artifactId: id(53), tenantId: tenant, digest: digest("a"), mediaType: "application/json", byteLength: 1, objectKey: "tenant/reconciliation",
  createdAt: "2026-09-10T00:00:00.000Z", producerActivityId: "operator", producerVersion: "v1", encryptionClass: "managed",
  retentionClass: "audit", dataClassification: "restricted", parentArtifactIds: [],
};

export const retrievalPlan = fixtures.evidencePacket.plan;

/** retrieval.search: synchronous admission and execution with a fake executor. */
export function retrievalSearchTransports(configured: boolean, execute = vi.fn(async () => undefined)) {
  const api = new KnowledgeIntegrationService(), mcp = new KnowledgeIntegrationService();
  const executor = { execute: execute as never };
  return {
    execute,
    api: { publicOrigin: ORIGIN, retrievalOperationService: api, ...(configured ? { canonicalRetrievalExecutor: executor } : {}) } satisfies ServerOptions,
    mcp: {
      operationService: mcp,
      apiOrigin: ORIGIN,
      knowledge: { reads: createKnowledgeResourceReads({}), retrievalOperations: mcp, ...(configured ? { retrievalExecutor: executor } : {}) },
    } satisfies Partial<KnowledgeMcpAppOptions>,
  };
}

/** Verification mutations: trusted ownership, shared admission and in-memory durable operations. */
export function mutationTransports(
  configured: boolean,
  owners: (actor: Actor) => boolean,
  decisions = true,
) {
  const resolveVerificationContext = (input: VerificationContextResolutionInput) =>
    owners(input.identity.actor)
      ? {
          tenantId: input.tenantId, correlationId: input.correlationId, idempotencyKey: input.idempotencyKey,
          operationId: id(90), attemptId: id(91), actor: input.identity.actor, capabilityVersion: "verification-service.v1",
          reason: "API/MCP parity", contractVersion: "v1" as const,
        }
      : undefined;
  const admission = {
    isParseArtifactRequestAdmitted: () => true,
    isStructuredExtractionRequestAdmitted: () => true,
    isBenchmarkRequestAdmitted: () => true,
    isBenchmarkComparisonRequestAdmitted: () => true,
    isAuditInspectionRequestAdmitted: () => true,
    isAdjudicationRequestAdmitted: () => true,
    isClaimsRequestAdmitted: () => true,
    ...(decisions ? { isAdjudicationDecisionAdmitted: async () => true } : {}),
  };
  const api = new KnowledgeIntegrationService(), mcp = new KnowledgeIntegrationService();
  return {
    api: {
      publicOrigin: ORIGIN,
      ...(configured ? { verificationOperationService: api, resolveVerificationContext: resolveVerificationContext as never, ...admission } : {}),
    } satisfies ServerOptions,
    mcp: {
      apiOrigin: ORIGIN,
      ...(configured
        ? {
            verificationOperations: new VerificationOperationApplicationService(mcp, ORIGIN),
            resolveVerificationContext,
            verificationAdmission: admission,
          }
        : {}),
    } satisfies Partial<KnowledgeMcpAppOptions>,
  };
}

export const claimsRequest = {
  verificationContractVersion: "verification.v1",
  captureIds: ["capture-1"],
  assertions: { artifactId: id(30), digest: digest("a") },
};
export const decisionRequest = {
  verificationContractVersion: "verification.v1",
  subjectId: id(3),
  packetArtifact: { artifactId: id(4), digest: digest("b") },
  decision: "affirm",
  rationale: "Synthetic engineering review record.",
};

/** Knowledge transports whose stored retrieval run no longer satisfies its public schema. */
export function integrityFailureTransports(): Transports {
  const services = knowledgeServices();
  services.resources.getRetrievalRunResource = vi.fn(async () => ({ id: KNOWN, tenantId: tenant }) as never);
  return knowledgeTransports(services, true);
}
