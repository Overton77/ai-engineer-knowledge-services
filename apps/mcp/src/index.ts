import { ApplyProviderReconciliationRequestSchema } from "@aiengineer/knowledge-contracts";
import { ExtractStructuredDataRequestSchema } from "@aiengineer/knowledge-contracts";
import { ParseArtifactRequestSchema } from "@aiengineer/knowledge-contracts";
import { InspectAuditBundleRequestSchema } from "@aiengineer/knowledge-contracts";
import {
  RequestAdjudicationRequestSchema,
  VerificationAdjudicationDecisionRequestSchema,
} from "@aiengineer/knowledge-contracts";
import {
  CompareBenchmarkRunsRequestSchema,
  RunBenchmarkRequestSchema,
} from "@aiengineer/knowledge-contracts";
import { pathToFileURL } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  assertOperationKindAdmitted,
  productionWorkerOperationKinds,
  VerificationOperationApplicationService,
  type KnowledgeOperationPort,
  type ResolveVerificationContext,
} from "@aiengineer/knowledge-application";
import { KnowledgeClient } from "@aiengineer/knowledge-client";
import {
  createVerificationHostRuntime,
  type VerificationHostAdmission,
} from "@aiengineer/knowledge-persistence";
import {
  actorsMatch,
  createLocalIdentityResolver,
  isAuthorized,
  requiredSubmissionAction,
  loadServerConfig,
  type LocalApiIdentity,
  type ResolveApiIdentity,
} from "@aiengineer/knowledge-config";
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
  type JsonValue,
  type OperationContext,
  type OperationKind,
  RetrievalPlanSchema,
  UuidSchema,
  VectorStoreCreateInputSchema,
  VectorStoreDocumentsInputSchema,
} from "@aiengineer/knowledge-contracts";
import {
  PostgresCanonicalRepository,
  PostgresKnowledgeOperationService,
} from "@aiengineer/knowledge-persistence";
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
  readonly incomingRequest?: {
    readonly headers: Record<string, unknown>;
    readonly body: unknown;
  };
  readonly apiClient?: Pick<
    KnowledgeClient,
    | "applyProviderReconciliation"
    | "getProviderReconciliation"
    | "getStructuredExtraction"
    | "getAuditInspection"
    | "getAdjudicationSubject"
    | "getAdjudicationDecision"
    | "getVerificationClaimsResult"
    | "getVerificationReportResult"
    | "extractStructuredData"
    | "getBenchmarkComparison"
    | "getBenchmarkRun"
    | "getBenchmarkRunManifest"
    | "listVerificationRunCases"
    | "getVerificationCase"
    | "getVerificationEvidence"
    | "getVerificationRun"
    | "getVerificationRunManifest"
    | "getVerificationOperation"
    | "getOperation"
    | "getVectorStoreOperation"
    | "getRetrievalExplanation"
    | "getRetrievalRun"
    | "getEvidencePacket"
    | "replayEvidencePacketCitations"
    | "getEvaluationFailures"
    | "validateRetrievalPlan"
    | "createRetrievalRun"
    | "captureVerificationSource"
    | "parseArtifact"
    | "verifyExtraction"
    | "verifyClaims"
    | "verifyReport"
    | "verifyMetricObservation"
    | "requestAdjudication"
    | "recordAdjudicationDecision"
    | "inspectAuditBundle"
    | "replayVerificationRun"
    | "runBenchmark"
    | "compareBenchmarkRuns"
  >;
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
type VerificationAdmissionGate = (
  tenantId: string,
  request: never,
) => boolean | Promise<boolean>;

