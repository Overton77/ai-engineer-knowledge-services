import { createVerificationProviderReconciliationService } from "./verification-provider-reconciliation-runtime.js";
import { createVerificationCaptureReads } from "./verification-capture-reads-runtime.js";
import { createVerificationBenchmarkCaptureProfileResolver } from "./verification-benchmark-capture-profile.js";
import { createVerificationSemanticReconciliationService } from "./verification-semantic-reconciliation-runtime.js";
import { apiOwnedOperationKinds } from "@aiengineer/knowledge-application";
import {
  createLocalIdentityResolver,
  loadServerConfig,
} from "@aiengineer/knowledge-config";
import { EvidencePacketSchema } from "@aiengineer/knowledge-contracts";
import {
  PostgresCallbackReplayStore,
  PostgresCanonicalRepository,
  PostgresKnowledgeOperationService,
  PostgresVerificationComponentDriftPublisher,
  PostgresVerificationRepository,
  createRemoteRetrievalArtifactReader,
  createVerificationHostRuntime,
} from "@aiengineer/knowledge-persistence";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { buildServer } from "./server.js";
import { createCallbackSigningSecretResolver } from "./a2a-http.js";
import { createGatewayEmbeddingAdapterFromEnvironment } from "@aiengineer/knowledge-embeddings";
import { CanonicalRetrievalExecutor } from "./retrieval-executor.js";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { createVerificationReads } from "./verification-reads-runtime.js";
import { createVerificationBenchmarkReads } from "./verification-benchmark-reads-runtime.js";
import { createVerificationBenchmarkComparisonReads } from "./verification-benchmark-comparison-reads-runtime.js";
import { createVerificationStructuredExtractionReads } from "./verification-structured-extraction-reads-runtime.js";
import { createVerificationAuditInspectionReads } from "./verification-audit-inspection-reads-runtime.js";
import { createVerificationClaimsReportReads } from "./verification-claims-report-reads-runtime.js";
import { createVerificationAdjudicationDecisionRuntime } from "./verification-adjudication-decision-runtime.js";
import { createVerificationAdjudicationReads } from "./verification-adjudication-reads-runtime.js";
import { createVerificationDriftRevalidationRuntime } from "./verification-drift-revalidation-runtime.js";

// Trusted host composition injects the same accounted adapter used by selected publication.
export { buildServer, CanonicalRetrievalExecutor };

type Environment = Readonly<Record<string, string | undefined>>;

export function validateApiPublicOrigin(
  value: string | undefined,
  production: boolean,
): string | undefined {
  if (!value?.trim()) {
    if (production) throw new Error("KNOWLEDGE_API_URL_REQUIRED");
    return undefined;
  }
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && !production))
  )
    throw new Error("INVALID_KNOWLEDGE_API_URL");
  return url.origin;
}

