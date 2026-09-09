import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { VerificationArtifactHandleSchema, VerificationReportLedgerSchema, type Actor, type VerificationArtifactHandle, type VerificationPolicyDefinition } from "@aiengineer/knowledge-contracts";
import { loadDiagnosticsV1ProviderGrant, VerificationAdmissionService, VerificationClaimsProjectionGrantCatalog } from "@aiengineer/knowledge-application";
import { VERIFICATION_PARSER_LIMITS } from "@aiengineer/knowledge-conversion";
import { PostgresCanonicalRepository, PostgresKnowledgeOperationService, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, digestCanonicalJson } from "@aiengineer/knowledge-verification";
import { buildServer } from "../apps/api/src/server.js";
import { createVerificationClaimsReportReads } from "../apps/api/src/verification-claims-report-reads-runtime.js";
import { createVerificationReads } from "../apps/api/src/verification-reads-runtime.js";
import { createVerificationOwnershipResolver } from "../apps/api/src/verification-ownership.js";
import { startWorker } from "../apps/worker/src/index.js";
import { createVerificationAgentReportFixture, type AgentReportAssertionInput, type AgentReportFrozenRecord } from "./verification-agent-report-fixture.js";
import { cloudReportOperationId } from "./start-verification-cloud-fixture-host.js";

type Registry = { readonly tenantId: string; readonly records: readonly (AgentReportFrozenRecord & { readonly sourceKey: string })[] };
type CloudConfig = { readonly temporalAddress: string; readonly temporalNamespace: string };
export type CursorCloudReportInput = { readonly reportMarkdown: string; readonly assertion: AgentReportAssertionInput; readonly producerAgentId: string; readonly producerRunId: string };
export type VerificationCloudAgentRuntime = "cursor_cloud" | "eve";

/**
 * Prepares one actual agent-authored report behind the production MC Cloud API.
 * Tokens are returned only to the in-process caller and are never persisted or logged here.
 */