const VERIFICATION_MCP_ADMISSION_GATES: {
  readonly [Name in VerificationMcpToolName]?: (
    admission: VerificationHostAdmission,
  ) => VerificationAdmissionGate | undefined;
} = {
  knowledge_parse_artifact: (admission) => admission.isParseArtifactRequestAdmitted,
  knowledge_extract_structured_data: (admission) =>
    admission.isStructuredExtractionRequestAdmitted,
  knowledge_run_benchmark: (admission) => admission.isBenchmarkRequestAdmitted,
  knowledge_compare_benchmark_runs: (admission) =>
    admission.isBenchmarkComparisonRequestAdmitted,
  knowledge_verify_claims: (admission) => admission.isClaimsRequestAdmitted,
  knowledge_verify_report: (admission) => admission.isClaimsRequestAdmitted,
  knowledge_inspect_audit_bundle: (admission) =>
    admission.isAuditInspectionRequestAdmitted,
  knowledge_request_adjudication: (admission) =>
    admission.isAdjudicationRequestAdmitted,
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
  knowledge_run_benchmark: (operations, request, context) =>
    operations.submitRunBenchmark(request, context),
  knowledge_verify_claims: (operations, request, context) =>
    operations.submitVerifyClaims(request, context),
  knowledge_verify_report: (operations, request, context) =>
    operations.submitVerifyReport(request, context),
  knowledge_verify_metric: (operations, request, context) =>
    operations.submitVerifyMetricObservation(request, context),
  knowledge_capture_source: (operations, request, context) =>
    operations.submitCaptureSource(request, context),
  knowledge_parse_artifact: (operations, request, context) =>
    operations.submitParseArtifact(request, context),
  knowledge_verify_extraction: (operations, request, context) =>
    operations.submitVerifyExtraction(request, context),
  knowledge_request_adjudication: (operations, request, context) =>
    operations.submitRequestAdjudication(request, context),
  knowledge_record_adjudication_decision: (operations, request, context) =>
    operations.submitRecordAdjudicationDecision(request, context),
  knowledge_inspect_audit_bundle: (operations, request, context) =>
    operations.submitInspectAuditBundle(request, context),
  knowledge_replay_run: (operations, request, context) =>
    operations.submitReplayRun(request, context),
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
  if (!resolved) return toolError("FORBIDDEN");
  const admission = await admitVerificationMcpRequest({
    name,
    tenantId: resolved.tenantId,
    request: parsed.request,
    admission: options.verificationAdmission,
  });
  if (admission !== "ok") return toolError(admission);
  if (name === "knowledge_record_adjudication_decision") {
    const gate = options.verificationAdmission?.isAdjudicationDecisionAdmitted;
    if (!gate) return toolError("CAPABILITY_NOT_ADMITTED");
    if (
      !(await gate({
        request: parsed.request as never,
        context: resolved,
      }))
    )
      return toolError("FORBIDDEN");
  }
  const result = await VERIFICATION_IN_PROCESS_SUBMIT[name](
    options.verificationOperations!,
    parsed.request,
    resolved,
  );
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result as unknown as Record<string, unknown>,
  };
}

