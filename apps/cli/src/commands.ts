import {
  ApplyProviderReconciliationRequestSchema,
  type ApplyProviderReconciliationRequest,
} from "@aiengineer/knowledge-contracts";
import {
  ExtractStructuredDataRequestSchema,
  type ExtractStructuredDataRequest,
} from "@aiengineer/knowledge-contracts";
import {
  CompareBenchmarkRunsRequestSchema,
  type CompareBenchmarkRunsRequest,
  RunBenchmarkRequestSchema,
  type RunBenchmarkRequest,
  VerifyMetricObservationRequestSchema,
  type VerifyMetricObservationRequest,
} from "@aiengineer/knowledge-contracts";
import { productionWorkerOperationKinds } from "@aiengineer/knowledge-application";
import {
  CaptureSourceRequestSchema,
  InspectAuditBundleRequestSchema,
  JsonValueSchema,
  ParseArtifactRequestSchema,
  ReplayRunRequestSchema,
  RequestAdjudicationRequestSchema,
  VerificationAdjudicationDecisionRequestSchema,
  RetrievalPlanSchema,
  UuidSchema,
  VectorStoreCreateInputSchema,
  VectorStoreDocumentsInputSchema,
  VerifyClaimsRequestSchema,
  VerifyReportRequestSchema,
  VerifyExtractionRequestSchema,
  type CaptureSourceRequest,
  type InspectAuditBundleRequest,
  type JsonValue,
  type OperationContext,
  type OperationKind,
  type ParseArtifactRequest,
  type ReplayRunRequest,
  type RequestAdjudicationRequest,
  type VerificationAdjudicationDecisionRequest,
  type RetrievalPlan,
  type VectorStoreCreateInput,
  type VectorStoreDocumentsInput,
  type VerifyClaimsRequest,
  type VerifyReportRequest,
  type VerifyExtractionRequest,
} from "@aiengineer/knowledge-contracts";

export type CliCommand =
  | {
      readonly mode: "provider_reconciliation";
      readonly action: "apply" | "show";
    }
  | { readonly mode: "submit"; readonly kind: OperationKind }
  | { readonly mode: "retrieval" }
  | {
      readonly mode: "read";
      readonly resource:
        | "claims_result"
        | "report_result"
        | "audit_inspection"
        | "adjudication"
        | "adjudication_decision"
        | "structured_extraction"
        | "benchmark_comparison"
        | "benchmark_run"
        | "benchmark_manifest"
        | "verification_cases"
        | "verification_case"
        | "verification_evidence"
        | "verification_run"
        | "verification_manifest"
        | "verification_operation"
        | "vector_store"
        | "vector_store_operation"
        | "operation"
        | "operation_events"
        | "retrieval_explanation"
        | "evaluation_failures";
    }
  | { readonly mode: "control"; readonly action: "retry" | "reconcile" }
  | { readonly mode: "validate_retrieval_plan" }
  | {
      readonly mode: "verification_mutation";
      readonly useCase:
        | "captureSource"
        | "parseArtifact"
        | "verifyExtraction"
        | "verifyClaims"
        | "verifyReport"
        | "verifyMetricObservation"
        | "requestAdjudication"
        | "recordAdjudicationDecision"
        | "inspectAuditBundle"
        | "replayRun"
        | "runBenchmark"
        | "compareBenchmarkRuns"
        | "extractStructuredData";
    }
  | { readonly mode: "unsupported"; readonly reason: string };
const submit = (kind: OperationKind): CliCommand => {
  if (!productionWorkerOperationKinds.includes(kind))
    throw new Error(`CLI_CATALOG_UNADMITTED:${kind}`);
  return { mode: "submit", kind };
};
const unsupported = (reason: string): CliCommand => ({
  mode: "unsupported",
  reason,
});

