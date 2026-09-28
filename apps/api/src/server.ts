import {
  VerificationProfileCaptureAcceptedSchema,
} from "@aiengineer/knowledge-contracts";
import {
  VerificationAdjudicationDecisionRequestSchema,
  type VerificationAdjudicationDecisionRequest,
} from "@aiengineer/knowledge-contracts";
import {
  type VerificationAdjudicationDecisionTerminalResource,
} from "@aiengineer/knowledge-contracts";
import {
  bindResolvedVerificationContext,
  createVerificationResourceReads,
  isAdjudicationDecisionReviewerActor,
  type VerificationContextBindingFailure,
  type VerificationResourceReadServices,
} from "@aiengineer/knowledge-application";
import {
  ApplyProviderReconciliationRequestSchema,
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
  VectorStoreCreateInputSchema,
  VectorStoreDocumentsInputSchema,
  VectorStoreIngestionInputSchema,
  UuidSchema,
  type EvidencePacket,
  type RetrievalCitationReplay,
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
import { DeterministicFakeEmbeddingAdapter } from "@aiengineer/knowledge-retrieval";
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
import {
  createKnowledgeResourceReads,
  retrievalExecutionProblem,
  submitCanonicalRetrievalRun,
  type CanonicalRetrievalExecutorPort,
  type ResourceReadResult,
} from "@aiengineer/knowledge-application";

export interface ServerOptions {
  service?: KnowledgeIntegrationService;
  operationService?: KnowledgeOperationPort;
  retrievalOperationService?: KnowledgeOperationPort;
  resourceReader?: ResourceReadRepository;
  maximumResourceResponseBytes?: number;
  publicOrigin?: string;
  resolveIdentity?: ResolveApiIdentity;
  replayEvidencePacketCitations?: (
    tenantId: string,
    packetId: string,
  ) => Promise<RetrievalCitationReplay>;
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
  verificationProviderReconciliation?: VerificationResourceReadServices["providerReconciliation"];
  verificationSemanticReconciliation?: VerificationResourceReadServices["semanticReconciliation"];
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
const VERIFICATION_CONTEXT_BINDING_TITLES: Readonly<
  Record<VerificationContextBindingFailure, string>
> = {
  ownership_denied: "Verification operation ownership denied",
  context_mismatch: "Trusted verification context mismatch",
  ownership_binding_mismatch: "Trusted verification ownership binding mismatch",
  external_execution_mismatch: "Trusted external execution binding mismatch",
};
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
    const retrieval = retrievalExecutionProblem(error);
    if (retrieval?.status === 422)
      return reply
        .status(422)
        .type("application/json")
        .send(retrieval.response);
    if (retrieval)
      return reply
        .status(retrieval.status)
        .type("application/problem+json")
        .send(
          problem(
            retrieval.status,
            retrieval.code,
            retrieval.status === 409
              ? "Retrieval request is not executable under the active policy"
              : "Retrieval embedding provider unavailable",
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
  const knowledgeReads = createKnowledgeResourceReads({
    ...(options.resourceReader ? { resources: options.resourceReader } : {}),
    operations: operationService,
    ...(options.getEvidencePacket
      ? { getEvidencePacket: options.getEvidencePacket }
      : {}),
    ...(options.replayEvidencePacketCitations
      ? { replayEvidencePacketCitations: options.replayEvidencePacketCitations }
      : {}),
    ...(options.maximumResourceResponseBytes === undefined
      ? {}
      : { maximumResponseBytes: options.maximumResourceResponseBytes }),
  });
  /** Maps a shared knowledge read onto this route family's historical replies. */
  const sendKnowledgeRead = <T>(
    request: FastifyRequest,
    reply: FastifyReply,
    result: ResourceReadResult<T>,
    notFound: string,
    inconsistent?: string,
  ) => {
    if (result.ok) return result.value;
    const { reason } = result.failure;
    if (reason === "too_large")
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
    if (reason === "inconsistent" && inconsistent)
      return reply
        .status(409)
        .send(problem(409, "CONFLICT", inconsistent, correlationId(request)));
    if (reason === "unavailable") return requireResourceReader(request, reply);
    return reply
      .status(404)
      .send(problem(404, "NOT_FOUND", notFound, correlationId(request)));
  };
  const verificationReads = createVerificationResourceReads({
    ...(options.verificationStructuredExtractionReads
      ? { structuredExtractionReads: options.verificationStructuredExtractionReads }
      : {}),
    ...(options.verificationAuditInspectionReads
      ? { auditInspectionReads: options.verificationAuditInspectionReads }
      : {}),
    ...(options.verificationAdjudicationReadService
      ? { adjudicationReads: options.verificationAdjudicationReadService }
      : {}),
    ...(options.verificationAdjudicationDecisionReadService
      ? { adjudicationDecisionReads: options.verificationAdjudicationDecisionReadService }
      : {}),
    ...(options.isAdjudicationDecisionReadAdmitted
      ? { isAdjudicationDecisionReadAdmitted: options.isAdjudicationDecisionReadAdmitted }
      : {}),
    ...(options.verificationCaptureReads
      ? { captureReads: options.verificationCaptureReads }
      : {}),
    ...(options.verificationClaimsReportReads
      ? { claimsReportReads: options.verificationClaimsReportReads }
      : {}),
    ...(options.verificationBenchmarkComparisonReads
      ? { benchmarkComparisonReads: options.verificationBenchmarkComparisonReads }
      : {}),
    ...(options.verificationBenchmarkReads
      ? { benchmarkReads: options.verificationBenchmarkReads }
      : {}),
    ...(options.verificationReads ? { runReads: options.verificationReads } : {}),
    ...(options.verificationCaseReads
      ? { caseReads: options.verificationCaseReads }
      : {}),
    ...(options.verificationProviderReconciliation
      ? { providerReconciliation: options.verificationProviderReconciliation }
      : {}),
    ...(options.verificationSemanticReconciliation
      ? { semanticReconciliation: options.verificationSemanticReconciliation }
      : {}),
    ...(options.maximumResourceResponseBytes === undefined
      ? {}
      : { maximumResponseBytes: options.maximumResourceResponseBytes }),
  });
  /** Maps a shared verification read onto the route's historical problem titles. */
  const sendVerificationRead = (
    request: FastifyRequest,
    reply: FastifyReply,
    result: ResourceReadResult<unknown>,
    titles: {
      readonly unavailable: string;
      readonly notFound: string;
      readonly integrity: string;
      readonly pending?: string;
      readonly terminal?: (state: string) => string;
    },
  ) => {
    if (result.ok) return result.value;
    const { failure } = result;
    const title =
      failure.reason === "unavailable"
        ? titles.unavailable
        : failure.reason === "not_found"
          ? titles.notFound
          : failure.reason === "pending" && titles.pending
            ? titles.pending
            : failure.reason === "terminal" && titles.terminal
              ? titles.terminal(failure.state ?? "")
              : failure.reason === "too_large"
                ? "Stored resource exceeds the bounded response contract"
                : titles.integrity;
    return reply
      .status(failure.status)
      .type("application/problem+json")
      .send(problem(failure.status, failure.code, title, correlationId(request)));
  };
  const reconciliationTitles = {
    unavailable: "Reconciliation unavailable",
    notFound: "Reconciliation not found",
    integrity: "Reconciliation unavailable",
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
    const binding = bindResolvedVerificationContext({
      resolved,
      tenantId: access.tenant,
      actor: access.identity.actor,
      correlationId: correlationId(request),
      idempotencyKey,
      hints,
      request,
    });
    if (!binding.ok) {
      await reply
        .status(403)
        .type("application/problem+json")
        .send(
          problem(
            403,
            "FORBIDDEN",
            VERIFICATION_CONTEXT_BINDING_TITLES[binding.failure],
            correlationId(request),
          ),
        );
      return undefined;
    }
    const { context } = binding;
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
          return sendVerificationRead(
            request,
            reply,
            await verificationReads.semanticReconciliation({
              ...scoped,
              ...(body ? { artifact: body.artifact } : {}),
            }),
            reconciliationTitles,
          );
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
        return sendVerificationRead(
          request,
          reply,
          await verificationReads.providerReconciliation({
            ...scoped,
            ...(body ? { artifact: body.artifact } : {}),
          }),
          reconciliationTitles,
        );
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
      return sendVerificationRead(
        request,
        reply,
        await verificationReads.structuredExtraction({
          tenantId: access.tenant,
          operationId,
          actor: access.identity.actor,
        }),
        {
          unavailable: "Extraction reads unavailable",
          notFound: "Extraction not found",
          integrity: "Extraction integrity unavailable",
        },
      );
    },
  );
  server.get<{ Params: { operationId: string } }>(
    "/v1/verification/audit-inspections/:operationId",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      z.strictObject({}).parse(request.query);
      const operationId = UuidSchema.parse(request.params.operationId);
      return sendVerificationRead(
        request,
        reply,
        await verificationReads.auditInspection({
          tenantId: access.tenant,
          operationId,
          actor: access.identity.actor,
        }),
        {
          unavailable: "Audit inspection reads unavailable",
          notFound: "Audit inspection not found",
          pending: "Audit inspection is not terminal",
          terminal: (state) => `Audit inspection terminal state: ${state}`,
          integrity: "Audit inspection integrity unavailable",
        },
      );
    },
  );
  server.get<{ Params: { operationId: string } }>(
    "/v1/verification/adjudication-decisions/:operationId",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      z.strictObject({}).parse(request.query);
      const operationId = UuidSchema.parse(request.params.operationId);
      return sendVerificationRead(
        request,
        reply,
        await verificationReads.adjudicationDecision({
          tenantId: access.tenant,
          operationId,
          actor: access.identity.actor,
        }),
        {
          unavailable: "Decision reads unavailable",
          notFound: "Decision not found",
          pending: "Decision is not terminal",
          terminal: () => "Decision did not succeed",
          integrity: "Decision integrity unavailable",
        },
      );
    },
  );
  server.get<{ Params: { operationId: string } }>(
    "/v1/verification/adjudications/:operationId",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      z.strictObject({}).parse(request.query);
      const operationId = UuidSchema.parse(request.params.operationId);
      return sendVerificationRead(
        request,
        reply,
        await verificationReads.adjudicationSubject({
          tenantId: access.tenant,
          operationId,
          actor: access.identity.actor,
        }),
        {
          unavailable: "Adjudication reads unavailable",
          notFound: "Adjudication subject not found",
          pending: "Adjudication subject is not terminal",
          terminal: (state) => `Adjudication terminal state: ${state}`,
          integrity: "Adjudication integrity unavailable",
        },
      );
    },
  );
  server.get<{ Params: { operationId: string } }>(
    "/v1/verification/captures/:operationId",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      z.strictObject({}).parse(request.query);
      const operationId = UuidSchema.parse(request.params.operationId);
      return sendVerificationRead(
        request,
        reply,
        await verificationReads.capture({
          tenantId: access.tenant,
          operationId,
          actor: access.identity.actor,
        }),
        {
          unavailable: "Capture reads unavailable",
          notFound: "Capture result not found",
          pending: "Capture result is not terminal",
          terminal: (state) => `Capture terminal state: ${state}`,
          integrity: "Capture custody integrity unavailable",
        },
      );
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
        const input = {
          tenantId: access.tenant,
          operationId,
          actor: access.identity.actor,
        };
        return sendVerificationRead(
          request,
          reply,
          family === "claims"
            ? await verificationReads.claims(input)
            : await verificationReads.report(input),
          {
            unavailable: "Claims/report reads unavailable",
            notFound: "Verification result not found",
            pending: "Verification result is not terminal",
            terminal: (state) => `Verification terminal state: ${state}`,
            integrity: "Verification result integrity unavailable",
          },
        );
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
      return sendVerificationRead(
        request,
        reply,
        await verificationReads.benchmarkComparison({
          tenantId: access.tenant,
          comparisonId,
        }),
        {
          unavailable: "Comparison reads unavailable",
          notFound: "Comparison not found",
          integrity: "Comparison integrity unavailable",
        },
      );
    },
  );
  for (const manifest of [false, true]) {
    server.get<{ Params: { runId: string } }>(
      `/v1/verification/benchmarks/:runId${manifest ? "/manifest" : ""}`,
      async (request, reply) => {
        const access = await requireAccess(request, reply, "knowledge.read");
        if (!access) return;
        z.strictObject({}).parse(request.query);
        const input = {
          tenantId: access.tenant,
          runId: UuidSchema.parse(request.params.runId),
        };
        return sendVerificationRead(
          request,
          reply,
          manifest
            ? await verificationReads.benchmarkManifest(input)
            : await verificationReads.benchmarkRun(input),
          {
            unavailable: "Benchmark reads unavailable",
            notFound: "Benchmark run not found",
            integrity: "Benchmark integrity unavailable",
          },
        );
      },
    );
  }
  for (const manifest of [false, true]) {
    server.get<{ Params: { runId: string } }>(
      `/v1/verification/runs/:runId${manifest ? "/manifest" : ""}`,
      async (request, reply) => {
        const access = await requireAccess(request, reply, "knowledge.read");
        if (!access) return;
        const input = {
          tenantId: access.tenant,
          runId: UuidSchema.parse(request.params.runId),
        };
        return sendVerificationRead(
          request,
          reply,
          manifest
            ? await verificationReads.runManifest(input)
            : await verificationReads.run(input),
          {
            unavailable: "Verification reads unavailable",
            notFound: "Verification run not found",
            integrity: "Verification run integrity unavailable",
          },
        );
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
        const tenantId = access.tenant;
        return sendVerificationRead(
          request,
          reply,
          route.kind === "list"
            ? await verificationReads.runCases({ tenantId, runId: id, ...page })
            : route.kind === "case"
              ? await verificationReads.case({ tenantId, caseRunId: id })
              : await verificationReads.evidence({ tenantId, evidenceId: id }),
          {
            unavailable: "Verification case reads unavailable",
            notFound: "Verification resource not found",
            integrity: "Verification resource integrity unavailable",
          },
        );
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
      if (
        !isAdjudicationDecisionReviewerActor(trusted.context.actor) ||
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
    const submission = await submitCanonicalRetrievalRun(
      {
        operations: retrievalOperationService,
        ...(options.canonicalRetrievalExecutor
          ? { executor: options.canonicalRetrievalExecutor }
          : {}),
      },
      { envelope, identity: access.identity, origin: origin(request) },
    );
    if (!submission.ok && submission.reason === "retrieval_version_required")
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
    if (!submission.ok)
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
    return reply.status(202).send(submission.accepted);
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
      const packet = await knowledgeReads.evidencePacket(
        access.tenant,
        request.params.id,
      );
      return packet.ok
        ? packet.value
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
    "/v1/evidence-packets/:id/citations",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      if (!options.replayEvidencePacketCitations)
        return reply
          .status(503)
          .type("application/problem+json")
          .send(
            problem(
              503,
              "INTERNAL_ERROR",
              "Citation replay custody unavailable",
              correlationId(request),
            ),
          );
      const replay = await knowledgeReads.citationReplay(
        access.tenant,
        UuidSchema.parse(request.params.id),
      );
      return replay.ok
        ? replay.value
        : reply
            .status(404)
            .type("application/problem+json")
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
      if (!requireResourceReader(request, reply)) return;
      return sendKnowledgeRead(
        request,
        reply,
        await knowledgeReads.retrievalRun(
          access.tenant,
          UuidSchema.parse(request.params.id),
        ),
        "Retrieval run not found",
      );
    },
  );
  server.get<{ Params: Params }>(
    "/v1/vector-stores/:id",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      if (!requireResourceReader(request, reply)) return;
      return sendKnowledgeRead(
        request,
        reply,
        await knowledgeReads.vectorStore(
          access.tenant,
          UuidSchema.parse(request.params.id),
        ),
        "Vector store not found",
      );
    },
  );
  server.get<{ Params: Params }>(
    "/v1/retrieval-runs/:id/explanation",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      if (!requireResourceReader(request, reply)) return;
      return sendKnowledgeRead(
        request,
        reply,
        await knowledgeReads.retrievalExplanation(
          access.tenant,
          UuidSchema.parse(request.params.id),
        ),
        "Retrieval explanation not found",
      );
    },
  );
  server.get<{ Params: Params }>(
    "/v1/eval-runs/:id/report",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      if (!requireResourceReader(request, reply)) return;
      return sendKnowledgeRead(
        request,
        reply,
        await knowledgeReads.evaluationReport(
          access.tenant,
          UuidSchema.parse(request.params.id),
        ),
        "Evaluation report not found",
      );
    },
  );
  server.get<{ Params: Params }>(
    "/v1/eval-runs/:id/failures",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      if (!requireResourceReader(request, reply)) return;
      return sendKnowledgeRead(
        request,
        reply,
        await knowledgeReads.evaluationFailures(
          access.tenant,
          UuidSchema.parse(request.params.id),
        ),
        "Evaluation run not found",
      );
    },
  );
  server.get<{ Params: Params }>(
    "/v1/artifacts/:id",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      if (!requireResourceReader(request, reply)) return;
      return sendKnowledgeRead(
        request,
        reply,
        await knowledgeReads.artifact(
          access.tenant,
          UuidSchema.parse(request.params.id),
        ),
        "Artifact not found",
      );
    },
  );
  server.get<{ Params: Params }>(
    "/v1/receipts/:id",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      if (!requireResourceReader(request, reply)) return;
      return sendKnowledgeRead(
        request,
        reply,
        await knowledgeReads.receipt(
          access.tenant,
          UuidSchema.parse(request.params.id),
        ),
        "Receipt not found",
      );
    },
  );
  server.get<{ Params: { id: string; operationId: string } }>(
    "/v1/vector-stores/:id/operations/:operationId",
    async (request, reply) => {
      const access = await requireAccess(request, reply, "knowledge.read");
      if (!access) return;
      if (!requireResourceReader(request, reply)) return;
      return sendKnowledgeRead(
        request,
        reply,
        await knowledgeReads.vectorStoreOperation(
          access.tenant,
          UuidSchema.parse(request.params.id),
          UuidSchema.parse(request.params.operationId),
        ),
        "Vector-store operation not found",
        "Vector-store operation metadata is inconsistent",
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
