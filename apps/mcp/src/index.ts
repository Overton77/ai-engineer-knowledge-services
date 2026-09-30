import { ApplyProviderReconciliationRequestSchema } from "@aiengineer/knowledge-contracts";
import { ExtractStructuredDataRequestSchema } from "@aiengineer/knowledge-contracts";
import { ParseArtifactRequestSchema } from "@aiengineer/knowledge-contracts";
import { InspectAuditBundleRequestSchema } from "@aiengineer/knowledge-contracts";
import {
  RequestAdjudicationRequestSchema,
  VerificationAdjudicationDecisionRequestSchema,
} from "@aiengineer/knowledge-contracts";
import { CompareBenchmarkRunsRequestSchema, RunBenchmarkRequestSchema } from "@aiengineer/knowledge-contracts";
import { pathToFileURL } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  assertOperationKindAdmitted,
  bindResolvedVerificationContext,
  createKnowledgeResourceReads,
  isAdjudicationDecisionReviewerActor,
  createVerificationResourceReads,
  productionWorkerOperationKinds,
  submitCanonicalRetrievalRun,
  transportProblem,
  VerificationOperationApplicationService,
  type CanonicalRetrievalExecutorPort,
  type KnowledgeOperationPort,
  type KnowledgeResourceReads,
  type ResolveVerificationContext,
  type ResourceReadResult,
  type VerificationResourceReads,
} from "@aiengineer/knowledge-application";
import {
  actorsMatch,
  createHost,
  createLocalIdentityResolver,
  isAuthorized,
  verificationReadServices,
  requiredSubmissionAction,
  type LocalApiIdentity,
  type ResolveApiIdentity,
  type VerificationHostAdmission,
} from "@aiengineer/knowledge-host";
import {
  JsonValueSchema,
  CaptureSourceRequestSchema,
  VerifyExtractionRequestSchema,
  VerifyClaimsRequestSchema,
  VerifyReportRequestSchema,
  ReplayRunRequestSchema,
  VerifyMetricObservationRequestSchema,
  VerificationOperationContextHintsSchema,
  OperationContextSchema,
  MutationEnvelopeSchema,
  type JsonValue,
  type OperationContext,
  type OperationKind,
  RetrievalPlanSchema,
  UuidSchema,
  VectorStoreCreateInputSchema,
  VectorStoreDocumentsInputSchema,
} from "@aiengineer/knowledge-contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import { MCP_TOOL_CATALOG, VERIFICATION_MCP_TOOL_NAMES } from "./catalog.js";

const McpToolArgumentsSchema = z.object({
  context: OperationContextSchema,
  input: JsonValueSchema,
  expectedVersions: z.record(z.string(), z.string().min(1)),
});
type McpToolArguments = z.infer<typeof McpToolArgumentsSchema>;

const verificationToolUseCases = {
  knowledge_extract_structured_data: "extractStructuredData",
  knowledge_compare_benchmark_runs: "compareBenchmarkRuns",
  knowledge_run_benchmark: "runBenchmark",
  knowledge_verify_claims: "verifyClaims",
  knowledge_verify_report: "verifyReport",
  knowledge_verify_metric: "verifyMetricObservation",
  knowledge_capture_source: "captureSource",
  knowledge_parse_artifact: "parseArtifact",
  knowledge_verify_extraction: "verifyExtraction",
  knowledge_request_adjudication: "requestAdjudication",
  knowledge_record_adjudication_decision: "recordAdjudicationDecision",
  knowledge_inspect_audit_bundle: "inspectAuditBundle",
  knowledge_replay_run: "replayRun",
} as const;

export interface KnowledgeMcpServerOptions {
  readonly operationService: KnowledgeOperationPort;
  /** Public API origin used by accepted-operation links, never the MCP origin. */
  readonly apiOrigin: string;
  readonly identity: LocalApiIdentity;
  readonly verificationOperations?: VerificationOperationApplicationService;
  readonly resolveVerificationContext?: ResolveVerificationContext;
  readonly verificationAdmission?: VerificationHostAdmission;
  /** In-process knowledge reads and canonical retrieval; absent capabilities are not admitted. */
  readonly knowledge?: KnowledgeMcpServices;
  /** In-process verification reads, decisions reads and reconciliation; absent means not admitted. */
  readonly verificationReads?: VerificationResourceReads;
  readonly incomingRequest?: {
    readonly headers: Record<string, unknown>;
    readonly body: unknown;
  };
}

export interface KnowledgeMcpServices {
  readonly reads: KnowledgeResourceReads;
  /** Admits API-owned synchronous kinds; retrieval.search submits through it before executing. */
  readonly retrievalOperations?: Pick<KnowledgeOperationPort, "submit">;
  readonly retrievalExecutor?: CanonicalRetrievalExecutorPort;
}

