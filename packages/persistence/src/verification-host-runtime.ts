import {
  createBenchmarkComparisonRequestAdmission,
  createBenchmarkRequestAdmission,
  createClaimsRequestAdmission,
  createParseArtifactRequestAdmission,
  createStaticVerificationContextResolver,
  createStructuredExtractionRequestAdmission,
  createSucceededVerificationRunAdmission,
  createVerificationOwnershipResolver,
  parseBenchmarkReadPublicKeys,
  parseVerificationBenchmarkComparisonRuntimeConfig,
  parseVerificationBenchmarkRuntimeConfig,
  parseVerificationStructuredExtractionRuntimeConfig,
  VerificationAuditInspectionGrantCatalog,
  VerificationClaimsProjectionGrantCatalog,
  VerificationSealPolicyCatalog,
  VerificationServiceCatalog,
  verificationServiceOperationKinds,
  type KnowledgeOperationPort,
  type ResolveVerificationContext,
  type VerificationServiceCatalog as VerificationCaptureCatalog,
} from "@aiengineer/knowledge-application";
import {
  ExternalExecutionContextSchema,
  VerificationAdjudicationReviewRequirementsSchema,
  type CompareBenchmarkRunsRequest,
  type InspectAuditBundleRequest,
  type ParseArtifactRequest,
  type OperationContext,
  type RequestAdjudicationRequest,
  type RunBenchmarkRequest,
  type VerificationAdjudicationDecisionRequest,
  type VerifyClaimsRequest,
  type VerifyReportRequest,
} from "@aiengineer/knowledge-contracts";
import { UuidSchema } from "@aiengineer/knowledge-contracts";
import type { OperationKind } from "@aiengineer/knowledge-contracts";
import { PostgresKnowledgeOperationService } from "./operation-service.js";
import { resolveEveVerificationBinding } from "./eve-verification-binding.js";
import type { PostgresCanonicalRepository } from "./postgres.js";

export interface VerificationHostAdmission {
  readonly isParseArtifactRequestAdmitted?: (
    tenantId: string,
    request: ParseArtifactRequest,
  ) => boolean;
  readonly isStructuredExtractionRequestAdmitted?: (
    tenantId: string,
    request: unknown,
  ) => boolean;
  readonly isBenchmarkRequestAdmitted?: (
    tenantId: string,
    request: RunBenchmarkRequest,
  ) => boolean;
  readonly isBenchmarkComparisonRequestAdmitted?: (
    tenantId: string,
    request: CompareBenchmarkRunsRequest,
  ) => boolean;
  readonly isClaimsRequestAdmitted?: (
    tenantId: string,
    request: VerifyClaimsRequest | VerifyReportRequest,
  ) => boolean;
  readonly isAuditInspectionRequestAdmitted?: (
    tenantId: string,
    request: InspectAuditBundleRequest,
  ) => boolean | Promise<boolean>;
  readonly isAdjudicationRequestAdmitted?: (
    tenantId: string,
    request: RequestAdjudicationRequest,
  ) => boolean | Promise<boolean>;
  readonly isAdjudicationDecisionAdmitted?: (input: {
    readonly request: VerificationAdjudicationDecisionRequest;
    readonly context: OperationContext;
  }) => boolean | Promise<boolean>;
}

export interface VerificationHostRuntime extends VerificationHostAdmission {
  readonly verificationConfigured: boolean;
  readonly resolveVerificationContext?: ResolveVerificationContext;
  readonly verificationOperationService?: KnowledgeOperationPort;
  readonly verificationCaptureCatalog?: VerificationCaptureCatalog;
}

type Environment = Readonly<Record<string, string | undefined>>;
type FeatureToggle = "0" | "1" | undefined;
type SucceededRunKind = "verification_claims" | "verification_report";

const CONFIG_MAX_CHARS = 262_144;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/u;

function readFeatureToggle(raw: string | undefined, invalidCode: string): FeatureToggle {
  const value = raw?.trim();
  if (!value) return undefined;
  if (value !== "0" && value !== "1") throw new Error(invalidCode);
  return value;
}