export async function startVerificationCloudAgentReportHost(input: CursorCloudReportInput & { readonly temporalApiKey: string; readonly upstreamBearer?: string; readonly deferKnowledgeWorker?: boolean; readonly externalMissionWorker?: boolean; readonly transportRuntime?: VerificationCloudAgentRuntime }) {
  assert.ok(input.temporalApiKey.trim(), "TEMPORAL_CLOUD_API_KEY_REQUIRED");
  assert.ok(input.producerAgentId.trim() && input.producerRunId.trim(), "CLOUD_AGENT_REPORT_LINEAGE_REQUIRED");
  const cloud = JSON.parse(await readFile(resolve("../internal/verification-temporal-cloud-setup-0ef2dd14-1cb0-4b80-b8a8-dc0ee12dc929.config.json"), "utf8")) as CloudConfig;
  assert.equal(cloud.temporalAddress, "us-east-1.aws.api.temporal.io:7233");
  assert.equal(cloud.temporalNamespace, "verification-cph-20260908.ih0e7");
  // @ts-expect-error verified local helper intentionally lives above the package graph.
  const { loadVerifiedLocalDevelopmentConfig } = await import("../../internal/verification-local-direct-config.mjs") as { loadVerifiedLocalDevelopmentConfig(): Promise<{ DB_URL: string; API_URL: string; SECRET_KEY: string }> };
  const local = await loadVerifiedLocalDevelopmentConfig();
  const databaseUrl = new URL(local.DB_URL), storageUrl = new URL(local.API_URL);
  assert.ok(["127.0.0.1", "localhost"].includes(databaseUrl.hostname) && databaseUrl.port === "54322", "CLOUD_AGENT_REPORT_LOCAL_DB_ONLY");
  assert.ok(["127.0.0.1", "localhost"].includes(storageUrl.hostname) && storageUrl.port === "54321", "CLOUD_AGENT_REPORT_LOCAL_STORAGE_ONLY");
  const namespace = randomUUID(), bucket = "ai-engineer-cloud-bucket";
  const transportRuntime = input.transportRuntime ?? "cursor_cloud";
  const runtimeLabel = transportRuntime === "eve" ? "eve" : "cursor-cloud";
  const registry = JSON.parse(await readFile(resolve("../internal/verification-frozen-source-registry-7a74a7a8-0dc4-4591-8bb1-5781ebddef42.json"), "utf8")) as Registry;
  const provider = await loadDiagnosticsV1ProviderGrant(resolve("catalog/verification-benchmarks/diagnostics-companies-v1"));
  const benchmarkCase = provider.dataset.cases.find(item => item.caseId === "tru-symphony-source"); assert.ok(benchmarkCase);
  const frozen = registry.records.find(record => record.sourceKey === benchmarkCase.evidence[0]!.sourceKey); assert.ok(frozen?.projections[0]);
  const missionId = randomUUID(), producerWorkItemId = randomUUID(), producerAttemptId = randomUUID(), verifierWorkItemId = randomUUID(), verifierAttemptId = randomUUID();
  const verifierDeploymentId = `${runtimeLabel}-verifier-${namespace}`;
  const actor: Actor = { kind: "service", id: randomUUID(), serviceIdentity: "mission_control_client" };
  const operationId = cloudReportOperationId({ tenantId: registry.tenantId, missionId, workItemId: verifierWorkItemId, attemptId: verifierAttemptId });
  const dispatchIdempotencyKey = ["vd1", "verifyReport", registry.tenantId, missionId, verifierWorkItemId, verifierAttemptId].join(":");
  const workflowId = `verification-${createHash("sha256").update(dispatchIdempotencyKey).digest("hex")}`;
  const taskQueue = `verification-${runtimeLabel}-${namespace}`;
  const database = new PostgresCanonicalRepository({ connectionString: databaseUrl.toString(), localOnly: true });
  let knowledgeServer: ReturnType<typeof buildServer> | undefined;
  let knowledgeWorker: Awaited<ReturnType<typeof startWorker>> | undefined;
  let cloudRuntime: { readonly baseUrl: string; close(): Promise<void> } | undefined;
  try {
    await database.transaction(registry.tenantId, async client => {
      await client.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,$4)", [missionId, registry.tenantId, `${runtimeLabel}-report-${namespace}`, `${transportRuntime === "eve" ? "Eve" : "Cursor Cloud"} transport of an agent report through Mission Control Temporal Cloud and Knowledge Services`]);
      await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind,spec) values($1,$2,$3,'verify_extraction',$4::jsonb)", [producerWorkItemId, registry.tenantId, missionId, JSON.stringify({ namespace, role: "agent_report_producer", producerAgentId: input.producerAgentId, producerRunId: input.producerRunId, transportRuntime })]);
      await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id,started_at) values($1,$2,$3,1,$4,clock_timestamp())", [producerAttemptId, registry.tenantId, producerWorkItemId, input.producerAgentId]);
      await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind,spec) values($1,$2,$3,'verify_extraction',$4::jsonb)", [verifierWorkItemId, registry.tenantId, missionId, JSON.stringify({ namespace, role: `${transportRuntime}_report_verifier`, transportRuntime })]);
      await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id,started_at) values($1,$2,$3,1,$4,clock_timestamp())", [verifierAttemptId, registry.tenantId, verifierWorkItemId, verifierDeploymentId]);
    });
    const repository = new PostgresVerificationRepository(database, new SupabaseArtifactStore({ projectUrl: local.API_URL, serviceRoleKey: local.SECRET_KEY, bucket, maximumBytes: 32_000_000 }), {
      async authorize(value) { assert.equal(value.tenantId, registry.tenantId); assert.ok(["verification_admission", "verification_replay", "policy_replay"].includes(value.purpose)); },
    });
    const projection = frozen.projections[0]!;
    const admission = new VerificationAdmissionService(repository, { async parse(): Promise<never> { throw new Error("PARSER_FORBIDDEN_IN_CLOUD_AGENT_REPORT"); } },
      { parserVersion: projection.parserVersion as "verification-native-parser.v1", imageDigest: projection.imageDigest, limits: VERIFICATION_PARSER_LIMITS },
      { storageBucket: bucket, producerVersion: `${runtimeLabel}-report.v1`, encryptionClass: "supabase-managed", retentionClass: "verification-audit", now: () => new Date().toISOString() });
    const register = async (value: unknown, artifactType: string): Promise<VerificationArtifactHandle> => repository.registerContentAddressedArtifact({ tenantId: registry.tenantId,
      producerAttemptId, missionId, artifactType, bytes: new TextEncoder().encode(canonicalizeJson(value)), createdAt: new Date().toISOString(), parentArtifactIds: [],
      producerActivityId: "verification-cloud-agent-report-host", producerVersion: "v1", mediaType: "application/json", encryptionClass: "supabase-managed",
      retentionClass: "verification-audit", dataClassification: "restricted", bucketClass: "ledger", storageBucket: bucket });
    const policyVersion = `${runtimeLabel}-policy-${namespace}`;
    const policy: VerificationPolicyDefinition = { schemaVersion: "verification-policy.v1", policyVersion, definitionId: policyVersion, criticalDownstreamUses: [],
      requireCrossFamilyForRisk: [], requireIndependentAuthorityForScopes: [], mixedEvidenceOutcome: "review", unknownCriticalOutcome: "review", authorityWithheldOutcome: "review", reviewAvailable: true };
    const policyArtifact = await register(policy, "verification_policy");
    const reportSha256 = createHash("sha256").update(input.reportMarkdown, "utf8").digest("hex");
    const priorReportRows = await database.transaction(registry.tenantId, async client => (await client.query<Record<string, unknown>>(`select a.*,
      m.producer_activity_id,m.producer_version,m.content_encoding,m.encryption_class,m.retention_class,m.data_classification,m.parent_artifact_ids,m.transformation_signature,m.attestation_artifact_id,
      pa.agent_deployment_id as report_producer_agent_id,w.spec->>'producerRunId' as report_producer_run_id
      from orchestration.artifact a join orchestration.verification_artifact_metadata m on m.tenant_id=a.tenant_id and m.artifact_id=a.id
      join orchestration.attempt pa on pa.tenant_id=a.tenant_id and pa.id=a.producer_attempt_id
      join orchestration.work_item w on w.tenant_id=pa.tenant_id and w.id=pa.work_item_id
      where a.tenant_id=$1 and a.sha256=$2 and a.artifact_type='report_markdown' and a.storage_state='available'
      order by a.created_at asc limit 2`, [registry.tenantId, reportSha256])).rows);
    assert.ok(priorReportRows.length <= 1, "CLOUD_AGENT_REPORT_PRIOR_ARTIFACT_AMBIGUOUS");
    const prior = priorReportRows[0];
    const existingReportRegistration = prior ? { artifact: VerificationArtifactHandleSchema.parse({ artifactId: String(prior.id), tenantId: String(prior.tenant_id),
      digest: `sha256:${String(prior.sha256)}`, mediaType: String(prior.media_type), byteLength: Number(prior.size_bytes), objectKey: String(prior.object_path),
      ...(prior.content_encoding ? { contentEncoding: String(prior.content_encoding) } : {}), createdAt: prior.created_at instanceof Date ? prior.created_at.toISOString() : new Date(String(prior.created_at)).toISOString(),
      producerActivityId: String(prior.producer_activity_id), producerVersion: String(prior.producer_version), encryptionClass: String(prior.encryption_class),
      retentionClass: String(prior.retention_class), dataClassification: String(prior.data_classification), parentArtifactIds: prior.parent_artifact_ids,
      ...(prior.transformation_signature ? { transformationSignature: `sha256:${String(prior.transformation_signature)}` } : {}),
      ...(prior.attestation_artifact_id ? { attestationArtifactId: String(prior.attestation_artifact_id) } : {}) }),
      producerAgentId: String(prior.report_producer_agent_id), producerRunId: String(prior.report_producer_run_id) } : undefined;
    const fixture = await createVerificationAgentReportFixture({ repository, admission, tenantId: registry.tenantId, namespace, missionId, producerAttemptId,
      producerDeploymentId: input.producerAgentId, verifierAttemptId, verifierDeploymentId, policyVersion, frozenRecord: frozen, benchmarkCase,
      producerRunId: input.producerRunId, reportMarkdown: input.reportMarkdown, assertion: input.assertion,
      ...(existingReportRegistration ? { existingReportRegistration } : {}) });
    const request = fixture.request;
    const projectionGrant = fixture.projectionGrant;
    const fixtureResolver = repository.createTrustedArtifactResolver();
    await fixtureResolver.authorizeArtifact({ tenantId: registry.tenantId, artifactId: fixture.reportArtifact.artifactId, purpose: "verification_replay" });
    const reportHydrated = await fixtureResolver.hydrateRegisteredArtifact({ tenantId: registry.tenantId, artifactId: fixture.reportArtifact.artifactId });
    await fixtureResolver.authorizeArtifact({ tenantId: registry.tenantId, artifactId: fixture.assertionsArtifact.artifactId, purpose: "verification_replay" });
    const ledgerHydrated = await fixtureResolver.hydrateRegisteredArtifact({ tenantId: registry.tenantId, artifactId: fixture.assertionsArtifact.artifactId });
    const parsedLedger = VerificationReportLedgerSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(ledgerHydrated.bytes)));
    assert.equal(canonicalizeJson(parsedLedger.reportArtifact), canonicalizeJson(reportHydrated.registration), "CLOUD_AGENT_REPORT_LEDGER_REPORT_MISMATCH");
    const keys = generateKeyPairSync("ed25519"), keyId = `${runtimeLabel}-${namespace}`;
    const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    const ownershipGrants = JSON.stringify([{ tenantId: registry.tenantId, actor, missionId, agentDeploymentId: verifierDeploymentId,
      capabilityVersion: "verification.v1", externalExecution: { runtime: "mission_control", runId: workflowId } }]);
    const claimsReportReads = createVerificationClaimsReportReads(database, { VERIFICATION_CLAIMS_REPORT_READ_PUBLIC_KEYS_JSON: JSON.stringify([{ keyId, publicKeyPem }]),
      VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON: ownershipGrants, SUPABASE_URL: local.API_URL, SUPABASE_SECRET_KEY: local.SECRET_KEY, VERIFICATION_STORAGE_BUCKET: bucket });
    const verificationReads = createVerificationReads(database, { VERIFICATION_READS_ENABLED: "1", SUPABASE_URL: local.API_URL, SUPABASE_SECRET_KEY: local.SECRET_KEY, VERIFICATION_STORAGE_BUCKET: bucket });
    assert.ok(claimsReportReads && verificationReads);
    const catalog = new VerificationClaimsProjectionGrantCatalog([projectionGrant]);
    const knowledgeToken = `${runtimeLabel}-knowledge-${randomUUID()}`;
    const operationService = new PostgresKnowledgeOperationService(database, { admittedOperationKinds: ["verification_report"] });
    knowledgeServer = buildServer({ publicOrigin: "http://127.0.0.1", operationService, verificationOperationService: operationService,
      resourceReader: database, verificationClaimsReportReads: claimsReportReads, verificationReads, verificationCaseReads: verificationReads.cases,
      isClaimsRequestAdmitted: (tenantId, candidate) => { try { catalog.resolve(tenantId, "assertions" in candidate ? candidate.assertions : candidate.claimLedger); return true; } catch { return false; } },
      resolveIdentity: token => token === knowledgeToken ? { actor, grants: [{ tenantId: registry.tenantId, roles: ["knowledge_operator"], scopes: [] }] } : undefined,
      resolveVerificationContext: createVerificationOwnershipResolver(database, ownershipGrants) });
    await knowledgeServer.listen({ host: "127.0.0.1", port: 0 });
    const knowledgeAddress = knowledgeServer.server.address(); assert.ok(knowledgeAddress && typeof knowledgeAddress !== "string");
    const knowledgeBaseUrl = `http://127.0.0.1:${knowledgeAddress.port}`;
    const startOwnedKnowledgeWorker = () => startWorker({ NODE_ENV: "test", KNOWLEDGE_PERSISTENCE_MODE: "postgres", WORKER_TENANT_ID: registry.tenantId,
      WORKER_OPERATION_ID: operationId, WORKER_POLL_MS: "25", POSTGRES_URL: databaseUrl.toString(), CANONICAL_LOCAL_ONLY: "1", SUPABASE_URL: local.API_URL,
      SUPABASE_SECRET_KEY: local.SECRET_KEY, SUPABASE_STORAGE_BUCKET: "source-captures", VERIFICATION_STORAGE_BUCKET: bucket,
      VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON: JSON.stringify([projectionGrant]),
      VERIFICATION_SEAL_POLICY_GRANTS_JSON: JSON.stringify([{ tenantId: registry.tenantId, policyVersion, policyArtifact: { artifactId: policyArtifact.artifactId, digest: policyArtifact.digest } }]),
      VERIFICATION_PARSER_IMAGE_DIGEST: projection.imageDigest, VERIFICATION_CODE_GIT_SHA: `uncommitted-${runtimeLabel}-proof`, VERIFICATION_CODE_DIRTY: "1",
      VERIFICATION_RUNTIME_PLATFORM: "node24-windows", VERIFICATION_RUNTIME_DEPLOYMENT_ID: verifierDeploymentId,
      VERIFICATION_AUDIT_SIGNING_KEY_ID: keyId, VERIFICATION_AUDIT_SIGNING_PRIVATE_KEY_PEM: privateKeyPem });
    if (!input.deferKnowledgeWorker) knowledgeWorker = await startOwnedKnowledgeWorker();
    const upstreamBearer = input.upstreamBearer ?? `${runtimeLabel}-upstream-${randomUUID()}-${randomUUID()}`;
    const dispatchGrant = { tenantId: registry.tenantId, missionId, actor, capabilityVersion: "verification.v1" };
    const dispatch = { operation: "verifyReport" as const, context: { tenantId: registry.tenantId, missionId, missionExecutionId: workflowId,
      workItemId: verifierWorkItemId, attemptId: verifierAttemptId, correlationId: `${runtimeLabel}-report-${namespace}` }, requestDigest: digestCanonicalJson(request), request };
    const cloudModule = await import(pathToFileURL(resolve("../ai-engineer-mission-control/scripts/prove-verification-temporal-cloud.ts")).href) as {
      startVerificationTemporalCloudApiRuntime(config: unknown): Promise<{ baseUrl: string; close(): Promise<void> }> };
    cloudRuntime = await cloudModule.startVerificationTemporalCloudApiRuntime({ temporalAddress: cloud.temporalAddress, temporalNamespace: cloud.temporalNamespace,
      temporalApiKey: input.temporalApiKey, taskQueue, knowledgeBaseUrl, knowledgeToken, dispatchGrant, upstreamBearer, externalWorker: input.externalMissionWorker });
    const launchBody = JSON.stringify(dispatch);
    let closed = false;
    return { baseUrl: cloudRuntime.baseUrl, upstreamBearer, launchBody, fixture: Object.freeze({ tenantId: registry.tenantId, missionId, workflowId, launchBody }),
      namespace, taskQueue, operationId, producer: { agentId: input.producerAgentId, runId: input.producerRunId,
        attemptId: prior ? String(prior.producer_attempt_id) : producerAttemptId }, verifier: { attemptId: verifierAttemptId, deploymentId: verifierDeploymentId }, transportRuntime,
      source: { caseId: benchmarkCase.caseId, caseDigest: benchmarkCase.caseDigest, inputManifestArtifactId: benchmarkCase.inputManifestArtifactId,
        captureId: benchmarkCase.evidence[0]!.captureId, projectionArtifactId: benchmarkCase.evidence[0]!.projectionArtifactId,
        transformationArtifactId: benchmarkCase.evidence[0]!.transformationArtifactId, selector: benchmarkCase.evidence[0]!.selector,
        fragmentId: benchmarkCase.evidence[0]!.fragmentId, selectedContentDigest: benchmarkCase.evidence[0]!.selectedContentDigest },
      // In-memory child-process configuration only; never persist or log this object.
      missionWorkerConfig: { temporalAddress: cloud.temporalAddress, temporalNamespace: cloud.temporalNamespace, temporalApiKey: input.temporalApiKey, taskQueue, knowledgeBaseUrl, knowledgeToken, dispatchGrant },
      async startKnowledgeWorker() { assert.ok(!closed, "CLOUD_HOST_CLOSED"); if (!knowledgeWorker) knowledgeWorker = await startOwnedKnowledgeWorker(); },
      async readOperationState() { return database.transaction(registry.tenantId, async client => (await client.query<{status:string}>("select status from knowledge_service.operation where tenant_id=$1 and id=$2", [registry.tenantId, operationId])).rows[0]?.status); },
      async cancelOwnedOperation() { return (await database.cancelOperation(registry.tenantId, operationId, { actorIdentity: `service:${actor.id}`, correlationId: randomUUID() }))?.status; },
      async readTerminal() { return claimsReportReads.getReport({ tenantId: registry.tenantId, operationId, actor }); },
      async registerPublicTransportTranscript(value: unknown) { assert.ok(!closed, "CLOUD_HOST_CLOSED"); return repository.registerContentAddressedArtifact({ tenantId: registry.tenantId,
        producerAttemptId: verifierAttemptId, missionId, artifactType: "execution_receipt", bytes: new TextEncoder().encode(canonicalizeJson(value)), createdAt: new Date().toISOString(),
        parentArtifactIds: [fixture.reportArtifact.artifactId, fixture.assertionsArtifact.artifactId],
        transformationSignature: digestCanonicalJson({ schemaVersion: "verification-public-transport-transcript-transformation.v1", transportRuntime,
          verifierAttemptId, reportArtifactId: fixture.reportArtifact.artifactId, assertionsArtifactId: fixture.assertionsArtifact.artifactId }),
        producerActivityId: "verification-cloud-agent-report-host:registerPublicTransportTranscript",
        producerVersion: "v1", mediaType: "application/json", encryptionClass: "supabase-managed", retentionClass: "verification-audit", dataClassification: "restricted",
        bucketClass: "ledger", storageBucket: bucket }); },
      async close() { if (closed) return; closed = true; try { await cloudRuntime?.close(); } finally { try { await knowledgeWorker?.stop(`${runtimeLabel}-host`); } finally { try { await knowledgeServer?.close(); } finally { await database.close(); } } } },
    };
  } catch (error) {
    if (cloudRuntime) await cloudRuntime.close().catch(() => undefined);
    if (knowledgeWorker) await knowledgeWorker.stop(`${runtimeLabel}-host-failed`).catch(() => undefined);
    if (knowledgeServer) await knowledgeServer.close().catch(() => undefined);
    await database.close().catch(() => undefined);
    throw error;
  }
}