const verificationContextSchema = z.strictObject({
  tenantId: z.uuid(),
  correlationId: z.string().trim().min(1).max(255),
  idempotencyKey: z.string().trim().min(8).max(255),
  ...VerificationOperationContextHintsSchema.shape,
});
const verificationToolSchemas = {
  knowledge_extract_structured_data: z.strictObject({
    context: verificationContextSchema,
    request: ExtractStructuredDataRequestSchema,
  }),
  knowledge_compare_benchmark_runs: z.strictObject({
    context: verificationContextSchema,
    request: CompareBenchmarkRunsRequestSchema,
  }),
  knowledge_run_benchmark: z.strictObject({
    context: verificationContextSchema,
    request: RunBenchmarkRequestSchema,
  }),
  knowledge_capture_source: z.strictObject({
    context: verificationContextSchema,
    request: CaptureSourceRequestSchema,
  }),
  knowledge_parse_artifact: z.strictObject({
    context: verificationContextSchema,
    request: ParseArtifactRequestSchema,
  }),
  knowledge_verify_metric: z.strictObject({
    context: verificationContextSchema,
    request: VerifyMetricObservationRequestSchema,
  }),
  knowledge_request_adjudication: z.strictObject({
    context: verificationContextSchema,
    request: RequestAdjudicationRequestSchema,
  }),
  knowledge_record_adjudication_decision: z.strictObject({
    context: verificationContextSchema,
    request: VerificationAdjudicationDecisionRequestSchema,
  }),
  knowledge_verify_extraction: z.strictObject({
    context: verificationContextSchema,
    request: VerifyExtractionRequestSchema,
  }),
  knowledge_verify_claims: z.strictObject({
    context: verificationContextSchema,
    request: VerifyClaimsRequestSchema,
  }),
  knowledge_verify_report: z.strictObject({
    context: verificationContextSchema,
    request: VerifyReportRequestSchema,
  }),
  knowledge_inspect_audit_bundle: z.strictObject({
    context: verificationContextSchema,
    request: InspectAuditBundleRequestSchema,
  }),
  knowledge_replay_run: z.strictObject({
    context: verificationContextSchema,
    request: ReplayRunRequestSchema,
  }),
} as const;

type VerificationMcpToolName = (typeof VERIFICATION_MCP_TOOL_NAMES)[number];
type VerificationAdmissionResult = "ok" | "CAPABILITY_NOT_ADMITTED" | "FORBIDDEN";
type VerificationAdmissionGate = (tenantId: string, request: never) => boolean | Promise<boolean>;

const VERIFICATION_MCP_ADMISSION_GATES: {
  readonly [Name in VerificationMcpToolName]?: (
    admission: VerificationHostAdmission,
  ) => VerificationAdmissionGate | undefined;
} = {
  knowledge_parse_artifact: (admission) => admission.isParseArtifactRequestAdmitted,
  knowledge_extract_structured_data: (admission) => admission.isStructuredExtractionRequestAdmitted,
  knowledge_run_benchmark: (admission) => admission.isBenchmarkRequestAdmitted,
  knowledge_compare_benchmark_runs: (admission) => admission.isBenchmarkComparisonRequestAdmitted,
  knowledge_verify_claims: (admission) => admission.isClaimsRequestAdmitted,
  knowledge_verify_report: (admission) => admission.isClaimsRequestAdmitted,
  knowledge_inspect_audit_bundle: (admission) => admission.isAuditInspectionRequestAdmitted,
  knowledge_request_adjudication: (admission) => admission.isAdjudicationRequestAdmitted,
};

const VERIFICATION_IN_PROCESS_SUBMIT: {
  readonly [Name in VerificationMcpToolName]: (
    operations: VerificationOperationApplicationService,
    request: unknown,
    context: OperationContext,
  ) => unknown;
} = {
  knowledge_extract_structured_data: (operations, request, context) =>
    operations.submitExtractStructuredData(request, context),
  knowledge_compare_benchmark_runs: (operations, request, context) =>
    operations.submitCompareBenchmarkRuns(request, context),
  knowledge_run_benchmark: (operations, request, context) => operations.submitRunBenchmark(request, context),
  knowledge_verify_claims: (operations, request, context) => operations.submitVerifyClaims(request, context),
  knowledge_verify_report: (operations, request, context) => operations.submitVerifyReport(request, context),
  knowledge_verify_metric: (operations, request, context) => operations.submitVerifyMetricObservation(request, context),
  knowledge_capture_source: (operations, request, context) => operations.submitCaptureSource(request, context),
  knowledge_parse_artifact: (operations, request, context) => operations.submitParseArtifact(request, context),
  knowledge_verify_extraction: (operations, request, context) => operations.submitVerifyExtraction(request, context),
  knowledge_request_adjudication: (operations, request, context) =>
    operations.submitRequestAdjudication(request, context),
  knowledge_record_adjudication_decision: (operations, request, context) =>
    operations.submitRecordAdjudicationDecision(request, context),
  knowledge_inspect_audit_bundle: (operations, request, context) =>
    operations.submitInspectAuditBundle(request, context),
  knowledge_replay_run: (operations, request, context) => operations.submitReplayRun(request, context),
};

async function admitVerificationMcpRequest(input: {
  readonly name: VerificationMcpToolName;
  readonly tenantId: string;
  readonly request: unknown;
  readonly admission: VerificationHostAdmission | undefined;
}): Promise<VerificationAdmissionResult> {
  const selectGate = VERIFICATION_MCP_ADMISSION_GATES[input.name];
  if (selectGate === undefined) return "ok";
  const gate = input.admission ? selectGate(input.admission) : undefined;
  if (gate === undefined) return "CAPABILITY_NOT_ADMITTED";
  if (!(await gate(input.tenantId, input.request as never))) return "FORBIDDEN";
  return "ok";
}

