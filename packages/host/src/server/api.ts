import {
  apiOwnedOperationKinds,
  type CallbackReplayStore,
  type KnowledgeOperationPort,
} from "@aiengineer/knowledge-application";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-core";
import {
  PostgresCallbackReplayStore,
  PostgresCanonicalRepository,
  PostgresKnowledgeOperationService,
  PostgresVerificationComponentDriftPublisher,
  PostgresVerificationRepository,
} from "@aiengineer/knowledge-persistence";
import type { TrustedArtifactResolver } from "@aiengineer/knowledge-verification";
import { loadServerConfig, type ServerConfig } from "../config/index.js";
import { constructWithResources } from "../lifecycle/resources.js";
import { createVerificationDriftRevalidationRuntime } from "../verification/api/verification-drift-revalidation-runtime.js";
import { composeKnowledgeServices, type KnowledgeServices } from "./knowledge.js";
import { openCanonicalRepository, type HostEnvironment } from "./shared.js";
import { composeVerificationServices, type VerificationServices } from "./verification.js";

/** Tenant-scoped drift publication ports built by host for the drift revalidation queue. */
export interface ComponentDriftPorts {
  forTenant(tenantId: string): {
    createResolver(): TrustedArtifactResolver;
    publisher: PostgresVerificationComponentDriftPublisher;
  };
}

export interface ApiHostOptions {
  readonly profile: "server";
  readonly role: "api";
  readonly environment: HostEnvironment;
  /** Transport-owned public-origin validation, applied before any resource opens. Required so production cannot skip it. */
  readonly resolvePublicOrigin: (config: ServerConfig) => string | undefined;
}

/** Service-only drift revalidation queue; composed only for the API's internal consumer routes. */
export type VerificationDriftRevalidation = ReturnType<typeof createVerificationDriftRevalidationRuntime>;

export interface ApiHost {
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
  readonly knowledge: KnowledgeServices;
  readonly verify: VerificationServices & {
    readonly driftRevalidation?: VerificationDriftRevalidation;
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
  const store = new SupabaseArtifactStore({
    projectUrl,
    serviceRoleKey,
    bucket: storageBucket,
    maximumBytes: 4_194_304,
  });
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

/**
 * Server API composition. Construction order and configuration failures match the
 * previous API bootstrap; any failure releases the database pool before rethrowing.
 */
export async function createApiHost(options: ApiHostOptions): Promise<ApiHost> {
  const { environment } = options;
  const config = loadServerConfig(environment as NodeJS.ProcessEnv);
  const production = config.NODE_ENV === "production";
  const connectionString = environment.POSTGRES_URL?.trim();
  if (production && !connectionString) throw new Error("POSTGRES_URL_REQUIRED");
  const publicOrigin = options.resolvePublicOrigin(config);
  const { value, resources } = await constructWithResources((resources) => {
    const database = connectionString ? openCanonicalRepository(resources, connectionString, environment) : undefined;
    let driftRevalidation: VerificationDriftRevalidation | undefined;
    const driftServiceIdentities = environment.VERIFICATION_DRIFT_CONSUMER_SERVICE_IDENTITIES_JSON?.trim();
    if (parseDriftToggle(environment) === "1") {
      if (!database || !driftServiceIdentities || driftServiceIdentities.length > 16_384)
        throw new Error("VERIFICATION_DRIFT_REVALIDATION_RUNTIME_REQUIRED");
      const componentMonitorsJson = environment.VERIFICATION_COMPONENT_DRIFT_MONITORS_JSON?.trim();
      const componentPublicKeysJson = environment.VERIFICATION_COMPONENT_DRIFT_PUBLIC_KEYS_JSON?.trim();
      const component =
        componentMonitorsJson && componentPublicKeysJson ? composeComponentDrift(database, environment) : undefined;
      driftRevalidation = createVerificationDriftRevalidationRuntime(
        database,
        driftServiceIdentities,
        componentMonitorsJson,
        componentPublicKeysJson,
        component,
      );
    } else if (driftServiceIdentities) throw new Error("VERIFICATION_DRIFT_REVALIDATION_DISABLED_CONFIG_PRESENT");
    const knowledge = composeKnowledgeServices(database, environment);
    const verify = composeVerificationServices(database, environment, { production });
    return {
      config,
      publicOrigin,
      capabilities: {
        persistence: Boolean(database),
        retrieval: Boolean(knowledge.canonicalRetrievalExecutor),
        citationReplay: Boolean(knowledge.replayEvidencePacketCitations),
        verification: verify.runtime.verificationConfigured,
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
      knowledge,
      verify: { ...verify, ...(driftRevalidation ? { driftRevalidation } : {}) },
    };
  });
  return { profile: "server", role: "api", ...value, close: () => resources.close() };
}