export async function createApiRuntime(environment: Environment = process.env) {
  const config = loadServerConfig(environment as NodeJS.ProcessEnv);
  const connectionString = environment.POSTGRES_URL?.trim();
  if (config.NODE_ENV === "production" && !connectionString)
    throw new Error("POSTGRES_URL_REQUIRED");
  const publicOrigin = validateApiPublicOrigin(
    environment.KNOWLEDGE_API_URL,
    config.NODE_ENV === "production",
  );
  const database = connectionString
    ? new PostgresCanonicalRepository({
        connectionString,
        ...(environment.CANONICAL_LOCAL_ONLY === "1"
          ? { localOnly: true }
          : {}),
      })
    : undefined;
  const driftEnabled =
    environment.VERIFICATION_DRIFT_REVALIDATION_ENABLED?.trim() ?? "0";
  if (!["0", "1"].includes(driftEnabled))
    throw new Error("VERIFICATION_DRIFT_REVALIDATION_ENABLED_INVALID");
  const driftAllowlistRaw =
    environment.VERIFICATION_DRIFT_CONSUMER_SERVICE_IDENTITIES_JSON?.trim();
  let verificationDriftRevalidation:
    | ReturnType<typeof createVerificationDriftRevalidationRuntime>
    | undefined;
  if (driftEnabled === "1") {
    if (!database || !driftAllowlistRaw || driftAllowlistRaw.length > 16_384)
      throw new Error("VERIFICATION_DRIFT_REVALIDATION_RUNTIME_REQUIRED");
    const componentMonitorsRaw =
      environment.VERIFICATION_COMPONENT_DRIFT_MONITORS_JSON?.trim();
    const componentPublicKeysRaw =
      environment.VERIFICATION_COMPONENT_DRIFT_PUBLIC_KEYS_JSON?.trim();
    let component: Parameters<
      typeof createVerificationDriftRevalidationRuntime
    >[4];
    if (componentMonitorsRaw && componentPublicKeysRaw) {
      const projectUrl = environment.SUPABASE_URL?.trim(),
        serviceRoleKey = environment.SUPABASE_SECRET_KEY?.trim();
      if (!projectUrl || !serviceRoleKey)
        throw new Error("VERIFICATION_COMPONENT_DRIFT_STORAGE_REQUIRED");
      const storageBucket =
        environment.VERIFICATION_STORAGE_BUCKET?.trim() ||
        "ai-engineer-cloud-bucket";
      const store = new SupabaseArtifactStore({
        projectUrl,
        serviceRoleKey,
        bucket: storageBucket,
        maximumBytes: 4_194_304,
      });
      component = {
        forTenant(tenantId) {
          const repository = new PostgresVerificationRepository(
            database,
            store,
            {
              async authorize(input) {
                if (
                  input.tenantId !== tenantId ||
                  input.purpose !== "verification_replay"
                )
                  throw new Error("COMPONENT_DRIFT_ARTIFACT_DENIED");
              },
            },
          );
          return {
            createResolver: () => repository.createTrustedArtifactResolver(),
            publisher: new PostgresVerificationComponentDriftPublisher(
              database,
              repository,
              { storageBucket },
            ),
          };
        },
      };
    }
    verificationDriftRevalidation = createVerificationDriftRevalidationRuntime(
      database,
      driftAllowlistRaw,
      componentMonitorsRaw,
      componentPublicKeysRaw,
      component,
    );
  } else if (driftAllowlistRaw)
    throw new Error("VERIFICATION_DRIFT_REVALIDATION_DISABLED_CONFIG_PRESENT");
  const gatewayConfigured = Boolean(
    environment.AI_GATEWAY_API_KEY?.trim() ||
    environment.VERCEL_OIDC_TOKEN?.trim(),
  );
  const canonicalRetrievalExecutor =
    database && gatewayConfigured
      ? new CanonicalRetrievalExecutor(
          database,
          createGatewayEmbeddingAdapterFromEnvironment(
            environment as NodeJS.ProcessEnv,
          ),
        )
      : undefined;
  // Citation replay reads sealed bytes from remote object custody, never from producer files.
  const retrievalStorageUrl = environment.SUPABASE_URL?.trim(),
    retrievalStorageKey = environment.SUPABASE_SECRET_KEY?.trim();
  const retrievalBuckets = (
    environment.KNOWLEDGE_RETRIEVAL_ARTIFACT_BUCKETS?.trim() ||
    "ai-engineer-cloud-bucket"
  )
    .split(",")
    .map((bucket) => bucket.trim())
    .filter(Boolean);
  const replayEvidencePacketCitations =
    database && retrievalStorageUrl && retrievalStorageKey
      ? (() => {
          const read = createRemoteRetrievalArtifactReader(database, {
            projectUrl: retrievalStorageUrl,
            serviceRoleKey: retrievalStorageKey,
            buckets: retrievalBuckets,
          });
          return (tenantId: string, packetId: string) =>
            database.replayEvidencePacketCitations(tenantId, packetId, read);
        })()
      : undefined;
  const ownershipGrants =
    environment.VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON?.trim();
  const verificationHost = createVerificationHostRuntime(
    database,
    environment,
    {
      production: config.NODE_ENV === "production",
      extraAdmittedKinds:
        environment.VERIFICATION_ADJUDICATION_DECISIONS_ENABLED?.trim() === "1"
          ? ["verification_adjudication_decision"]
          : [],
    },
  );
  const verificationReads = createVerificationReads(database, environment);
  const verificationBenchmarkReads = createVerificationBenchmarkReads(
    database,
    environment,
  );
  const verificationBenchmarkComparisonReads =
    createVerificationBenchmarkComparisonReads(database, environment);
  const verificationProviderReconciliation =
    createVerificationProviderReconciliationService(database, environment);
  const verificationSemanticReconciliation =
    createVerificationSemanticReconciliationService(database, environment);
  const verificationStructuredExtractionReads =
    createVerificationStructuredExtractionReads(database, environment);
  const verificationAuditInspectionReads =
    createVerificationAuditInspectionReads(database, environment);
  const verificationClaimsReportReads = createVerificationClaimsReportReads(
    database,
    environment,
  );
  const verificationCaptureReads = createVerificationCaptureReads(
    database,
    environment,
  );
  const benchmarkCaptureProfiles =
    environment.VERIFICATION_BENCHMARK_CAPTURE_PROFILES_JSON?.trim();
  if (benchmarkCaptureProfiles && (!database || !ownershipGrants))
    throw new Error(
      "VERIFICATION_BENCHMARK_CAPTURE_PROFILE_CONFIGURATION_REQUIRED",
    );
  const resolveVerificationBenchmarkCaptureProfile = benchmarkCaptureProfiles
    ? createVerificationBenchmarkCaptureProfileResolver(
        database!,
        benchmarkCaptureProfiles,
        ownershipGrants!,
      )
    : undefined;
  const verificationAdjudicationReadService =
    createVerificationAdjudicationReads(database, environment);
  const decisionRuntime = createVerificationAdjudicationDecisionRuntime(
    database,
    environment,
  );
  if (decisionRuntime && !verificationHost.resolveVerificationContext)
    throw new Error("VERIFICATION_ADJUDICATION_DECISION_OWNERSHIP_REQUIRED");
  const server = buildServer({
    ...(decisionRuntime ?? {}),
    ...(verificationDriftRevalidation ? { verificationDriftRevalidation } : {}),
    ...(verificationBenchmarkReads ? { verificationBenchmarkReads } : {}),
    ...(verificationBenchmarkComparisonReads
      ? { verificationBenchmarkComparisonReads }
      : {}),
    ...(verificationProviderReconciliation
      ? { verificationProviderReconciliation }
      : {}),
    ...(verificationSemanticReconciliation
      ? { verificationSemanticReconciliation }
      : {}),
    ...(verificationStructuredExtractionReads
      ? { verificationStructuredExtractionReads }
      : {}),
    ...(verificationAuditInspectionReads
      ? { verificationAuditInspectionReads }
      : {}),
    ...(verificationClaimsReportReads ? { verificationClaimsReportReads } : {}),
    ...(verificationCaptureReads ? { verificationCaptureReads } : {}),
    ...(resolveVerificationBenchmarkCaptureProfile
      ? { resolveVerificationBenchmarkCaptureProfile }
      : {}),
    ...(verificationAdjudicationReadService
      ? { verificationAdjudicationReadService }
      : {}),
    ...(verificationReads
      ? { verificationReads, verificationCaseReads: verificationReads.cases }
      : {}),
    ...(publicOrigin ? { publicOrigin } : {}),
    resolveIdentity: createLocalIdentityResolver(
      environment.KNOWLEDGE_API_IDENTITIES,
    ),
    resolveCallbackSigningSecret: createCallbackSigningSecretResolver(
      environment.KNOWLEDGE_CALLBACK_SIGNING_KEYS,
    ),
    ...(database
      ? {
          operationService: new PostgresKnowledgeOperationService(database),
          retrievalOperationService: new PostgresKnowledgeOperationService(
            database,
            { admittedOperationKinds: apiOwnedOperationKinds },
          ),
          callbackReplayStore: new PostgresCallbackReplayStore(database),
          resourceReader: database,
          ...(verificationHost.verificationConfigured
            ? {
                ...(verificationHost.verificationOperationService
                  ? {
                      verificationOperationService:
                        verificationHost.verificationOperationService,
                    }
                  : {}),
                ...(verificationHost.verificationCaptureCatalog
                  ? {
                      verificationCaptureCatalog:
                        verificationHost.verificationCaptureCatalog,
                    }
                  : {}),
                ...(verificationHost.isParseArtifactRequestAdmitted
                  ? {
                      isParseArtifactRequestAdmitted:
                        verificationHost.isParseArtifactRequestAdmitted,
                    }
                  : {}),
                ...(verificationHost.isStructuredExtractionRequestAdmitted
                  ? {
                      isStructuredExtractionRequestAdmitted:
                        verificationHost.isStructuredExtractionRequestAdmitted,
                    }
                  : {}),
                ...(verificationHost.isBenchmarkRequestAdmitted
                  ? {
                      isBenchmarkRequestAdmitted:
                        verificationHost.isBenchmarkRequestAdmitted,
                    }
                  : {}),
                ...(verificationHost.isBenchmarkComparisonRequestAdmitted
                  ? {
                      isBenchmarkComparisonRequestAdmitted:
                        verificationHost.isBenchmarkComparisonRequestAdmitted,
                    }
                  : {}),
                ...(verificationHost.isClaimsRequestAdmitted
                  ? {
                      isClaimsRequestAdmitted:
                        verificationHost.isClaimsRequestAdmitted,
                    }
                  : {}),
                ...(verificationHost.isAuditInspectionRequestAdmitted
                  ? {
                      isAuditInspectionRequestAdmitted:
                        verificationHost.isAuditInspectionRequestAdmitted,
                    }
                  : {}),
                ...(verificationHost.isAdjudicationRequestAdmitted
                  ? {
                      isAdjudicationRequestAdmitted:
                        verificationHost.isAdjudicationRequestAdmitted,
                    }
                  : {}),
                ...(verificationHost.resolveVerificationContext
                  ? {
                      resolveVerificationContext:
                        verificationHost.resolveVerificationContext,
                    }
                  : {}),
              }
            : {}),
          ...(canonicalRetrievalExecutor ? { canonicalRetrievalExecutor } : {}),
          ...(replayEvidencePacketCitations
            ? { replayEvidencePacketCitations }
            : {}),
          getEvidencePacket: async (tenantId: string, packetId: string) => {
            const packet = await database.getEvidencePacket(tenantId, packetId);
            return packet === undefined
              ? undefined
              : EvidencePacketSchema.parse(packet);
          },
        }
      : {}),
  });
  return {
    config,
    database,
    server,
    retrievalConfigured: Boolean(canonicalRetrievalExecutor),
    citationReplayConfigured: Boolean(replayEvidencePacketCitations),
    verificationConfigured: verificationHost.verificationConfigured,
  };
}