/** Read commands never submit writes; deferred capabilities fail before admission. */
export const CLI_COMMANDS = Object.freeze({
  source: {
    discover: submit("source_discovery"),
    fetch: submit("capture"),
    inspect: unsupported("capture inspection is not production-admitted"),
    vet: submit("source_vetting"),
  },
  store: {
    create: submit("vector_store_create"),
    show: { mode: "read", resource: "vector_store" },
    "add-documents": submit("vector_store_documents"),
    search: unsupported("use retrieve search with a canonical RetrievalPlan"),
    evaluate: submit("vector_store_evaluation"),
    status: { mode: "read", resource: "vector_store_operation" },
  },
  document: {
    convert: submit("transformation"),
    inspect: unsupported(
      "representation inspection is not production-admitted",
    ),
    compare: submit("representation_comparison"),
  },
  chunk: {
    preview: submit("chunk_preview"),
    build: submit("chunk_set"),
    inspect: unsupported("chunk-set inspection is not production-admitted"),
  },
  promotion: {
    propose: submit("promotion_proposal"),
    review: submit("promotion_decision"),
    status: { mode: "read", resource: "operation" },
  },
  embed: {
    run: submit("embedding_run"),
    status: { mode: "read", resource: "operation" },
    verify: submit("publication_verification"),
  },
  retrieve: {
    plan: { mode: "validate_retrieval_plan" },
    search: { mode: "retrieval" },
    explain: { mode: "read", resource: "retrieval_explanation" },
  },
  eval: {
    generate: submit("evaluation_dataset"),
    run: submit("evaluation_run"),
    compare: submit("experiment"),
    failures: { mode: "read", resource: "evaluation_failures" },
  },
  reconciliation: {
    apply: { mode: "provider_reconciliation", action: "apply" },
    show: { mode: "provider_reconciliation", action: "show" },
  },
  extraction: {
    run: { mode: "verification_mutation", useCase: "extractStructuredData" },
    show: { mode: "read", resource: "structured_extraction" },
  },
  benchmark: {
    comparison: { mode: "read", resource: "benchmark_comparison" },
    compare: { mode: "verification_mutation", useCase: "compareBenchmarkRuns" },
    show: { mode: "read", resource: "benchmark_run" },
    manifest: { mode: "read", resource: "benchmark_manifest" },
    run: { mode: "verification_mutation", useCase: "runBenchmark" },
    capture: { mode: "verification_mutation", useCase: "captureSource" },
  },
  artifact: {
    parse: { mode: "verification_mutation", useCase: "parseArtifact" },
  },
  verify: {
    status: { mode: "read", resource: "verification_operation" },
    "claims-result": { mode: "read", resource: "claims_result" },
    "report-result": { mode: "read", resource: "report_result" },
    cases: { mode: "read", resource: "verification_cases" },
    case: { mode: "read", resource: "verification_case" },
    evidence: { mode: "read", resource: "verification_evidence" },
    run: { mode: "read", resource: "verification_run" },
    manifest: { mode: "read", resource: "verification_manifest" },
    extract: { mode: "verification_mutation", useCase: "verifyExtraction" },
    citations: { mode: "verification_mutation", useCase: "verifyClaims" },
    report: { mode: "verification_mutation", useCase: "verifyReport" },
    metric: {
      mode: "verification_mutation",
      useCase: "verifyMetricObservation",
    },
  },
  bundle: {
    inspect: { mode: "verification_mutation", useCase: "inspectAuditBundle" },
    show: { mode: "read", resource: "audit_inspection" },
    replay: { mode: "verification_mutation", useCase: "replayRun" },
  },
  adjudication: {
    request: { mode: "verification_mutation", useCase: "requestAdjudication" },
    decision: {
      mode: "verification_mutation",
      useCase: "recordAdjudicationDecision",
    },
    get: { mode: "read", resource: "adjudication" },
    "get-decision": { mode: "read", resource: "adjudication_decision" },
  },
  space: {
    publish: submit("space_publication"),
    rollback: submit("publication_rollback"),
    rebuild: unsupported("space rebuild is not production-admitted"),
  },
  operation: {
    status: { mode: "read", resource: "operation" },
    events: { mode: "read", resource: "operation_events" },
    retry: { mode: "control", action: "retry" },
    reconcile: { mode: "control", action: "reconcile" },
  },
  db: {
    verify: unsupported("database maintenance is an offline operator workflow"),
    types: unsupported("database type generation is an offline build workflow"),
    "rls-test": unsupported("RLS verification is an offline test workflow"),
  },
  fixture: {
    load: unsupported("fixture loading is an offline test workflow"),
    reset: unsupported("fixture reset is an offline test workflow"),
  },
} satisfies Record<string, Record<string, CliCommand>>);
export function resolveCommand(
  group: string,
  action: string,
): CliCommand | undefined {
  return CLI_COMMANDS[group as keyof typeof CLI_COMMANDS]?.[action as never] as
    | CliCommand
    | undefined;
}

