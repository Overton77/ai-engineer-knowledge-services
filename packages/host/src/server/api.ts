import { apiOwnedOperationKinds, type CallbackReplayStore, type KnowledgeOperationPort } from "@aiengineer/knowledge-application";
import { EvidencePacketSchema, type EvidencePacket, type RetrievalCitationReplay } from "@aiengineer/knowledge-contracts";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-core";
import {
  PostgresCallbackReplayStore,
  PostgresCanonicalRepository,
  PostgresKnowledgeOperationService,
  PostgresVerificationComponentDriftPublisher,
  PostgresVerificationRepository,
  createRemoteRetrievalArtifactReader,
  type ResourceReadRepository,
} from "@aiengineer/knowledge-persistence";
import { createGatewayEmbeddingAdapterFromEnvironment, type EmbeddingAdapter } from "@aiengineer/knowledge-retrieval";
import type { TrustedArtifactResolver } from "@aiengineer/knowledge-verification";
import { loadServerConfig, type ServerConfig } from "../config/index.js";
import { constructWithResources } from "../lifecycle/resources.js";
import { createVerificationHostRuntime, type VerificationHostRuntime } from "../verification/host-runtime.js";
import { createVerificationBenchmarkComparisonReads } from "../verification/api/verification-benchmark-comparison-reads-runtime.js";
import { createVerificationBenchmarkReads } from "../verification/api/verification-benchmark-reads-runtime.js";
import { createVerificationReads } from "../verification/api/verification-reads-runtime.js";
import { openCanonicalRepository, type HostEnvironment } from "./shared.js";

/** Tenant-scoped drift publication ports built by host for the API-owned drift runtime. */
export interface ComponentDriftPorts {
  forTenant(tenantId: string): {
    createResolver(): TrustedArtifactResolver;
    publisher: PostgresVerificationComponentDriftPublisher;
  };
}

/**
 * Unit 3 seams: API-owned use cases that host constructs through narrow typed
 * factories until they move into application. Each receives only the ports it
 * already requires; request authorization and admission stay in their owners.
 */
export interface ApiCompositionSeams<TRetrieval, TDrift, TVerification> {
  /** Unit 3: canonical retrieval execution moves to application. */
  createCanonicalRetrievalExecutor(ports: {
    readonly database: PostgresCanonicalRepository;
    readonly embeddings: EmbeddingAdapter;
  }): TRetrieval;
  /** Unit 3: service-only drift queue policy moves to application. */
  createVerificationDriftRevalidation(ports: {
    readonly database: PostgresCanonicalRepository;
    readonly serviceIdentitiesJson: string;
    readonly componentMonitorsJson: string | undefined;
    readonly componentPublicKeysJson: string | undefined;
    readonly component: ComponentDriftPorts | undefined;
  }): TDrift;
  /** Unit 3: ownership-authorized verification reads and decisions move to application. */
  createVerificationUseCases(ports: {
    readonly database: PostgresCanonicalRepository | undefined;
    readonly environment: HostEnvironment;
    readonly verification: VerificationHostRuntime;
  }): TVerification;
}

export interface ApiHostOptions<TRetrieval, TDrift, TVerification> {
  readonly profile: "server";
  readonly role: "api";
  readonly environment: HostEnvironment;
  /** Transport-owned public-origin validation, applied before any resource opens. Required so production cannot skip it. */
  readonly resolvePublicOrigin: (config: ServerConfig) => string | undefined;
  readonly seams: ApiCompositionSeams<TRetrieval, TDrift, TVerification>;
}