function requireOwnership(
  context: ResolveVerificationContext | undefined,
  code: string,
): void {
  if (!context) throw new Error(code);
}

function parseJsonOrThrow(raw: string, invalidCode: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(invalidCode);
  }
}

function parseServiceCatalog(
  raw: string | undefined,
  requiredCode: string,
  invalidCode: string,
) {
  if (!raw || raw.length > CONFIG_MAX_CHARS) throw new Error(requiredCode);
  return new VerificationServiceCatalog(
    parseJsonOrThrow(raw, invalidCode) as ConstructorParameters<
      typeof VerificationServiceCatalog
    >[0],
  );
}

function runKindFromAuditGrant(
  catalog: VerificationAuditInspectionGrantCatalog,
  tenantId: string,
  request: InspectAuditBundleRequest,
): SucceededRunKind | undefined {
  try {
    const grant = catalog.resolve(tenantId, request);
    return grant.runKind === "claims"
      ? "verification_claims"
      : "verification_report";
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "VERIFICATION_AUDIT_INSPECTION_GRANT_REQUIRED"
    )
      return undefined;
    throw error;
  }
}

function createSucceededRunKindAdmission(
  database: PostgresCanonicalRepository,
  catalog: VerificationAuditInspectionGrantCatalog,
  selectInspectRequest: (
    request: InspectAuditBundleRequest | RequestAdjudicationRequest,
  ) => InspectAuditBundleRequest | undefined,
) {
  return createSucceededVerificationRunAdmission(database, (tenantId, request) => {
    const inspect = selectInspectRequest(request);
    if (!inspect) return undefined;
    return runKindFromAuditGrant(catalog, tenantId, inspect);
  });
}

function resolveOwnershipContext(input: {
  readonly database: PostgresCanonicalRepository | undefined;
  readonly environment: Environment;
  readonly production: boolean;
}): ResolveVerificationContext | undefined {
  const verificationAttemptId = input.environment.VERIFICATION_SERVICE_ATTEMPT_ID?.trim();
  const ownershipGrants =
    input.environment.VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON?.trim();
  const eveRuntimeAttestationKeysJson =
    input.environment.VERIFICATION_EVE_RUNTIME_ATTESTATION_KEYS_JSON?.trim();
  if (input.production && verificationAttemptId && !ownershipGrants)
    throw new Error("VERIFICATION_OWNERSHIP_GRANTS_REQUIRED");
  return input.database && ownershipGrants
    ? createVerificationOwnershipResolver(input.database, ownershipGrants, {
        ...(eveRuntimeAttestationKeysJson ? { eveRuntimeAttestationKeysJson } : {}),
        resolveEveBinding: (envelope) =>
          resolveEveVerificationBinding(input.database!, envelope),
      })
    : undefined;
}

function resolveBenchmarkConfigs(input: {
  readonly environment: Environment;
  readonly dynamicVerificationContext: ResolveVerificationContext | undefined;
}) {
  const benchmarkRaw = input.environment.VERIFICATION_BENCHMARK_CONFIG_JSON?.trim();
  const benchmarkConfig = benchmarkRaw
    ? parseVerificationBenchmarkRuntimeConfig(benchmarkRaw)
    : undefined;
  if (benchmarkConfig && !input.dynamicVerificationContext)
    throw new Error("BENCHMARK_RUNTIME_OWNERSHIP_GRANTS_REQUIRED");
  const comparisonRaw =
    input.environment.VERIFICATION_BENCHMARK_COMPARISON_CONFIG_JSON?.trim();
  const comparisonConfig = comparisonRaw
    ? parseVerificationBenchmarkComparisonRuntimeConfig(comparisonRaw)
    : undefined;
  if (comparisonConfig && !input.dynamicVerificationContext)
    throw new Error("BENCHMARK_COMPARISON_OWNERSHIP_GRANTS_REQUIRED");
  const extractionRaw =
    input.environment.VERIFICATION_STRUCTURED_EXTRACTION_CONFIG_JSON?.trim();
  const extractionConfig = extractionRaw
    ? parseVerificationStructuredExtractionRuntimeConfig(extractionRaw)
    : undefined;
  if (
    extractionConfig &&
    (!input.dynamicVerificationContext ||
      extractionConfig.executionMode !== "live_provider")
  )
    throw new Error("STRUCTURED_EXTRACTION_API_OWNERSHIP_AND_LIVE_RUNTIME_REQUIRED");
  if (extractionConfig)
    parseBenchmarkReadPublicKeys(
      JSON.stringify(
        Object.entries(extractionConfig.trustedPublicKeys).map(
          ([keyId, publicKeyPem]) => ({ keyId, publicKeyPem }),
        ),
      ),
    );
  return { benchmarkConfig, comparisonConfig, extractionConfig };
}

