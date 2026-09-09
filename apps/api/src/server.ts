import {
  VerificationCaptureTerminalResourceSchema,
  VerificationProfileCaptureAcceptedSchema,
} from "@aiengineer/knowledge-contracts";
import {
  VerificationAdjudicationDecisionRequestSchema,
  type VerificationAdjudicationDecisionRequest,
} from "@aiengineer/knowledge-contracts";
import {
  VerificationAdjudicationDecisionTerminalResourceSchema,
  type VerificationAdjudicationDecisionTerminalResource,
} from "@aiengineer/knowledge-contracts";
import { isVerifiedEveRuntimeRetry } from "./verification-ownership.js";
import {
  ApplyProviderReconciliationRequestSchema,
  VerificationProviderReconciliationResourceSchema,
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
} from "@aiengineer/knowledge-contracts";
import {
  ParseArtifactRequestSchema,
  type ParseArtifactRequest,
} from "@aiengineer/knowledge-contracts";
import {
  AgenticKnowledgeService,
  createIntegrationService,
  createKnowledgeApplication,
  OperationCapabilityUnavailableError,
  VerificationOperationApplicationService,
  type KnowledgeIntegrationService,
  type KnowledgeOperationPort,
  type CallbackReplayStore,
  type VerificationCaseReadService,
  type VerificationBenchmarkReadService,
  type VerificationBenchmarkComparisonReadService,
} from "@aiengineer/knowledge-application";
import {
  EvidencePacketSchema,
  ArtifactResourceSchema,
  DurableReceiptResourceSchema,
  EvaluationFailuresResourceSchema,
  EvaluationReportResourceSchema,
  ExploratoryEvaluationInputSchema,
  MutationEnvelopeSchema,
  OperationKindSchema,
  OperationContextSchema,
  CaptureSourceRequestSchema,
  InspectAuditBundleRequestSchema,
  RequestAdjudicationRequestSchema,
  VerifyClaimsRequestSchema,
  VerifyReportRequestSchema,
  VerifyExtractionRequestSchema,
  ReplayRunRequestSchema,
  VerificationOperationContextHintsSchema,
  RetrievalPlanSchema,
  RetrievalRunInputSchema,
  RetrievalExplanationResourceSchema,
  RetrievalRunResourceSchema,
  VectorStoreResourceSchema,
  VectorStoreCreateInputSchema,
  VectorStoreDocumentsInputSchema,
  VectorStoreIngestionInputSchema,
  UuidSchema,
  VerificationClaimsTerminalResourceSchema,
  VerificationReportTerminalResourceSchema,
  VerificationAdjudicationTerminalResourceSchema,
  VerificationStructuredExtractionResourceSchema,
  VerificationAuditInspectionResourceSchema,
  VerificationBenchmarkComparisonResourceSchema,
  VerificationBenchmarkRunSummaryResourceSchema,
  VerificationBenchmarkRunManifestResourceSchema,
  VerificationRunSummaryResourceSchema,
  VerificationRunManifestResourceSchema,
  VerificationRunCasesResourceSchema,
  VerificationCaseResourceSchema,
  VerificationEvidenceResourceSchema,
  type EvidencePacket,
  type OperationKind,
  type OperationContext,
  type ProblemDetails,
  type VerificationOperationContextHints,
  type VerificationRunSummaryResource,
  type VerificationRunManifestResource,
  type VerifyClaimsRequest,
  type VerifyReportRequest,
  type InspectAuditBundleRequest,
  type RequestAdjudicationRequest,
} from "@aiengineer/knowledge-contracts";
import type { ResourceReadRepository } from "@aiengineer/knowledge-persistence";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { DeterministicFakeEmbeddingAdapter } from "@aiengineer/knowledge-embeddings";
import { loadEmbeddingBundles } from "@aiengineer/knowledge-testkit";
import { z, ZodError, type ZodType } from "zod";
import {
  actorsMatch,
  createLocalIdentityResolver,
  isAuthorized,
  requiredSubmissionAction,
  type ApiAction,
  type LocalApiIdentity,
  type ResolveApiIdentity,
} from "./auth.js";
import {
  registerA2AHttpRoutes,
  type ResolveCallbackSigningSecret,
} from "./a2a-http.js";
import type { CanonicalRetrievalExecutorPort } from "./retrieval-executor.js";