export interface ApiHost<TRetrieval, TDrift, TVerification> {
  readonly profile: "server";
  readonly role: "api";
  readonly config: ServerConfig;
  readonly publicOrigin: string | undefined;
  readonly capabilities: {
    readonly persistence: boolean;
    readonly retrieval: boolean;
    readonly citationReplay: boolean;
    readonly verification: boolean;
  };
  readonly operations?: {
    readonly service: KnowledgeOperationPort;
    readonly retrieval: KnowledgeOperationPort;
    readonly callbackReplay: CallbackReplayStore;
  };
  readonly knowledge: {
    readonly resources?: ResourceReadRepository;
    readonly getEvidencePacket?: (tenantId: string, packetId: string) => Promise<EvidencePacket | undefined>;
    readonly replayEvidencePacketCitations?: (tenantId: string, packetId: string) => Promise<RetrievalCitationReplay>;
    readonly canonicalRetrievalExecutor?: TRetrieval;
  };
  readonly verify: {
    readonly runtime: VerificationHostRuntime;
    readonly reads?: NonNullable<ReturnType<typeof createVerificationReads>>;
    readonly benchmarkReads?: NonNullable<ReturnType<typeof createVerificationBenchmarkReads>>;
    readonly benchmarkComparisonReads?: NonNullable<ReturnType<typeof createVerificationBenchmarkComparisonReads>>;
    readonly driftRevalidation?: TDrift;
    readonly useCases: TVerification;
  };
  close(): Promise<void>;
}

function parseDriftToggle(environment: HostEnvironment): "0" | "1" {
  const enabled = environment.VERIFICATION_DRIFT_REVALIDATION_ENABLED?.trim() ?? "0";
  if (enabled !== "0" && enabled !== "1") throw new Error("VERIFICATION_DRIFT_REVALIDATION_ENABLED_INVALID");
  return enabled;
}

function composeComponentDrift(
  database: PostgresCanonicalRepository,
  environment: HostEnvironment,
): ComponentDriftPorts {
  const projectUrl = environment.SUPABASE_URL?.trim(),
    serviceRoleKey = environment.SUPABASE_SECRET_KEY?.trim();
  if (!projectUrl || !serviceRoleKey) throw new Error("VERIFICATION_COMPONENT_DRIFT_STORAGE_REQUIRED");
  const storageBucket = environment.VERIFICATION_STORAGE_BUCKET?.trim() || "ai-engineer-cloud-bucket";
  const store = new SupabaseArtifactStore({ projectUrl, serviceRoleKey, bucket: storageBucket, maximumBytes: 4_194_304 });
  return {
    forTenant(tenantId) {
      const repository = new PostgresVerificationRepository(database, store, {
        async authorize(input) {
          if (input.tenantId !== tenantId || input.purpose !== "verification_replay")
            throw new Error("COMPONENT_DRIFT_ARTIFACT_DENIED");
        },
      });
      return {
        createResolver: () => repository.createTrustedArtifactResolver(),
        publisher: new PostgresVerificationComponentDriftPublisher(database, repository, { storageBucket }),
      };
    },
  };
}

function composeCitationReplay(database: PostgresCanonicalRepository, environment: HostEnvironment) {
  // Citation replay reads sealed bytes from remote object custody, never from producer files.
  const projectUrl = environment.SUPABASE_URL?.trim(),
    serviceRoleKey = environment.SUPABASE_SECRET_KEY?.trim();
  if (!projectUrl || !serviceRoleKey) return undefined;
  const buckets = (environment.KNOWLEDGE_RETRIEVAL_ARTIFACT_BUCKETS?.trim() || "ai-engineer-cloud-bucket")
    .split(",")
    .map((bucket) => bucket.trim())
    .filter(Boolean);
  const read = createRemoteRetrievalArtifactReader(database, { projectUrl, serviceRoleKey, buckets });
  return (tenantId: string, packetId: string) => database.replayEvidencePacketCitations(tenantId, packetId, read);
}

/**
 * Server API composition. Construction order and configuration failures match the
 * previous API bootstrap; any failure releases the database pool before rethrowing.
 */