function resolveAuditInspectionAdmission(input: {
  readonly environment: Environment;
  readonly database: PostgresCanonicalRepository | undefined;
  readonly dynamicVerificationContext: ResolveVerificationContext | undefined;
}):
  | ((tenantId: string, request: InspectAuditBundleRequest) => Promise<boolean>)
  | undefined {
  const auditInspectionEnabled = readFeatureToggle(
    input.environment.VERIFICATION_AUDIT_INSPECTION_ENABLED,
    "INVALID_VERIFICATION_AUDIT_INSPECTION_ENABLED",
  );
  if (auditInspectionEnabled === "1")
    requireOwnership(
      input.dynamicVerificationContext,
      "VERIFICATION_AUDIT_INSPECTION_OWNERSHIP_GRANTS_REQUIRED",
    );
  if (auditInspectionEnabled !== "1") return undefined;
  const raw = input.environment.VERIFICATION_AUDIT_INSPECTION_GRANTS_JSON?.trim();
  if (!raw || raw.length > CONFIG_MAX_CHARS)
    throw new Error("VERIFICATION_AUDIT_INSPECTION_RUNTIME_GRANTS_REQUIRED");
  const catalog = new VerificationAuditInspectionGrantCatalog(
    parseJsonOrThrow(raw, "VERIFICATION_AUDIT_INSPECTION_RUNTIME_GRANTS_INVALID"),
  );
  return createSucceededRunKindAdmission(input.database!, catalog, (request) =>
    "auditBundle" in request ? request : undefined,
  );
}

function resolveAdjudicationAdmission(input: {
  readonly environment: Environment;
  readonly database: PostgresCanonicalRepository | undefined;
  readonly dynamicVerificationContext: ResolveVerificationContext | undefined;
}):
  | ((tenantId: string, request: RequestAdjudicationRequest) => Promise<boolean>)
  | undefined {
  const adjudicationGrantsRaw =
    input.environment.VERIFICATION_ADJUDICATION_GRANTS_JSON?.trim();
  const adjudicationRequirementsRaw =
    input.environment.VERIFICATION_ADJUDICATION_REVIEW_REQUIREMENTS_JSON?.trim();
  const adjudicationPublicKeysRaw =
    input.environment.VERIFICATION_ADJUDICATION_PUBLIC_KEYS_JSON?.trim();
  const adjudicationConfigured = [
    adjudicationGrantsRaw,
    adjudicationRequirementsRaw,
    adjudicationPublicKeysRaw,
  ].filter((value) => value !== undefined).length;
  if (adjudicationConfigured !== 0 && adjudicationConfigured !== 3)
    throw new Error("VERIFICATION_ADJUDICATION_RUNTIME_CONFIGURATION_REQUIRED");
  if (adjudicationConfigured !== 3) return undefined;
  requireOwnership(
    input.dynamicVerificationContext,
    "VERIFICATION_ADJUDICATION_OWNERSHIP_GRANTS_REQUIRED",
  );
  if (
    adjudicationGrantsRaw!.length > CONFIG_MAX_CHARS ||
    adjudicationRequirementsRaw!.length > CONFIG_MAX_CHARS
  )
    throw new Error("VERIFICATION_ADJUDICATION_RUNTIME_CONFIGURATION_TOO_LARGE");
  let grants: unknown, requirements: unknown;
  try {
    grants = JSON.parse(adjudicationGrantsRaw!);
    requirements = JSON.parse(adjudicationRequirementsRaw!);
  } catch {
    throw new Error("VERIFICATION_ADJUDICATION_RUNTIME_CONFIGURATION_INVALID");
  }
  let catalog: VerificationAuditInspectionGrantCatalog;
  try {
    catalog = new VerificationAuditInspectionGrantCatalog(grants);
    VerificationAdjudicationReviewRequirementsSchema.parse(requirements);
    parseBenchmarkReadPublicKeys(adjudicationPublicKeysRaw!);
  } catch {
    throw new Error("VERIFICATION_ADJUDICATION_RUNTIME_CONFIGURATION_INVALID");
  }
  return createSucceededRunKindAdmission(input.database!, catalog, (request) =>
    "evidencePacket" in request
      ? {
          verificationContractVersion: request.verificationContractVersion,
          auditBundle: request.evidencePacket,
        }
      : undefined,
  );
}

