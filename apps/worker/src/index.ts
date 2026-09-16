import { parseSemanticJudgeProfileCatalog } from "@aiengineer/knowledge-application";
import {
  TrustedVerificationSourceAcquirer,
  VerificationSourceAcquisitionCatalog,
} from "@aiengineer/knowledge-application";
import { lookup as resolveAcquisitionHost } from "node:dns/promises";
import { pathToFileURL } from "node:url";
import { ExactHttpAcquisitionAdapter } from "@aiengineer/knowledge-acquisition";
import {
  createIntegrationService,
  createKnowledgeApplication,
  VerificationAdmissionService,
  ParseArtifactApplicationService,
  VerificationServiceCatalog,
  VerificationMetricApplicationService,
  VerificationMetricProfileCatalog,
  VerificationSealPolicyCatalog,
  VerificationAdjudicationReadService,
  VerificationClaimsApplicationService,
  VerificationClaimsProjectionGrantCatalog,
  type VerificationClaimsProjectionGrant,
} from "@aiengineer/knowledge-application";
import {
  createGatewayEmbeddingAdapterFromEnvironment,
  type EmbeddingAdapter,
} from "@aiengineer/knowledge-embeddings";
import {
  createDoclingServeClientFromEnvironment,
  DeterministicTextConversionProvider,
  DoclingServeProvider,
  HttpUnstructuredTransformClient,
  UnstructuredTransformProvider,
  SandboxedVerificationParser,
  VERIFICATION_PARSER_LIMITS,
  type DocumentConversionProvider,
} from "@aiengineer/knowledge-conversion";
import {
  canonicalPersistenceConfigFromEnvironment,
  createCanonicalPersistence,
  PostgresGovernedIndexRepository,
  type PromotionSelectionConfiguration,
  PostgresPreparationRepository,
  PostgresVectorStoreLifecycleRepository,
  PostgresVerificationRepository,
  PostgresVerificationAdjudicationRepository,
  PostgresVerificationAdjudicationReadRepository,
  createVerificationAdjudicationRequestService,
} from "@aiengineer/knowledge-persistence";
import {
  SupabaseArtifactStore,
  type ArtifactStore,
} from "@aiengineer/knowledge-runtime";
import {
  createCanonicalActivityExecutor,
  createProductionActivityRegistry,
} from "./activity-registry.js";
import {
  parsePromotionSelectionAuthorityLocator,
  resolvePromotionSelectionHost,
} from "./promotion-selection.js";
import { CanonicalDurableKnowledgeWorker } from "./canonical-worker.js";
import { DurableKnowledgeWorker } from "./worker.js";
import {
  createVerificationOperationExecutor,
  verificationActivityHandlers,
} from "./verification-activities.js";
import { verificationMetricActivityHandler } from "./verification-metric-activity.js";
import { createVerificationMetricAuditSealer } from "./verification-metric-sealer.js";
import {
  createVerificationClaimsSemanticStage,
  parseClaimsSemanticRuntimeConfiguration,
} from "./verification-claims-semantic-stage.js";
import { createVerificationClaimsAuditSealer } from "./verification-claims-sealer.js";
import { claimsHostActivation, createClaimsSourceAuthorityStage, parseSourceAuthorityPins } from "./verification-claims-source-authority.js";
import { createConfiguredVerificationAuditSigner } from "./verification-audit-signing-runtime.js";
import { verificationClaimsActivityHandler } from "./verification-claims-activity.js";
import { verificationSealedReplayActivityHandler } from "./verification-sealed-replay-activity.js";
import { createVerificationSealedMetricReplay } from "./verification-sealed-replay-runtime.js";
import {
  PostgresVerificationClaimsRuntimePrincipals,
  PostgresVerificationMetricRuntimePrincipals,
} from "@aiengineer/knowledge-persistence";
import {
  digestCanonicalJson,
  projectionSelectorResolver,
} from "@aiengineer/knowledge-verification";
import { createConfiguredVerificationBenchmarkHandler } from "./verification-benchmark-runtime.js";
import { createConfiguredVerificationBenchmarkComparisonHandler } from "./verification-benchmark-comparison-runtime.js";
import { createConfiguredVerificationStructuredExtractionHandler } from "./verification-structured-extraction-runtime.js";
import { verificationParseArtifactActivityHandler } from "./verification-parse-activity.js";
import {
  createVerificationAuditInspectionHandler,
  parseVerificationAuditInspectionPublicKeys,
} from "./verification-audit-inspection-runtime.js";
import { createVerificationAdjudicationRequestHandler } from "./verification-adjudication-runtime.js";
import { createVerificationAdjudicationDecisionHandler } from "./verification-adjudication-decision-runtime.js";
import {
  UuidSchema,
  VerificationAdjudicationReviewRequirementsSchema,
} from "@aiengineer/knowledge-contracts";
import { VerificationAuditInspectionGrantCatalog } from "@aiengineer/knowledge-application";
import { z } from "zod";

export { CanonicalDurableKnowledgeWorker } from "./canonical-worker.js";
export { DurableKnowledgeWorker } from "./worker.js";
export * from "./activity-registry.js";
export {
  composePromotionSelectionWorkerHost,
  createCanonicalPromotionSelectionApplication,
  createPromotionSelectionConfiguration,
  parsePromotionSelectionAuthorityLocator,
  PromotionSelectionAuthorityLocatorSchema,
  resolvePromotionSelectionHost,
} from "./promotion-selection.js";
export type {
  CanonicalPromotionSelectionConfiguration,
  ComposedPromotionSelectionHost,
} from "./promotion-selection.js";
export * from "./verification-activities.js";
export * from "./verification-audit-inspection-activity.js";
export * from "./verification-audit-inspection-runtime.js";
export * from "./verification-adjudication-activity.js";
export * from "./verification-adjudication-runtime.js";
export * from "./verification-adjudication-decision-activity.js";
export * from "./verification-adjudication-decision-runtime.js";