async function executeVerificationInProcess(input: {
  readonly name: VerificationMcpToolName;
  readonly parsed: z.infer<(typeof verificationToolSchemas)[VerificationMcpToolName]>;
  readonly options: KnowledgeMcpServerOptions;
}) {
  const { name, parsed, options } = input;
  const resolved = await options.resolveVerificationContext!({
    ...(options.incomingRequest ? { request: options.incomingRequest } : {}),
    tenantId: parsed.context.tenantId,
    identity: options.identity,
    correlationId: parsed.context.correlationId,
    idempotencyKey: parsed.context.idempotencyKey,
    useCase: verificationToolUseCases[name],
    hints: parsed.context,
  });
  // The API route's trusted-context binding: tenant, correlation, idempotency, actor and hints.
  const binding = bindResolvedVerificationContext({
    resolved,
    tenantId: parsed.context.tenantId,
    actor: options.identity.actor,
    correlationId: parsed.context.correlationId,
    idempotencyKey: parsed.context.idempotencyKey,
    hints: parsed.context,
    ...(options.incomingRequest ? { request: options.incomingRequest } : {}),
  });
  if (!binding.ok) return toolError("FORBIDDEN");
  const context = binding.context;
  const admission = await admitVerificationMcpRequest({
    name,
    tenantId: context.tenantId,
    request: parsed.request,
    admission: options.verificationAdmission,
  });
  if (admission !== "ok") return toolError(admission);
  if (name === "knowledge_record_adjudication_decision") {
    const gate = options.verificationAdmission?.isAdjudicationDecisionAdmitted;
    if (!gate) return toolError("CAPABILITY_NOT_ADMITTED");
    if (
      !isAdjudicationDecisionReviewerActor(context.actor) ||
      !(await gate({
        request: parsed.request as never,
        context,
      }))
    )
      return toolError("FORBIDDEN");
  }
  const result = await VERIFICATION_IN_PROCESS_SUBMIT[name](options.verificationOperations!, parsed.request, context);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result as unknown as Record<string, unknown>,
  };
}

export function createVerificationMcpToolExecutor(options: KnowledgeMcpServerOptions) {
  return async (name: (typeof VERIFICATION_MCP_TOOL_NAMES)[number], value: unknown) => {
    const parsed = verificationToolSchemas[name].parse(value),
      context = parsed.context;
    if (!isAuthorized(options.identity, context.tenantId, "operation.submit")) return toolError("FORBIDDEN");
    // Submission is in process only. Without trusted operations and ownership resolution
    // the capability is not admitted; as on the API route, record-decision reports missing
    // decision admission only after the context is resolved and bound.
    if (!options.verificationOperations || !options.resolveVerificationContext)
      return toolError("CAPABILITY_NOT_ADMITTED");
    return executeVerificationInProcess({ name, parsed, options });
  };
}

