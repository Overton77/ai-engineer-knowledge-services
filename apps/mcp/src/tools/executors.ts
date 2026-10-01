import {
  assertOperationKindAdmitted,
  actorsMatch,
  bindResolvedVerificationContext,
  isAuthorized,
  isAdjudicationDecisionReviewerActor,
  productionWorkerOperationKinds,
  requiredSubmissionAction,
  submitCanonicalRetrievalRun,
  transportProblem,
  type CanonicalRetrievalExecutorPort,
  type KnowledgeOperationPort,
  type KnowledgeResourceReads,
  type LocalApiIdentity,
  type ResolveApiIdentity,
  type ResolveVerificationContext,
  type VerificationHostAdmission,
  type VerificationOperationApplicationService,
  type VerificationResourceReads,
} from "@aiengineer/knowledge-host";
import {
  ApplyProviderReconciliationRequestSchema,
  CaptureSourceRequestSchema,
  CompareBenchmarkRunsRequestSchema,
  ExtractStructuredDataRequestSchema,
  InspectAuditBundleRequestSchema,
  JsonValueSchema,
  MutationEnvelopeSchema,
  OperationContextSchema,
  ParseArtifactRequestSchema,
  ReplayRunRequestSchema,
  RequestAdjudicationRequestSchema,
  RetrievalPlanSchema,
  RunBenchmarkRequestSchema,
  UuidSchema,
  VectorStoreCreateInputSchema,
  VectorStoreDocumentsInputSchema,
  VerificationAdjudicationDecisionRequestSchema,
  VerificationOperationContextHintsSchema,
  VerifyClaimsRequestSchema,
  VerifyExtractionRequestSchema,
  VerifyMetricObservationRequestSchema,
  VerifyReportRequestSchema,
  type OperationContext,
  type OperationKind,
} from "@aiengineer/knowledge-contracts";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { MCP_TOOL_CATALOG, VERIFICATION_MCP_TOOL_NAMES, type McpToolName } from "../catalog.js";
import { McpReadContextSchema } from "./definition.js";
import { inProcessRead, readToolResult, toolError } from "./errors.js";

export const McpToolArgumentsSchema = z.object({
  context: OperationContextSchema,
  input: JsonValueSchema,
  expectedVersions: z.record(z.string(), z.string().min(1)),
});
export type McpToolArguments = z.infer<typeof McpToolArgumentsSchema>;

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

const verificationContextSchema = McpReadContextSchema.extend({
  idempotencyKey: z.string().trim().min(8).max(255),
  ...VerificationOperationContextHintsSchema.shape,
});
export const verificationToolSchemas = {
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

export const benchmarkReadSchema = z.strictObject({
  context: McpReadContextSchema,
  runId: z.uuid(),
});
export const comparisonReadSchema = z.strictObject({
  context: benchmarkReadSchema.shape.context,
  comparisonId: z.uuid(),
});
export const reconciliationReadSchema = z.strictObject({
  context: benchmarkReadSchema.shape.context,
  operationId: z.uuid(),
  providerAttemptId: z.uuid(),
});
export const reconciliationApplySchema = reconciliationReadSchema.extend(
  ApplyProviderReconciliationRequestSchema.shape,
);
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
export const extractionReadSchema = z.strictObject({
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
    const success = (value: unknown): CallToolResult => ({
      content: [{ type: "text", text: JSON.stringify(value) }],
      structuredContent: value as Record<string, unknown>,
    });
    const operationStatus = async () => {
      const id = uuid("operationId");
      if (!id) return toolError("RESOURCE_ID_REQUIRED");
      const item = await options.operationService.get(id, context.tenantId);
      if (!item) throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
      return success(item);
    };
    const packetId = () => {
      const id = uuid("packetId");
      return id && !Object.keys(inputObject).some((key) => key !== "packetId") ? id : undefined;
    };
    const readPacket = async () => {
      if (!reads) return toolError("CAPABILITY_NOT_ADMITTED");
      const id = packetId();
      return id ? inProcessRead(() => reads.evidencePacket(context.tenantId, id)) : toolError("RESOURCE_ID_REQUIRED");
    };
    const replayCitations = async () => {
      if (!reads) return toolError("CAPABILITY_NOT_ADMITTED");
      const id = packetId();
      return id ? inProcessRead(() => reads.citationReplay(context.tenantId, id)) : toolError("RESOURCE_ID_REQUIRED");
    };
    const readHandlers: Partial<Record<McpToolName, () => Promise<CallToolResult>>> = {
      "chunk.strategy_list": async () =>
        success({
          items: [
            { id: "heading-sections-v1", version: "1.0.0", admitted: true },
            { id: "transcript-topics-v1", version: "1.0.0", admitted: true },
          ],
          nextCursor: null,
        }),
      "retrieval.plan_validate": async () => success(RetrievalPlanSchema.parse(inputObject.plan ?? inputObject)),
      "retrieval.search": async () =>
        options.knowledge
          ? searchCanonicalRetrieval(options, context, inputObject.plan ?? inputObject)
          : toolError("CAPABILITY_NOT_ADMITTED"),
      "retrieval.explain_run": async () => {
        if (!reads) return toolError("CAPABILITY_NOT_ADMITTED");
        const id = uuid("runId");
        return id
          ? inProcessRead(() => reads.retrievalExplanation(context.tenantId, id))
          : toolError("RESOURCE_ID_REQUIRED");
      },
      "retrieval.read_run": async () => {
        if (!reads) return toolError("CAPABILITY_NOT_ADMITTED");
        const id = uuid("runId");
        if (!id || Object.keys(inputObject).some((key) => key !== "runId")) return toolError("RESOURCE_ID_REQUIRED");
        return inProcessRead(() => reads.retrievalRun(context.tenantId, id));
      },
      "retrieval.read_evidence_packet": readPacket,
      "retrieval.replay_citations": replayCitations,
      "evaluation.inspect_failures": async () => {
        if (!reads) return toolError("CAPABILITY_NOT_ADMITTED");
        const id = uuid("runId");
        return id
          ? inProcessRead(() => reads.evaluationFailures(context.tenantId, id))
          : toolError("RESOURCE_ID_REQUIRED");
      },
      "embedding.run_status": operationStatus,
      "promotion.status": operationStatus,
      "vector_store.ingestion_status": async () => {
        if (!reads) return toolError("CAPABILITY_NOT_ADMITTED");
        const storeId = uuid("vectorStoreId");
        const operationId = uuid("operationId");
        if (!storeId || !operationId) return toolError("RESOURCE_ID_REQUIRED");
        return inProcessRead(() => reads.vectorStoreOperation(context.tenantId, storeId, operationId));
      },
      "embedding.model_list": async () => toolError("CAPABILITY_NOT_ADMITTED"),
      "embedding.estimate": async () => toolError("CAPABILITY_NOT_ADMITTED"),
    };
    const readHandler = readHandlers[name];
    if (readHandler) return readHandler();
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

export const verificationOperationReadSchema = z.strictObject({
  context: McpReadContextSchema,
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