export interface RunningWorker {
  readonly mode: "postgres" | "memory";
  stop(signal?: string): Promise<void>;
}

type Environment = Readonly<Record<string, string | undefined>>;

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`INVALID_${name}`);
  return parsed;
}

/** Adjudication has a separate complete server-owned trust set. */
export function parseVerificationAdjudicationRuntimeConfiguration(
  environment: Environment,
) {
  const grantsJson = environment.VERIFICATION_ADJUDICATION_GRANTS_JSON?.trim();
  const requirementsJson =
    environment.VERIFICATION_ADJUDICATION_REVIEW_REQUIREMENTS_JSON?.trim();
  const publicKeysJson =
    environment.VERIFICATION_ADJUDICATION_PUBLIC_KEYS_JSON?.trim();
  const configured = [grantsJson, requirementsJson, publicKeysJson].filter(
    (value) => value !== undefined,
  ).length;
  if (configured === 0) return undefined;
  if (configured !== 3)
    throw new Error("VERIFICATION_ADJUDICATION_RUNTIME_CONFIGURATION_REQUIRED");
  if (grantsJson!.length > 262_144 || requirementsJson!.length > 262_144)
    throw new Error(
      "VERIFICATION_ADJUDICATION_RUNTIME_CONFIGURATION_TOO_LARGE",
    );
  let grants: unknown, requirements: unknown;
  try {
    grants = JSON.parse(grantsJson!);
    requirements = JSON.parse(requirementsJson!);
  } catch {
    throw new Error("VERIFICATION_ADJUDICATION_RUNTIME_CONFIGURATION_INVALID");
  }
  try {
    return Object.freeze({
      auditGrants: new VerificationAuditInspectionGrantCatalog(grants),
      reviewRequirements:
        VerificationAdjudicationReviewRequirementsSchema.parse(requirements),
      trustedPublicKeys: parseVerificationAuditInspectionPublicKeys(
        publicKeysJson!,
      ),
      ...(environment.VERIFICATION_SEMANTIC_PROFILE_GRANTS_JSON
        ? {
            semanticProfiles: parseSemanticJudgeProfileCatalog(
              environment.VERIFICATION_SEMANTIC_PROFILE_GRANTS_JSON,
            ),
          }
        : {}),
    });
  } catch {
    throw new Error("VERIFICATION_ADJUDICATION_RUNTIME_CONFIGURATION_INVALID");
  }
}

const syntheticReviewerGrantSchema = z.strictObject({
  tenantId: z.string().uuid(),
  actorId: z.string().uuid(),
  role: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
});

/** Decision recording is disabled unless explicitly enabled. Synthetic reviewers
 * are an exact server-owned allowlist; human authority remains database-backed. */
export function parseVerificationAdjudicationDecisionRuntimeConfiguration(
  environment: Environment,
) {
  const enabled =
    environment.VERIFICATION_ADJUDICATION_DECISIONS_ENABLED?.trim();
  const grantsJson =
    environment.VERIFICATION_ADJUDICATION_SYNTHETIC_REVIEWER_GRANTS_JSON?.trim();
  if (enabled === undefined || enabled === "0") {
    if (grantsJson)
      throw new Error(
        "VERIFICATION_ADJUDICATION_DECISION_RUNTIME_CONFIGURATION_REQUIRED",
      );
    return undefined;
  }
  if (enabled !== "1")
    throw new Error("INVALID_VERIFICATION_ADJUDICATION_DECISIONS_ENABLED");
  if (!grantsJson)
    return Object.freeze({ syntheticReviewerGrants: Object.freeze([]) });
  if (grantsJson.length > 262_144)
    throw new Error(
      "VERIFICATION_ADJUDICATION_SYNTHETIC_REVIEWER_GRANTS_TOO_LARGE",
    );
  try {
    return Object.freeze({
      syntheticReviewerGrants: Object.freeze(
        z
          .array(syntheticReviewerGrantSchema)
          .max(256)
          .parse(JSON.parse(grantsJson)),
      ),
    });
  } catch {
    throw new Error(
      "VERIFICATION_ADJUDICATION_SYNTHETIC_REVIEWER_GRANTS_INVALID",
    );
  }
}

/** Limits a local worker to one canonical operation. Unset preserves normal
 * tenant-wide reconciliation and polling; this is intentionally not a kind filter. */
export function parseWorkerOperationScope(
  environment: Environment,
): string | undefined {
  const raw = environment.WORKER_OPERATION_ID?.trim();
  if (!raw) return undefined;
  try {
    return UuidSchema.parse(raw);
  } catch {
    throw new Error("INVALID_WORKER_OPERATION_ID");
  }
}

export async function reconcileWorkerScope(
  worker: {
    reconcile(): Promise<number>;
    reconcileOperation(operationId: string): Promise<unknown>;
  },
  operationId?: string,
): Promise<number> {
  if (!operationId) return worker.reconcile();
  return (await worker.reconcileOperation(operationId)) === undefined ? 0 : 1;
}

export function runWorkerScope(
  worker: {
    runOnce(): Promise<unknown>;
    runOperationOnce(operationId: string): Promise<unknown>;
  },
  operationId?: string,
): () => Promise<unknown> {
  return operationId
    ? () => worker.runOperationOnce(operationId)
    : () => worker.runOnce();
}

/**
 * Composition-root dependencies the worker process cannot build itself. The
 * canonical promotion-selection ports live in the knowledge executor host,
 * which owns ContentLink reconciliation and remote evidence; the worker only
 * accepts an already-composed authority. Process `main()` cannot build that
 * host: a locator without `promotionSelection` fails closed.
 */
export interface WorkerHostDependencies {
  readonly promotionSelection?: PromotionSelectionConfiguration;
}