const benchmarkReadSchema = z.strictObject({
  context: z.strictObject({
    tenantId: z.uuid(),
    correlationId: z.string().trim().min(1).max(255),
  }),
  runId: z.uuid(),
});
const comparisonReadSchema = z.strictObject({
  context: benchmarkReadSchema.shape.context,
  comparisonId: z.uuid(),
});
const reconciliationReadSchema = z.strictObject({
  context: benchmarkReadSchema.shape.context,
  operationId: z.uuid(),
  providerAttemptId: z.uuid(),
});
const reconciliationApplySchema = reconciliationReadSchema.extend(ApplyProviderReconciliationRequestSchema.shape);
export function createProviderReconciliationMcpExecutor(options: KnowledgeMcpServerOptions, action: "apply" | "show") {
  return async (value: unknown) => {
    const parsed = (action === "apply" ? reconciliationApplySchema : reconciliationReadSchema).parse(value);
    if (
      !isAuthorized(
        options.identity,
        parsed.context.tenantId,
        action === "apply" ? "operation.submit" : "knowledge.read",
      )
    )
      return toolError("FORBIDDEN");
    const reads = options.verificationReads;
    if (!reads) return toolError("CAPABILITY_NOT_ADMITTED");
    return readToolResult(
      await reads.providerReconciliation({
        tenantId: parsed.context.tenantId,
        actor: options.identity.actor,
        operationId: parsed.operationId,
        providerAttemptId: parsed.providerAttemptId,
        ...("artifact" in parsed
          ? {
              artifact: ApplyProviderReconciliationRequestSchema.parse({
                artifact: parsed.artifact,
              }).artifact,
            }
          : {}),
      }),
    );
  };
}
const extractionReadSchema = z.strictObject({
  context: benchmarkReadSchema.shape.context,
  operationId: z.uuid(),
});
export function createStructuredExtractionReadMcpExecutor(options: KnowledgeMcpServerOptions) {
  return async (value: unknown) => {
    const { context, operationId } = extractionReadSchema.parse(value);
    if (!isAuthorized(options.identity, context.tenantId, "knowledge.read")) return toolError("FORBIDDEN");
    const reads = options.verificationReads;
    if (!reads) return toolError("CAPABILITY_NOT_ADMITTED");
    return readToolResult(
      await reads.structuredExtraction({
        tenantId: context.tenantId,
        operationId,
        actor: options.identity.actor,
      }),
    );
  };
}
export function createAuditInspectionReadMcpExecutor(options: KnowledgeMcpServerOptions) {
  return async (value: unknown) => {
    const { context, operationId } = extractionReadSchema.parse(value);
    if (!isAuthorized(options.identity, context.tenantId, "knowledge.read")) return toolError("FORBIDDEN");
    const reads = options.verificationReads;
    if (!reads) return toolError("CAPABILITY_NOT_ADMITTED");
    return readToolResult(
      await reads.auditInspection({
        tenantId: context.tenantId,
        operationId,
        actor: options.identity.actor,
      }),
    );
  };
}
export function createClaimsReportReadMcpExecutor(options: KnowledgeMcpServerOptions, family: "claims" | "report") {
  return async (value: unknown) => {
    const { context, operationId } = extractionReadSchema.parse(value);
    if (!isAuthorized(options.identity, context.tenantId, "knowledge.read")) return toolError("FORBIDDEN");
    const reads = options.verificationReads;
    if (!reads) return toolError("CAPABILITY_NOT_ADMITTED");
    const input = {
      tenantId: context.tenantId,
      operationId,
      actor: options.identity.actor,
    };
    return family === "claims" ? readToolResult(await reads.claims(input)) : readToolResult(await reads.report(input));
  };
}
export function createAdjudicationReadMcpExecutor(options: KnowledgeMcpServerOptions) {
  return async (value: unknown) => {
    const { context, operationId } = extractionReadSchema.parse(value);
    if (!isAuthorized(options.identity, context.tenantId, "knowledge.read")) return toolError("FORBIDDEN");
    const reads = options.verificationReads;
    if (!reads) return toolError("CAPABILITY_NOT_ADMITTED");
    return readToolResult(
      await reads.adjudicationSubject({
        tenantId: context.tenantId,
        operationId,
        actor: options.identity.actor,
      }),
    );
  };
}
export function createAdjudicationDecisionReadMcpExecutor(options: KnowledgeMcpServerOptions) {
  return async (value: unknown) => {
    const { context, operationId } = extractionReadSchema.parse(value);
    if (!isAuthorized(options.identity, context.tenantId, "knowledge.read")) return toolError("FORBIDDEN");
    const reads = options.verificationReads;
    if (!reads) return toolError("CAPABILITY_NOT_ADMITTED");
    return readToolResult(
      await reads.adjudicationDecision({
        tenantId: context.tenantId,
        operationId,
        actor: options.identity.actor,
      }),
    );
  };
}
export function createBenchmarkComparisonReadMcpExecutor(options: KnowledgeMcpServerOptions) {
  return async (value: unknown) => {
    const { context, comparisonId } = comparisonReadSchema.parse(value);
    if (!isAuthorized(options.identity, context.tenantId, "knowledge.read")) return toolError("FORBIDDEN");
    const reads = options.verificationReads;
    if (!reads) return toolError("CAPABILITY_NOT_ADMITTED");
    return readToolResult(await reads.benchmarkComparison({ tenantId: context.tenantId, comparisonId }));
  };
}
export function createBenchmarkReadMcpExecutor(options: KnowledgeMcpServerOptions) {
  return async (name: "knowledge_get_benchmark_run" | "knowledge_get_benchmark_manifest", value: unknown) => {
    const { context, runId } = benchmarkReadSchema.parse(value);
    if (!isAuthorized(options.identity, context.tenantId, "knowledge.read")) return toolError("FORBIDDEN");
    const reads = options.verificationReads;
    if (!reads) return toolError("CAPABILITY_NOT_ADMITTED");
    const input = { tenantId: context.tenantId, runId };
    return name === "knowledge_get_benchmark_run"
      ? readToolResult(await reads.benchmarkRun(input))
      : readToolResult(await reads.benchmarkManifest(input));
  };
}

export interface KnowledgeMcpAppOptions {
  readonly operationService: KnowledgeOperationPort;
  readonly apiOrigin: string;
  readonly resolveIdentity: ResolveApiIdentity;
  readonly verificationOperations?: VerificationOperationApplicationService;
  readonly resolveVerificationContext?: ResolveVerificationContext;
  readonly verificationAdmission?: VerificationHostAdmission;
  readonly knowledge?: KnowledgeMcpServices;
  readonly verificationReads?: VerificationResourceReads;
}

type ResourceReadFailureCode = Extract<ResourceReadResult<unknown>, { ok: false }>["failure"]["code"];

function toolError(
  code:
    | "FORBIDDEN"
    | "ACTOR_MISMATCH"
    | "CAPABILITY_NOT_ADMITTED"
    | "RESOURCE_ID_REQUIRED"
    | ResourceReadFailureCode
    | ReturnType<typeof transportProblem>["code"],
  details?: unknown,
) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ code }) }],
    ...(details === undefined ? {} : { structuredContent: details as Record<string, unknown> }),
    isError: true,
  };
}

/**
 * Returns a shared read result as MCP content. A failure carries the same problem
 * code the API route returns; a missing capability is CAPABILITY_NOT_ADMITTED.
 */