let serverlessRuntime: ReturnType<typeof createApiRuntime> | undefined;
const getServerlessRuntime = () => (serverlessRuntime ??= createApiRuntime());

export function createApiRequestHandler(
  runtime: () => Promise<
    Pick<Awaited<ReturnType<typeof createApiRuntime>>, "server">
  >,
) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const { server } = await runtime();
    await server.ready();
    await new Promise<void>((resolve, reject) => {
      response.once("finish", resolve);
      response.once("error", reject);
      server.server.emit("request", request, response);
    });
  };
}

/** Vercel Node function entrypoint; the Fastify/runtime singleton survives warm invocations. */
const handler = createApiRequestHandler(getServerlessRuntime);
export default handler;

async function main() {
  const { config, database, server } = await createApiRuntime();
  await server.listen({ host: config.HOST, port: config.PORT });
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    void server
      .close()
      .then(() => database?.close())
      .catch((error) => {
        process.stderr.write(
          `${JSON.stringify({ event: "knowledge.api.shutdown_failed", signal, error: error instanceof Error ? error.message : "unknown" })}\n`,
        );
        process.exitCode = 1;
      });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({ event: "knowledge.api.start_failed", error: error instanceof Error ? error.message : "unknown" })}\n`,
    );
    process.exitCode = 1;
  });