export async function startWorker(
  environment: Environment = process.env,
  host: WorkerHostDependencies = {},
): Promise<RunningWorker> {
  const mode = environment.KNOWLEDGE_PERSISTENCE_MODE?.trim() || "postgres";
  if (mode !== "postgres" && mode !== "memory")
    throw new Error("INVALID_KNOWLEDGE_PERSISTENCE_MODE");
  const selectionLocator = parsePromotionSelectionAuthorityLocator(environment);
  const promotionSelection = resolvePromotionSelectionHost({
    host,
    ...(selectionLocator ? { locator: selectionLocator } : {}),
    persistenceMode: mode,
  });
  if (
    mode === "memory" &&
    environment.NODE_ENV !== "development" &&
    environment.NODE_ENV !== "test"
  )
    throw new Error("IN_MEMORY_PERSISTENCE_NOT_ADMITTED");
  const scopedOperationId = parseWorkerOperationScope(environment);
  if (scopedOperationId && mode !== "postgres")
    throw new Error("WORKER_OPERATION_SCOPE_REQUIRES_POSTGRES");
  const auditSigner = createConfiguredVerificationAuditSigner(environment);
  const sourceAuthorityPins = parseSourceAuthorityPins(environment.VERIFICATION_SOURCE_AUTHORITY_PINS_JSON?.trim());
  const claimsEnabled = claimsHostActivation({ mode: environment.VERIFICATION_CLAIMS_ENABLED?.trim(),
    projectionConfigured: Boolean(environment.VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON?.trim()), sourceAuthorityConfigured: Boolean(sourceAuthorityPins),
    policyConfigured: Boolean(environment.VERIFICATION_SEAL_POLICY_GRANTS_JSON?.trim()), signerConfigured: Boolean(auditSigner), nativePersistence: mode === "postgres" });
  const owner = environment.WORKER_ID?.trim() || `worker-${process.pid}`;
  const pollMs = positiveInteger(
    environment.WORKER_POLL_MS,
    1_000,
    "WORKER_POLL_MS",
  );
  const leaseMs = positiveInteger(
    environment.WORKER_LEASE_MS,
    30_000,
    "WORKER_LEASE_MS",
  );
  const application = createKnowledgeApplication();
  let stopping = false;
  let timer: NodeJS.Timeout | undefined;
  let active: Promise<unknown> | undefined;
  let close: () => Promise<void> = async () => undefined;
  let runOnce: () => Promise<unknown>;
  let reconciled = 0;
  let registeredActivities: readonly string[] = [];

  if (mode === "postgres") {
    const tenantId = environment.WORKER_TENANT_ID?.trim();
    if (!tenantId) throw new Error("WORKER_TENANT_ID_REQUIRED");
    const persistenceConfig =
      canonicalPersistenceConfigFromEnvironment(environment);
    const persistence = createCanonicalPersistence(persistenceConfig);
    close = () => persistence.close();
    const maximumArtifactBytes = positiveInteger(
      environment.MAXIMUM_ARTIFACT_BYTES,
      67_108_864,
      "MAXIMUM_ARTIFACT_BYTES",
    );
    const sourceArtifacts = new SupabaseArtifactStore({
      projectUrl: persistenceConfig.supabaseUrl,
      serviceRoleKey: persistenceConfig.supabaseSecretKey,
      bucket: "source-captures",
      maximumBytes: maximumArtifactBytes,
    });
    const derivativeArtifacts = new SupabaseArtifactStore({
      projectUrl: persistenceConfig.supabaseUrl,
      serviceRoleKey: persistenceConfig.supabaseSecretKey,
      bucket: "content-derivatives",
      maximumBytes: maximumArtifactBytes,
    });
    const preparationArtifacts: ArtifactStore = {
      put: (input) => derivativeArtifacts.put(input),
      get: (tenant, digest) => sourceArtifacts.get(tenant, digest),
    };
    const allowedHosts = environment.ACQUISITION_ALLOWED_HOSTS?.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const acquisition = new ExactHttpAcquisitionAdapter(sourceArtifacts, {
      allowedProtocols: [
        "https:",
        ...(environment.ALLOW_INSECURE_HTTP_ACQUISITION === "1"
          ? ["http:" as const]
          : []),
      ],
      allowedPorts: [
        443,
        ...(environment.ALLOW_INSECURE_HTTP_ACQUISITION === "1" ? [80] : []),
      ],
      maximumRedirects: positiveInteger(
        environment.ACQUISITION_MAXIMUM_REDIRECTS,
        5,
        "ACQUISITION_MAXIMUM_REDIRECTS",
      ),
      timeoutMs: positiveInteger(
        environment.ACQUISITION_TIMEOUT_MS,
        30_000,
        "ACQUISITION_TIMEOUT_MS",
      ),
      maximumBytes: maximumArtifactBytes,
      maximumDecompressionRatio: positiveInteger(
        environment.ACQUISITION_MAXIMUM_DECOMPRESSION_RATIO,
        20,
        "ACQUISITION_MAXIMUM_DECOMPRESSION_RATIO",
      ),
      ...(allowedHosts?.length ? { allowedHosts } : {}),
    });
    const conversionProviders: DocumentConversionProvider[] = [
      new DeterministicTextConversionProvider(preparationArtifacts),
      new DoclingServeProvider(
        environment.DOCLING_VERSION?.trim() || "pinned-f8b324448e7c",
        createDoclingServeClientFromEnvironment(environment),
        preparationArtifacts,
      ),
    ];
    const unstructuredBaseUrl =
      environment.UNSTRUCTURED_BASE_URL?.trim() ||
      environment.UNSTRUCTURED_API_URL?.trim();
    if (
      unstructuredBaseUrl &&
      environment.UNSTRUCTURED_API_KEY?.trim() &&
      environment.UNSTRUCTURED_TEMPLATE_ID?.trim()
    ) {
      conversionProviders.unshift(
        new UnstructuredTransformProvider(
          environment.UNSTRUCTURED_VERSION?.trim() || "configured-v1",
          new HttpUnstructuredTransformClient({
            baseUrl: unstructuredBaseUrl,
            apiKey: environment.UNSTRUCTURED_API_KEY.trim(),
            templateId: environment.UNSTRUCTURED_TEMPLATE_ID.trim(),
            maximumResultBytes: maximumArtifactBytes,
          }),
          preparationArtifacts,
        ),
      );
    }
    const verificationCatalogJson =
      environment.VERIFICATION_SERVICE_CATALOG_JSON?.trim();
    const parseArtifactEnabled =
      environment.VERIFICATION_PARSE_ARTIFACT_ENABLED?.trim() === "1";
    const metricCatalogJson =
      environment.VERIFICATION_METRIC_PROFILE_GRANTS_JSON?.trim();
    const claimsCatalogJson =
      environment.VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON?.trim();
    const auditInspectionEnabledValue =
      environment.VERIFICATION_AUDIT_INSPECTION_ENABLED?.trim();
    if (
      auditInspectionEnabledValue &&
      auditInspectionEnabledValue !== "0" &&
      auditInspectionEnabledValue !== "1"
    )
      throw new Error("INVALID_VERIFICATION_AUDIT_INSPECTION_ENABLED");
    const auditInspectionEnabled = auditInspectionEnabledValue === "1";
    const auditInspectionGrantsJson =
      environment.VERIFICATION_AUDIT_INSPECTION_GRANTS_JSON?.trim();
    const auditInspectionKeysJson =
      environment.VERIFICATION_AUDIT_INSPECTION_PUBLIC_KEYS_JSON?.trim();
    if (
      auditInspectionEnabled &&
      (!auditInspectionGrantsJson ||
        !auditInspectionKeysJson ||
        !claimsCatalogJson)
    )
      throw new Error("VERIFICATION_AUDIT_INSPECTION_RUNTIME_GRANTS_REQUIRED");
    const adjudicationRuntimeConfiguration =
      parseVerificationAdjudicationRuntimeConfiguration(environment);
    const adjudicationDecisionRuntimeConfiguration =
      parseVerificationAdjudicationDecisionRuntimeConfiguration(environment);
    if (adjudicationRuntimeConfiguration && !claimsCatalogJson)
      throw new Error("VERIFICATION_ADJUDICATION_PROJECTION_GRANTS_REQUIRED");
    if (
      adjudicationDecisionRuntimeConfiguration &&
      !adjudicationRuntimeConfiguration
    )
      throw new Error(
        "VERIFICATION_ADJUDICATION_DECISION_SUBJECT_READ_RUNTIME_REQUIRED",
      );
    const sealGrantsJson =
      environment.VERIFICATION_SEAL_POLICY_GRANTS_JSON?.trim();
    if (sealGrantsJson && !metricCatalogJson && !claimsEnabled)
      throw new Error("VERIFICATION_SEAL_USE_CASE_CONFIGURATION_REQUIRED");
    if (claimsEnabled && !sealGrantsJson)
      throw new Error("VERIFICATION_CLAIMS_SEAL_CONFIGURATION_REQUIRED");
    if (parseArtifactEnabled && !verificationCatalogJson)
      throw new Error("VERIFICATION_PARSE_ARTIFACT_CATALOG_REQUIRED");
    let verificationHandlers:
      | ReturnType<typeof verificationActivityHandlers>
      | undefined;
    if (
      verificationCatalogJson ||
      metricCatalogJson ||
      claimsEnabled ||
      auditInspectionEnabled ||
      adjudicationRuntimeConfiguration
    ) {
      const imageDigest = environment.VERIFICATION_PARSER_IMAGE_DIGEST?.trim();
      if (!imageDigest || !/^sha256:[a-f0-9]{64}$/u.test(imageDigest))
        throw new Error("VERIFICATION_PARSER_IMAGE_DIGEST_REQUIRED");
      let catalogInput: unknown;
      try {
        catalogInput = verificationCatalogJson
          ? JSON.parse(verificationCatalogJson)
          : undefined;
      } catch {
        throw new Error("VERIFICATION_SERVICE_CATALOG_INVALID");
      }
      const verificationArtifacts = new SupabaseArtifactStore({
        projectUrl: persistenceConfig.supabaseUrl,
        serviceRoleKey: persistenceConfig.supabaseSecretKey,
        bucket:
          environment.VERIFICATION_STORAGE_BUCKET?.trim() ||
          "ai-engineer-cloud-bucket",
        maximumBytes: maximumArtifactBytes,
      });
      const repository = new PostgresVerificationRepository(
        persistence.database,
        verificationArtifacts,
        {
          async authorize(input) {
            if (input.tenantId !== tenantId)
              throw new Error("VERIFICATION_WORKER_TENANT_DENIED");
          },
        },
      );
      const parser = new SandboxedVerificationParser(
        imageDigest as `sha256:${string}`,
        environment.VERIFICATION_PARSER_COMMAND?.trim() || "docker",
      );
      const admission = new VerificationAdmissionService(
        repository,
        parser,
        {
          parserVersion: "verification-native-parser.v1",
          imageDigest: imageDigest as `sha256:${string}`,
          limits: VERIFICATION_PARSER_LIMITS,
        },
        {
          storageBucket:
            environment.VERIFICATION_STORAGE_BUCKET?.trim() ||
            "ai-engineer-cloud-bucket",
          producerVersion: "verification-admission.v1",
          encryptionClass: "supabase-managed",
          retentionClass: "verification-audit",
          now: () => new Date().toISOString(),
        },
      );
      verificationHandlers = [];
      let sealPolicyCatalog: VerificationSealPolicyCatalog | undefined;
      let sealRuntime:
        | Parameters<typeof createVerificationMetricAuditSealer>[0]["runtime"]
        | undefined;
      if (sealGrantsJson) {
        if (sealGrantsJson.length > 262_144)
          throw new Error("VERIFICATION_SEAL_POLICY_GRANTS_TOO_LARGE");
        let sealGrants: unknown;
        try {
          sealGrants = JSON.parse(sealGrantsJson);
        } catch {
          throw new Error("VERIFICATION_SEAL_POLICY_GRANTS_INVALID");
        }
        if (
          !Array.isArray(sealGrants) ||
          sealGrants.length < 1 ||
          sealGrants.length > 256
        )
          throw new Error("VERIFICATION_SEAL_POLICY_GRANTS_INVALID");
        const gitSha = environment.VERIFICATION_CODE_GIT_SHA?.trim(),
          dirty = environment.VERIFICATION_CODE_DIRTY?.trim();
        const platform = environment.VERIFICATION_RUNTIME_PLATFORM?.trim(),
          deploymentId = environment.VERIFICATION_RUNTIME_DEPLOYMENT_ID?.trim();
        if (
          !gitSha ||
          !platform ||
          !deploymentId ||
          !["0", "1"].includes(dirty ?? "")
        )
          throw new Error("VERIFICATION_SEAL_RUNTIME_IDENTITY_REQUIRED");
        sealPolicyCatalog = new VerificationSealPolicyCatalog(sealGrants);
        sealRuntime = {
          code: {
            gitSha,
            dirty: dirty === "1",
            normalizerVersion: "RFC8785.v1",
          },
          platform,
          deploymentId,
        };
      }
      let verificationCatalog: VerificationServiceCatalog | undefined;
      if (verificationCatalogJson) {
        verificationCatalog = new VerificationServiceCatalog(
          catalogInput as ConstructorParameters<
            typeof VerificationServiceCatalog
          >[0],
        );
        const acquireEnabled =
          environment.VERIFICATION_CAPTURE_ACQUIRE_ENABLED?.trim();
        if (acquireEnabled && !["0", "1"].includes(acquireEnabled))
          throw new Error("INVALID_VERIFICATION_CAPTURE_ACQUIRE_ENABLED");
        let sourceAcquirer: TrustedVerificationSourceAcquirer | undefined;
        if (acquireEnabled === "1") {
          if (!verificationCatalog.hasAcquisitionGrants())
            throw new Error("VERIFICATION_ACQUISITION_RUNTIME_GRANTS_REQUIRED");
          const raw =
            environment.VERIFICATION_SOURCE_ACQUISITION_GRANTS_JSON?.trim();
          if (!raw || raw.length > 262_144)
            throw new Error(
              "VERIFICATION_ACQUISITION_TRANSPORT_GRANTS_REQUIRED",
            );
          let value: unknown;
          try {
            value = JSON.parse(raw);
          } catch {
            throw new Error(
              "VERIFICATION_ACQUISITION_TRANSPORT_GRANTS_INVALID",
            );
          }
          if (!Array.isArray(value))
            throw new Error(
              "VERIFICATION_ACQUISITION_TRANSPORT_GRANTS_INVALID",
            );
          sourceAcquirer = new TrustedVerificationSourceAcquirer(
            new VerificationSourceAcquisitionCatalog(value),
            {
              resolve: async (hostname) =>
                (
                  await resolveAcquisitionHost(hostname, {
                    all: true,
                    verbatim: true,
                  })
                ).map((item) => item.address),
            },
            () => new Date().toISOString(),
          );
        }
        const executor = createVerificationOperationExecutor({
          operations: persistence.database,
          repository,
          admission,
          catalog: verificationCatalog,
          ...(sourceAcquirer ? { sourceAcquirer } : {}),
          config: {
            storageBucket:
              environment.VERIFICATION_STORAGE_BUCKET?.trim() ||
              "ai-engineer-cloud-bucket",
            producerVersion: "verification-service.v1",
            encryptionClass: "supabase-managed",
            retentionClass: "verification-audit",
            now: () => new Date().toISOString(),
          },
        });
        verificationHandlers = verificationActivityHandlers(executor);
      }
      if (parseArtifactEnabled) {
        const catalog = verificationCatalog!;
        if (!catalog.hasParseArtifactGrants())
          throw new Error(
            "VERIFICATION_PARSE_ARTIFACT_RUNTIME_GRANTS_REQUIRED",
          );
        const parseService = new ParseArtifactApplicationService(
          repository,
          admission,
          {
            storageBucket:
              environment.VERIFICATION_STORAGE_BUCKET?.trim() ||
              "ai-engineer-cloud-bucket",
            producerVersion: "verification-service.v1",
            encryptionClass: "supabase-managed",
            retentionClass: "verification-audit",
            now: () => new Date().toISOString(),
          },
        );
        verificationHandlers = [
          ...verificationHandlers,
          verificationParseArtifactActivityHandler({
            service: parseService,
            async resolveKind(input) {
              const binding = await repository.getRegisteredCapture({
                tenantId: input.tenantId,
                captureId: input.captureId,
              });
              if (
                digestCanonicalJson(binding.capture.contentArtifact) !==
                digestCanonicalJson(input.sourceArtifact)
              )
                throw new Error("PARSE_ARTIFACT_SOURCE_BINDING_INVALID");
              return catalog.parseArtifact(
                input.captureId,
                input.sourceArtifact,
              ).parserKind;
            },
            async assertActive(input) {
              const operation = await persistence.database.getOperationRecord(
                input.tenantId,
                input.operationId,
              );
              if (!operation || operation.status !== "running")
                throw new Error(
                  operation?.status === "cancelled"
                    ? "PARSE_ARTIFACT_CANCELLED"
                    : "PARSE_ARTIFACT_OPERATION_NOT_ACTIVE",
                );
            },
          }),
        ];
      }
      if (metricCatalogJson) {
        if (metricCatalogJson.length > 262_144)
          throw new Error("VERIFICATION_METRIC_PROFILE_GRANTS_TOO_LARGE");
        let metricGrants: unknown;
        try {
          metricGrants = JSON.parse(metricCatalogJson);
        } catch {
          throw new Error("VERIFICATION_METRIC_PROFILE_GRANTS_INVALID");
        }
        if (
          !Array.isArray(metricGrants) ||
          metricGrants.length < 1 ||
          metricGrants.length > 256
        )
          throw new Error("VERIFICATION_METRIC_PROFILE_GRANTS_INVALID");
        const service = new VerificationMetricApplicationService({
          artifactResolver: repository.createTrustedArtifactResolver(),
          captures: repository,
          profiles: new VerificationMetricProfileCatalog(metricGrants),
          runtimePrincipals: new PostgresVerificationMetricRuntimePrincipals(
            persistence.database,
          ),
          nativeProjectionAdmission: admission,
          selectorResolvers: [projectionSelectorResolver],
        });
        let sealer:
          | ReturnType<typeof createVerificationMetricAuditSealer>
          | undefined;
        if (sealPolicyCatalog && sealRuntime) {
          sealer = createVerificationMetricAuditSealer({
            repository,
            policyCatalog: sealPolicyCatalog,
            ...(auditSigner ? { signer: auditSigner } : {}),
            storageBucket:
              environment.VERIFICATION_STORAGE_BUCKET?.trim() ||
              "ai-engineer-cloud-bucket",
            runtime: sealRuntime,
            now: () => new Date().toISOString(),
          });
        }
        verificationHandlers = [
          ...verificationHandlers,
          verificationMetricActivityHandler({
            service,
            repository,
            operations: persistence.database,
            storageBucket:
              environment.VERIFICATION_STORAGE_BUCKET?.trim() ||
              "ai-engineer-cloud-bucket",
            now: () => new Date().toISOString(),
            ...(sealer ? { sealer } : {}),
          }),
        ];
        const fallback = verificationHandlers.find(
          (handler) => handler.operationKind === "verification_replay",
        );
        verificationHandlers = [
          ...verificationHandlers.filter(
            (handler) => handler.operationKind !== "verification_replay",
          ),
          verificationSealedReplayActivityHandler({
            repository,
            operations: persistence.database,
            storageBucket:
              environment.VERIFICATION_STORAGE_BUCKET?.trim() ||
              "ai-engineer-cloud-bucket",
            now: () => new Date().toISOString(),
            replay: createVerificationSealedMetricReplay({
              repository,
              profiles: new VerificationMetricProfileCatalog(metricGrants),
              runtimePrincipals:
                new PostgresVerificationMetricRuntimePrincipals(
                  persistence.database,
                ),
              admission,
            }),
            ...(fallback ? { fallback } : {}),
          }),
        ];
      }
      if (claimsEnabled) {
        if (claimsCatalogJson && claimsCatalogJson.length > 262_144)
          throw new Error("VERIFICATION_CLAIMS_PROJECTION_GRANTS_TOO_LARGE");
        let claimsGrants: unknown;
        try {
          claimsGrants = claimsCatalogJson ? JSON.parse(claimsCatalogJson) : undefined;
        } catch {
          throw new Error("VERIFICATION_CLAIMS_PROJECTION_GRANTS_INVALID");
        }
        if (
          claimsCatalogJson && (!Array.isArray(claimsGrants) ||
          claimsGrants.length < 1 ||
          claimsGrants.length > 256)
        )
          throw new Error("VERIFICATION_CLAIMS_PROJECTION_GRANTS_INVALID");
        if (!sealPolicyCatalog || !sealRuntime)
          throw new Error("VERIFICATION_CLAIMS_SEAL_CONFIGURATION_REQUIRED");
        const service = new VerificationClaimsApplicationService({
          artifactResolver: repository.createTrustedArtifactResolver(),
          captures: repository,
          runtimePrincipals: new PostgresVerificationClaimsRuntimePrincipals(
            persistence.database,
          ),
          ...(Array.isArray(claimsGrants) ? { projectionGrants: new VerificationClaimsProjectionGrantCatalog(
            claimsGrants,
          ) } : {}),
          nativeProjectionAdmission: admission,
          selectorResolvers: [projectionSelectorResolver],
        });
        const semanticConfiguration =
          parseClaimsSemanticRuntimeConfiguration(environment);
        const semanticStage = semanticConfiguration
          ? createVerificationClaimsSemanticStage({
              service,
              database: persistence.database,
              repository,
              ...semanticConfiguration,
              storageBucket:
                environment.VERIFICATION_STORAGE_BUCKET?.trim() ||
                "ai-engineer-cloud-bucket",
              now: () => new Date().toISOString(),
            })
          : undefined;
        const sealer = createVerificationClaimsAuditSealer({
          repository,
          policyCatalog: sealPolicyCatalog,
          storageBucket:
            environment.VERIFICATION_STORAGE_BUCKET?.trim() ||
            "ai-engineer-cloud-bucket",
          runtime: sealRuntime,
          now: () => new Date().toISOString(),
          ...(semanticStage ? { semanticStage } : {}),
          ...(sourceAuthorityPins ? { sourceAuthorityStage: createClaimsSourceAuthorityStage({ pins: sourceAuthorityPins,
            database: persistence.database, repository }) } : {}),
          ...(auditSigner ? { signer: auditSigner } : {}),
        });
        const dependencies = {
          service,
          repository,
          operations: persistence.database,
          storageBucket:
            environment.VERIFICATION_STORAGE_BUCKET?.trim() ||
            "ai-engineer-cloud-bucket",
          now: () => new Date().toISOString(),
          sealer,
        };
        verificationHandlers = [
          ...verificationHandlers,
          verificationClaimsActivityHandler(
            dependencies,
            "verification_claims",
          ),
          verificationClaimsActivityHandler(
            dependencies,
            "verification_report",
          ),
        ];
      }
      if (auditInspectionEnabled) {
        if (
          !auditInspectionGrantsJson ||
          !auditInspectionKeysJson ||
          !claimsCatalogJson
        )
          throw new Error(
            "VERIFICATION_AUDIT_INSPECTION_RUNTIME_GRANTS_REQUIRED",
          );
        if (auditInspectionGrantsJson.length > 262_144)
          throw new Error("VERIFICATION_AUDIT_INSPECTION_GRANTS_TOO_LARGE");
        let auditGrants: unknown, projectionGrants: unknown;
        try {
          auditGrants = JSON.parse(auditInspectionGrantsJson);
          projectionGrants = JSON.parse(claimsCatalogJson);
        } catch {
          throw new Error(
            "VERIFICATION_AUDIT_INSPECTION_RUNTIME_GRANTS_INVALID",
          );
        }
        if (
          !Array.isArray(projectionGrants) ||
          projectionGrants.length < 1 ||
          projectionGrants.length > 256
        )
          throw new Error(
            "VERIFICATION_AUDIT_INSPECTION_RUNTIME_GRANTS_INVALID",
          );
        const handler = createVerificationAuditInspectionHandler({
          database: persistence.database,
          repository,
          admission,
          projectionGrants: new VerificationClaimsProjectionGrantCatalog(
            projectionGrants as VerificationClaimsProjectionGrant[],
          ),
          auditGrants: new VerificationAuditInspectionGrantCatalog(auditGrants),
          trustedPublicKeys: parseVerificationAuditInspectionPublicKeys(
            auditInspectionKeysJson,
          ),
          ...(environment.VERIFICATION_SEMANTIC_PROFILE_GRANTS_JSON
            ? {
                semanticProfiles: parseSemanticJudgeProfileCatalog(
                  environment.VERIFICATION_SEMANTIC_PROFILE_GRANTS_JSON,
                ),
              }
            : {}),
          storageBucket:
            environment.VERIFICATION_STORAGE_BUCKET?.trim() ||
            "ai-engineer-cloud-bucket",
          now: () => new Date().toISOString(),
          maximumInspectionMs: positiveInteger(
            environment.VERIFICATION_AUDIT_INSPECTION_TIMEOUT_MS,
            30_000,
            "VERIFICATION_AUDIT_INSPECTION_TIMEOUT_MS",
          ),
        });
        verificationHandlers = [...verificationHandlers, handler];
      }
      if (adjudicationRuntimeConfiguration) {
        if (!claimsCatalogJson)
          throw new Error(
            "VERIFICATION_ADJUDICATION_PROJECTION_GRANTS_REQUIRED",
          );
        let projectionGrants: unknown;
        try {
          projectionGrants = JSON.parse(claimsCatalogJson);
        } catch {
          throw new Error(
            "VERIFICATION_ADJUDICATION_PROJECTION_GRANTS_INVALID",
          );
        }
        if (
          !Array.isArray(projectionGrants) ||
          projectionGrants.length < 1 ||
          projectionGrants.length > 256
        )
          throw new Error(
            "VERIFICATION_ADJUDICATION_PROJECTION_GRANTS_INVALID",
          );
        const handler = createVerificationAdjudicationRequestHandler({
          database: persistence.database,
          repository,
          admission,
          projectionGrants: new VerificationClaimsProjectionGrantCatalog(
            projectionGrants as VerificationClaimsProjectionGrant[],
          ),
          auditGrants: adjudicationRuntimeConfiguration.auditGrants,
          trustedPublicKeys: adjudicationRuntimeConfiguration.trustedPublicKeys,
          reviewRequirements:
            adjudicationRuntimeConfiguration.reviewRequirements,
          ...(adjudicationRuntimeConfiguration.semanticProfiles
            ? {
                semanticProfiles:
                  adjudicationRuntimeConfiguration.semanticProfiles,
              }
            : {}),
          subjects: new PostgresVerificationAdjudicationRepository(
            persistence.database,
            repository,
          ),
          storageBucket:
            environment.VERIFICATION_STORAGE_BUCKET?.trim() ||
            "ai-engineer-cloud-bucket",
          now: () => new Date().toISOString(),
          maximumInspectionMs: positiveInteger(
            environment.VERIFICATION_ADJUDICATION_TIMEOUT_MS,
            30_000,
            "VERIFICATION_ADJUDICATION_TIMEOUT_MS",
          ),
        });
        verificationHandlers = [...verificationHandlers, handler];
        if (adjudicationDecisionRuntimeConfiguration) {
          // This is the worker-internal counterpart of the API signed-subject
          // reader. It replays the registered packet through the existing
          // server trust set; it does not authorize public reads or call a provider.
          const native = {
            database: persistence.database,
            repository,
            admission,
            projectionGrants: new VerificationClaimsProjectionGrantCatalog(
              projectionGrants as VerificationClaimsProjectionGrant[],
            ),
            auditGrants: adjudicationRuntimeConfiguration.auditGrants,
            trustedPublicKeys:
              adjudicationRuntimeConfiguration.trustedPublicKeys,
            ...(adjudicationRuntimeConfiguration.semanticProfiles
              ? {
                  semanticProfiles:
                    adjudicationRuntimeConfiguration.semanticProfiles,
                }
              : {}),
            storageBucket:
              environment.VERIFICATION_STORAGE_BUCKET?.trim() ||
              "ai-engineer-cloud-bucket",
            now: () => new Date().toISOString(),
            maximumInspectionMs: positiveInteger(
              environment.VERIFICATION_ADJUDICATION_TIMEOUT_MS,
              30_000,
              "VERIFICATION_ADJUDICATION_TIMEOUT_MS",
            ),
          };
          const packetReplay = {
            async replayPacket(
              replay: Parameters<
                import("@aiengineer/knowledge-application").VerificationAdjudicationPacketReplayPort["replayPacket"]
              >[0],
            ) {
              return createVerificationAdjudicationRequestService({
                ...native,
                reviewRequirements: replay.reviewRequirements,
              }).prepare(replay.request, replay.context, replay.signal);
            },
          };
          const verifiedSubjects = new VerificationAdjudicationReadService(
            new PostgresVerificationAdjudicationReadRepository(
              persistence.database,
              () => repository.createTrustedArtifactResolver(),
              packetReplay,
              { maximumReplayMs: native.maximumInspectionMs },
            ),
          );
          verificationHandlers = [
            ...verificationHandlers,
            createVerificationAdjudicationDecisionHandler({
              database: persistence.database,
              registrations: repository,
              verifiedSubjects,
              storageBucket: native.storageBucket,
              now: native.now,
              syntheticReviewerGrants:
                adjudicationDecisionRuntimeConfiguration.syntheticReviewerGrants,
            }),
          ];
        }
      }
    }
    const benchmarkHandler = createConfiguredVerificationBenchmarkHandler({
      database: persistence.database,
      tenantId,
      projectUrl: persistenceConfig.supabaseUrl,
      serviceRoleKey: persistenceConfig.supabaseSecretKey,
      maximumArtifactBytes,
      environment,
    });
    if (benchmarkHandler)
      verificationHandlers = [
        ...(verificationHandlers ?? []),
        benchmarkHandler,
      ];
    const comparisonHandler =
      createConfiguredVerificationBenchmarkComparisonHandler({
        database: persistence.database,
        tenantId,
        projectUrl: persistenceConfig.supabaseUrl,
        serviceRoleKey: persistenceConfig.supabaseSecretKey,
        maximumArtifactBytes,
        environment,
      });
    if (comparisonHandler)
      verificationHandlers = [
        ...(verificationHandlers ?? []),
        comparisonHandler,
      ];
    const extractionHandler =
      createConfiguredVerificationStructuredExtractionHandler({
        database: persistence.database,
        tenantId,
        projectUrl: persistenceConfig.supabaseUrl,
        serviceRoleKey: persistenceConfig.supabaseSecretKey,
        maximumArtifactBytes,
        environment,
      });
    if (extractionHandler)
      verificationHandlers = [
        ...(verificationHandlers ?? []),
        extractionHandler,
      ];
    const registry = createProductionActivityRegistry({
      retrieval: persistence.database,
      review: persistence.database,
      vectorStore: new PostgresVectorStoreLifecycleRepository(
        persistence.database,
      ),
      durablePreparation: {
        repository: new PostgresPreparationRepository(persistence.database),
        sourceArtifacts,
        derivativeArtifacts,
        sourceStorageBucket: "source-captures",
        derivativeStorageBucket: "content-derivatives",
        acquisition,
        conversionProviders,
      },
      governedIndex: {
        repository: new PostgresGovernedIndexRepository(persistence.database, promotionSelection),
        embeddingAdapter: {
          discoverModel: (modelSlug) =>
            createGatewayEmbeddingAdapterFromEnvironment(
              environment,
            ).discoverModel(modelSlug),
          embedOne: (request) =>
            createGatewayEmbeddingAdapterFromEnvironment(environment).embedOne(
              request,
            ),
          embedMany: (request) =>
            createGatewayEmbeddingAdapterFromEnvironment(environment).embedMany(
              request,
            ),
        } satisfies EmbeddingAdapter,
        embeddingAdapterVersion: "vercel-ai-gateway/v1",
      },
      ...(verificationHandlers ? { verificationHandlers } : {}),
    });
    registeredActivities = registry.activities();
    const worker = new CanonicalDurableKnowledgeWorker(
      owner,
      tenantId,
      persistence.database,
      createCanonicalActivityExecutor(persistence.database, registry),
      leaseMs,
      registry.operationKinds(),
    );
    try {
      reconciled = await reconcileWorkerScope(worker, scopedOperationId);
    } catch (error) {
      await close();
      throw error;
    }
    runOnce = runWorkerScope(worker, scopedOperationId);
  } else {
    const worker = new DurableKnowledgeWorker(
      owner,
      createIntegrationService(),
      undefined,
      leaseMs,
    );
    runOnce = () => worker.runOnce();
  }

  const status = await application.getStatus();
  process.stdout.write(
    `${JSON.stringify({ event: "knowledge.worker.started", mode, owner, reconciled, registeredActivities, ...status })}\n`,
  );
  const schedule = () => {
    if (stopping) return;
    timer = setTimeout(() => {
      active = runOnce()
        .catch((error) =>
          process.stderr.write(
            `${JSON.stringify({ event: "knowledge.worker.activity_failed", error: error instanceof Error ? error.message : "unknown" })}\n`,
          ),
        )
        .finally(() => {
          active = undefined;
          schedule();
        });
    }, pollMs);
  };
  schedule();

  return {
    mode,
    async stop(signal = "requested") {
      if (stopping) return;
      stopping = true;
      if (timer) clearTimeout(timer);
      await active;
      await close();
      process.stdout.write(
        `${JSON.stringify({ event: "knowledge.worker.stopped", mode, signal })}\n`,
      );
    },
  };
}

/** Generic process entry. Selection authority is host-composed; this path cannot supply ports. */
async function main() {
  const running = await startWorker();
  const shutdown = (signal: string) => {
    void running.stop(signal).catch((error) => {
      process.stderr.write(
        `${JSON.stringify({ event: "knowledge.worker.shutdown_failed", error: error instanceof Error ? error.message : "unknown" })}\n`,
      );
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({ event: "knowledge.worker.start_failed", error: error instanceof Error ? error.message : "unknown" })}\n`,
    );
    process.exitCode = 1;
  });
}