export interface ServerOptions {
  service?: KnowledgeIntegrationService;
  operationService?: KnowledgeOperationPort;
  retrievalOperationService?: KnowledgeOperationPort;
  resourceReader?: ResourceReadRepository;
  maximumResourceResponseBytes?: number;
  publicOrigin?: string;
  resolveIdentity?: ResolveApiIdentity;
  getEvidencePacket?: (
    tenantId: string,
    packetId: string,
  ) => EvidencePacket | undefined | Promise<EvidencePacket | undefined>;
  callbackReplayStore?: CallbackReplayStore;
  resolveCallbackSigningSecret?: ResolveCallbackSigningSecret;
  callbackClock?: () => Date;
  maximumCallbackAgeMs?: number;
  canonicalRetrievalExecutor?: CanonicalRetrievalExecutorPort;
  /** Dedicated verification operations remain unavailable unless both trusted ports are configured. */
  verificationOperationService?: KnowledgeOperationPort;
  verificationCaptureCatalog?: import("@aiengineer/knowledge-application").VerificationServiceCatalog;
  verificationCaseReads?: Pick<
    VerificationCaseReadService,
    "listRunCases" | "getCase" | "getEvidence"
  >;
  verificationBenchmarkReads?: Pick<
    VerificationBenchmarkReadService,
    "getRun" | "getManifest"
  >;
  verificationBenchmarkComparisonReads?: Pick<
    VerificationBenchmarkComparisonReadService,
    "getComparison"
  >;
  verificationProviderReconciliation?: NonNullable<
    ReturnType<
      typeof import("./verification-provider-reconciliation-runtime.js").createVerificationProviderReconciliationService
    >
  >;
  verificationSemanticReconciliation?: NonNullable<
    ReturnType<
      typeof import("./verification-semantic-reconciliation-runtime.js").createVerificationSemanticReconciliationService
    >
  >;
  verificationStructuredExtractionReads?: {
    getExtraction(input: {
      tenantId: string;
      operationId: string;
      actor: import("@aiengineer/knowledge-contracts").Actor;
    }): Promise<
      import("@aiengineer/knowledge-contracts").VerificationStructuredExtractionResource
    >;
  };
  verificationAuditInspectionReads?: {
    getInspection(input: {
      tenantId: string;
      operationId: string;
      actor: import("@aiengineer/knowledge-contracts").Actor;
    }): Promise<
      import("@aiengineer/knowledge-contracts").VerificationAuditInspectionResource
    >;
  };
  verificationAdjudicationReadService?: {
    getPendingSubject(input: {
      tenantId: string;
      operationId: string;
      actor: import("@aiengineer/knowledge-contracts").Actor;
    }): Promise<
      import("@aiengineer/knowledge-contracts").VerificationAdjudicationTerminalResource
    >;
  };
  verificationAdjudicationDecisionReadService?: {
    getDecision(input: {
      tenantId: string;
      operationId: string;
      actor: import("@aiengineer/knowledge-contracts").Actor;
    }): Promise<VerificationAdjudicationDecisionTerminalResource>;
  };
  /** Private, service-only drift queue. It is absent unless runtime policy config composes it. */
  verificationDriftRevalidation?: {
    readonly serviceIdentities: readonly string[];
    scan(input: {
      tenantId: string;
      limit: number;
    }): Promise<{ planned: number; alreadyPlanned: number }>;
    claim(input: {
      tenantId: string;
      owner: string;
      limit: number;
      visibilityTimeoutMs: number;
    }): Promise<
      readonly {
        id: string;
        observationArtifactId: string;
        sourceOperationId: string;
        dimensions: readonly string[];
        disposition: "revalidate" | "review_required";
        reviewReason?: string;
        claimToken: string;
      }[]
    >;
    ack(input: {
      tenantId: string;
      id: string;
      owner: string;
      claimToken: string;
    }): Promise<void>;
    listAlerts(input: {
      tenantId: string;
      limit: number;
    }): Promise<
      readonly {
        id: string;
        observationArtifactId: string;
        sourceOperationId: string;
        dimensions: readonly string[];
        reviewReason: string;
        publishedAt: string;
      }[]
    >;
  };
  isAdjudicationDecisionReadAdmitted?: (input: {
    tenantId: string;
    operationId: string;
    actor: import("@aiengineer/knowledge-contracts").Actor;
  }) => Promise<boolean>;
  verificationCaptureReads?: {
    getCapture(input: {
      tenantId: string;
      operationId: string;
      actor: import("@aiengineer/knowledge-contracts").Actor;
    }): Promise<
      import("@aiengineer/knowledge-contracts").VerificationCaptureTerminalResource
    >;
  };
  verificationClaimsReportReads?: {
    getClaims(input: {
      tenantId: string;
      operationId: string;
      actor: import("@aiengineer/knowledge-contracts").Actor;
    }): Promise<
      import("@aiengineer/knowledge-contracts").VerificationClaimsTerminalResource
    >;
    getReport(input: {
      tenantId: string;
      operationId: string;
      actor: import("@aiengineer/knowledge-contracts").Actor;
    }): Promise<
      import("@aiengineer/knowledge-contracts").VerificationReportTerminalResource
    >;
  };
  verificationReads?: {
    getRun(input: {
      tenantId: string;
      runId: string;
    }): Promise<VerificationRunSummaryResource>;
    getRunManifest(input: {
      tenantId: string;
      runId: string;
    }): Promise<VerificationRunManifestResource>;
  };
  isStructuredExtractionRequestAdmitted?: (
    tenantId: string,
    request: ExtractStructuredDataRequest,
  ) => boolean;
  isBenchmarkRequestAdmitted?: (
    tenantId: string,
    request: RunBenchmarkRequest,
  ) => boolean;
  isBenchmarkComparisonRequestAdmitted?: (
    tenantId: string,
    request: CompareBenchmarkRunsRequest,
  ) => boolean;
  isClaimsRequestAdmitted?: (
    tenantId: string,
    request: VerifyClaimsRequest | VerifyReportRequest,
  ) => boolean;
  isAuditInspectionRequestAdmitted?: (
    tenantId: string,
    request: InspectAuditBundleRequest,
  ) => boolean | Promise<boolean>;
  isAdjudicationRequestAdmitted?: (
    tenantId: string,
    request: RequestAdjudicationRequest,
  ) => boolean | Promise<boolean>;
  isAdjudicationDecisionAdmitted?: (input: {
    request: VerificationAdjudicationDecisionRequest;
    context: OperationContext;
  }) => boolean | Promise<boolean>;
  /** Exact trusted capture grants are checked before an operation is enqueued. */
  isParseArtifactRequestAdmitted?: (
    tenantId: string,
    request: ParseArtifactRequest,
  ) => boolean;
  resolveVerificationBenchmarkCaptureProfile?: (input: {
    profileName: string;
    identity: LocalApiIdentity;
    correlationId: string;
    idempotencyKey: string;
  }) => Promise<OperationContext | undefined>;
  resolveVerificationContext?: (input: {
    readonly request: FastifyRequest;
    readonly tenantId: string;
    readonly identity: LocalApiIdentity;
    readonly correlationId: string;
    readonly idempotencyKey: string;
    readonly useCase:
      | "captureSource"
      | "parseArtifact"
      | "verifyExtraction"
      | "verifyClaims"
      | "verifyReport"
      | "requestAdjudication"
      | "recordAdjudicationDecision"
      | "inspectAuditBundle"
      | "verifyMetricObservation"
      | "replayRun"
      | "runBenchmark"
      | "compareBenchmarkRuns"
      | "extractStructuredData";
    readonly hints: VerificationOperationContextHints;
  }) => OperationContext | undefined | Promise<OperationContext | undefined>;
  /** Test/contract hook invoked for every route registered with Fastify. */
  observeRoute?: (method: string, path: string) => void;
}
type Params = { id: string };
const collectionKinds: Record<string, OperationKind> = {
  "vector-stores": "vector_store_create",
  captures: "capture",
  documents: "document",
  "document-versions": "document_version",
  representations: "representation",
  "promotion-proposals": "promotion_proposal",
  "promotion-decisions": "promotion_decision",
  "embedding-runs": "embedding_run",
  "space-publications": "space_publication",
  "eval-datasets": "evaluation_dataset",
  experiments: "experiment",
  "eval-runs": "evaluation_run",
  reviews: "review",
  "review-decisions": "review_decision",
};
const operationInputSchemas: Partial<Record<OperationKind, ZodType>> = {
  vector_store_create: VectorStoreCreateInputSchema,
  vector_store_documents: VectorStoreDocumentsInputSchema,
  vector_store_ingestion: VectorStoreIngestionInputSchema,
};
function correlationId(request: FastifyRequest) {
  const value = request.headers["x-correlation-id"];
  return typeof value === "string" && value.trim()
    ? value.slice(0, 255)
    : randomUUID();
}
function tenantId(request: FastifyRequest) {
  const value = request.headers["x-tenant-id"];
  return typeof value === "string" ? value : undefined;
}
function problem(
  status: number,
  code: ProblemDetails["code"],
  title: string,
  correlation: string,
  detail?: string,
  issues?: ProblemDetails["issues"],
): ProblemDetails {
  return {
    type: `https://knowledge.aiengineer.dev/problems/${code.toLowerCase().replaceAll("_", "-")}`,
    title,
    status,
    code,
    correlationId: correlation,
    ...(detail ? { detail } : {}),
    ...(issues?.length ? { issues } : {}),
  };
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const server = Fastify({ logger: false });
  if (options.observeRoute)
    server.addHook("onRoute", (route) => {
      const methods = Array.isArray(route.method)
        ? route.method
        : [route.method];
      for (const method of methods) options.observeRoute?.(method, route.url);
    });
  const application = createKnowledgeApplication();
  const service = options.service ?? createIntegrationService();
  const operationService = options.operationService ?? service;
  const retrievalOperationService =
    options.retrievalOperationService ?? operationService;
  const resolveIdentity =
    options.resolveIdentity ?? createLocalIdentityResolver();
  server.addHook("onRequest", async (request, reply) => {
    const id = correlationId(request);
    request.headers["x-correlation-id"] = id;
    reply.header("x-correlation-id", id);
  });
  server.setErrorHandler((error, request, reply) => {
    const correlation = correlationId(request);
    if (error instanceof OperationCapabilityUnavailableError)
      return reply
        .status(503)
        .type("application/problem+json")
        .send(
          problem(
            503,
            "CAPABILITY_NOT_ADMITTED",
            "Operation capability unavailable",
            correlation,
          ),
        );
    if (error instanceof ZodError)
      return reply
        .status(400)
        .type("application/problem+json")
        .send(
          problem(
            400,
            "INVALID_CONTRACT",
            "Request contract validation failed",
            correlation,
            "The request does not match the v1 contract.",
            error.issues.slice(0, 25).map((issue) => ({
              path: issue.path.join(".") || "$",
              message: issue.message,
            })),
          ),
        );
    const message = error instanceof Error ? error.message : "Internal error";
    if (message === "IDEMPOTENCY_CONFLICT")
      return reply
        .status(409)
        .type("application/problem+json")
        .send(
          problem(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Idempotency conflict",
            correlation,
          ),
        );
    if (message === "INVALID_STATE_TRANSITION")
      return reply
        .status(409)
        .type("application/problem+json")
        .send(
          problem(
            409,
            "INVALID_STATE_TRANSITION",
            "Invalid state transition",
            correlation,
          ),
        );
    if (message === "RESOURCE_INTEGRITY_CONFLICT")
      return reply
        .status(409)
        .type("application/problem+json")
        .send(
          problem(
            409,
            "CONFLICT",
            "Stored resource failed its integrity checks",
            correlation,
          ),
        );
    if (message === "RESOURCE_RESPONSE_LIMIT_EXCEEDED")
      return reply
        .status(413)
        .type("application/problem+json")
        .send(
          problem(
            413,
            "LIMIT_EXCEEDED",
            "Stored resource exceeds the bounded response contract",
            correlation,
          ),
        );
    if (
      message.startsWith("RETRIEVAL_") ||
      message.startsWith("NO_ACTIVE_PUBLISHED_")
    )
      return reply
        .status(409)
        .type("application/problem+json")
        .send(
          problem(
            409,
            "CONFLICT",
            "Retrieval request is not executable under the active policy",
            correlation,
          ),
        );
    if (message.startsWith("AI_GATEWAY_"))
      return reply
        .status(503)
        .type("application/problem+json")
        .send(
          problem(
            503,
            "INTERNAL_ERROR",
            "Retrieval embedding provider unavailable",
            correlation,
          ),
        );
    return reply
      .status(500)
      .type("application/problem+json")
      .send(
        problem(500, "INTERNAL_ERROR", "Internal service error", correlation),
      );
  });
  const requireTenant = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const tenant = tenantId(request);
    if (!tenant) {
      await reply
        .status(400)
        .type("application/problem+json")
        .send(
          problem(
            400,
            "INVALID_CONTRACT",
            "Tenant context required",
            correlationId(request),
            "x-tenant-id is required.",
          ),
        );
      return undefined;
    }
    return tenant;
  };
  const requireAccess = async (
    request: FastifyRequest,
    reply: FastifyReply,
    action: ApiAction,
  ): Promise<{ tenant: string; identity: LocalApiIdentity } | undefined> => {
    const auth = request.headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
    const identity = token ? await resolveIdentity(token) : undefined;
    if (!identity) {
      await reply
        .status(401)
        .type("application/problem+json")
        .send(
          problem(
            401,
            "UNAUTHORIZED",
            "Authentication required",
            correlationId(request),
          ),
        );
      return undefined;
    }
    const tenant = await requireTenant(request, reply);
    if (!tenant) return undefined;
    if (!isAuthorized(identity, tenant, action)) {
      await reply
        .status(403)
        .type("application/problem+json")
        .send(
          problem(
            403,
            "FORBIDDEN",
            "Action is not authorized",
            correlationId(request),
          ),
        );
      return undefined;
    }
    return { tenant, identity };
  };
  const requireEnvelopeActor = (
    identity: LocalApiIdentity,
    envelope: ReturnType<typeof MutationEnvelopeSchema.parse>,
    request: FastifyRequest,
    reply: FastifyReply,
  ) =>
    actorsMatch(identity.actor, envelope.context.actor)
      ? true
      : reply
          .status(403)
          .type("application/problem+json")
          .send(
            problem(
              403,
              "FORBIDDEN",
              "Authenticated actor does not match operation actor",
              correlationId(request),
            ),
          );
  const origin = (request: FastifyRequest) =>
    options.publicOrigin ??
    `${request.protocol}://${request.headers.host ?? "localhost"}`;
  const requireResourceReader = (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    if (options.resourceReader) return options.resourceReader;
    void reply
      .status(503)
      .type("application/problem+json")
      .send(
        problem(
          503,
          "INTERNAL_ERROR",
          "Canonical resource store unavailable",
          correlationId(request),
        ),
      );
    return undefined;
  };
  const boundedResource = (
    request: FastifyRequest,
    reply: FastifyReply,
    value: unknown,
  ) => {
    const maximumBytes = options.maximumResourceResponseBytes ?? 1_048_576;
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1)
      throw new Error("INVALID_RESOURCE_RESPONSE_LIMIT");
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > maximumBytes)
      return reply
        .status(413)
        .type("application/problem+json")
        .send(
          problem(
            413,
            "LIMIT_EXCEEDED",
            "Stored resource exceeds the bounded response contract",
            correlationId(request),
          ),
        );
    return value;
  };
  const verificationContext = async (
    request: FastifyRequest,
    reply: FastifyReply,
    useCase:
      | "captureSource"
      | "parseArtifact"
      | "verifyExtraction"
      | "verifyClaims"
      | "verifyReport"
      | "requestAdjudication"
      | "recordAdjudicationDecision"
      | "inspectAuditBundle"
      | "verifyMetricObservation"
      | "replayRun"
      | "runBenchmark"
      | "compareBenchmarkRuns"
      | "extractStructuredData",
  ) => {
    const access = await requireAccess(request, reply, "operation.submit");
    if (!access) return undefined;
    if (
      !options.verificationOperationService ||
      !options.resolveVerificationContext
    ) {
      await reply
        .status(503)
        .type("application/problem+json")
        .send(
          problem(
            503,
            "CAPABILITY_NOT_ADMITTED",
            "Verification operation unavailable",
            correlationId(request),
          ),
        );
      return undefined;
    }
    const raw = request.headers["idempotency-key"],
      idempotencyKey = typeof raw === "string" ? raw.trim() : "";
    if (idempotencyKey.length < 8 || idempotencyKey.length > 255) {
      await reply
        .status(400)
        .type("application/problem+json")
        .send(
          problem(
            400,
            "INVALID_CONTRACT",
            "Idempotency key required",
            correlationId(request),
          ),
        );
      return undefined;
    }
    const header = (name: string): string | undefined => {
      const value = request.headers[name];
      if (value === undefined) return undefined;
      if (typeof value !== "string" || value.trim() === "")
        throw new ZodError([]);
      return value.trim();
    };
    const externalHeaders = Object.fromEntries(
      Object.entries({
        runtime: header("x-external-runtime"),
        runId: header("x-external-run-id"),
        rootRunId: header("x-external-root-run-id"),
        sessionId: header("x-external-session-id"),
        turnId: header("x-external-turn-id"),
        toolCallId: header("x-external-tool-call-id"),
      }).filter(([, value]) => value !== undefined),
    );
    const hasExternal = Object.values(externalHeaders).some(
      (value) => value !== undefined,
    );
    const hints = VerificationOperationContextHintsSchema.parse({
      attemptId: header("x-verification-attempt-id"),
      workItemId: header("x-verification-work-item-id"),
      missionId: header("x-verification-mission-id"),
      causationId: header("x-causation-id"),
      ...(hasExternal ? { externalExecution: externalHeaders } : {}),
    });
    const resolved = await options.resolveVerificationContext({
      request,
      tenantId: access.tenant,
      identity: access.identity,
      correlationId: correlationId(request),
      idempotencyKey,
      useCase,
      hints,
    });
    if (!resolved) {
      await reply
        .status(403)
        .type("application/problem+json")
        .send(
          problem(
            403,
            "FORBIDDEN",
            "Verification operation ownership denied",
            correlationId(request),
          ),
        );
      return undefined;
    }
    const context = OperationContextSchema.parse(resolved);
    if (
      context.tenantId !== access.tenant ||
      context.correlationId !== correlationId(request) ||
      context.idempotencyKey !== idempotencyKey ||
      !actorsMatch(access.identity.actor, context.actor)
    ) {
      await reply
        .status(403)
        .type("application/problem+json")
        .send(
          problem(
            403,
            "FORBIDDEN",
            "Trusted verification context mismatch",
            correlationId(request),
          ),
        );
      return undefined;
    }
    for (const key of [
      "attemptId",
      "workItemId",
      "missionId",
      "causationId",
    ] as const)
      if (hints[key] !== undefined && context[key] !== hints[key]) {
        await reply
          .status(403)
          .type("application/problem+json")
          .send(
            problem(
              403,
              "FORBIDDEN",
              "Trusted verification ownership binding mismatch",
              correlationId(request),
            ),
          );
        return undefined;
      }
    // Only the production resolver can attest a newly observed Eve invocation
    // and bind it to the original immutable operation context for a retry.
    if (
      hints.externalExecution !== undefined &&
      JSON.stringify(context.externalExecution) !==
        JSON.stringify(hints.externalExecution) &&
      !isVerifiedEveRuntimeRetry(request, context)
    ) {
      await reply
        .status(403)
        .type("application/problem+json")
        .send(
          problem(
            403,
            "FORBIDDEN",
            "Trusted external execution binding mismatch",
            correlationId(request),
          ),
        );
      return undefined;
    }
    return {
      access,
      context,
      service: new VerificationOperationApplicationService(
        options.verificationOperationService,
        origin(request),
        options.verificationCaptureCatalog,
      ),
    };
  };
  const validatedStoredResource = <T>(
    schema: ZodType<T>,
    value: unknown,
  ): T => {
    const result = schema.safeParse(value);
    if (!result.success)
      throw new Error("RESOURCE_INTEGRITY_CONFLICT", { cause: result.error });
    return result.data;
  };
  const submit = async (
    request: FastifyRequest,
    reply: FastifyReply,
    kind: OperationKind,
    pathVectorStoreId?: string,
  ) => {
    const access = await requireAccess(
      request,
      reply,
      requiredSubmissionAction(kind),
    );
    if (!access) return;
    const envelope = MutationEnvelopeSchema.parse(request.body);
    operationInputSchemas[kind]?.parse(envelope.input);
    if (access.tenant !== envelope.context.tenantId)
      return reply
        .status(403)
        .type("application/problem+json")
        .send(
          problem(
            403,
            "FORBIDDEN",
            "Tenant context mismatch",
            correlationId(request),
          ),
        );
    if (
      requireEnvelopeActor(access.identity, envelope, request, reply) !== true
    )
      return;
    if (envelope.context.correlationId !== correlationId(request))
      return reply
        .status(400)
        .type("application/problem+json")
        .send(
          problem(
            400,
            "INVALID_CONTRACT",
            "Correlation context mismatch",
            correlationId(request),
          ),
        );
    if (pathVectorStoreId) {
      const input = envelope.input as { vectorStoreId?: unknown };
      if (input.vectorStoreId !== UuidSchema.parse(pathVectorStoreId))
        return reply
          .status(400)
          .type("application/problem+json")
          .send(
            problem(
              400,
              "INVALID_CONTRACT",
              "Path vector store does not match operation input",
              correlationId(request),
            ),
          );
    }
    return reply
      .status(202)
      .send(await operationService.submit(kind, envelope, origin(request)));
  };

  registerA2AHttpRoutes(server, {
    operationService,
    retrievalOperationService,
    ...(options.canonicalRetrievalExecutor
      ? { canonicalRetrievalExecutor: options.canonicalRetrievalExecutor }
      : {}),
    requireAccess,
    correlationId,
    origin,
    problem,
    ...(options.callbackReplayStore
      ? { callbackReplayStore: options.callbackReplayStore }
      : {}),
    ...(options.resolveCallbackSigningSecret
      ? { resolveCallbackSigningSecret: options.resolveCallbackSigningSecret }
      : {}),
    ...(options.callbackClock ? { callbackClock: options.callbackClock } : {}),
    ...(options.maximumCallbackAgeMs
      ? { maximumCallbackAgeMs: options.maximumCallbackAgeMs }
      : {}),
  });

  server.get("/health", async () => ({ status: "ok" }));
  const driftConsumer = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const scoped = await requireAccess(
      request,
      reply,
      "verification.drift.consume",
    );
    if (!scoped) return;
    const runtime = options.verificationDriftRevalidation;
    if (!runtime) {
      await reply
        .status(503)
        .type("application/problem+json")
        .send(
          problem(
            503,
            "CAPABILITY_NOT_ADMITTED",
            "Drift consumer unavailable",
            correlationId(request),
          ),
        );
      return undefined;
    }
    const actor = scoped.identity.actor;
    const explicitScope = scoped.identity.grants.some(
      (grant) =>
        grant.tenantId === scoped.tenant &&
        grant.scopes.includes("verification.drift.consume"),
    );
    if (
      !explicitScope ||
      actor.kind !== "service" ||
      !runtime.serviceIdentities.includes(actor.serviceIdentity)
    ) {
      await reply
        .status(403)
        .type("application/problem+json")
        .send(
          problem(
            403,
            "FORBIDDEN",
            "Service identity is not admitted",
            correlationId(request),
          ),
        );
      return undefined;
    }
    return { tenant: scoped.tenant, owner: actor.serviceIdentity, runtime };
  };
  const driftClaimSchema = z.strictObject({
    limit: z.number().int().min(1).max(100),
    visibilityTimeoutMs: z.number().int().min(1000).max(900000),
  });
  const driftAckSchema = z.strictObject({ id: z.uuid(), claimToken: z.uuid() });
  const driftScanSchema = z.strictObject({
    limit: z.number().int().min(1).max(100),
  });
  const driftDimensionSchema = z.enum([
    "provider",
    "model",
    "parser",
    "grader",
    "policy",
  ]);
  const driftReasonSchema = z.string().regex(/^[A-Z0-9_]{1,128}$/);
  const driftScanResponseSchema = z.strictObject({
    planned: z.number().int().min(0).max(100),
    alreadyPlanned: z.number().int().min(0).max(100),
  });
  const driftClaimItemSchema = z.object({
    id: z.uuid(),
    observationArtifactId: z.uuid(),
    sourceOperationId: z.uuid(),
    dimensions: z.array(driftDimensionSchema).min(1).max(5),
    disposition: z.literal("review_required"),
    reviewReason: driftReasonSchema,
    claimToken: z.uuid(),
  });
  const driftAlertItemSchema = z.object({
    id: z.uuid(),
    observationArtifactId: z.uuid(),
    sourceOperationId: z.uuid(),
    dimensions: z.array(driftDimensionSchema).min(1).max(5),
    reviewReason: driftReasonSchema,
    publishedAt: z.string().datetime({ offset: true }),
  });
  server.post(
    "/v1/internal/verification/drift-revalidations/scan",
    async (request, reply) => {
      const scoped = await driftConsumer(request, reply);
      if (!scoped) return;
      const output = driftScanResponseSchema.parse(
        await scoped.runtime.scan({
          tenantId: scoped.tenant,
          ...driftScanSchema.parse(request.body),
        }),
      );
      return { planned: output.planned, alreadyPlanned: output.alreadyPlanned };
    },
  );
  server.post(
    "/v1/internal/verification/drift-revalidations/claim",
    async (request, reply) => {
      const scoped = await driftConsumer(request, reply);
      if (!scoped) return;
      const items = z
        .array(driftClaimItemSchema)
        .max(100)
        .parse(
          await scoped.runtime.claim({
            tenantId: scoped.tenant,
            owner: scoped.owner,
            ...driftClaimSchema.parse(request.body),
          }),
        );
      return {
        items: items.map((item) => ({
          id: item.id,
          observationArtifactId: item.observationArtifactId,
          sourceOperationId: item.sourceOperationId,
          dimensions: item.dimensions,
          disposition: item.disposition,
          reviewReason: item.reviewReason,
          claimToken: item.claimToken,
        })),
      };
    },
  );
  server.post(
    "/v1/internal/verification/drift-revalidations/ack",
    async (request, reply) => {
      const scoped = await driftConsumer(request, reply);
      if (!scoped) return;
      const body = driftAckSchema.parse(request.body);
      await scoped.runtime.ack({
        tenantId: scoped.tenant,
        owner: scoped.owner,
        ...body,
      });
      return { acknowledged: true };
    },
  );
  server.get(
    "/v1/internal/verification/drift-alerts",
    async (request, reply) => {
      const scoped = await driftConsumer(request, reply);
      if (!scoped) return;
      const query = z
        .strictObject({ limit: z.coerce.number().int().min(1).max(100) })
        .parse(request.query);
      const items = z
        .array(driftAlertItemSchema)
        .max(100)
        .parse(
          await scoped.runtime.listAlerts({
            tenantId: scoped.tenant,
            ...query,
          }),
        );
      return {
        items: items.map((item) => ({
          id: item.id,
          observationArtifactId: item.observationArtifactId,
          sourceOperationId: item.sourceOperationId,
          dimensions: item.dimensions,
          reviewReason: item.reviewReason,
          publishedAt: item.publishedAt,
        })),
      };
    },
  );
  server.get("/readiness", async () => application.getStatus());
  server.get("/v1/system", async (request, reply) =>
    (await requireAccess(request, reply, "system.read"))
      ? application.getStatus()
      : undefined,
  );
  server.get("/v1/operations", async (request, reply) => {
    const access = await requireAccess(request, reply, "knowledge.read");
    if (!access) return;
    return {
      items: await operationService.list(access.tenant),
      nextCursor: null,
    };
  });
  for (const host of ["claims", "report"] as const)
    for (const method of ["GET", "POST"] as const) {
      server.route<{
        Params: { operationId: string; providerAttemptId: string };
      }>({
        method,
        url: `/v1/verification/${host === "claims" ? "claims" : "reports"}/:operationId/provider-attempts/:providerAttemptId/reconciliation`,
        handler: async (request, reply) => {
          const access = await requireAccess(
            request,
            reply,
            method === "GET" ? "knowledge.read" : "operation.submit",
          );
          if (!access) return;
          z.strictObject({}).parse(request.query);
          const scoped = {
            tenantId: access.tenant,
            actor: access.identity.actor,
            host,
            operationId: UuidSchema.parse(request.params.operationId),
            providerAttemptId: UuidSchema.parse(
              request.params.providerAttemptId,
            ),
          };
          const body =
            method === "POST"
              ? ApplyProviderReconciliationRequestSchema.parse(request.body)
              : undefined;
          if (!options.verificationSemanticReconciliation)
            return reply
              .status(503)
              .type("application/problem+json")
              .send(
                problem(
                  503,
                  "CAPABILITY_NOT_ADMITTED",
                  "Reconciliation unavailable",
                  correlationId(request),
                ),
              );
          try {
            const resource =
              VerificationProviderReconciliationResourceSchema.parse(
                body
                  ? await options.verificationSemanticReconciliation.applyDecision(
                      { ...scoped, ...body },
                    )
                  : await options.verificationSemanticReconciliation.getDecision(
                      scoped,
                    ),
              );
            if (
              resource.tenantId !== scoped.tenantId ||
              resource.operationId !== scoped.operationId ||
              resource.providerAttemptId !== scoped.providerAttemptId
            )
              throw new Error(
                "VERIFICATION_PROVIDER_RECONCILIATION_READ_SCOPE_MISMATCH",
              );
            return boundedResource(request, reply, resource);
          } catch (error) {
            const missing =
              error instanceof Error &&
              "code" in error &&
              error.code === "NOT_FOUND";
            return reply
              .status(missing ? 404 : 503)
              .type("application/problem+json")
              .send(
                problem(
                  missing ? 404 : 503,
                  missing ? "NOT_FOUND" : "INTERNAL_ERROR",
                  missing
                    ? "Reconciliation not found"
                    : "Reconciliation unavailable",
                  correlationId(request),
                ),
              );
          }
        },
      });
    }
  for (const method of ["GET", "POST"] as const) {
    server.route<{
      Params: { operationId: string; providerAttemptId: string };
    }>({
      method,
      url: "/v1/verification/extractions/:operationId/provider-attempts/:providerAttemptId/reconciliation",
      handler: async (request, reply) => {
        const access = await requireAccess(
          request,
          reply,
          method === "GET" ? "knowledge.read" : "operation.submit",
        );
        if (!access) return;
        z.strictObject({}).parse(request.query);
        const scoped = {
          tenantId: access.tenant,
          actor: access.identity.actor,
          operationId: UuidSchema.parse(request.params.operationId),
          providerAttemptId: UuidSchema.parse(request.params.providerAttemptId),
        };
        const body =
          method === "POST"
            ? ApplyProviderReconciliationRequestSchema.parse(request.body)
            : undefined;
        if (!options.verificationProviderReconciliation)
          return reply
            .status(503)
            .type("application/problem+json")
            .send(
              problem(
                503,
                "CAPABILITY_NOT_ADMITTED",
                "Reconciliation unavailable",
                correlationId(request),
              ),
            );
        try {
          const resource =
            VerificationProviderReconciliationResourceSchema.parse(
              body
                ? await options.verificationProviderReconciliation.applyDecision(
                    { ...scoped, ...body },
                  )
                : await options.verificationProviderReconciliation.getDecision(
                    scoped,
                  ),
            );
          if (
            resource.tenantId !== scoped.tenantId ||
            resource.operationId !== scoped.operationId ||
            resource.providerAttemptId !== scoped.providerAttemptId
          )
            throw new Error(
              "VERIFICATION_PROVIDER_RECONCILIATION_READ_SCOPE_MISMATCH",
            );
          return boundedResource(request, reply, resource);
        } catch (error) {
          const missing =
            error instanceof Error &&
            "code" in error &&
            error.code === "NOT_FOUND";
          return reply
            .status(missing ? 404 : 503)
            .type("application/problem+json")
            .send(
              problem(
                missing ? 404 : 503,
                missing ? "NOT_FOUND" : "INTERNAL_ERROR",
                missing
                  ? "Reconciliation not found"
                  : "Reconciliation unavailable",
                correlationId(request),
              ),
            );
        }
      },
    });
  }
  server.get<{ Params: { operationId: string } }>(
    "/v1/verification/extractions/:operationId",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      z.strictObject({}).parse(request.query);
      const operationId = UuidSchema.parse(request.params.operationId);
      if (!options.verificationStructuredExtractionReads)
        return reply
          .status(503)
          .type("application/problem+json")
          .send(
            problem(
              503,
              "CAPABILITY_NOT_ADMITTED",
              "Extraction reads unavailable",
              correlationId(request),
            ),
          );
      try {
        const resource = VerificationStructuredExtractionResourceSchema.parse(
          await options.verificationStructuredExtractionReads.getExtraction({
            tenantId: access.tenant,
            operationId,
            actor: access.identity.actor,
          }),
        );
        if (
          resource.tenantId !== access.tenant ||
          resource.operationId !== operationId
        )
          throw new Error("VERIFICATION_EXTRACTION_READ_SCOPE_MISMATCH");
        return boundedResource(request, reply, resource);
      } catch (error) {
        const missing =
          error instanceof Error &&
          "code" in error &&
          error.code === "NOT_FOUND";
        return reply
          .status(missing ? 404 : 503)
          .type("application/problem+json")
          .send(
            problem(
              missing ? 404 : 503,
              missing ? "NOT_FOUND" : "INTERNAL_ERROR",
              missing
                ? "Extraction not found"
                : "Extraction integrity unavailable",
              correlationId(request),
            ),
          );
      }
    },
  );
  server.get<{ Params: { operationId: string } }>(
    "/v1/verification/audit-inspections/:operationId",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      z.strictObject({}).parse(request.query);
      const operationId = UuidSchema.parse(request.params.operationId);
      if (!options.verificationAuditInspectionReads)
        return reply
          .status(503)
          .type("application/problem+json")
          .send(
            problem(
              503,
              "CAPABILITY_NOT_ADMITTED",
              "Audit inspection reads unavailable",
              correlationId(request),
            ),
          );
      try {
        const resource = VerificationAuditInspectionResourceSchema.parse(
          await options.verificationAuditInspectionReads.getInspection({
            tenantId: access.tenant,
            operationId,
            actor: access.identity.actor,
          }),
        );
        if (
          resource.tenantId !== access.tenant ||
          resource.operationId !== operationId
        )
          throw new Error("VERIFICATION_AUDIT_INSPECTION_READ_SCOPE_MISMATCH");
        return boundedResource(request, reply, resource);
      } catch (error) {
        const code =
          error instanceof Error &&
          "code" in error &&
          typeof error.code === "string"
            ? error.code
            : "INTEGRITY";
        const status =
          code === "NOT_FOUND"
            ? 404
            : code === "PENDING"
              ? 409
              : code === "FAILED" || code === "CANCELLED"
                ? 422
                : 503;
        const problemCode =
          status === 404
            ? "NOT_FOUND"
            : status === 409
              ? "CONFLICT"
              : status === 422
                ? "INVALID_STATE_TRANSITION"
                : "INTERNAL_ERROR";
        return reply
          .status(status)
          .type("application/problem+json")
          .send(
            problem(
              status,
              problemCode,
              status === 404
                ? "Audit inspection not found"
                : status === 409
                  ? "Audit inspection is not terminal"
                  : status === 422
                    ? `Audit inspection terminal state: ${code.toLowerCase()}`
                    : "Audit inspection integrity unavailable",
              correlationId(request),
            ),
          );
      }
    },
  );
  server.get<{ Params: { operationId: string } }>(
    "/v1/verification/adjudication-decisions/:operationId",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      z.strictObject({}).parse(request.query);
      const operationId = UuidSchema.parse(request.params.operationId);
      if (
        !options.verificationAdjudicationDecisionReadService ||
        !options.isAdjudicationDecisionReadAdmitted
      )
        return reply
          .status(503)
          .type("application/problem+json")
          .send(
            problem(
              503,
              "CAPABILITY_NOT_ADMITTED",
              "Decision reads unavailable",
              correlationId(request),
            ),
          );
      try {
        if (
          !(await options.isAdjudicationDecisionReadAdmitted({
            tenantId: access.tenant,
            operationId,
            actor: access.identity.actor,
          }))
        )
          return reply
            .status(404)
            .type("application/problem+json")
            .send(
              problem(
                404,
                "NOT_FOUND",
                "Decision not found",
                correlationId(request),
              ),
            );
        const resource =
          VerificationAdjudicationDecisionTerminalResourceSchema.parse(
            await options.verificationAdjudicationDecisionReadService.getDecision(
              {
                tenantId: access.tenant,
                operationId,
                actor: access.identity.actor,
              },
            ),
          );
        if (
          resource.tenantId !== access.tenant ||
          resource.operationId !== operationId
        )
          throw new Error("DECISION_READ_SCOPE_MISMATCH");
        return boundedResource(request, reply, resource);
      } catch (error) {
        const code =
          error instanceof Error && "code" in error
            ? String(error.code)
            : "INTEGRITY";
        const status =
          code === "NOT_FOUND"
            ? 404
            : code === "PENDING"
              ? 409
              : code === "FAILED" || code === "CANCELLED"
                ? 422
                : 503;
        return reply
          .status(status)
          .type("application/problem+json")
          .send(
            problem(
              status,
              status === 404
                ? "NOT_FOUND"
                : status === 409
                  ? "CONFLICT"
                  : status === 422
                    ? "INVALID_STATE_TRANSITION"
                    : "INTERNAL_ERROR",
              status === 404
                ? "Decision not found"
                : status === 409
                  ? "Decision is not terminal"
                  : status === 422
                    ? "Decision did not succeed"
                    : "Decision integrity unavailable",
              correlationId(request),
            ),
          );
      }
    },
  );
  server.get<{ Params: { operationId: string } }>(
    "/v1/verification/adjudications/:operationId",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      z.strictObject({}).parse(request.query);
      const operationId = UuidSchema.parse(request.params.operationId);
      if (!options.verificationAdjudicationReadService)
        return reply
          .status(503)
          .type("application/problem+json")
          .send(
            problem(
              503,
              "CAPABILITY_NOT_ADMITTED",
              "Adjudication reads unavailable",
              correlationId(request),
            ),
          );
      try {
        const resource = VerificationAdjudicationTerminalResourceSchema.parse(
          await options.verificationAdjudicationReadService.getPendingSubject({
            tenantId: access.tenant,
            operationId,
            actor: access.identity.actor,
          }),
        );
        if (
          resource.tenantId !== access.tenant ||
          resource.operationId !== operationId
        )
          throw new Error("VERIFICATION_ADJUDICATION_READ_SCOPE_MISMATCH");
        return boundedResource(request, reply, resource);
      } catch (error) {
        const code =
          error instanceof Error &&
          "code" in error &&
          typeof error.code === "string"
            ? error.code
            : "INTEGRITY";
        const status =
          code === "NOT_FOUND"
            ? 404
            : code === "PENDING"
              ? 409
              : code === "FAILED" || code === "CANCELLED"
                ? 422
                : 503;
        return reply
          .status(status)
          .type("application/problem+json")
          .send(
            problem(
              status,
              status === 404
                ? "NOT_FOUND"
                : status === 409
                  ? "CONFLICT"
                  : status === 422
                    ? "INVALID_STATE_TRANSITION"
                    : "INTERNAL_ERROR",
              status === 404
                ? "Adjudication subject not found"
                : status === 409
                  ? "Adjudication subject is not terminal"
                  : status === 422
                    ? `Adjudication terminal state: ${code.toLowerCase()}`
                    : "Adjudication integrity unavailable",
              correlationId(request),
            ),
          );
      }
    },
  );
  server.get<{ Params: { operationId: string } }>(
    "/v1/verification/captures/:operationId",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      z.strictObject({}).parse(request.query);
      const operationId = UuidSchema.parse(request.params.operationId);
      if (!options.verificationCaptureReads)
        return reply
          .status(503)
          .type("application/problem+json")
          .send(
            problem(
              503,
              "CAPABILITY_NOT_ADMITTED",
              "Capture reads unavailable",
              correlationId(request),
            ),
          );
      try {
        const resource = VerificationCaptureTerminalResourceSchema.parse(
          await options.verificationCaptureReads.getCapture({
            tenantId: access.tenant,
            operationId,
            actor: access.identity.actor,
          }),
        );
        if (
          resource.tenantId !== access.tenant ||
          resource.operationId !== operationId
        )
          throw new Error("VERIFICATION_CAPTURE_READ_SCOPE_MISMATCH");
        return boundedResource(request, reply, resource);
      } catch (error) {
        const code =
          error instanceof Error &&
          "code" in error &&
          typeof error.code === "string"
            ? error.code
            : "INTEGRITY";
        const status =
          code === "NOT_FOUND"
            ? 404
            : code === "PENDING"
              ? 409
              : code === "FAILED" || code === "CANCELLED"
                ? 422
                : 503;
        return reply
          .status(status)
          .type("application/problem+json")
          .send(
            problem(
              status,
              status === 404
                ? "NOT_FOUND"
                : status === 409
                  ? "CONFLICT"
                  : status === 422
                    ? "INVALID_STATE_TRANSITION"
                    : "INTERNAL_ERROR",
              status === 404
                ? "Capture result not found"
                : status === 409
                  ? "Capture result is not terminal"
                  : status === 422
                    ? `Capture terminal state: ${code.toLowerCase()}`
                    : "Capture custody integrity unavailable",
              correlationId(request),
            ),
          );
      }
    },
  );
  for (const family of ["claims", "reports"] as const) {
    server.get<{ Params: { operationId: string } }>(
      `/v1/verification/${family}/:operationId`,
      async (request, reply) => {
        const access = await requireAccess(request, reply, "knowledge.read");
        if (!access) return;
        z.strictObject({}).parse(request.query);
        const operationId = UuidSchema.parse(request.params.operationId);
        if (!options.verificationClaimsReportReads)
          return reply
            .status(503)
            .type("application/problem+json")
            .send(
              problem(
                503,
                "CAPABILITY_NOT_ADMITTED",
                "Claims/report reads unavailable",
                correlationId(request),
              ),
            );
        try {
          const value =
            family === "claims"
              ? await options.verificationClaimsReportReads.getClaims({
                  tenantId: access.tenant,
                  operationId,
                  actor: access.identity.actor,
                })
              : await options.verificationClaimsReportReads.getReport({
                  tenantId: access.tenant,
                  operationId,
                  actor: access.identity.actor,
                });
          const resource =
            family === "claims"
              ? VerificationClaimsTerminalResourceSchema.parse(value)
              : VerificationReportTerminalResourceSchema.parse(value);
          if (
            resource.tenantId !== access.tenant ||
            resource.operationId !== operationId
          )
            throw new Error("VERIFICATION_CLAIMS_REPORT_READ_SCOPE_MISMATCH");
          return boundedResource(request, reply, resource);
        } catch (error) {
          const code =
            error instanceof Error &&
            "code" in error &&
            typeof error.code === "string"
              ? error.code
              : "INTEGRITY";
          const status =
            code === "NOT_FOUND"
              ? 404
              : code === "PENDING"
                ? 409
                : code === "FAILED" || code === "CANCELLED"
                  ? 422
                  : 503;
          const problemCode =
            status === 404
              ? "NOT_FOUND"
              : status === 409
                ? "CONFLICT"
                : status === 422
                  ? "INVALID_STATE_TRANSITION"
                  : "INTERNAL_ERROR";
          return reply
            .status(status)
            .type("application/problem+json")
            .send(
              problem(
                status,
                problemCode,
                status === 404
                  ? "Verification result not found"
                  : status === 409
                    ? "Verification result is not terminal"
                    : status === 422
                      ? `Verification terminal state: ${code.toLowerCase()}`
                      : "Verification result integrity unavailable",
                correlationId(request),
              ),
            );
        }
      },
    );
  }
  server.get<{ Params: { comparisonId: string } }>(
    "/v1/verification/benchmarks/comparisons/:comparisonId",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      z.strictObject({}).parse(request.query);
      const comparisonId = UuidSchema.parse(request.params.comparisonId);
      if (!options.verificationBenchmarkComparisonReads)
        return reply
          .status(503)
          .type("application/problem+json")
          .send(
            problem(
              503,
              "CAPABILITY_NOT_ADMITTED",
              "Comparison reads unavailable",
              correlationId(request),
            ),
          );
      try {
        const resource = VerificationBenchmarkComparisonResourceSchema.parse(
          await options.verificationBenchmarkComparisonReads.getComparison({
            tenantId: access.tenant,
            comparisonId,
          }),
        );
        if (
          resource.tenantId !== access.tenant ||
          resource.comparisonId !== comparisonId
        )
          throw new Error(
            "VERIFICATION_BENCHMARK_COMPARISON_READ_SCOPE_MISMATCH",
          );
        return boundedResource(request, reply, resource);
      } catch (error) {
        const missing =
          error instanceof Error &&
          "code" in error &&
          error.code === "NOT_FOUND";
        return reply
          .status(missing ? 404 : 503)
          .type("application/problem+json")
          .send(
            problem(
              missing ? 404 : 503,
              missing ? "NOT_FOUND" : "INTERNAL_ERROR",
              missing
                ? "Comparison not found"
                : "Comparison integrity unavailable",
              correlationId(request),
            ),
          );
      }
    },
  );
  for (const manifest of [false, true]) {
    server.get<{ Params: { runId: string } }>(
      `/v1/verification/benchmarks/:runId${manifest ? "/manifest" : ""}`,
      async (request, reply) => {
        const access = await requireAccess(request, reply, "knowledge.read");
        if (!access) return;
        z.strictObject({}).parse(request.query);
        const runId = UuidSchema.parse(request.params.runId);
        if (!options.verificationBenchmarkReads)
          return reply
            .status(503)
            .type("application/problem+json")
            .send(
              problem(
                503,
                "CAPABILITY_NOT_ADMITTED",
                "Benchmark reads unavailable",
                correlationId(request),
              ),
            );
        try {
          const input = { tenantId: access.tenant, runId };
          const resource = manifest
            ? VerificationBenchmarkRunManifestResourceSchema.parse(
                await options.verificationBenchmarkReads.getManifest(input),
              )
            : VerificationBenchmarkRunSummaryResourceSchema.parse(
                await options.verificationBenchmarkReads.getRun(input),
              );
          if (resource.tenantId !== access.tenant || resource.runId !== runId)
            throw new Error("VERIFICATION_BENCHMARK_READ_SCOPE_MISMATCH");
          return boundedResource(request, reply, resource);
        } catch (error) {
          const missing =
            error instanceof Error &&
            "code" in error &&
            error.code === "NOT_FOUND";
          return reply
            .status(missing ? 404 : 503)
            .type("application/problem+json")
            .send(
              problem(
                missing ? 404 : 503,
                missing ? "NOT_FOUND" : "INTERNAL_ERROR",
                missing
                  ? "Benchmark run not found"
                  : "Benchmark integrity unavailable",
                correlationId(request),
              ),
            );
        }
      },
    );
  }
  for (const manifest of [false, true]) {
    server.get<{ Params: { runId: string } }>(
      `/v1/verification/runs/:runId${manifest ? "/manifest" : ""}`,
      async (request, reply) => {
        const access = await requireAccess(request, reply, "knowledge.read");
        if (!access) return;
        const runId = UuidSchema.parse(request.params.runId);
        if (!options.verificationReads)
          return reply
            .status(503)
            .type("application/problem+json")
            .send(
              problem(
                503,
                "CAPABILITY_NOT_ADMITTED",
                "Verification reads unavailable",
                correlationId(request),
              ),
            );
        try {
          const input = { tenantId: access.tenant, runId };
          const resource = manifest
            ? VerificationRunManifestResourceSchema.parse(
                await options.verificationReads.getRunManifest(input),
              )
            : VerificationRunSummaryResourceSchema.parse(
                await options.verificationReads.getRun(input),
              );
          if (resource.tenantId !== access.tenant || resource.runId !== runId)
            throw new Error("VERIFICATION_RUN_READ_SCOPE_MISMATCH");
          return boundedResource(request, reply, resource);
        } catch (error) {
          const missing =
            error instanceof Error &&
            "code" in error &&
            error.code === "NOT_FOUND";
          return reply
            .status(missing ? 404 : 503)
            .type("application/problem+json")
            .send(
              problem(
                missing ? 404 : 503,
                missing ? "NOT_FOUND" : "INTERNAL_ERROR",
                missing
                  ? "Verification run not found"
                  : "Verification run integrity unavailable",
                correlationId(request),
              ),
            );
        }
      },
    );
  }
  for (const route of [
    { path: "/v1/verification/runs/:id/cases", kind: "list" },
    { path: "/v1/verification/cases/:id", kind: "case" },
    { path: "/v1/verification/evidence/:id", kind: "evidence" },
  ] as const) {
    server.get<{ Params: { id: string } }>(
      route.path,
      async (request, reply) => {
        const access = await requireAccess(request, reply, "knowledge.read");
        if (!access) return;
        const id = UuidSchema.parse(request.params.id);
        const page =
          route.kind === "list"
            ? z
                .strictObject({
                  pageSize: z.coerce.number().int().min(1).max(100).default(25),
                  cursor: UuidSchema.optional(),
                })
                .parse(request.query)
            : z.strictObject({}).parse(request.query);
        const reads = options.verificationCaseReads;
        if (!reads)
          return reply
            .status(503)
            .type("application/problem+json")
            .send(
              problem(
                503,
                "CAPABILITY_NOT_ADMITTED",
                "Verification case reads unavailable",
                correlationId(request),
              ),
            );
        try {
          const value =
            route.kind === "list"
              ? await reads.listRunCases({
                  tenantId: access.tenant,
                  runId: id,
                  ...page,
                })
              : route.kind === "case"
                ? await reads.getCase({
                    tenantId: access.tenant,
                    caseRunId: id,
                  })
                : await reads.getEvidence({
                    tenantId: access.tenant,
                    evidenceId: id,
                  });
          const resource =
            route.kind === "list"
              ? VerificationRunCasesResourceSchema.parse(value)
              : route.kind === "case"
                ? VerificationCaseResourceSchema.parse(value)
                : VerificationEvidenceResourceSchema.parse(value);
          if (
            resource.tenantId !== access.tenant ||
            (route.kind === "list" && resource.runId !== id) ||
            (route.kind === "case" &&
              (!("caseRunId" in resource) || resource.caseRunId !== id)) ||
            (route.kind === "evidence" &&
              (!("evidenceId" in resource) || resource.evidenceId !== id))
          )
            throw new Error("VERIFICATION_CASE_READ_SCOPE_MISMATCH");
          return boundedResource(request, reply, resource);
        } catch (error) {
          const missing =
            error instanceof Error &&
            "code" in error &&
            error.code === "NOT_FOUND";
          return reply
            .status(missing ? 404 : 503)
            .type("application/problem+json")
            .send(
              problem(
                missing ? 404 : 503,
                missing ? "NOT_FOUND" : "INTERNAL_ERROR",
                missing
                  ? "Verification resource not found"
                  : "Verification resource integrity unavailable",
                correlationId(request),
              ),
            );
        }
      },
    );
  }
  server.post<{ Params: { profileName: string } }>(
    "/v1/verification/benchmark-capture-profiles/:profileName/captures",
    async (request, reply) => {
      const auth = request.headers.authorization,
        token = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
      const identity = token ? await resolveIdentity(token) : undefined;
      if (!identity)
        return reply
          .status(401)
          .type("application/problem+json")
          .send(
            problem(
              401,
              "UNAUTHORIZED",
              "Authentication required",
              correlationId(request),
            ),
          );
      z.strictObject({}).parse(request.query);
      const profileName = z
        .string()
        .regex(/^[a-z][a-z0-9-]{0,63}$/u)
        .parse(request.params.profileName);
      if (
        Object.keys(request.headers).some(
          (name) =>
            name === "x-tenant-id" ||
            name.startsWith("x-verification-") ||
            name.startsWith("x-external-") ||
            name.startsWith("x-eve-") ||
            name === "x-causation-id",
        )
      )
        return reply
          .status(400)
          .type("application/problem+json")
          .send(
            problem(
              400,
              "INVALID_CONTRACT",
              "Profile routing is server-owned",
              correlationId(request),
            ),
          );
      const idempotencyKey = z
        .string()
        .min(8)
        .max(255)
        .parse(request.headers["idempotency-key"]);
      const input = CaptureSourceRequestSchema.parse(request.body);
      if (input.source.mode !== "acquire")
        return reply
          .status(400)
          .type("application/problem+json")
          .send(
            problem(
              400,
              "INVALID_CONTRACT",
              "Profile capture requires acquisition",
              correlationId(request),
            ),
          );
      if (
        !options.resolveVerificationBenchmarkCaptureProfile ||
        !options.verificationOperationService ||
        !options.verificationCaptureCatalog
      )
        return reply
          .status(503)
          .type("application/problem+json")
          .send(
            problem(
              503,
              "CAPABILITY_NOT_ADMITTED",
              "Profile capture unavailable",
              correlationId(request),
            ),
          );
      const resolved = await options.resolveVerificationBenchmarkCaptureProfile(
        {
          profileName,
          identity,
          correlationId: correlationId(request),
          idempotencyKey,
        },
      );
      if (!resolved)
        return reply
          .status(404)
          .type("application/problem+json")
          .send(
            problem(
              404,
              "NOT_FOUND",
              "Capture profile not found",
              correlationId(request),
            ),
          );
      const context = OperationContextSchema.parse(resolved);
      if (
        !actorsMatch(context.actor, identity.actor) ||
        !isAuthorized(identity, context.tenantId, "operation.submit") ||
        context.correlationId !== correlationId(request) ||
        context.idempotencyKey !== idempotencyKey
      )
        throw new Error("VERIFICATION_PROFILE_CONTEXT_MISMATCH");
      try {
        options.verificationCaptureCatalog.acquisition(
          context.tenantId,
          input.source.sourceUri,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "VERIFICATION_ACQUISITION_GRANT_REQUIRED"
        )
          return reply
            .status(403)
            .type("application/problem+json")
            .send(
              problem(
                403,
                "FORBIDDEN",
                "Source acquisition grant required",
                correlationId(request),
              ),
            );
        throw error;
      }
      const service = new VerificationOperationApplicationService(
        options.verificationOperationService,
        origin(request),
        options.verificationCaptureCatalog,
      );
      return reply
        .status(202)
        .send(
          VerificationProfileCaptureAcceptedSchema.parse({
            tenantId: context.tenantId,
            operation: await service.submitCaptureSource(input, context),
          }),
        );
    },
  );
  server.post("/v1/verification/captures", async (request, reply) => {
    const trusted = await verificationContext(request, reply, "captureSource");
    if (!trusted) return;
    const input = CaptureSourceRequestSchema.parse(request.body);
    if (input.source.mode === "acquire") {
      if (!options.verificationCaptureCatalog)
        return reply
          .status(503)
          .type("application/problem+json")
          .send(
            problem(
              503,
              "CAPABILITY_NOT_ADMITTED",
              "Source acquisition unavailable",
              correlationId(request),
            ),
          );
      try {
        options.verificationCaptureCatalog.acquisition(
          trusted.context.tenantId,
          input.source.sourceUri,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "VERIFICATION_ACQUISITION_GRANT_REQUIRED"
        )
          return reply
            .status(403)
            .type("application/problem+json")
            .send(
              problem(
                403,
                "FORBIDDEN",
                "Source acquisition grant required",
                correlationId(request),
              ),
            );
        throw error;
      }
    }
    return reply
      .status(202)
      .send(await trusted.service.submitCaptureSource(input, trusted.context));
  });
  server.post("/v1/verification/artifacts::parse", async (request, reply) => {
    const trusted = await verificationContext(request, reply, "parseArtifact");
    if (!trusted) return;
    if (!options.isParseArtifactRequestAdmitted)
      return reply
        .status(503)
        .type("application/problem+json")
        .send(
          problem(
            503,
            "CAPABILITY_NOT_ADMITTED",
            "Parse runtime unavailable",
            correlationId(request),
          ),
        );
    const input = ParseArtifactRequestSchema.parse(request.body);
    if (
      !options.isParseArtifactRequestAdmitted(trusted.context.tenantId, input)
    )
      return reply
        .status(403)
        .type("application/problem+json")
        .send(
          problem(
            403,
            "FORBIDDEN",
            "Parse capture grant required",
            correlationId(request),
          ),
        );
    return reply
      .status(202)
      .send(await trusted.service.submitParseArtifact(input, trusted.context));
  });
  server.post("/v1/verification/extractions", async (request, reply) => {
    const trusted = await verificationContext(
      request,
      reply,
      "extractStructuredData",
    );
    if (!trusted) return;
    if (!options.isStructuredExtractionRequestAdmitted)
      return reply
        .status(503)
        .type("application/problem+json")
        .send(
          problem(
            503,
            "CAPABILITY_NOT_ADMITTED",
            "Extraction runtime unavailable",
            correlationId(request),
          ),
        );
    const input = ExtractStructuredDataRequestSchema.parse(request.body);
    if (
      !options.isStructuredExtractionRequestAdmitted(
        trusted.context.tenantId,
        input,
      )
    )
      return reply
        .status(403)
        .type("application/problem+json")
        .send(
          problem(
            403,
            "FORBIDDEN",
            "Extraction input grant required",
            correlationId(request),
          ),
        );
    return reply
      .status(202)
      .send(
        await trusted.service.submitExtractStructuredData(
          input,
          trusted.context,
        ),
      );
  });
  server.post("/v1/verification/benchmarks::run", async (request, reply) => {
    const trusted = await verificationContext(request, reply, "runBenchmark");
    if (!trusted) return;
    if (!options.isBenchmarkRequestAdmitted)
      return reply
        .status(503)
        .type("application/problem+json")
        .send(
          problem(
            503,
            "CAPABILITY_NOT_ADMITTED",
            "Benchmark runtime unavailable",
            correlationId(request),
          ),
        );
    const input = RunBenchmarkRequestSchema.parse(request.body);
    if (!options.isBenchmarkRequestAdmitted(trusted.context.tenantId, input))
      return reply
        .status(403)
        .type("application/problem+json")
        .send(
          problem(
            403,
            "FORBIDDEN",
            "Benchmark input grant required",
            correlationId(request),
          ),
        );
    return reply
      .status(202)
      .send(await trusted.service.submitRunBenchmark(input, trusted.context));
  });
  server.post(
    "/v1/verification/benchmarks::compare",
    async (request, reply) => {
      const trusted = await verificationContext(
        request,
        reply,
        "compareBenchmarkRuns",
      );
      if (!trusted) return;
      if (!options.isBenchmarkComparisonRequestAdmitted)
        return reply
          .status(503)
          .type("application/problem+json")
          .send(
            problem(
              503,
              "CAPABILITY_NOT_ADMITTED",
              "Comparison runtime unavailable",
              correlationId(request),
            ),
          );
      const input = CompareBenchmarkRunsRequestSchema.parse(request.body);
      if (
        !options.isBenchmarkComparisonRequestAdmitted(
          trusted.context.tenantId,
          input,
        )
      )
        return reply
          .status(403)
          .type("application/problem+json")
          .send(
            problem(
              403,
              "FORBIDDEN",
              "Comparison profile grant required",
              correlationId(request),
            ),
          );
      return reply
        .status(202)
        .send(
          await trusted.service.submitCompareBenchmarkRuns(
            input,
            trusted.context,
          ),
        );
    },
  );
  server.post("/v1/verification/metrics::verify", async (request, reply) => {
    const trusted = await verificationContext(
      request,
      reply,
      "verifyMetricObservation",
    );
    if (!trusted) return;
    return reply
      .status(202)
      .send(
        await trusted.service.submitVerifyMetricObservation(
          request.body,
          trusted.context,
        ),
      );
  });
  server.post("/v1/verification/claims::verify", async (request, reply) => {
    const trusted = await verificationContext(request, reply, "verifyClaims");
    if (!trusted) return;
    if (!options.isClaimsRequestAdmitted)
      return reply
        .status(503)
        .type("application/problem+json")
        .send(
          problem(
            503,
            "CAPABILITY_NOT_ADMITTED",
            "Claims verification runtime unavailable",
            correlationId(request),
          ),
        );
    const input = VerifyClaimsRequestSchema.parse(request.body);
    if (!options.isClaimsRequestAdmitted(trusted.context.tenantId, input))
      return reply
        .status(403)
        .type("application/problem+json")
        .send(
          problem(
            403,
            "FORBIDDEN",
            "Claims projection grant required",
            correlationId(request),
          ),
        );
    return reply
      .status(202)
      .send(await trusted.service.submitVerifyClaims(input, trusted.context));
  });
  server.post("/v1/verification/reports::verify", async (request, reply) => {
    const trusted = await verificationContext(request, reply, "verifyReport");
    if (!trusted) return;
    if (!options.isClaimsRequestAdmitted)
      return reply
        .status(503)
        .type("application/problem+json")
        .send(
          problem(
            503,
            "CAPABILITY_NOT_ADMITTED",
            "Report verification runtime unavailable",
            correlationId(request),
          ),
        );
    const input = VerifyReportRequestSchema.parse(request.body);
    if (!options.isClaimsRequestAdmitted(trusted.context.tenantId, input))
      return reply
        .status(403)
        .type("application/problem+json")
        .send(
          problem(
            403,
            "FORBIDDEN",
            "Report projection grant required",
            correlationId(request),
          ),
        );
    return reply
      .status(202)
      .send(await trusted.service.submitVerifyReport(input, trusted.context));
  });
  server.post(
    "/v1/verification/adjudications::record-decision",
    async (request, reply) => {
      const trusted = await verificationContext(
        request,
        reply,
        "recordAdjudicationDecision",
      );
      if (!trusted) return;
      if (!options.isAdjudicationDecisionAdmitted)
        return reply
          .status(503)
          .type("application/problem+json")
          .send(
            problem(
              503,
              "CAPABILITY_NOT_ADMITTED",
              "Decision runtime unavailable",
              correlationId(request),
            ),
          );
      const input = VerificationAdjudicationDecisionRequestSchema.parse(
        request.body,
      );
      const actor = trusted.context.actor;
      if (
        actor.kind === "model" ||
        (actor.kind === "service" &&
          actor.serviceIdentity !== "human_reviewer") ||
        !(await options.isAdjudicationDecisionAdmitted({
          request: input,
          context: trusted.context,
        }))
      )
        return reply
          .status(403)
          .type("application/problem+json")
          .send(
            problem(
              403,
              "FORBIDDEN",
              "Reviewer grant required",
              correlationId(request),
            ),
          );
      return reply
        .status(202)
        .send(
          await trusted.service.submitRecordAdjudicationDecision(
            input,
            trusted.context,
          ),
        );
    },
  );
  server.post(
    "/v1/verification/adjudications::request",
    async (request, reply) => {
      const trusted = await verificationContext(
        request,
        reply,
        "requestAdjudication",
      );
      if (!trusted) return;
      if (!options.isAdjudicationRequestAdmitted)
        return reply
          .status(503)
          .type("application/problem+json")
          .send(
            problem(
              503,
              "CAPABILITY_NOT_ADMITTED",
              "Adjudication request runtime unavailable",
              correlationId(request),
            ),
          );
      const input = RequestAdjudicationRequestSchema.parse(request.body);
      if (
        !(await options.isAdjudicationRequestAdmitted(
          trusted.context.tenantId,
          input,
        ))
      )
        return reply
          .status(403)
          .type("application/problem+json")
          .send(
            problem(
              403,
              "FORBIDDEN",
              "Adjudication request grant required",
              correlationId(request),
            ),
          );
      return reply
        .status(202)
        .send(
          await trusted.service.submitRequestAdjudication(
            input,
            trusted.context,
          ),
        );
    },
  );
  server.post(
    "/v1/verification/audit-bundles::inspect",
    async (request, reply) => {
      const trusted = await verificationContext(
        request,
        reply,
        "inspectAuditBundle",
      );
      if (!trusted) return;
      if (!options.isAuditInspectionRequestAdmitted)
        return reply
          .status(503)
          .type("application/problem+json")
          .send(
            problem(
              503,
              "CAPABILITY_NOT_ADMITTED",
              "Audit inspection runtime unavailable",
              correlationId(request),
            ),
          );
      const input = InspectAuditBundleRequestSchema.parse(request.body);
      if (
        !(await options.isAuditInspectionRequestAdmitted(
          trusted.context.tenantId,
          input,
        ))
      )
        return reply
          .status(403)
          .type("application/problem+json")
          .send(
            problem(
              403,
              "FORBIDDEN",
              "Exact claims/report audit artifact grant required",
              correlationId(request),
            ),
          );
      return reply
        .status(202)
        .send(
          await trusted.service.submitInspectAuditBundle(
            input,
            trusted.context,
          ),
        );
    },
  );
  server.post(
    "/v1/verification/extractions::verify",
    async (request, reply) => {
      const trusted = await verificationContext(
        request,
        reply,
        "verifyExtraction",
      );
      if (!trusted) return;
      return reply
        .status(202)
        .send(
          await trusted.service.submitVerifyExtraction(
            VerifyExtractionRequestSchema.parse(request.body),
            trusted.context,
          ),
        );
    },
  );
  server.post<{ Params: { runId: string } }>(
    "/v1/verification/runs/:runId(^[^:]+)::replay",
    async (request, reply) => {
      const trusted = await verificationContext(request, reply, "replayRun");
      if (!trusted) return;
      const parsed = ReplayRunRequestSchema.parse(request.body);
      if (parsed.runId !== request.params.runId)
        return reply
          .status(400)
          .type("application/problem+json")
          .send(
            problem(
              400,
              "INVALID_CONTRACT",
              "Path run does not match replay request",
              correlationId(request),
            ),
          );
      return reply
        .status(202)
        .send(await trusted.service.submitReplayRun(parsed, trusted.context));
    },
  );
  server.get<{ Params: Params }>(
    "/v1/verification/operations/:id",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      const item = await (
        options.verificationOperationService ?? operationService
      ).get(request.params.id, access.tenant);
      return (
        item ??
        reply
          .status(404)
          .send(
            problem(
              404,
              "NOT_FOUND",
              "Verification operation not found",
              correlationId(request),
            ),
          )
      );
    },
  );
  server.post("/v1/operations", async (request, reply) => {
    const body = request.body as { kind?: unknown; envelope?: unknown };
    const kind = OperationKindSchema.parse(body?.kind);
    const access = await requireAccess(
      request,
      reply,
      requiredSubmissionAction(kind),
    );
    if (!access) return;
    const envelope = MutationEnvelopeSchema.parse(body?.envelope);
    if (access.tenant !== envelope.context.tenantId)
      return reply
        .status(403)
        .send(
          problem(
            403,
            "FORBIDDEN",
            "Tenant context mismatch",
            correlationId(request),
          ),
        );
    if (
      requireEnvelopeActor(access.identity, envelope, request, reply) !== true
    )
      return;
    if (correlationId(request) !== envelope.context.correlationId)
      return reply
        .status(400)
        .send(
          problem(
            400,
            "INVALID_CONTRACT",
            "Correlation context mismatch",
            correlationId(request),
          ),
        );
    return reply
      .status(202)
      .send(await operationService.submit(kind, envelope, origin(request)));
  });
  server.get<{ Params: Params }>(
    "/v1/operations/:id",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      const item = await operationService.get(request.params.id, access.tenant);
      return (
        item ??
        reply
          .status(404)
          .send(
            problem(
              404,
              "NOT_FOUND",
              "Operation not found",
              correlationId(request),
            ),
          )
      );
    },
  );
  server.get<{ Params: Params }>(
    "/v1/operations/:id/events",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      const after = Number((request.query as { after?: string }).after ?? 0);
      const items = await operationService.events(
        request.params.id,
        access.tenant,
        Number.isSafeInteger(after) && after >= 0 ? after : 0,
      );
      return items
        ? { items, nextCursor: null }
        : reply
            .status(404)
            .send(
              problem(
                404,
                "NOT_FOUND",
                "Operation not found",
                correlationId(request),
              ),
            );
    },
  );
  server.post<{ Params: { target: string } }>(
    "/v1/operations/:target",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "operation.control");
      if (!access) return;
      const match = /^(.*):(cancel|retry|reconcile)$/.exec(
        request.params.target,
      );
      if (!match)
        return reply
          .status(404)
          .send(
            problem(
              404,
              "NOT_FOUND",
              "Operation action not found",
              correlationId(request),
            ),
          );
      const envelope = MutationEnvelopeSchema.parse(request.body);
      if (access.tenant !== envelope.context.tenantId)
        return reply
          .status(403)
          .send(
            problem(
              403,
              "FORBIDDEN",
              "Tenant context mismatch",
              correlationId(request),
            ),
          );
      if (
        requireEnvelopeActor(access.identity, envelope, request, reply) !== true
      )
        return;
      if (correlationId(request) !== envelope.context.correlationId)
        return reply
          .status(400)
          .send(
            problem(
              400,
              "INVALID_CONTRACT",
              "Correlation context mismatch",
              correlationId(request),
            ),
          );
      if (match[1] !== envelope.context.operationId)
        return reply
          .status(400)
          .type("application/problem+json")
          .send(
            problem(
              400,
              "INVALID_CONTRACT",
              "Operation context mismatch",
              correlationId(request),
            ),
          );
      const action = match[2] as "cancel" | "retry" | "reconcile";
      const result = await operationService[action](
        match[1]!,
        envelope.context.tenantId,
        envelope.context,
      );
      return (
        result ??
        reply
          .status(404)
          .send(
            problem(
              404,
              "NOT_FOUND",
              "Operation not found",
              correlationId(request),
            ),
          )
      );
    },
  );
  server.post("/v1/retrieval-plans:validate", async (request, reply) => {
    if (!(await requireAccess(request, reply, "retrieval.plan.validate")))
      return;
    const body = request.body as { plan?: unknown };
    return RetrievalPlanSchema.parse(body?.plan ?? request.body);
  });
  server.post("/v1/retrieval-runs", async (request, reply) => {
    const access = await requireAccess(request, reply, "operation.submit");
    if (!access) return;
    const envelope = MutationEnvelopeSchema.parse(request.body);
    if (access.tenant !== envelope.context.tenantId)
      return reply
        .status(403)
        .type("application/problem+json")
        .send(
          problem(
            403,
            "FORBIDDEN",
            "Tenant context mismatch",
            correlationId(request),
          ),
        );
    if (
      requireEnvelopeActor(access.identity, envelope, request, reply) !== true
    )
      return;
    if (envelope.context.correlationId !== correlationId(request))
      return reply
        .status(400)
        .type("application/problem+json")
        .send(
          problem(
            400,
            "INVALID_CONTRACT",
            "Correlation context mismatch",
            correlationId(request),
          ),
        );
    RetrievalRunInputSchema.parse(envelope.input);
    if (envelope.expectedVersions.retrieval !== "v1")
      return reply
        .status(400)
        .type("application/problem+json")
        .send(
          problem(
            400,
            "INVALID_CONTRACT",
            "Retrieval contract version v1 is required",
            correlationId(request),
          ),
        );
    if (!options.canonicalRetrievalExecutor)
      return reply
        .status(503)
        .type("application/problem+json")
        .send(
          problem(
            503,
            "INTERNAL_ERROR",
            "Canonical retrieval executor unavailable",
            correlationId(request),
          ),
        );
    const accepted = await retrievalOperationService.submit(
      "retrieval_run",
      envelope,
      origin(request),
    );
    await options.canonicalRetrievalExecutor.execute(envelope, access.identity);
    return reply.status(202).send(accepted);
  });
  server.get("/v1/retrieval-runs", async (request, reply) => {
    const access = await requireAccess(request, reply, "knowledge.read");
    if (!access) return;
    return {
      items: (await operationService.list(access.tenant)).filter(
        (operation) => operation.kind === "retrieval_run",
      ),
      nextCursor: null,
    };
  });
  for (const [collection, kind] of Object.entries(collectionKinds)) {
    server.post(`/v1/${collection}`, async (request, reply) =>
      submit(request, reply, kind),
    );
    server.get(`/v1/${collection}`, async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      return {
        items: (await operationService.list(access.tenant)).filter(
          (operation) => operation.kind === kind,
        ),
        nextCursor: null,
      };
    });
  }
  const mutationRoutes: [string, OperationKind][] = [
    ["/v1/transformations", "transformation"],
    ["/v1/chunk-previews", "chunk_preview"],
    ["/v1/chunk-comparisons", "chunk_comparison"],
    ["/v1/chunk-sets", "chunk_set"],
  ];
  for (const [path, kind] of mutationRoutes)
    server.post(path, async (request, reply) => submit(request, reply, kind));
  server.post<{ Params: Params }>(
    "/v1/vector-stores/:id/documents",
    async (request, reply) =>
      submit(request, reply, "vector_store_documents", request.params.id),
  );
  server.post<{ Params: Params }>(
    "/v1/vector-stores/:id/ingestion-jobs",
    async (request, reply) =>
      submit(request, reply, "vector_store_ingestion", request.params.id),
  );
  server.post<{ Params: { sourceAction: string } }>(
    "/v1/:sourceAction",
    async (request, reply) => {
      const kind = {
        "sources:discover": "source_discovery",
        "sources:resolve": "source_resolution",
      }[request.params.sourceAction] as OperationKind | undefined;
      return kind
        ? submit(request, reply, kind)
        : reply
            .status(404)
            .send(
              problem(
                404,
                "NOT_FOUND",
                "Action not found",
                correlationId(request),
              ),
            );
    },
  );
  const resourceActions: Record<string, Record<string, OperationKind>> = {
    "vector-stores": {
      search: "vector_store_search",
      evaluate: "vector_store_evaluation",
    },
    captures: {
      inspect: "capture_inspection",
      compare: "capture_comparison",
      vet: "source_vetting",
    },
    representations: {
      inspect: "representation_inspection",
      compare: "representation_comparison",
      decide: "representation_decision",
    },
    "chunk-sets": { inspect: "chunk_set_inspection" },
    "space-publications": {
      verify: "publication_verification",
      rollback: "publication_rollback",
    },
  };
  for (const [resource, actions] of Object.entries(resourceActions))
    server.post<{ Params: { target: string } }>(
      `/v1/${resource}/:target`,
      async (request, reply) => {
        const match = /^(.*):([a-z-]+)$/.exec(request.params.target);
        const kind = match ? actions[match[2]!] : undefined;
        return kind
          ? submit(request, reply, kind)
          : reply
              .status(404)
              .send(
                problem(
                  404,
                  "NOT_FOUND",
                  "Resource action not found",
                  correlationId(request),
                ),
              );
      },
    );
  server.post("/v1/demo/evaluations", async (request, reply) => {
    const access = await requireAccess(request, reply, "demo.evaluate");
    if (!access) return;
    const envelope = MutationEnvelopeSchema.parse(request.body);
    if (
      access.tenant !== envelope.context.tenantId ||
      correlationId(request) !== envelope.context.correlationId
    )
      return reply
        .status(403)
        .send(
          problem(
            403,
            "FORBIDDEN",
            "Execution context mismatch",
            correlationId(request),
          ),
        );
    if (
      requireEnvelopeActor(access.identity, envelope, request, reply) !== true
    )
      return;
    const input = ExploratoryEvaluationInputSchema.parse(envelope.input);
    const loaded = await loadEmbeddingBundles();
    const byVideoId = new Map(
      loaded.map((item) => [item.bundle.video_id, item.bundle]),
    );
    const bundles = input.bundles.map(
      (descriptor) => byVideoId.get(descriptor.video_id)!,
    );
    if (bundles.some((bundle) => !bundle))
      return reply
        .status(503)
        .send(
          problem(
            503,
            "INTERNAL_ERROR",
            "Allow-listed exploratory fixture unavailable",
            correlationId(request),
          ),
        );
    const accepted = service.submit(
      "evaluation_run",
      envelope,
      origin(request),
    );
    const evaluator = new AgenticKnowledgeService(
      new DeterministicFakeEmbeddingAdapter(),
    );
    const index = await evaluator.buildExploratoryIndex(bundles);
    const report = await evaluator.evaluate(index);
    service.setResult(accepted.operationId, {
      storeClass: "internal_exploratory",
      canonicalPublication: false,
      bundleCount: 3,
      videoIds: input.bundles.map((bundle) => bundle.video_id),
      evaluationScopes: input.bundles.map((bundle) => bundle.evaluation_scope),
      claimProjectionCount: index.records.length,
      vectorCount: index.backend.count(
        index.tenantId,
        index.vectorSpaceVersionId,
      ),
      metrics: report.overall,
      evaluationManifestDigest: report.outputManifestDigest,
    } as unknown as import("@aiengineer/knowledge-contracts").JsonValue);
    let claim;
    while (
      (claim = service.claimOperation(accepted.operationId, "demo-evaluator"))
    )
      service.execute(claim, { stage: claim.step.name });
    return reply.status(202).send(accepted);
  });
  server.get<{ Params: Params }>(
    "/v1/evidence-packets/:id",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      const packet = await options.getEvidencePacket?.(
        access.tenant,
        request.params.id,
      );
      return packet
        ? EvidencePacketSchema.parse(packet)
        : reply
            .status(404)
            .send(
              problem(
                404,
                "NOT_FOUND",
                "Evidence packet not found",
                correlationId(request),
              ),
            );
    },
  );
  server.get<{ Params: Params }>(
    "/v1/retrieval-runs/:id",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      const reader = requireResourceReader(request, reply);
      if (!reader) return;
      const resource = await reader.getRetrievalRunResource(
        access.tenant,
        UuidSchema.parse(request.params.id),
      );
      return resource
        ? boundedResource(
            request,
            reply,
            validatedStoredResource(RetrievalRunResourceSchema, resource),
          )
        : reply
            .status(404)
            .send(
              problem(
                404,
                "NOT_FOUND",
                "Retrieval run not found",
                correlationId(request),
              ),
            );
    },
  );
  server.get<{ Params: Params }>(
    "/v1/vector-stores/:id",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      const reader = requireResourceReader(request, reply);
      if (!reader) return;
      const resource = await reader.getVectorStoreResource(
        access.tenant,
        UuidSchema.parse(request.params.id),
      );
      return resource
        ? boundedResource(
            request,
            reply,
            validatedStoredResource(VectorStoreResourceSchema, resource),
          )
        : reply
            .status(404)
            .send(
              problem(
                404,
                "NOT_FOUND",
                "Vector store not found",
                correlationId(request),
              ),
            );
    },
  );
  server.get<{ Params: Params }>(
    "/v1/retrieval-runs/:id/explanation",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      const reader = requireResourceReader(request, reply);
      if (!reader) return;
      const resource = await reader.getRetrievalExplanationResource(
        access.tenant,
        UuidSchema.parse(request.params.id),
      );
      return resource
        ? boundedResource(
            request,
            reply,
            validatedStoredResource(
              RetrievalExplanationResourceSchema,
              resource,
            ),
          )
        : reply
            .status(404)
            .send(
              problem(
                404,
                "NOT_FOUND",
                "Retrieval explanation not found",
                correlationId(request),
              ),
            );
    },
  );
  server.get<{ Params: Params }>(
    "/v1/eval-runs/:id/report",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      const reader = requireResourceReader(request, reply);
      if (!reader) return;
      const resource = await reader.getEvaluationReportResource(
        access.tenant,
        UuidSchema.parse(request.params.id),
      );
      return resource
        ? boundedResource(
            request,
            reply,
            validatedStoredResource(EvaluationReportResourceSchema, resource),
          )
        : reply
            .status(404)
            .send(
              problem(
                404,
                "NOT_FOUND",
                "Evaluation report not found",
                correlationId(request),
              ),
            );
    },
  );
  server.get<{ Params: Params }>(
    "/v1/eval-runs/:id/failures",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      const reader = requireResourceReader(request, reply);
      if (!reader) return;
      const resource = await reader.getEvaluationFailuresResource(
        access.tenant,
        UuidSchema.parse(request.params.id),
      );
      return resource
        ? boundedResource(
            request,
            reply,
            validatedStoredResource(EvaluationFailuresResourceSchema, resource),
          )
        : reply
            .status(404)
            .send(
              problem(
                404,
                "NOT_FOUND",
                "Evaluation run not found",
                correlationId(request),
              ),
            );
    },
  );
  server.get<{ Params: Params }>(
    "/v1/artifacts/:id",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      const reader = requireResourceReader(request, reply);
      if (!reader) return;
      const resource = await reader.getArtifactResource(
        access.tenant,
        UuidSchema.parse(request.params.id),
      );
      return resource
        ? boundedResource(
            request,
            reply,
            validatedStoredResource(ArtifactResourceSchema, resource),
          )
        : reply
            .status(404)
            .send(
              problem(
                404,
                "NOT_FOUND",
                "Artifact not found",
                correlationId(request),
              ),
            );
    },
  );
  server.get<{ Params: Params }>("/v1/receipts/:id", async (request, reply) => {
    const access = await requireAccess(request, reply, "knowledge.read");
    if (!access) return;
    const reader = requireResourceReader(request, reply);
    if (!reader) return;
    const resource = await reader.getReceiptResource(
      access.tenant,
      UuidSchema.parse(request.params.id),
    );
    return resource
      ? boundedResource(
          request,
          reply,
          validatedStoredResource(DurableReceiptResourceSchema, resource),
        )
      : reply
          .status(404)
          .send(
            problem(
              404,
              "NOT_FOUND",
              "Receipt not found",
              correlationId(request),
            ),
          );
  });
  server.get<{ Params: { id: string; operationId: string } }>(
    "/v1/vector-stores/:id/operations/:operationId",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      const reader = requireResourceReader(request, reply);
      if (!reader) return;
      const vectorStoreId = UuidSchema.parse(request.params.id);
      const operationId = UuidSchema.parse(request.params.operationId);
      if (
        !(await reader.operationBelongsToVectorStore(
          access.tenant,
          vectorStoreId,
          operationId,
        ))
      )
        return reply
          .status(404)
          .send(
            problem(
              404,
              "NOT_FOUND",
              "Vector-store operation not found",
              correlationId(request),
            ),
          );
      const operation = await operationService.get(operationId, access.tenant);
      return (
        operation ??
        reply
          .status(409)
          .send(
            problem(
              409,
              "CONFLICT",
              "Vector-store operation metadata is inconsistent",
              correlationId(request),
            ),
          )
      );
    },
  );
  server.get("/v1/chunking-procedures", async (request, reply) =>
    (await requireAccess(request, reply, "knowledge.read"))
      ? {
          items: [
            { id: "heading-sections-v1", version: "1.0.0", admitted: true },
            { id: "transcript-topics-v1", version: "1.0.0", admitted: true },
          ],
          nextCursor: null,
        }
      : undefined,
  );
  return server;
}