export function createVerificationMcpToolExecutor(
  options: KnowledgeMcpServerOptions,
) {
  return async (
    name: (typeof VERIFICATION_MCP_TOOL_NAMES)[number],
    value: unknown,
  ) => {
    const parsed = verificationToolSchemas[name].parse(value),
      context = parsed.context;
    if (!isAuthorized(options.identity, context.tenantId, "operation.submit"))
      return toolError("FORBIDDEN");
    if (
      options.verificationOperations &&
      options.resolveVerificationContext &&
      (name !== "knowledge_record_adjudication_decision" ||
        options.verificationAdmission?.isAdjudicationDecisionAdmitted)
    )
      return executeVerificationInProcess({ name, parsed, options });
    const client = options.apiClient;
    if (!client) return toolError("CAPABILITY_NOT_ADMITTED");
    const result =
      name === "knowledge_extract_structured_data"
        ? await client.extractStructuredData(parsed.request as never, context)
        : name === "knowledge_compare_benchmark_runs"
          ? await client.compareBenchmarkRuns(parsed.request as never, context)
          : name === "knowledge_run_benchmark"
            ? await client.runBenchmark(parsed.request as never, context)
            : name === "knowledge_verify_claims"
              ? await client.verifyClaims(parsed.request as never, context)
              : name === "knowledge_verify_report"
                ? await client.verifyReport(parsed.request as never, context)
                : name === "knowledge_verify_metric"
                  ? await client.verifyMetricObservation(
                      parsed.request as never,
                      context,
                    )
                  : name === "knowledge_capture_source"
                    ? await client.captureVerificationSource(
                        parsed.request as never,
                        context,
                      )
                    : name === "knowledge_parse_artifact"
                      ? await client.parseArtifact(
                          parsed.request as never,
                          context,
                        )
                      : name === "knowledge_verify_extraction"
                        ? await client.verifyExtraction(
                            parsed.request as never,
                            context,
                          )
                        : name === "knowledge_request_adjudication"
                          ? await client.requestAdjudication(
                              parsed.request as never,
                              context,
                            )
                          : name === "knowledge_record_adjudication_decision"
                            ? await client.recordAdjudicationDecision(
                                parsed.request as never,
                                context,
                              )
                            : name === "knowledge_inspect_audit_bundle"
                              ? await client.inspectAuditBundle(
                                  parsed.request as never,
                                  context,
                                )
                              : await client.replayVerificationRun(
                                  parsed.request as never,
                                  context,
                                );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
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
const reconciliationApplySchema = reconciliationReadSchema.extend(
  ApplyProviderReconciliationRequestSchema.shape,
);
export function createProviderReconciliationMcpExecutor(
  options: KnowledgeMcpServerOptions,
  action: "apply" | "show",
) {
  return async (value: unknown) => {
    const parsed = (
      action === "apply" ? reconciliationApplySchema : reconciliationReadSchema
    ).parse(value);
    if (
      !isAuthorized(
        options.identity,
        parsed.context.tenantId,
        action === "apply" ? "operation.submit" : "knowledge.read",
      )
    )
      return toolError("FORBIDDEN");
    if (!options.apiClient) return toolError("CAPABILITY_NOT_ADMITTED");
    const result =
      "artifact" in parsed
        ? await options.apiClient.applyProviderReconciliation(
            parsed.operationId,
            parsed.providerAttemptId,
            ApplyProviderReconciliationRequestSchema.parse({
              artifact: parsed.artifact,
            }),
            parsed.context,
          )
        : await options.apiClient.getProviderReconciliation(
            parsed.operationId,
            parsed.providerAttemptId,
            parsed.context,
          );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  };
}
const extractionReadSchema = z.strictObject({
  context: benchmarkReadSchema.shape.context,
  operationId: z.uuid(),
});
export function createStructuredExtractionReadMcpExecutor(
  options: KnowledgeMcpServerOptions,
) {
  return async (value: unknown) => {
    const { context, operationId } = extractionReadSchema.parse(value);
    if (!isAuthorized(options.identity, context.tenantId, "knowledge.read"))
      return toolError("FORBIDDEN");
    if (!options.apiClient) return toolError("CAPABILITY_NOT_ADMITTED");
    const result = await options.apiClient.getStructuredExtraction(
      operationId,
      context,
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  };
}
export function createAuditInspectionReadMcpExecutor(
  options: KnowledgeMcpServerOptions,
) {
  return async (value: unknown) => {
    const { context, operationId } = extractionReadSchema.parse(value);
    if (!isAuthorized(options.identity, context.tenantId, "knowledge.read"))
      return toolError("FORBIDDEN");
    if (!options.apiClient) return toolError("CAPABILITY_NOT_ADMITTED");
    const result = await options.apiClient.getAuditInspection(
      operationId,
      context,
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  };
}
export function createClaimsReportReadMcpExecutor(
  options: KnowledgeMcpServerOptions,
  family: "claims" | "report",
) {
  return async (value: unknown) => {
    const { context, operationId } = extractionReadSchema.parse(value);
    if (!isAuthorized(options.identity, context.tenantId, "knowledge.read"))
      return toolError("FORBIDDEN");
    if (!options.apiClient) return toolError("CAPABILITY_NOT_ADMITTED");
    const result =
      family === "claims"
        ? await options.apiClient.getVerificationClaimsResult(
            operationId,
            context,
          )
        : await options.apiClient.getVerificationReportResult(
            operationId,
            context,
          );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  };
}
export function createAdjudicationReadMcpExecutor(
  options: KnowledgeMcpServerOptions,
) {
  return async (value: unknown) => {
    const { context, operationId } = extractionReadSchema.parse(value);
    if (!isAuthorized(options.identity, context.tenantId, "knowledge.read"))
      return toolError("FORBIDDEN");
    if (!options.apiClient) return toolError("CAPABILITY_NOT_ADMITTED");
    const result = await options.apiClient.getAdjudicationSubject(
      operationId,
      context,
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  };
}
export function createAdjudicationDecisionReadMcpExecutor(
  options: KnowledgeMcpServerOptions,
) {
  return async (value: unknown) => {
    const { context, operationId } = extractionReadSchema.parse(value);
    if (!isAuthorized(options.identity, context.tenantId, "knowledge.read"))
      return toolError("FORBIDDEN");
    if (!options.apiClient) return toolError("CAPABILITY_NOT_ADMITTED");
    const result = await options.apiClient.getAdjudicationDecision(
      operationId,
      context,
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  };
}
export function createBenchmarkComparisonReadMcpExecutor(
  options: KnowledgeMcpServerOptions,
) {
  return async (value: unknown) => {
    const { context, comparisonId } = comparisonReadSchema.parse(value);
    if (!isAuthorized(options.identity, context.tenantId, "knowledge.read"))
      return toolError("FORBIDDEN");
    if (!options.apiClient) return toolError("CAPABILITY_NOT_ADMITTED");
    const result = await options.apiClient.getBenchmarkComparison(
      comparisonId,
      context,
    );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  };
}
export function createBenchmarkReadMcpExecutor(
  options: KnowledgeMcpServerOptions,
) {
  return async (
    name: "knowledge_get_benchmark_run" | "knowledge_get_benchmark_manifest",
    value: unknown,
  ) => {
    const { context, runId } = benchmarkReadSchema.parse(value);
    if (!isAuthorized(options.identity, context.tenantId, "knowledge.read"))
      return toolError("FORBIDDEN");
    if (!options.apiClient) return toolError("CAPABILITY_NOT_ADMITTED");
    const result =
      name === "knowledge_get_benchmark_run"
        ? await options.apiClient.getBenchmarkRun(runId, context)
        : await options.apiClient.getBenchmarkRunManifest(runId, context);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  };
}

export interface KnowledgeMcpAppOptions {
  readonly operationService: KnowledgeOperationPort;
  readonly apiOrigin: string;
  readonly resolveIdentity: ResolveApiIdentity;
  readonly verificationOperations?: VerificationOperationApplicationService;
  readonly resolveVerificationContext?: ResolveVerificationContext;
  readonly verificationAdmission?: VerificationHostAdmission;
  readonly createApiClient?: (
    accessToken: string,
  ) => KnowledgeMcpServerOptions["apiClient"];
}

function toolError(
  code:
    | "FORBIDDEN"
    | "ACTOR_MISMATCH"
    | "CAPABILITY_NOT_ADMITTED"
    | "RESOURCE_ID_REQUIRED",
) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ code }) }],
    isError: true,
  };
}