function readToolResult<T>(result: ResourceReadResult<T>) {
  if (!result.ok)
    return toolError(result.failure.reason === "unavailable" ? "CAPABILITY_NOT_ADMITTED" : result.failure.code);
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result.value) }],
    structuredContent: result.value as unknown as Record<string, unknown>,
  };
}

/**
 * Runs a shared read and maps an uncaught failure to the API error handler's problem
 * code, so no internal message reaches the MCP caller.
 */
async function inProcessRead<T>(read: () => Promise<ResourceReadResult<T>>) {
  let result: ResourceReadResult<T>;
  try {
    result = await read();
  } catch (error) {
    return toolError(transportProblem(error).code);
  }
  return readToolResult(result);
}

/** Runs canonical retrieval in process with the API route's admission and failure codes. */
async function searchCanonicalRetrieval(options: KnowledgeMcpServerOptions, context: OperationContext, plan: unknown) {
  const knowledge = options.knowledge;
  if (!knowledge?.retrievalOperations || !knowledge.retrievalExecutor) return toolError("CAPABILITY_NOT_ADMITTED");
  // The envelope the public client submitted: JSON-normalized, retrieval contract v1.
  const envelope = MutationEnvelopeSchema.parse(
    JSON.parse(
      JSON.stringify({
        context,
        input: { plan: RetrievalPlanSchema.parse(plan) },
        expectedVersions: { api: "v1", retrieval: "v1" },
      }),
    ),
  );
  try {
    const submission = await submitCanonicalRetrievalRun(
      {
        operations: knowledge.retrievalOperations,
        executor: knowledge.retrievalExecutor,
      },
      { envelope, identity: options.identity, origin: options.apiOrigin },
    );
    if (!submission.ok) return toolError("CAPABILITY_NOT_ADMITTED");
    return {
      content: [{ type: "text" as const, text: JSON.stringify(submission.accepted) }],
      structuredContent: submission.accepted as unknown as Record<string, unknown>,
    };
  } catch (error) {
    const problem = transportProblem(error);
    return problem.response === undefined ? toolError(problem.code) : toolError(problem.code, problem.response);
  }
}

/**
 * Creates a handler shared by every bounded MCP tool. It is deliberately a
 * transport adapter: durable admission, idempotency and step planning remain
 * in the injected application port.
 */
export function createMcpToolExecutor(options: KnowledgeMcpServerOptions) {
  return async (name: keyof typeof MCP_TOOL_CATALOG, kind: OperationKind, argumentsValue: unknown) => {
    const { context, input, expectedVersions } = McpToolArgumentsSchema.parse(argumentsValue);
    const readTools = new Set([
      "chunk.strategy_list",
      "retrieval.plan_validate",
      "retrieval.explain_run",
      "retrieval.read_run",
      "retrieval.read_evidence_packet",
      "retrieval.replay_citations",
      "evaluation.inspect_failures",
      "embedding.run_status",
      "promotion.status",
      "vector_store.ingestion_status",
    ]);
    if (
      !isAuthorized(
        options.identity,
        context.tenantId,
        readTools.has(name) ? "knowledge.read" : requiredSubmissionAction(kind),
      )
    )
      return toolError("FORBIDDEN");
    if (!actorsMatch(options.identity.actor, context.actor)) return toolError("ACTOR_MISMATCH");
    const inputObject =
      input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
    const uuid = (name: string) => {
      const parsed = UuidSchema.safeParse(inputObject[name]);
      return parsed.success ? parsed.data : undefined;
    };
    const reads = options.knowledge?.reads;
    let readResult: unknown;
    if (name === "chunk.strategy_list")
      readResult = {
        items: [
          { id: "heading-sections-v1", version: "1.0.0", admitted: true },
          { id: "transcript-topics-v1", version: "1.0.0", admitted: true },
        ],
        nextCursor: null,
      };
    else if (name === "retrieval.plan_validate")
      readResult = RetrievalPlanSchema.parse(inputObject.plan ?? inputObject);
    else if (name === "retrieval.search" && options.knowledge)
      return searchCanonicalRetrieval(options, context, inputObject.plan ?? inputObject);
    else if (name === "retrieval.explain_run" && reads) {
      const id = uuid("runId");
      if (!id) return toolError("RESOURCE_ID_REQUIRED");
      return inProcessRead(() => reads.retrievalExplanation(context.tenantId, id));
    } else if (name === "retrieval.read_run" && reads) {
      const id = uuid("runId");
      if (!id || Object.keys(inputObject).some((key) => key !== "runId")) return toolError("RESOURCE_ID_REQUIRED");
      return inProcessRead(() => reads.retrievalRun(context.tenantId, id));
    } else if ((name === "retrieval.read_evidence_packet" || name === "retrieval.replay_citations") && reads) {
      const id = uuid("packetId");
      if (!id || Object.keys(inputObject).some((key) => key !== "packetId")) return toolError("RESOURCE_ID_REQUIRED");
      return name === "retrieval.read_evidence_packet"
        ? inProcessRead(() => reads.evidencePacket(context.tenantId, id))
        : inProcessRead(() => reads.citationReplay(context.tenantId, id));
    } else if (name === "evaluation.inspect_failures" && reads) {
      const id = uuid("runId");
      if (!id) return toolError("RESOURCE_ID_REQUIRED");
      return inProcessRead(() => reads.evaluationFailures(context.tenantId, id));
    } else if (name === "embedding.run_status" || name === "promotion.status") {
      const id = uuid("operationId");
      if (!id) return toolError("RESOURCE_ID_REQUIRED");
      const item = await options.operationService.get(id, context.tenantId);
      if (!item) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
      readResult = item;
    } else if (name === "vector_store.ingestion_status" && reads) {
      const storeId = uuid("vectorStoreId"),
        operationId = uuid("operationId");
      if (!storeId || !operationId) return toolError("RESOURCE_ID_REQUIRED");
      return inProcessRead(() => reads.vectorStoreOperation(context.tenantId, storeId, operationId));
    }
    if (readResult !== undefined)
      return {
        content: [{ type: "text" as const, text: JSON.stringify(readResult) }],
        structuredContent: readResult as Record<string, unknown>,
      };
    if (
      ["embedding.model_list", "embedding.estimate"].includes(name) ||
      [
        "retrieval.search",
        "retrieval.explain_run",
        "retrieval.read_run",
        "retrieval.read_evidence_packet",
        "retrieval.replay_citations",
        "evaluation.inspect_failures",
        "vector_store.ingestion_status",
      ].includes(name)
    )
      return toolError("CAPABILITY_NOT_ADMITTED");
    try {
      assertOperationKindAdmitted(kind, productionWorkerOperationKinds);
    } catch {
      return toolError("CAPABILITY_NOT_ADMITTED");
    }
    if (kind === "vector_store_create") VectorStoreCreateInputSchema.parse(input);
    if (kind === "vector_store_documents") VectorStoreDocumentsInputSchema.parse(input);
    const result = await options.operationService.submit(kind, { context, input, expectedVersions }, options.apiOrigin);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result,
    };
  };
}