function resolveCaptureCatalog(input: {
  readonly environment: Environment;
  readonly dynamicVerificationContext: ResolveVerificationContext | undefined;
}): VerificationServiceCatalog | undefined {
  const captureAcquireEnabled = readFeatureToggle(
    input.environment.VERIFICATION_CAPTURE_ACQUIRE_ENABLED,
    "INVALID_VERIFICATION_CAPTURE_ACQUIRE_ENABLED",
  );
  if (captureAcquireEnabled !== "1") return undefined;
  requireOwnership(
    input.dynamicVerificationContext,
    "VERIFICATION_ACQUISITION_OWNERSHIP_GRANTS_REQUIRED",
  );
  const catalog = parseServiceCatalog(
    input.environment.VERIFICATION_SERVICE_CATALOG_JSON?.trim(),
    "VERIFICATION_ACQUISITION_RUNTIME_GRANTS_REQUIRED",
    "VERIFICATION_ACQUISITION_RUNTIME_GRANTS_INVALID",
  );
  if (!catalog.hasAcquisitionGrants())
    throw new Error("VERIFICATION_ACQUISITION_RUNTIME_GRANTS_REQUIRED");
  return catalog;
}

function resolveParseArtifactAdmission(input: {
  readonly environment: Environment;
  readonly dynamicVerificationContext: ResolveVerificationContext | undefined;
}):
  | ((tenantId: string, request: ParseArtifactRequest) => boolean)
  | undefined {
  const parseArtifactEnabled = readFeatureToggle(
    input.environment.VERIFICATION_PARSE_ARTIFACT_ENABLED,
    "INVALID_VERIFICATION_PARSE_ARTIFACT_ENABLED",
  );
  if (parseArtifactEnabled !== "1") return undefined;
  requireOwnership(
    input.dynamicVerificationContext,
    "VERIFICATION_PARSE_ARTIFACT_OWNERSHIP_GRANTS_REQUIRED",
  );
  const catalog = parseServiceCatalog(
    input.environment.VERIFICATION_SERVICE_CATALOG_JSON?.trim(),
    "VERIFICATION_PARSE_ARTIFACT_RUNTIME_GRANTS_REQUIRED",
    "VERIFICATION_PARSE_ARTIFACT_RUNTIME_GRANTS_INVALID",
  );
  if (!catalog.hasParseArtifactGrants())
    throw new Error("VERIFICATION_PARSE_ARTIFACT_RUNTIME_GRANTS_REQUIRED");
  return createParseArtifactRequestAdmission(catalog);
}