async function smokeMain() {
  const reportPath = process.env.VERIFICATION_CLOUD_AGENT_REPORT_PATH?.trim();
  const temporalApiKey = process.env.TEMPORAL_API_KEY?.trim() || process.env.TEMPORAL_CLOUD_API_KEY?.trim();
  const producerAgentId = process.env.VERIFICATION_CLOUD_AGENT_ID?.trim(), producerRunId = process.env.VERIFICATION_CLOUD_RUN_ID?.trim();
  assert.ok(reportPath && resolve(reportPath) === reportPath && temporalApiKey && producerAgentId && producerRunId, "CLOUD_AGENT_REPORT_SMOKE_INPUT_REQUIRED");
  const report = JSON.parse(await readFile(reportPath, "utf8")) as { reportMarkdown: string; assertion: AgentReportAssertionInput };
  const host = await startVerificationCloudAgentReportHost({ ...report, producerAgentId, producerRunId, temporalApiKey });
  try {
    const readiness = await fetch(`${host.baseUrl}/readiness`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(readiness.status, 200, "CLOUD_AGENT_REPORT_MC_READINESS_FAILED");
    const body = await readiness.json() as { capabilities?: { verificationExecutions?: boolean } };
    assert.equal(body.capabilities?.verificationExecutions, true, "CLOUD_AGENT_REPORT_MC_WORKER_NOT_READY");
    process.stdout.write(JSON.stringify({ event: "verification.cloud_agent_report_host.ready", workflowId: host.fixture.workflowId,
      operationId: host.operationId, taskQueue: host.taskQueue, launchBytes: Buffer.byteLength(host.launchBody), productionApiReady: true }) + "\n");
  } finally { await host.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await smokeMain().catch(error => { process.stderr.write(JSON.stringify({ event: "verification.cloud_agent_report_host.failed", error: error instanceof Error ? error.message : "unknown" }) + "\n"); process.exitCode = 1; });
}