export interface CliKnowledgeClient {
  getProviderReconciliation(
    operationId: string,
    providerAttemptId: string,
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  applyProviderReconciliation(
    operationId: string,
    providerAttemptId: string,
    request: ApplyProviderReconciliationRequest,
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  getStructuredExtraction(
    operationId: string,
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  getAuditInspection(
    operationId: string,
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  getAdjudicationSubject(
    operationId: string,
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  getAdjudicationDecision(
    operationId: string,
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  getVerificationClaimsResult(
    operationId: string,
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  getVerificationReportResult(
    operationId: string,
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  extractStructuredData(
    request: ExtractStructuredDataRequest,
    context: OperationContext,
  ): Promise<unknown>;
  getBenchmarkComparison(
    comparisonId: string,
    context: OperationContext,
  ): Promise<unknown>;
  getBenchmarkRun(
    id: string,
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  getBenchmarkRunManifest(
    id: string,
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  listVerificationRunCases(
    id: string,
    page: { pageSize?: number; cursor?: string },
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  getVerificationCase(
    id: string,
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  getVerificationEvidence(
    id: string,
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  getVerificationRun(
    id: string,
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  getVerificationRunManifest(
    id: string,
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  compareBenchmarkRuns(
    request: CompareBenchmarkRunsRequest,
    context: OperationContext,
  ): Promise<unknown>;
  runBenchmark(
    request: RunBenchmarkRequest,
    context: OperationContext,
  ): Promise<unknown>;
  verifyMetricObservation(
    request: VerifyMetricObservationRequest,
    context: OperationContext,
  ): Promise<unknown>;
  verifyClaims(
    request: VerifyClaimsRequest,
    context: OperationContext,
  ): Promise<unknown>;
  verifyReport(
    request: VerifyReportRequest,
    context: OperationContext,
  ): Promise<unknown>;
  inspectAuditBundle(
    request: InspectAuditBundleRequest,
    context: OperationContext,
  ): Promise<unknown>;
  requestAdjudication(
    request: RequestAdjudicationRequest,
    context: OperationContext,
  ): Promise<unknown>;
  recordAdjudicationDecision(
    request: VerificationAdjudicationDecisionRequest,
    context: OperationContext,
  ): Promise<unknown>;
  submitOperation(
    kind: OperationKind,
    input: JsonValue,
    context: OperationContext,
  ): Promise<unknown>;
  createRetrievalRun(
    plan: RetrievalPlan,
    context: OperationContext,
  ): Promise<unknown>;
  validateRetrievalPlan(
    plan: RetrievalPlan,
    context: OperationContext,
  ): Promise<unknown>;
  createVectorStore(
    input: VectorStoreCreateInput,
    context: OperationContext,
  ): Promise<unknown>;
  attachVectorStoreDocuments(
    vectorStoreId: string,
    input: VectorStoreDocumentsInput,
    context: OperationContext,
  ): Promise<unknown>;
  getVectorStore(
    id: string,
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  getVectorStoreOperation(
    storeId: string,
    operationId: string,
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  getOperation(
    id: string,
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  getVerificationOperation(
    id: string,
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  getOperationEvents(
    id: string,
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  retryOperation(id: string, context: OperationContext): Promise<unknown>;
  reconcileOperation(id: string, context: OperationContext): Promise<unknown>;
  getRetrievalExplanation(
    id: string,
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  getEvaluationFailures(
    id: string,
    context: Pick<OperationContext, "tenantId" | "correlationId">,
  ): Promise<unknown>;
  captureVerificationSource(
    request: CaptureSourceRequest,
    context: Pick<
      OperationContext,
      "tenantId" | "correlationId" | "idempotencyKey"
    >,
  ): Promise<unknown>;
  parseArtifact(
    request: ParseArtifactRequest,
    context: Pick<
      OperationContext,
      "tenantId" | "correlationId" | "idempotencyKey"
    >,
  ): Promise<unknown>;
  verifyExtraction(
    request: VerifyExtractionRequest,
    context: Pick<
      OperationContext,
      "tenantId" | "correlationId" | "idempotencyKey"
    >,
  ): Promise<unknown>;
  replayVerificationRun(
    request: ReplayRunRequest,
    context: Pick<
      OperationContext,
      "tenantId" | "correlationId" | "idempotencyKey"
    >,
  ): Promise<unknown>;
}
function objectInput(value: unknown): Record<string, unknown> {
  const parsed = JsonValueSchema.parse(value);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
    throw new Error("CLI_INPUT_OBJECT_REQUIRED");
  return parsed;
}
const requiredId = (input: Record<string, unknown>, name: string) =>
  UuidSchema.parse(input[name]);
export async function dispatchCliCommand(
  client: CliKnowledgeClient,
  command: CliCommand,
  inputValue: unknown,
  context: OperationContext,
): Promise<unknown> {
  if (command.mode === "unsupported")
    throw new Error(`CAPABILITY_NOT_ADMITTED:${command.reason}`);
  const input = objectInput(inputValue);
  if (command.mode === "provider_reconciliation") {
    const operationId = UuidSchema.parse(input.operationId),
      providerAttemptId = UuidSchema.parse(input.providerAttemptId);
    const allowed =
      command.action === "show"
        ? ["operationId", "providerAttemptId"]
        : ["operationId", "providerAttemptId", "artifact"];
    if (Object.keys(input).some((key) => !allowed.includes(key)))
      throw new Error("RECONCILIATION_INPUT_INVALID");
    if (command.action === "show")
      return client.getProviderReconciliation(
        operationId,
        providerAttemptId,
        context,
      );
    return client.applyProviderReconciliation(
      operationId,
      providerAttemptId,
      ApplyProviderReconciliationRequestSchema.parse({
        artifact: input.artifact,
      }),
      context,
    );
  }
  if (command.mode === "submit") {
    if (command.kind === "vector_store_create")
      return client.createVectorStore(
        VectorStoreCreateInputSchema.parse(input),
        context,
      );
    if (command.kind === "vector_store_documents") {
      const parsed = VectorStoreDocumentsInputSchema.parse(input);
      return client.attachVectorStoreDocuments(
        parsed.vectorStoreId,
        parsed,
        context,
      );
    }
    return client.submitOperation(command.kind, input as JsonValue, context);
  }
  if (command.mode === "retrieval")
    return client.createRetrievalRun(
      RetrievalPlanSchema.parse(input.plan ?? input),
      context,
    );
  if (command.mode === "validate_retrieval_plan")
    return client.validateRetrievalPlan(
      RetrievalPlanSchema.parse(input.plan ?? input),
      context,
    );
  if (command.mode === "verification_mutation") {
    if (command.useCase === "extractStructuredData")
      return client.extractStructuredData(
        ExtractStructuredDataRequestSchema.parse(input),
        context,
      );
    if (command.useCase === "compareBenchmarkRuns")
      return client.compareBenchmarkRuns(
        CompareBenchmarkRunsRequestSchema.parse(input),
        context,
      );
    if (command.useCase === "runBenchmark")
      return client.runBenchmark(
        RunBenchmarkRequestSchema.parse(input),
        context,
      );
    if (command.useCase === "verifyClaims")
      return client.verifyClaims(
        VerifyClaimsRequestSchema.parse(input),
        context,
      );
    if (command.useCase === "verifyReport")
      return client.verifyReport(
        VerifyReportRequestSchema.parse(input),
        context,
      );
    if (command.useCase === "verifyMetricObservation")
      return client.verifyMetricObservation(
        VerifyMetricObservationRequestSchema.parse(input),
        context,
      );
    if (command.useCase === "captureSource")
      return client.captureVerificationSource(
        CaptureSourceRequestSchema.parse(input),
        context,
      );
    if (command.useCase === "parseArtifact")
      return client.parseArtifact(
        ParseArtifactRequestSchema.parse(input),
        context,
      );
    if (command.useCase === "verifyExtraction")
      return client.verifyExtraction(
        VerifyExtractionRequestSchema.parse(input),
        context,
      );
    if (command.useCase === "requestAdjudication")
      return client.requestAdjudication(
        RequestAdjudicationRequestSchema.parse(input),
        context,
      );
    if (command.useCase === "recordAdjudicationDecision")
      return client.recordAdjudicationDecision(
        VerificationAdjudicationDecisionRequestSchema.parse(input),
        context,
      );
    if (command.useCase === "inspectAuditBundle")
      return client.inspectAuditBundle(
        InspectAuditBundleRequestSchema.parse(input),
        context,
      );
    return client.replayVerificationRun(
      ReplayRunRequestSchema.parse(input),
      context,
    );
  }
  if (command.mode === "control") {
    const id = requiredId(input, "operationId");
    return command.action === "retry"
      ? client.retryOperation(id, context)
      : client.reconcileOperation(id, context);
  }
  if (
    command.resource === "claims_result" ||
    command.resource === "report_result"
  ) {
    if (Object.keys(input).length !== 1)
      throw new Error("VERIFICATION_RESULT_READ_INPUT_INVALID");
    const operationId = UuidSchema.parse(input.operationId);
    return command.resource === "claims_result"
      ? client.getVerificationClaimsResult(operationId, context)
      : client.getVerificationReportResult(operationId, context);
  }
  if (command.resource === "audit_inspection") {
    if (Object.keys(input).length !== 1)
      throw new Error("AUDIT_INSPECTION_READ_INPUT_INVALID");
    return client.getAuditInspection(
      UuidSchema.parse(input.operationId),
      context,
    );
  }
  if (
    command.resource === "adjudication" ||
    command.resource === "adjudication_decision"
  ) {
    if (Object.keys(input).length !== 1)
      throw new Error("ADJUDICATION_READ_INPUT_INVALID");
    const operationId = UuidSchema.parse(input.operationId);
    return command.resource === "adjudication"
      ? client.getAdjudicationSubject(operationId, context)
      : client.getAdjudicationDecision(operationId, context);
  }
  if (command.resource === "structured_extraction") {
    if (Object.keys(input).length !== 1)
      throw new Error("EXTRACTION_READ_INPUT_INVALID");
    return client.getStructuredExtraction(
      UuidSchema.parse(input.operationId),
      context,
    );
  }
  if (command.resource === "benchmark_comparison") {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).length !== 1
    )
      throw new Error("COMPARISON_READ_INPUT_INVALID");
    return client.getBenchmarkComparison(
      UuidSchema.parse((input as Record<string, unknown>).comparisonId),
      context,
    );
  }
  if (
    command.resource === "benchmark_run" ||
    command.resource === "benchmark_manifest"
  ) {
    if (Object.keys(input).some((key) => key !== "runId"))
      throw new Error("CLI_BENCHMARK_READ_UNKNOWN_FIELD");
    const id = requiredId(input, "runId");
    return command.resource === "benchmark_run"
      ? client.getBenchmarkRun(id, context)
      : client.getBenchmarkRunManifest(id, context);
  }
  if (command.resource === "verification_cases") {
    if (
      Object.keys(input).some(
        (key) => !["runId", "pageSize", "cursor"].includes(key),
      )
    )
      throw new Error("CLI_CASE_READ_UNKNOWN_FIELD");
    const pageSize = input.pageSize;
    if (
      pageSize !== undefined &&
      (typeof pageSize !== "number" ||
        !Number.isInteger(pageSize) ||
        pageSize < 1 ||
        pageSize > 100)
    )
      throw new Error("CLI_CASE_PAGE_INVALID");
    return client.listVerificationRunCases(
      requiredId(input, "runId"),
      {
        ...(pageSize === undefined ? {} : { pageSize: pageSize as number }),
        ...(input.cursor === undefined
          ? {}
          : { cursor: UuidSchema.parse(input.cursor) }),
      },
      context,
    );
  }
  if (
    command.resource === "verification_case" ||
    command.resource === "verification_evidence"
  ) {
    const key =
      command.resource === "verification_case" ? "caseRunId" : "evidenceId";
    if (Object.keys(input).some((name) => name !== key))
      throw new Error("CLI_CASE_READ_UNKNOWN_FIELD");
    return command.resource === "verification_case"
      ? client.getVerificationCase(requiredId(input, key), context)
      : client.getVerificationEvidence(requiredId(input, key), context);
  }
  if (command.resource === "verification_operation") {
    if (Object.keys(input).some((name) => name !== "operationId"))
      throw new Error("CLI_OPERATION_READ_UNKNOWN_FIELD");
    return client.getVerificationOperation(
      requiredId(input, "operationId"),
      context,
    );
  }
  switch (command.resource) {
    case "verification_run":
      return client.getVerificationRun(requiredId(input, "runId"), context);
    case "verification_manifest":
      return client.getVerificationRunManifest(
        requiredId(input, "runId"),
        context,
      );
    case "vector_store":
      return client.getVectorStore(requiredId(input, "vectorStoreId"), context);
    case "vector_store_operation":
      return client.getVectorStoreOperation(
        requiredId(input, "vectorStoreId"),
        requiredId(input, "operationId"),
        context,
      );
    case "operation":
      return client.getOperation(requiredId(input, "operationId"), context);
    case "operation_events":
      return client.getOperationEvents(
        requiredId(input, "operationId"),
        context,
      );
    case "retrieval_explanation":
      return client.getRetrievalExplanation(
        requiredId(input, "runId"),
        context,
      );
    case "evaluation_failures":
      return client.getEvaluationFailures(requiredId(input, "runId"), context);
  }
}