function assertClaimsWorkerRuntime(environment: Environment): void {
  const imageDigest = environment.VERIFICATION_PARSER_IMAGE_DIGEST?.trim(),
    gitSha = environment.VERIFICATION_CODE_GIT_SHA?.trim(),
    dirty = environment.VERIFICATION_CODE_DIRTY?.trim(),
    platform = environment.VERIFICATION_RUNTIME_PLATFORM?.trim(),
    deploymentId = environment.VERIFICATION_RUNTIME_DEPLOYMENT_ID?.trim();
  if (
    !imageDigest ||
    !SHA256_DIGEST.test(imageDigest) ||
    !gitSha ||
    !platform ||
    !deploymentId ||
    !["0", "1"].includes(dirty ?? "")
  )
    throw new Error("VERIFICATION_CLAIMS_WORKER_RUNTIME_REQUIRED");
}

function resolveClaimsAdmission(input: {
  readonly environment: Environment;
  readonly claimsEnabled: FeatureToggle;
}):
  | ((
      tenantId: string,
      request: VerifyClaimsRequest | VerifyReportRequest,
    ) => boolean)
  | undefined {
  if (input.claimsEnabled !== "1") return undefined;
  const projectionRaw =
      input.environment.VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON?.trim(),
    sealRaw = input.environment.VERIFICATION_SEAL_POLICY_GRANTS_JSON?.trim();
  if (!projectionRaw || !sealRaw)
    throw new Error("VERIFICATION_CLAIMS_RUNTIME_GRANTS_REQUIRED");
  if (projectionRaw.length > CONFIG_MAX_CHARS || sealRaw.length > CONFIG_MAX_CHARS)
    throw new Error("VERIFICATION_CLAIMS_RUNTIME_GRANTS_TOO_LARGE");
  let projections: unknown, policies: unknown;
  try {
    projections = JSON.parse(projectionRaw);
    policies = JSON.parse(sealRaw);
  } catch {
    throw new Error("VERIFICATION_CLAIMS_RUNTIME_GRANTS_INVALID");
  }
  if (
    !Array.isArray(projections) ||
    projections.length < 1 ||
    projections.length > 256 ||
    !Array.isArray(policies) ||
    policies.length < 1 ||
    policies.length > 256
  )
    throw new Error("VERIFICATION_CLAIMS_RUNTIME_GRANTS_INVALID");
  const projectionCatalog = new VerificationClaimsProjectionGrantCatalog(
    projections as ConstructorParameters<
      typeof VerificationClaimsProjectionGrantCatalog
    >[0],
  );
  void new VerificationSealPolicyCatalog(
    policies as ConstructorParameters<typeof VerificationSealPolicyCatalog>[0],
  );
  assertClaimsWorkerRuntime(input.environment);
  return createClaimsRequestAdmission(projectionCatalog);
}

