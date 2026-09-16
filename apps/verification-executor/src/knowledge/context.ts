import { createPublicKey } from "node:crypto";
import { z } from "zod";
import { ReportAssessmentService, ReportAssessmentAuthorityPinSchema, type ReportAssessmentAuthorityPin, type ReportAssessmentAuthority, type ReportAssessmentConfig } from "./report-assessment.js";
import { createEd25519Verifier, digestCanonicalJson } from "@aiengineer/knowledge-verification";
import { PolicyDefinitionInputSchema } from "../intents.js";
import { verificationStoreOracle } from "./evidence-oracle.js";
import { ArtifactLedger, ReadExecutor } from "@aiengineer/knowledge-db-read";
import { ContentLinkExecutor, ContentSummaryPreparer, IngestionExecutor, ReportService, REPORT_BUCKET } from "@aiengineer/knowledge-ingestion";
import { createContentLinkAuthority } from "./content-links.js";
import { TenantPostgres, PostgresCanonicalRepository, PostgresSourceDiscoveryStore, PostgresCheckpointStore, PostgresGovernedIndexRepository, PostgresClaimsReportReadRepository, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { SourceDiscoveryApplicationService, CheckpointApplicationService, type SourceDiscoveryHost } from "@aiengineer/knowledge-application";
import { LocalArtifactStore, SupabaseArtifactStore, type ArtifactStore } from "@aiengineer/knowledge-runtime";
import { loadWorkspace, resolveWorkspaceDir, type Workspace } from "@aiengineer/knowledge-schema-workspace";
import { loadExecutorConfig, type VerificationExecutor } from "../executor.js";
import { createExecutorCustody } from "../store-custody-postgres.js";
import { createSourceDiscoveryHost, type DiscoveryHostConfig } from "./source-discovery-host.js";
import { createSourceDiscoveryCustody } from "./source-discovery-custody.js";
import { EXECUTOR_STORAGE_PROFILE } from "../store-custody-profile.js";
import { CHECKPOINT_POLICY } from "./checkpoints-policy.js";
import { createCheckpointCustody } from "./checkpoints-custody.js";
import { createCheckpointReconciler } from "./checkpoints-reconciler.js";
import { KnowledgeCheckpointHarness } from "./checkpoints-harness.js";
import { createCheckpointOwnerReconciler } from "./checkpoints-owners.js";
import { CanonicalRecoveryHost, RecoveryHostConfigSchema, type RecoveryHostConfig } from "./recovery-host.js";

export const KNOWLEDGE_EXECUTOR_VERSION = "knowledge-executor/0.1.0";
const LEDGER_BUCKET = "research-ingestion-intents";
const DEFAULT_ARTIFACT_DIR = ".knowledge-artifacts";
const FALLBACK_WORKSPACE = "../../../ai-engineer-db-contract/workspace";

export interface KnowledgeConfig {
  readonly databaseUrl: string;
  readonly workspaceDir: string;
  readonly artifactDir: string;
  readonly defaultTenantId: string;
  readonly allowStale: boolean;
  /** Host-authorized immutable definition; custom versions also require a pinned digest. */
  readonly evidencePolicyVersion?: string;
  readonly evidencePolicyDigest?: string;
  /** Legacy declared configuration is parsed only to reject it at startup. */
  readonly evidenceOracle: "verification-store" | "declared-runs";
  readonly storage: { readonly projectUrl: string; readonly secretKey: string } | undefined;
  readonly producerAttemptId?: string;
  readonly missionId?: string;
  readonly discoveryProviders?: DiscoveryHostConfig;
  readonly recovery?: RecoveryHostConfig;
  readonly reportAssessmentPins?: Readonly<Record<string, ReportAssessmentAuthorityPin>>;
  readonly contentLinksEnabled?: boolean;
}

export interface KnowledgeServices {
  readonly config: KnowledgeConfig;
  readonly db: TenantPostgres;
  readonly workspace: Workspace;
  readonly artifacts: ArtifactLedger;
  readonly reads: ReadExecutor;
  readonly ingestion: IngestionExecutor;
  readonly reports: ReportService;
  readonly reportAssessment?: ReportAssessmentService;
  readonly contentLinks?: ContentLinkExecutor;
  readonly contentSummaries?: ContentSummaryPreparer;
  readonly sourceDiscovery?: SourceDiscoveryApplicationService;
  readonly checkpoints?: CheckpointApplicationService;
  readonly checkpointHarness?: KnowledgeCheckpointHarness;
  readonly recovery?: CanonicalRecoveryHost;
  readonly prepareCapturedSource?: (input: unknown) => Promise<unknown>;
  close(): Promise<void>;
}

type Env = Readonly<Record<string, string | undefined>>;

/** `undefined` when no database URL is configured: the executor then serves verification only. */
export function loadKnowledgeConfig(env: Env = process.env): KnowledgeConfig | undefined {
  if (env.KNOWLEDGE_CONTENT_LINKS_ENABLED !== undefined && !["0", "1"].includes(env.KNOWLEDGE_CONTENT_LINKS_ENABLED)) throw new Error("CONTENT_LINK_ENABLE_VALUE_INVALID");
  const databaseUrl = env.KNOWLEDGE_DB_URL?.trim() || env.POSTGRES_URL?.trim();
  if (!databaseUrl) {
    if (env.KNOWLEDGE_RECOVERY_CONFIG_JSON?.trim() || env.KNOWLEDGE_REPORT_ASSESSMENT_PINS_JSON?.trim() || env.KNOWLEDGE_CONTENT_LINKS_ENABLED === "1") throw new Error("KNOWLEDGE_AUTHORITY_DATABASE_REQUIRED");
    if (env.KNOWLEDGE_ARTIFACT_STORAGE === "supabase") throw new Error("REMOTE_ARTIFACT_DATABASE_CONFIGURATION_REQUIRED");
    return undefined;
  }
  const secretKey = env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const projectUrl = env.SUPABASE_URL?.trim();
  if (env.KNOWLEDGE_ARTIFACT_STORAGE === "supabase" && (!projectUrl || !secretKey)) throw new Error("REMOTE_ARTIFACT_STORAGE_CONFIGURATION_REQUIRED");
  const recoveryJson = env.KNOWLEDGE_RECOVERY_CONFIG_JSON?.trim();
  if (recoveryJson && Buffer.byteLength(recoveryJson, "utf8") > 2_000_000) throw new Error("RECOVERY_HOST_CONFIGURATION_TOO_LARGE");
  const recovery = recoveryJson ? RecoveryHostConfigSchema.parse(JSON.parse(recoveryJson)) : undefined;
  const reportPinsJson = env.KNOWLEDGE_REPORT_ASSESSMENT_PINS_JSON?.trim();
  if (reportPinsJson && Buffer.byteLength(reportPinsJson, "utf8") > 2_000_000) throw new Error("REPORT_ASSESSMENT_CONFIGURATION_TOO_LARGE");
  const reportAssessmentPins = reportPinsJson ? z.record(z.uuid(), ReportAssessmentAuthorityPinSchema).parse(JSON.parse(reportPinsJson)) : undefined;
  if (recovery && env.KNOWLEDGE_ARTIFACT_STORAGE !== "supabase") throw new Error("RECOVERY_HOST_REMOTE_CUSTODY_REQUIRED");
  return {
    databaseUrl,
    workspaceDir: resolveWorkspaceDir({ env, fallbackDir: FALLBACK_WORKSPACE }),
    artifactDir: env.KNOWLEDGE_ARTIFACT_DIR?.trim() || DEFAULT_ARTIFACT_DIR,
    defaultTenantId: env.KNOWLEDGE_TENANT_ID?.trim() || env.VERIFY_TENANT_ID?.trim() || loadExecutorConfig(env).tenantId,
    allowStale: env.KNOWLEDGE_ALLOW_STALE === "1",
    contentLinksEnabled: env.KNOWLEDGE_CONTENT_LINKS_ENABLED === "1",
    ...(recovery ? { recovery } : {}),
    ...(reportAssessmentPins ? { reportAssessmentPins } : {}),
    ...(env.KNOWLEDGE_EVIDENCE_POLICY_DIGEST?.trim() ? { evidencePolicyDigest: env.KNOWLEDGE_EVIDENCE_POLICY_DIGEST.trim() } : {}),
    evidencePolicyVersion: env.KNOWLEDGE_EVIDENCE_POLICY_VERSION?.trim() || "executor-default.v1",
    evidenceOracle: env.KNOWLEDGE_EVIDENCE_ORACLE === "declared" ? "declared-runs" : "verification-store",
    storage: env.KNOWLEDGE_ARTIFACT_STORAGE === "supabase" && projectUrl && secretKey ? { projectUrl, secretKey } : undefined,
    ...(env.KNOWLEDGE_PRODUCER_ATTEMPT_ID?.trim() ? { producerAttemptId: env.KNOWLEDGE_PRODUCER_ATTEMPT_ID.trim() } : {}),
    ...(env.KNOWLEDGE_MISSION_ID?.trim() ? { missionId: env.KNOWLEDGE_MISSION_ID.trim() } : {}),
    discoveryProviders: {
      ...(env.TAVILY_API_KEY?.trim() ? { tavilyApiKey: env.TAVILY_API_KEY.trim() } : {}),
      ...(env.FIRECRAWL_API_KEY?.trim() ? { firecrawlApiKey: env.FIRECRAWL_API_KEY.trim() } : {}),
    },
  };
}

function artifactStore(config: KnowledgeConfig): { store: ArtifactStore; uploaded: boolean } {
  if (config.storage) return { store: new SupabaseArtifactStore({ projectUrl: config.storage.projectUrl, serviceRoleKey: config.storage.secretKey, bucket: LEDGER_BUCKET, maximumBytes: 64_000_000 }), uploaded: true };
  return { store: new LocalArtifactStore(config.artifactDir), uploaded: false };
}

export interface KnowledgeServicesOptions {
  /** Required authoritative co-hosted verifier; omission rejects before database initialization. */
  readonly verification?: VerificationExecutor;
  readonly sourceDiscoveryHost?: SourceDiscoveryHost;
  readonly reportAssessmentAuthority?: (config: Omit<ReportAssessmentConfig, "authority">) => ReportAssessmentAuthority;
  readonly prepareCapturedSource?: (input: unknown) => Promise<unknown>;
}

export function createKnowledgeServices(config: KnowledgeConfig, options: KnowledgeServicesOptions = {}): KnowledgeServices {
  if (config.evidenceOracle !== "verification-store" || !options.verification) throw new Error("EVIDENCE_ORACLE_REQUIRED");
  if (config.contentLinksEnabled && (!config.storage || !z.uuid().safeParse(config.producerAttemptId).success
    || !z.uuid().safeParse(config.missionId).success || !z.uuid().safeParse(config.defaultTenantId).success)) throw new Error("CONTENT_LINK_HOST_PINS_REQUIRED");
  const recoveryKeys: Record<string, string> = Object.create(null) as Record<string, string>;
  if (config.recovery) {
    if (!config.storage) throw new Error("RECOVERY_HOST_REMOTE_CUSTODY_REQUIRED");
    for (const row of config.recovery.publicKeys) {
      if (Object.hasOwn(recoveryKeys, row.keyId)) throw new Error("RECOVERY_HOST_DUPLICATE_KEY");
      const key = createPublicKey(row.publicKeyPem);
      if (key.asymmetricKeyType !== "ed25519") throw new Error("RECOVERY_HOST_KEY_ALGORITHM");
      recoveryKeys[row.keyId] = key.export({ type: "spki", format: "pem" }).toString();
    }
  }
  const policyVersion = config.evidencePolicyVersion ?? "executor-default.v1";
  if (policyVersion !== "executor-default.v1" && !config.evidencePolicyDigest) throw new Error("EVIDENCE_POLICY_DIGEST_REQUIRED");
  const defaultPolicy = { schemaVersion: "verification-policy.v1", definitionId: "policy-executor-default.v1", ...PolicyDefinitionInputSchema.parse({}) };
  const evidence = verificationStoreOracle(options.verification, { tenantId: config.defaultTenantId, policyVersion, policyDigest: config.evidencePolicyDigest ?? digestCanonicalJson(defaultPolicy) });
  const db = new TenantPostgres({ connectionString: config.databaseUrl, applicationName: "ai-engineer-knowledge-executor" });
  const workspace = loadWorkspace(config.workspaceDir);
  const { store, uploaded } = artifactStore(config);
  const reportStore = config.storage
    ? new SupabaseArtifactStore({ projectUrl: config.storage.projectUrl, serviceRoleKey: config.storage.secretKey, bucket: REPORT_BUCKET, maximumBytes: 64_000_000 })
    : new LocalArtifactStore(`${config.artifactDir}/reports`);
  const readStores: Record<string, ArtifactStore> = { [REPORT_BUCKET]: reportStore };
  if (config.contentLinksEnabled && config.storage) readStores[EXECUTOR_STORAGE_PROFILE.captures.bucket] = new SupabaseArtifactStore({
    projectUrl: config.storage.projectUrl, serviceRoleKey: config.storage.secretKey, bucket: EXECUTOR_STORAGE_PROFILE.captures.bucket,
    maximumBytes: EXECUTOR_STORAGE_PROFILE.maximumArtifactBytes,
  });
  if (config.contentLinksEnabled && config.storage) for (const bucket of ["source-captures", "content-derivatives"]) {
    readStores[bucket] = new SupabaseArtifactStore({ projectUrl: config.storage.projectUrl, serviceRoleKey: config.storage.secretKey,
      bucket, maximumBytes: EXECUTOR_STORAGE_PROFILE.maximumArtifactBytes });
  }
  const artifacts = new ArtifactLedger({ db, store, bucket: LEDGER_BUCKET, uploaded, executorVersion: KNOWLEDGE_EXECUTOR_VERSION, readStores });
  const reportArtifacts = new ArtifactLedger({ db, store: reportStore, bucket: REPORT_BUCKET, uploaded, executorVersion: KNOWLEDGE_EXECUTOR_VERSION });
  const reports = new ReportService({ db, artifacts: reportArtifacts });
  const reportPins = structuredClone(config.reportAssessmentPins ?? {});
  const reportAssessmentConfig = { db, reports, artifacts: reportArtifacts, verification: options.verification,
    tenantId: config.defaultTenantId, policyVersion, policyDigest: config.evidencePolicyDigest ?? digestCanonicalJson(defaultPolicy) };
  const reportAssessment = new ReportAssessmentService({ ...reportAssessmentConfig,
    authority: options.reportAssessmentAuthority?.(reportAssessmentConfig) ?? { async forReport({ tenantId, revisionId }) {
      if (tenantId !== config.defaultTenantId) throw new Error("REPORT_ASSESSMENT_TENANT_DENIED");
      return reportPins[revisionId];
    } },
  });
  const reads = new ReadExecutor({ db, workspace, artifacts, executorVersion: KNOWLEDGE_EXECUTOR_VERSION, allowStale: config.allowStale });
  const ingestion = new IngestionExecutor({ db, workspace, artifacts, executorVersion: KNOWLEDGE_EXECUTOR_VERSION, allowStale: config.allowStale, evidence });
  const contentConfig = config.contentLinksEnabled ? { db, workspace, artifacts, tenantId: config.defaultTenantId,
    missionId: config.missionId!, attemptId: config.producerAttemptId!, policyDigest: config.evidencePolicyDigest ?? digestCanonicalJson(defaultPolicy),
    executorVersion: KNOWLEDGE_EXECUTOR_VERSION,
    authority: createContentLinkAuthority({ verification: options.verification, tenantId: config.defaultTenantId,
      policyVersion, policyDigest: config.evidencePolicyDigest ?? digestCanonicalJson(defaultPolicy) }),
  } : undefined;
  const contentLinks = contentConfig ? new ContentLinkExecutor(contentConfig) : undefined;
  const contentSummaries = contentConfig ? new ContentSummaryPreparer(contentConfig) : undefined;
  const custody = config.storage ? createExecutorCustody({ databaseUrl: config.databaseUrl, tenantId: config.defaultTenantId,
    ...config.storage, ...(config.producerAttemptId ? { producerAttemptId: config.producerAttemptId } : {}),
    ...(config.missionId ? { missionId: config.missionId } : {}),
  }) : undefined;
  if (custody) {
    if (options.verification.store.tenantId !== config.defaultTenantId) throw new Error("ARTIFACT_TENANT_MISMATCH");
    options.verification.store.attachCustody(custody);
  }
  const discoveryDatabase = custody ? new PostgresCanonicalRepository({ connectionString: config.databaseUrl }) : undefined;
  const sourceDiscovery = discoveryDatabase && custody ? new SourceDiscoveryApplicationService(
    new PostgresSourceDiscoveryStore(discoveryDatabase), createSourceDiscoveryCustody(options.verification.store, custody,
      new SupabaseArtifactStore({ projectUrl: config.storage!.projectUrl, serviceRoleKey: config.storage!.secretKey,
        bucket: EXECUTOR_STORAGE_PROFILE.intermediate.bucket, maximumBytes: EXECUTOR_STORAGE_PROFILE.maximumArtifactBytes })),
    options.sourceDiscoveryHost ?? createSourceDiscoveryHost(config.discoveryProviders ?? {}),
  ) : undefined;
  const checkpoints = discoveryDatabase && custody ? new CheckpointApplicationService(
    new PostgresCheckpointStore(discoveryDatabase), createCheckpointCustody(options.verification.store, custody),
    createCheckpointReconciler(discoveryDatabase, custody, createCheckpointOwnerReconciler({ database: discoveryDatabase,
      store: options.verification.store, artifacts, reportArtifacts, custody, verification: custody,
      publications: new PostgresGovernedIndexRepository(discoveryDatabase), sourceDiscovery: sourceDiscovery!, ingestion, reports })), CHECKPOINT_POLICY,
  ) : undefined;
  const checkpointHarness = checkpoints && custody ? new KnowledgeCheckpointHarness({ tenantId: config.defaultTenantId,
    service: checkpoints, store: options.verification.store, custody, sourceDiscovery: sourceDiscovery! }) : undefined;
  let recovery: CanonicalRecoveryHost | undefined;
  if (config.recovery) {
    if (!discoveryDatabase || !custody || !checkpoints || !config.storage) throw new Error("RECOVERY_HOST_REMOTE_CUSTODY_REQUIRED");
    const nativeArtifacts = new SupabaseArtifactStore({ projectUrl: config.storage.projectUrl, serviceRoleKey: config.storage.secretKey,
      bucket: EXECUTOR_STORAGE_PROFILE.intermediate.bucket, maximumBytes: EXECUTOR_STORAGE_PROFILE.maximumArtifactBytes });
    const native = new PostgresVerificationRepository(discoveryDatabase, nativeArtifacts, {
      async authorize(request) { if (request.tenantId !== config.defaultTenantId) throw new Error("RECOVERY_HOST_TENANT_DENIED"); },
    });
    recovery = new CanonicalRecoveryHost({ tenantId: config.defaultTenantId, config: config.recovery, database: discoveryDatabase,
      store: options.verification.store, custody, checkpoints,
      reads: new PostgresClaimsReportReadRepository(discoveryDatabase, () => native.createTrustedArtifactResolver(), createEd25519Verifier(recoveryKeys)) });
    recovery.start();
  }
  return { config, db, workspace, artifacts, reads, ingestion, reports, reportAssessment,
    ...(contentLinks && contentSummaries ? { contentLinks, contentSummaries } : {}),
    ...(sourceDiscovery ? { sourceDiscovery } : {}),
    ...(checkpoints ? { checkpoints } : {}), ...(checkpointHarness ? { checkpointHarness } : {}),
    ...(recovery ? { recovery } : {}),
    ...(options.prepareCapturedSource ? { prepareCapturedSource: options.prepareCapturedSource } : {}),
    close: async () => { await recovery?.close(); await discoveryDatabase?.close(); await custody?.close(); await db.close(); },
  };
}