const verificationOperationReadSchema = z.strictObject({
  context: z.strictObject({
    tenantId: z.uuid(),
    correlationId: z.string().trim().min(1).max(255),
  }),
  operationId: z.uuid(),
});
/** Verification-aware operation poll (spec §19 `knowledge_get_operation`): state + receipt ids only, never a synthesized result. */
export function createVerificationOperationReadMcpExecutor(options: KnowledgeMcpServerOptions) {
  return async (value: unknown) => {
    const { context, operationId } = verificationOperationReadSchema.parse(value);
    if (!isAuthorized(options.identity, context.tenantId, "knowledge.read")) return toolError("FORBIDDEN");
    const result = await options.operationService.get(operationId, context.tenantId);
    if (!result) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  };
}

export function createKnowledgeMcpServer(options: KnowledgeMcpServerOptions) {
  const server = new McpServer({
    name: "ai-engineer-knowledge-services",
    version: "0.1.0",
  });
  const execute = createMcpToolExecutor(options);
  for (const [name, kind] of Object.entries(MCP_TOOL_CATALOG))
    server.registerTool(
      name,
      {
        description: `Bounded ${name} workflow over the Knowledge Services v1 application contract.`,
        inputSchema: McpToolArgumentsSchema.shape,
      },
      async (argumentsValue) => execute(name as keyof typeof MCP_TOOL_CATALOG, kind, argumentsValue),
    );
  const executeVerification = createVerificationMcpToolExecutor(options);
  const executeBenchmarkRead = createBenchmarkReadMcpExecutor(options);
  for (const name of ["knowledge_get_benchmark_run", "knowledge_get_benchmark_manifest"] as const)
    server.registerTool(
      name,
      {
        description:
          "Read a completed, signed benchmark with compact engineering metadata under the caller's tenant read authority.",
        inputSchema: benchmarkReadSchema.shape,
      },
      async (value: unknown) => executeBenchmarkRead(name, value),
    );
  server.registerTool(
    "knowledge_apply_provider_reconciliation",
    {
      description:
        "Apply a registered signed accounting decision under configured operator authority; never redispatches.",
      inputSchema: reconciliationApplySchema.shape,
    },
    createProviderReconciliationMcpExecutor(options, "apply"),
  );
  server.registerTool(
    "knowledge_get_provider_reconciliation",
    {
      description: "Read an authenticated applied accounting decision.",
      inputSchema: reconciliationReadSchema.shape,
    },
    createProviderReconciliationMcpExecutor(options, "show"),
  );
  server.registerTool(
    "knowledge_get_structured_extraction",
    {
      description: "Read compact authenticated extraction custody results; candidates remain unverified.",
      inputSchema: extractionReadSchema.shape,
    },
    createStructuredExtractionReadMcpExecutor(options),
  );
  server.registerTool(
    "knowledge_get_audit_inspection",
    {
      description: "Read a compact authenticated audit inspection result and immutable proof reference.",
      inputSchema: extractionReadSchema.shape,
    },
    createAuditInspectionReadMcpExecutor(options),
  );
  server.registerTool(
    "knowledge_get_verification_claims_result",
    {
      description: "Read the compact signed terminal result for an authenticated claims verification operation.",
      inputSchema: extractionReadSchema.shape,
    },
    createClaimsReportReadMcpExecutor(options, "claims"),
  );
  server.registerTool(
    "knowledge_get_verification_report_result",
    {
      description:
        "Read the compact signed terminal result and report-wide gate summary for an authenticated report verification operation.",
      inputSchema: extractionReadSchema.shape,
    },
    createClaimsReportReadMcpExecutor(options, "report"),
  );
  server.registerTool(
    "knowledge_get_adjudication",
    {
      description: "Read an authenticated pending adjudication subject and its verified source references.",
      inputSchema: extractionReadSchema.shape,
    },
    createAdjudicationReadMcpExecutor(options),
  );
  server.registerTool(
    "knowledge_get_adjudication_decision",
    {
      description: "Read a compact authenticated packet-bound adjudication decision terminal result.",
      inputSchema: extractionReadSchema.shape,
    },
    createAdjudicationDecisionReadMcpExecutor(options),
  );
  server.registerTool(
    "knowledge_get_benchmark_comparison",
    {
      description:
        "Read signed paired engineering statistics and corrected p-values for a completed benchmark comparison.",
      inputSchema: comparisonReadSchema.shape,
    },
    createBenchmarkComparisonReadMcpExecutor(options),
  );
  const caseReadContext = z.strictObject({
    tenantId: z.uuid(),
    correlationId: z.string().trim().min(1).max(255),
  });
  const caseReadTools = [
    {
      name: "knowledge_list_verification_cases",
      schema: z.strictObject({
        context: caseReadContext,
        runId: z.uuid(),
        pageSize: z.int().min(1).max(100).optional(),
        cursor: z.uuid().optional(),
      }),
      kind: "list",
    },
    {
      name: "knowledge_get_verification_case",
      schema: z.strictObject({ context: caseReadContext, caseRunId: z.uuid() }),
      kind: "case",
    },
    {
      name: "knowledge_get_verification_evidence",
      schema: z.strictObject({
        context: caseReadContext,
        evidenceId: z.uuid(),
      }),
      kind: "evidence",
    },
  ] as const;
  for (const tool of caseReadTools) {
    server.registerTool(
      tool.name,
      {
        description:
          "Read authored verification cases or compact artifact-backed evidence under the caller's tenant read authority.",
        inputSchema: tool.schema.shape,
      },
      async (value: unknown) => {
        const parsed = tool.schema.parse(value);
        if (!isAuthorized(options.identity, parsed.context.tenantId, "knowledge.read")) return toolError("FORBIDDEN");
        const reads = options.verificationReads;
        if (!reads) return toolError("CAPABILITY_NOT_ADMITTED");
        const tenantId = parsed.context.tenantId;
        return "runId" in parsed
          ? readToolResult(
              await reads.runCases({
                tenantId,
                runId: parsed.runId,
                ...(parsed.pageSize === undefined ? {} : { pageSize: parsed.pageSize }),
                ...(parsed.cursor === undefined ? {} : { cursor: parsed.cursor }),
              }),
            )
          : "caseRunId" in parsed
            ? readToolResult(await reads.case({ tenantId, caseRunId: parsed.caseRunId }))
            : readToolResult(await reads.evidence({ tenantId, evidenceId: parsed.evidenceId }));
      },
    );
  }
  const verificationReadSchema = z.strictObject({
    context: z.strictObject({
      tenantId: z.uuid(),
      correlationId: z.string().trim().min(1).max(255),
    }),
    runId: z.uuid(),
  });
  for (const name of ["knowledge_get_verification_run", "knowledge_get_verification_manifest"] as const) {
    server.registerTool(
      name,
      {
        description: "Read compact metadata from a sealed, tenant-owned verification run.",
        inputSchema: verificationReadSchema.shape,
      },
      async (value: unknown) => {
        const { context, runId } = verificationReadSchema.parse(value);
        if (!isAuthorized(options.identity, context.tenantId, "knowledge.read")) return toolError("FORBIDDEN");
        const reads = options.verificationReads;
        if (!reads) return toolError("CAPABILITY_NOT_ADMITTED");
        const input = { tenantId: context.tenantId, runId };
        return name === "knowledge_get_verification_run"
          ? readToolResult(await reads.run(input))
          : readToolResult(await reads.runManifest(input));
      },
    );
  }
  server.registerTool(
    "knowledge_get_verification_operation",
    {
      description:
        "Poll the state and receipt ids of a tenant-owned verification operation; read the kind-specific terminal result once state is succeeded.",
      inputSchema: verificationOperationReadSchema.shape,
    },
    createVerificationOperationReadMcpExecutor(options),
  );
  for (const name of VERIFICATION_MCP_TOOL_NAMES)
    server.registerTool(
      name,
      {
        description: `Bounded ${name} workflow through in-process verification admission.`,
        inputSchema: verificationToolSchemas[name].shape,
      },
      async (value: unknown) => executeVerification(name, value),
    );
  return server;
}

function bearerToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
}

/** Stateless MCP HTTP host. The bearer is resolved by the same identity map as HTTP. */
export function buildKnowledgeMcpApp(options: KnowledgeMcpAppOptions): FastifyInstance {
  // Raw HTTP URLs and exception messages can contain tenant evidence or credentials.
  // Operational telemetry must use the application's bounded event projections.
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    const candidate =
      error !== null && typeof error === "object" && "statusCode" in error ? error.statusCode : undefined;
    const status =
      typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 400 && candidate < 500
        ? candidate
        : 500;
    return reply.status(status).send({ code: status === 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST" });
  });
  app.get("/health", async () => ({ status: "ok" }));
  app.all("/mcp", async (request, reply) => {
    const token = bearerToken(request);
    const identity = token ? await options.resolveIdentity(token) : undefined;
    if (!identity) return reply.status(401).send({ code: "UNAUTHORIZED" });
    const server = createKnowledgeMcpServer({
      operationService: options.operationService,
      apiOrigin: options.apiOrigin,
      identity,
      incomingRequest: {
        headers: request.headers as Record<string, unknown>,
        body: request.body,
      },
      ...(options.verificationOperations ? { verificationOperations: options.verificationOperations } : {}),
      ...(options.resolveVerificationContext ? { resolveVerificationContext: options.resolveVerificationContext } : {}),
      ...(options.verificationAdmission ? { verificationAdmission: options.verificationAdmission } : {}),
      ...(options.knowledge ? { knowledge: options.knowledge } : {}),
      ...(options.verificationReads ? { verificationReads: options.verificationReads } : {}),
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    reply.hijack();
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
  });
  return app;
}

export function apiPublicOrigin(value: string | undefined, production = process.env.NODE_ENV === "production"): string {
  if (!value?.trim()) throw new Error("KNOWLEDGE_API_URL_REQUIRED");
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (production && url.protocol !== "https:")
  )
    throw new Error("INVALID_KNOWLEDGE_API_URL");
  return url.toString().replace(/\/$/, "");
}

type Environment = Readonly<Record<string, string | undefined>>;

export async function createMcpRuntime(environment: Environment = process.env) {
  const host = await createHost({
    profile: "server",
    role: "mcp",
    environment,
    resolveApiOrigin: (config) => apiPublicOrigin(environment.KNOWLEDGE_API_URL, config.NODE_ENV === "production"),
  });
  try {
    const { apiOrigin, knowledge, operations, verify } = host;
    const app = buildKnowledgeMcpApp({
      operationService: operations.service,
      apiOrigin,
      knowledge: {
        reads: createKnowledgeResourceReads({
          ...(knowledge.resources ? { resources: knowledge.resources } : {}),
          operations: operations.service,
          ...(knowledge.getEvidencePacket ? { getEvidencePacket: knowledge.getEvidencePacket } : {}),
          ...(knowledge.replayEvidencePacketCitations
            ? {
                replayEvidencePacketCitations: knowledge.replayEvidencePacketCitations,
              }
            : {}),
        }),
        retrievalOperations: operations.retrieval,
        ...(knowledge.canonicalRetrievalExecutor ? { retrievalExecutor: knowledge.canonicalRetrievalExecutor } : {}),
      },
      resolveIdentity: createLocalIdentityResolver(environment.KNOWLEDGE_API_IDENTITIES),
      ...(verify.operations ? { verificationOperations: verify.operations } : {}),
      ...(verify.runtime.resolveVerificationContext
        ? { resolveVerificationContext: verify.runtime.resolveVerificationContext }
        : {}),
      // The API's admission gates, including opt-in adjudication decision admission.
      verificationAdmission: {
        ...verify.runtime,
        ...(verify.decisions
          ? {
              isAdjudicationDecisionAdmitted: verify.decisions.isAdjudicationDecisionAdmitted,
            }
          : {}),
      },
      verificationReads: createVerificationResourceReads(verificationReadServices(verify)),
    });
    let closing: Promise<void> | undefined;
    return {
      app,
      config: host.config,
      /** Closes the HTTP app before releasing host resources; idempotent. */
      close: () =>
        (closing ??= (async () => {
          try {
            await app.close();
          } finally {
            await host.close();
          }
        })()),
    };
  } catch (error) {
    await host.close().catch(() => undefined);
    throw error;
  }
}

let serverlessRuntime: ReturnType<typeof createMcpRuntime> | undefined;
const getServerlessRuntime = () => (serverlessRuntime ??= createMcpRuntime());

export function createMcpRequestHandler(
  runtime: () => Promise<Pick<Awaited<ReturnType<typeof createMcpRuntime>>, "app">>,
) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const { app } = await runtime();
    await app.ready();
    await new Promise<void>((resolve, reject) => {
      response.once("finish", resolve);
      response.once("error", reject);
      app.server.emit("request", request, response);
    });
  };
}

/** Vercel Node function entrypoint with one database/app instance per warm isolate. */
const handler = createMcpRequestHandler(getServerlessRuntime);
export default handler;

async function main() {
  const runtime = await createMcpRuntime();
  const shutdown = () =>
    void runtime.close().catch((error) => {
      process.stderr.write(
        `${JSON.stringify({ event: "knowledge.mcp.shutdown_failed", error: error instanceof Error ? error.message : "unknown" })}
`,
      );
      process.exitCode = 1;
    });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  try {
    await runtime.app.listen({ host: runtime.config.HOST, port: runtime.config.PORT });
  } catch (error) {
    await runtime.close().catch(() => undefined);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main().catch(() => {
    process.stderr.write(
      `${JSON.stringify({
        event: "knowledge.mcp.start_failed",
        code: "MCP_START_FAILED",
      })}\n`,
    );
    process.exitCode = 1;
  });

export type { JsonValue, McpToolArguments, OperationContext };