export async function createApiHost<TRetrieval, TDrift, TVerification>(
  options: ApiHostOptions<TRetrieval, TDrift, TVerification>,
): Promise<ApiHost<TRetrieval, TDrift, TVerification>> {
  const { environment, seams } = options;
  const config = loadServerConfig(environment as NodeJS.ProcessEnv);
  const production = config.NODE_ENV === "production";
  const connectionString = environment.POSTGRES_URL?.trim();
  if (production && !connectionString) throw new Error("POSTGRES_URL_REQUIRED");
  const publicOrigin = options.resolvePublicOrigin(config);
  const { value, resources } = await constructWithResources((resources) => {
    const database = connectionString ? openCanonicalRepository(resources, connectionString, environment) : undefined;
    let driftRevalidation: TDrift | undefined;
    const driftServiceIdentities = environment.VERIFICATION_DRIFT_CONSUMER_SERVICE_IDENTITIES_JSON?.trim();
    if (parseDriftToggle(environment) === "1") {
      if (!database || !driftServiceIdentities || driftServiceIdentities.length > 16_384)
        throw new Error("VERIFICATION_DRIFT_REVALIDATION_RUNTIME_REQUIRED");
      const componentMonitorsJson = environment.VERIFICATION_COMPONENT_DRIFT_MONITORS_JSON?.trim();
      const componentPublicKeysJson = environment.VERIFICATION_COMPONENT_DRIFT_PUBLIC_KEYS_JSON?.trim();
      const component =
        componentMonitorsJson && componentPublicKeysJson ? composeComponentDrift(database, environment) : undefined;
      driftRevalidation = seams.createVerificationDriftRevalidation({
        database,
        serviceIdentitiesJson: driftServiceIdentities,
        componentMonitorsJson,
        componentPublicKeysJson,
        component,
      });
    } else if (driftServiceIdentities) throw new Error("VERIFICATION_DRIFT_REVALIDATION_DISABLED_CONFIG_PRESENT");
    const gatewayConfigured = Boolean(environment.AI_GATEWAY_API_KEY?.trim() || environment.VERCEL_OIDC_TOKEN?.trim());
    const canonicalRetrievalExecutor =
      database && gatewayConfigured
        ? seams.createCanonicalRetrievalExecutor({
            database,
            embeddings: createGatewayEmbeddingAdapterFromEnvironment(environment as NodeJS.ProcessEnv),
          })
        : undefined;
    const replayEvidencePacketCitations = database ? composeCitationReplay(database, environment) : undefined;
    const verification = createVerificationHostRuntime(database, environment, {
      production,
      extraAdmittedKinds:
        environment.VERIFICATION_ADJUDICATION_DECISIONS_ENABLED?.trim() === "1"
          ? ["verification_adjudication_decision"]
          : [],
    });
    const reads = createVerificationReads(database, environment);
    const benchmarkReads = createVerificationBenchmarkReads(database, environment);
    const benchmarkComparisonReads = createVerificationBenchmarkComparisonReads(database, environment);
    const useCases = seams.createVerificationUseCases({ database, environment, verification });
    return {
      config,
      publicOrigin,
      capabilities: {
        persistence: Boolean(database),
        retrieval: Boolean(canonicalRetrievalExecutor),
        citationReplay: Boolean(replayEvidencePacketCitations),
        verification: verification.verificationConfigured,
      },
      ...(database
        ? {
            operations: {
              service: new PostgresKnowledgeOperationService(database),
              retrieval: new PostgresKnowledgeOperationService(database, {
                admittedOperationKinds: apiOwnedOperationKinds,
              }),
              callbackReplay: new PostgresCallbackReplayStore(database),
            },
          }
        : {}),
      knowledge: {
        ...(database
          ? {
              resources: database,
              getEvidencePacket: async (tenantId: string, packetId: string) => {
                const packet = await database.getEvidencePacket(tenantId, packetId);
                return packet === undefined ? undefined : EvidencePacketSchema.parse(packet);
              },
            }
          : {}),
        ...(replayEvidencePacketCitations ? { replayEvidencePacketCitations } : {}),
        ...(canonicalRetrievalExecutor ? { canonicalRetrievalExecutor } : {}),
      },
      verify: {
        runtime: verification,
        ...(reads ? { reads } : {}),
        ...(benchmarkReads ? { benchmarkReads } : {}),
        ...(benchmarkComparisonReads ? { benchmarkComparisonReads } : {}),
        ...(driftRevalidation ? { driftRevalidation } : {}),
        useCases,
      },
    };
  });
  return { profile: "server", role: "api", ...value, close: () => resources.close() };
}