/**
 * Creates a handler shared by every bounded MCP tool. It is deliberately a
 * transport adapter: durable admission, idempotency and step planning remain
 * in the injected application port.
 */
export function createMcpToolExecutor(options: KnowledgeMcpServerOptions) {
  return async (
    name: keyof typeof MCP_TOOL_CATALOG,
    kind: OperationKind,
    argumentsValue: unknown,
  ) => {
    const { context, input, expectedVersions } =
      McpToolArgumentsSchema.parse(argumentsValue);
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
    if (!actorsMatch(options.identity.actor, context.actor))
      return toolError("ACTOR_MISMATCH");
    const inputObject =
      input && typeof input === "object" && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : {};
    const uuid = (name: string) => {
      const parsed = UuidSchema.safeParse(inputObject[name]);
      return parsed.success ? parsed.data : undefined;
    };
    const client = options.apiClient;
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
    else if (name === "retrieval.search" && client)
      readResult = await client.createRetrievalRun(
        RetrievalPlanSchema.parse(inputObject.plan ?? inputObject),
        context,
      );
    else if (name === "retrieval.explain_run" && client) {
      const id = uuid("runId");
      if (!id) return toolError("RESOURCE_ID_REQUIRED");
      readResult = await client.getRetrievalExplanation(id, context);
    } else if (name === "retrieval.read_run" && client) {
      const id = uuid("runId");
      if (!id || Object.keys(inputObject).some(key => key !== "runId")) return toolError("RESOURCE_ID_REQUIRED");
      readResult = await client.getRetrievalRun(id, context);
    } else if ((name === "retrieval.read_evidence_packet" || name === "retrieval.replay_citations") && client) {
      const id = uuid("packetId");
      if (!id || Object.keys(inputObject).some(key => key !== "packetId")) return toolError("RESOURCE_ID_REQUIRED");
      readResult = name === "retrieval.read_evidence_packet"
        ? await client.getEvidencePacket(id, context)
        : await client.replayEvidencePacketCitations(id, context);
    } else if (name === "evaluation.inspect_failures" && client) {
      const id = uuid("runId");
      if (!id) return toolError("RESOURCE_ID_REQUIRED");
      readResult = await client.getEvaluationFailures(id, context);
    } else if (
      name === "embedding.run_status" ||
      name === "promotion.status"
    ) {
      const id = uuid("operationId");
      if (!id) return toolError("RESOURCE_ID_REQUIRED");
      const item = await options.operationService.get(id, context.tenantId);
      if (!item)
        throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
      readResult = item;
    } else if (name === "vector_store.ingestion_status" && client) {
      const storeId = uuid("vectorStoreId"),
        operationId = uuid("operationId");
      if (!storeId || !operationId) return toolError("RESOURCE_ID_REQUIRED");
      readResult = await client.getVectorStoreOperation(
        storeId,
        operationId,
        context,
      );
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
    if (kind === "vector_store_create")
      VectorStoreCreateInputSchema.parse(input);
    if (kind === "vector_store_documents")
      VectorStoreDocumentsInputSchema.parse(input);
    const result = await options.operationService.submit(
      kind,
      { context, input, expectedVersions },
      options.apiOrigin,
    );
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
export function createVerificationOperationReadMcpExecutor(
  options: KnowledgeMcpServerOptions,
) {
  return async (value: unknown) => {
    const { context, operationId } =
      verificationOperationReadSchema.parse(value);
    if (!isAuthorized(options.identity, context.tenantId, "knowledge.read"))
      return toolError("FORBIDDEN");
    const result = await options.operationService.get(
      operationId,
      context.tenantId,
    );
    if (!result)
      throw Object.assign(new Error("NOT_FOUND"), { code: "NOT_FOUND" });
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
      async (argumentsValue) =>
        execute(name as keyof typeof MCP_TOOL_CATALOG, kind, argumentsValue),
    );
  const executeVerification = createVerificationMcpToolExecutor(options);
  const executeBenchmarkRead = createBenchmarkReadMcpExecutor(options);
  for (const name of [
    "knowledge_get_benchmark_run",
    "knowledge_get_benchmark_manifest",
  ] as const)
    server.registerTool(
      name,
      {
        description:
          "Read a completed, signed benchmark through the authenticated API with compact engineering metadata.",
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
      description:
        "Read compact authenticated extraction custody results; candidates remain unverified.",
      inputSchema: extractionReadSchema.shape,
    },
    createStructuredExtractionReadMcpExecutor(options),
  );
  server.registerTool(
    "knowledge_get_audit_inspection",
    {
      description:
        "Read a compact authenticated audit inspection result and immutable proof reference.",
      inputSchema: extractionReadSchema.shape,
    },
    createAuditInspectionReadMcpExecutor(options),
  );
  server.registerTool(
    "knowledge_get_verification_claims_result",
    {
      description:
        "Read the compact signed terminal result for an authenticated claims verification operation.",
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
      description:
        "Read an authenticated pending adjudication subject and its verified source references.",
      inputSchema: extractionReadSchema.shape,
    },
    createAdjudicationReadMcpExecutor(options),
  );
  server.registerTool(
    "knowledge_get_adjudication_decision",
    {
      description:
        "Read a compact authenticated packet-bound adjudication decision terminal result.",
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
          "Read authored verification cases or compact artifact-backed evidence through the authenticated API.",
        inputSchema: tool.schema.shape,
      },
      async (value: unknown) => {
        const parsed = tool.schema.parse(value);
        if (
          !isAuthorized(
            options.identity,
            parsed.context.tenantId,
            "knowledge.read",
          )
        )
          return toolError("FORBIDDEN");
        if (!options.apiClient) return toolError("CAPABILITY_NOT_ADMITTED");
        const result =
          "runId" in parsed
            ? await options.apiClient.listVerificationRunCases(
                parsed.runId,
                {
                  ...(parsed.pageSize === undefined
                    ? {}
                    : { pageSize: parsed.pageSize }),
                  ...(parsed.cursor === undefined
                    ? {}
                    : { cursor: parsed.cursor }),
                },
                parsed.context,
              )
            : "caseRunId" in parsed
              ? await options.apiClient.getVerificationCase(
                  parsed.caseRunId,
                  parsed.context,
                )
              : await options.apiClient.getVerificationEvidence(
                  parsed.evidenceId,
                  parsed.context,
                );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
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
  for (const name of [
    "knowledge_get_verification_run",
    "knowledge_get_verification_manifest",
  ] as const) {
    server.registerTool(
      name,
      {
        description:
          "Read compact metadata from a sealed, tenant-owned verification run.",
        inputSchema: verificationReadSchema.shape,
      },
      async (value: unknown) => {
        const { context, runId } = verificationReadSchema.parse(value);
        if (!isAuthorized(options.identity, context.tenantId, "knowledge.read"))
          return toolError("FORBIDDEN");
        if (!options.apiClient) return toolError("CAPABILITY_NOT_ADMITTED");
        const result =
          name === "knowledge_get_verification_run"
            ? await options.apiClient.getVerificationRun(runId, context)
            : await options.apiClient.getVerificationRunManifest(
                runId,
                context,
              );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
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
        description: `Bounded ${name} workflow through the authenticated verification HTTP client.`,
        inputSchema: verificationToolSchemas[name].shape,
      },
      async (value: unknown) => executeVerification(name, value),
    );
  return server;
}

function bearerToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
}

/** Stateless MCP HTTP host. The bearer is resolved by the same identity map as HTTP. */
export function buildKnowledgeMcpApp(
  options: KnowledgeMcpAppOptions,
): FastifyInstance {
  // Raw HTTP URLs and exception messages can contain tenant evidence or credentials.
  // Operational telemetry must use the application's bounded event projections.
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    const candidate =
      error !== null && typeof error === "object" && "statusCode" in error
        ? error.statusCode
        : undefined;
    const status =
      typeof candidate === "number" &&
      Number.isInteger(candidate) &&
      candidate >= 400 &&
      candidate < 500
        ? candidate
        : 500;
    return reply
      .status(status)
      .send({ code: status === 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST" });
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
      ...(options.verificationOperations
        ? { verificationOperations: options.verificationOperations }
        : {}),
      ...(options.resolveVerificationContext
        ? { resolveVerificationContext: options.resolveVerificationContext }
        : {}),
      ...(options.verificationAdmission
        ? { verificationAdmission: options.verificationAdmission }
        : {}),
      apiClient: options.createApiClient?.(token!),
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

export function apiPublicOrigin(
  value: string | undefined,
  production = process.env.NODE_ENV === "production",
): string {
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

function composeMcpVerificationHost(input: {
  readonly database: PostgresCanonicalRepository;
  readonly environment: Environment;
  readonly production: boolean;
  readonly apiOrigin: string;
}): Pick<
  KnowledgeMcpAppOptions,
  | "verificationOperations"
  | "resolveVerificationContext"
  | "verificationAdmission"
> {
  const host = createVerificationHostRuntime(input.database, input.environment, {
    production: input.production,
  });
  return {
    ...(host.verificationOperationService
      ? {
          verificationOperations: new VerificationOperationApplicationService(
            host.verificationOperationService,
            input.apiOrigin,
            host.verificationCaptureCatalog,
          ),
        }
      : {}),
    ...(host.resolveVerificationContext
      ? { resolveVerificationContext: host.resolveVerificationContext }
      : {}),
    verificationAdmission: host,
  };
}

export async function createMcpRuntime(environment: Environment = process.env) {
  const config = loadServerConfig({
    ...environment,
    PORT: environment.PORT ?? "4101",
  });
  const connectionString = environment.POSTGRES_URL?.trim();
  if (!connectionString) throw new Error("POSTGRES_URL_REQUIRED");
  const database = new PostgresCanonicalRepository({
    connectionString,
    ...(environment.CANONICAL_LOCAL_ONLY === "1" ? { localOnly: true } : {}),
  });
  const apiOrigin = apiPublicOrigin(
    environment.KNOWLEDGE_API_URL,
    config.NODE_ENV === "production",
  );
  const app = buildKnowledgeMcpApp({
    operationService: new PostgresKnowledgeOperationService(database),
    apiOrigin,
    resolveIdentity: createLocalIdentityResolver(
      environment.KNOWLEDGE_API_IDENTITIES,
    ),
    ...composeMcpVerificationHost({
      database,
      environment,
      production: config.NODE_ENV === "production",
      apiOrigin,
    }),
    createApiClient: (accessToken) =>
      new KnowledgeClient({
        baseUrl: apiOrigin,
        getAccessToken: () => accessToken,
      }),
  });
  return { app, config, database };
}

let serverlessRuntime: ReturnType<typeof createMcpRuntime> | undefined;
const getServerlessRuntime = () => (serverlessRuntime ??= createMcpRuntime());

export function createMcpRequestHandler(
  runtime: () => Promise<
    Pick<Awaited<ReturnType<typeof createMcpRuntime>>, "app">
  >,
) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
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
  const { app, config, database } = await createMcpRuntime();
  const shutdown = async () => {
    await app.close();
    await database.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  await app.listen({ host: config.HOST, port: config.PORT });
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