function resolveStaticVerificationContext(
  environment: Environment,
): ResolveVerificationContext | undefined {
  const verificationAttemptId = environment.VERIFICATION_SERVICE_ATTEMPT_ID?.trim();
  if (verificationAttemptId) UuidSchema.parse(verificationAttemptId);
  const verificationWorkItemId = environment.VERIFICATION_SERVICE_WORK_ITEM_ID?.trim();
  if (verificationWorkItemId) UuidSchema.parse(verificationWorkItemId);
  const verificationMissionId = environment.VERIFICATION_SERVICE_MISSION_ID?.trim();
  if (verificationMissionId) UuidSchema.parse(verificationMissionId);
  const verificationCausationId =
    environment.VERIFICATION_SERVICE_CAUSATION_ID?.trim();
  const externalRuntime = environment.VERIFICATION_SERVICE_EXTERNAL_RUNTIME?.trim(),
    externalRunId = environment.VERIFICATION_SERVICE_EXTERNAL_RUN_ID?.trim();
  if (Boolean(externalRuntime) !== Boolean(externalRunId))
    throw new Error("VERIFICATION_EXTERNAL_EXECUTION_CONFIG_INCOMPLETE");
  const verificationExternalExecution =
    externalRuntime && externalRunId
      ? ExternalExecutionContextSchema.parse({
          runtime: externalRuntime,
          runId: externalRunId,
          ...(environment.VERIFICATION_SERVICE_EXTERNAL_ROOT_RUN_ID?.trim()
            ? { rootRunId: environment.VERIFICATION_SERVICE_EXTERNAL_ROOT_RUN_ID.trim() }
            : {}),
          ...(environment.VERIFICATION_SERVICE_EXTERNAL_SESSION_ID?.trim()
            ? { sessionId: environment.VERIFICATION_SERVICE_EXTERNAL_SESSION_ID.trim() }
            : {}),
          ...(environment.VERIFICATION_SERVICE_EXTERNAL_TURN_ID?.trim()
            ? { turnId: environment.VERIFICATION_SERVICE_EXTERNAL_TURN_ID.trim() }
            : {}),
          ...(environment.VERIFICATION_SERVICE_EXTERNAL_TOOL_CALL_ID?.trim()
            ? {
                toolCallId:
                  environment.VERIFICATION_SERVICE_EXTERNAL_TOOL_CALL_ID.trim(),
              }
            : {}),
        })
      : undefined;
  return verificationAttemptId
    ? createStaticVerificationContextResolver({
        attemptId: verificationAttemptId,
        ...(verificationWorkItemId ? { workItemId: verificationWorkItemId } : {}),
        ...(verificationMissionId ? { missionId: verificationMissionId } : {}),
        ...(verificationCausationId ? { causationId: verificationCausationId } : {}),
        ...(verificationExternalExecution
          ? { externalExecution: verificationExternalExecution }
          : {}),
        capabilityVersion:
          environment.VERIFICATION_SERVICE_CAPABILITY_VERSION?.trim() ||
          "verification-service.v1",
      })
    : undefined;
}

function collectAdmittedOperationKinds(input: {
  readonly extraAdmittedKinds?: readonly OperationKind[];
  readonly parseArtifactEnabled: boolean;
  readonly metricEnabled: boolean;
  readonly claimsEnabled: boolean;
  readonly auditInspectionEnabled: boolean;
  readonly adjudicationEnabled: boolean;
  readonly benchmarkEnabled: boolean;
  readonly comparisonEnabled: boolean;
  readonly extractionEnabled: boolean;
}): OperationKind[] {
  return [
    ...verificationServiceOperationKinds,
    ...(input.extraAdmittedKinds ?? []),
    ...(input.parseArtifactEnabled
      ? (["verification_parse_artifact"] as const)
      : []),
    ...(input.metricEnabled ? (["verification_metric"] as const) : []),
    ...(input.claimsEnabled
      ? (["verification_claims", "verification_report"] as const)
      : []),
    ...(input.auditInspectionEnabled
      ? (["verification_audit_bundle"] as const)
      : []),
    ...(input.adjudicationEnabled
      ? (["verification_adjudication"] as const)
      : []),
    ...(input.benchmarkEnabled ? (["verification_benchmark"] as const) : []),
    ...(input.comparisonEnabled
      ? (["verification_benchmark_compare"] as const)
      : []),
    ...(input.extractionEnabled
      ? (["verification_structured_extraction"] as const)
      : []),
  ];
}

export function createVerificationHostRuntime(
  database: PostgresCanonicalRepository | undefined,
  environment: Environment,
  options: {
    readonly production: boolean;
    readonly extraAdmittedKinds?: readonly OperationKind[];
  },
): VerificationHostRuntime {
  const verificationAttemptId = environment.VERIFICATION_SERVICE_ATTEMPT_ID?.trim();
  const dynamicVerificationContext = resolveOwnershipContext({
    database,
    environment,
    production: options.production,
  });
  const verificationConfigured = Boolean(
    database && (dynamicVerificationContext || verificationAttemptId),
  );
  const { benchmarkConfig, comparisonConfig, extractionConfig } =
    resolveBenchmarkConfigs({ environment, dynamicVerificationContext });
  const metricEnabled = readFeatureToggle(
    environment.VERIFICATION_METRIC_ENABLED,
    "INVALID_VERIFICATION_METRIC_ENABLED",
  );
  if (metricEnabled === "1")
    requireOwnership(dynamicVerificationContext, "VERIFICATION_METRIC_OWNERSHIP_GRANTS_REQUIRED");
  const claimsEnabled = readFeatureToggle(
    environment.VERIFICATION_CLAIMS_ENABLED,
    "INVALID_VERIFICATION_CLAIMS_ENABLED",
  );
  if (claimsEnabled === "1")
    requireOwnership(dynamicVerificationContext, "VERIFICATION_CLAIMS_OWNERSHIP_GRANTS_REQUIRED");
  const isAuditInspectionRequestAdmitted = resolveAuditInspectionAdmission({
    environment,
    database,
    dynamicVerificationContext,
  });
  const isAdjudicationRequestAdmitted = resolveAdjudicationAdmission({
    environment,
    database,
    dynamicVerificationContext,
  });
  const parseArtifactEnabled = readFeatureToggle(
    environment.VERIFICATION_PARSE_ARTIFACT_ENABLED,
    "INVALID_VERIFICATION_PARSE_ARTIFACT_ENABLED",
  );
  const verificationCaptureCatalog = resolveCaptureCatalog({
    environment,
    dynamicVerificationContext,
  });
  const isParseArtifactRequestAdmitted = resolveParseArtifactAdmission({
    environment,
    dynamicVerificationContext,
  });
  const isClaimsRequestAdmitted = resolveClaimsAdmission({
    environment,
    claimsEnabled,
  });
  const staticVerificationContext = resolveStaticVerificationContext(environment);
  const resolveVerificationContext =
    dynamicVerificationContext ?? staticVerificationContext;
  if (!database || !verificationConfigured || !resolveVerificationContext)
    return { verificationConfigured };
  return {
    verificationConfigured,
    resolveVerificationContext,
    verificationOperationService: new PostgresKnowledgeOperationService(database, {
      admittedOperationKinds: collectAdmittedOperationKinds({
        ...(options.extraAdmittedKinds
          ? { extraAdmittedKinds: options.extraAdmittedKinds }
          : {}),
        parseArtifactEnabled: parseArtifactEnabled === "1",
        metricEnabled: metricEnabled === "1",
        claimsEnabled: claimsEnabled === "1",
        auditInspectionEnabled:
          environment.VERIFICATION_AUDIT_INSPECTION_ENABLED?.trim() === "1",
        adjudicationEnabled: Boolean(isAdjudicationRequestAdmitted),
        benchmarkEnabled: Boolean(benchmarkConfig),
        comparisonEnabled: Boolean(comparisonConfig),
        extractionEnabled: Boolean(extractionConfig),
      }),
    }),
    ...(verificationCaptureCatalog ? { verificationCaptureCatalog } : {}),
    ...(isParseArtifactRequestAdmitted ? { isParseArtifactRequestAdmitted } : {}),
    ...(extractionConfig
      ? {
          isStructuredExtractionRequestAdmitted:
            createStructuredExtractionRequestAdmission(extractionConfig),
        }
      : {}),
    ...(benchmarkConfig
      ? { isBenchmarkRequestAdmitted: createBenchmarkRequestAdmission(benchmarkConfig) }
      : {}),
    ...(comparisonConfig
      ? {
          isBenchmarkComparisonRequestAdmitted:
            createBenchmarkComparisonRequestAdmission(comparisonConfig),
        }
      : {}),
    ...(isClaimsRequestAdmitted ? { isClaimsRequestAdmitted } : {}),
    ...(isAuditInspectionRequestAdmitted
      ? { isAuditInspectionRequestAdmitted }
      : {}),
    ...(isAdjudicationRequestAdmitted ? { isAdjudicationRequestAdmitted } : {}),
  };
}
