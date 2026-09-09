import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Actor, type OperationContext, type VerifyReportRequest, type VerificationArtifactHandle, type VerificationPolicyDefinition } from "@aiengineer/knowledge-contracts";
import { VerificationAdmissionService, VerificationClaimsProjectionGrantCatalog } from "@aiengineer/knowledge-application";
import { VERIFICATION_PARSER_LIMITS } from "@aiengineer/knowledge-conversion";
import { PostgresCanonicalRepository, PostgresKnowledgeOperationService, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { deterministicUuid, SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, digestCanonicalJson } from "@aiengineer/knowledge-verification";
import { buildServer } from "../apps/api/src/server.js";
import { createVerificationClaimsReportReads } from "../apps/api/src/verification-claims-report-reads-runtime.js";
import { createVerificationReads } from "../apps/api/src/verification-reads-runtime.js";
import { createVerificationOwnershipResolver } from "../apps/api/src/verification-ownership.js";
import { startWorker } from "../apps/worker/src/index.js";
import { createVerificationSemanticMissionFixture, type FrozenSemanticMissionRecord } from "./verification-semantic-mission-fixture.js";

type Registry = { readonly tenantId: string; readonly records: readonly (FrozenSemanticMissionRecord & { readonly sourceKey: string })[] };
type CloudConfig = { readonly temporalAddress: string; readonly temporalNamespace: string };

export function cloudReportOperationId(input: { readonly tenantId: string; readonly missionId: string; readonly workItemId: string; readonly attemptId: string }): string {
  const idempotencyKey = ["vd1", "verifyReport", input.tenantId, input.missionId, input.workItemId, input.attemptId].join(":");
  return deterministicUuid("verification-http-operation", `${input.tenantId}:verifyReport:${idempotencyKey}`);
}

async function main(): Promise<void> {
  const temporalApiKey = process.env.TEMPORAL_API_KEY?.trim() || process.env.TEMPORAL_CLOUD_API_KEY?.trim();
  assert.ok(temporalApiKey, "TEMPORAL_CLOUD_API_KEY_REQUIRED");
  const cloud = JSON.parse(await readFile(resolve("../internal/verification-temporal-cloud-setup-0ef2dd14-1cb0-4b80-b8a8-dc0ee12dc929.config.json"), "utf8")) as CloudConfig;
  assert.equal(cloud.temporalAddress, "us-east-1.aws.api.temporal.io:7233", "TEMPORAL_CLOUD_ADDRESS_DRIFT");
  assert.equal(cloud.temporalNamespace, "verification-cph-20260908.ih0e7", "TEMPORAL_CLOUD_NAMESPACE_DRIFT");
  // @ts-expect-error local proof config is deliberately outside the package graph.
  const { loadVerifiedLocalDevelopmentConfig } = await import("../../internal/verification-local-direct-config.mjs") as { loadVerifiedLocalDevelopmentConfig(): Promise<{ DB_URL: string; API_URL: string; SECRET_KEY: string }> };
  const local = await loadVerifiedLocalDevelopmentConfig();
  const databaseUrl = new URL(local.DB_URL);
  const storageUrl = new URL(local.API_URL);
  assert.ok(["127.0.0.1", "localhost"].includes(databaseUrl.hostname) && databaseUrl.port === "54322", "CLOUD_HOST_LOCAL_DB_ONLY");
  assert.ok(["127.0.0.1", "localhost"].includes(storageUrl.hostname) && storageUrl.port === "54321", "CLOUD_HOST_LOCAL_STORAGE_ONLY");

  const namespace = randomUUID();
  const workflowId = `verification-cloud-report-${namespace}`;
  const taskQueue = `verification-cloud-report-${namespace}`;
  const bucket = "ai-engineer-cloud-bucket";
  const registry = JSON.parse(await readFile(resolve("../internal/verification-frozen-source-registry-7a74a7a8-0dc4-4591-8bb1-5781ebddef42.json"), "utf8")) as Registry;
  const frozen = registry.records.find(record => record.sourceKey === "gl-comparison");
  assert.ok(frozen?.projections[0], "CLOUD_HOST_FROZEN_PROJECTION_REQUIRED");
  const missionId = randomUUID(), producerWorkItemId = randomUUID(), producerAttemptId = randomUUID(), verifierWorkItemId = randomUUID(), verifierAttemptId = randomUUID();
  const producerDeploymentId = `cloud-host-producer-${namespace}`, verifierDeploymentId = `cloud-host-verifier-${namespace}`;
  const actor: Actor = { kind: "service", id: randomUUID(), serviceIdentity: "mission_control_client" };
  const operationId = cloudReportOperationId({ tenantId: registry.tenantId, missionId, workItemId: verifierWorkItemId, attemptId: verifierAttemptId });
  const context: OperationContext = { contractVersion: "v1", tenantId: registry.tenantId, operationId, attemptId: verifierAttemptId, missionId, workItemId: verifierWorkItemId,
    correlationId: `verification-cloud-report-${namespace}`, actor, capabilityVersion: "verification.v1",
    idempotencyKey: ["vd1", "verifyReport", registry.tenantId, missionId, verifierWorkItemId, verifierAttemptId].join(":"),
    reason: "Authorized deterministic Temporal Cloud report verification proof", externalExecution: { runtime: "mission_control", runId: workflowId } };
  const startupPath = resolve("../internal", `verification-cloud-fixture-host-startup-${namespace}.json`);
  const receiptPath = resolve("../internal", `verification-cloud-fixture-host-${namespace}.json`);
  const failurePath = receiptPath.replace(/\.json$/u, ".failure.json");
  await writeFile(startupPath, JSON.stringify({ schemaVersion: "verification-cloud-fixture-host-startup.v1", namespace, tenantId: registry.tenantId,
    missionId, workItemId: verifierWorkItemId, attemptId: verifierAttemptId, operationId, workflowId, taskQueue, temporalAddress: cloud.temporalAddress,
    temporalNamespace: cloud.temporalNamespace, intendedMutationScope: "one fresh local mission, producer attempt, verifier attempt, and exact scoped verifyReport operation",
    createdAt: new Date().toISOString() }, null, 2) + "\n", { flag: "wx" });

  const database = new PostgresCanonicalRepository({ connectionString: databaseUrl.toString(), localOnly: true });
  let server: ReturnType<typeof buildServer> | undefined;
  let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
  let phase = "fixture";
  try {
    await database.transaction(registry.tenantId, async client => {
      await client.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,$4)", [missionId, registry.tenantId, `verification-cloud-report-${namespace}`, "Temporal Cloud to local Knowledge Services deterministic report verification proof"]);
      await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind,spec) values($1,$2,$3,'verify_extraction',$4::jsonb)", [producerWorkItemId, registry.tenantId, missionId, JSON.stringify({ namespace, role: "cloud_report_producer" })]);
      await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id,started_at) values($1,$2,$3,1,$4,clock_timestamp())", [producerAttemptId, registry.tenantId, producerWorkItemId, producerDeploymentId]);
      await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind,spec) values($1,$2,$3,'verify_extraction',$4::jsonb)", [verifierWorkItemId, registry.tenantId, missionId, JSON.stringify({ namespace, role: "cloud_report_verifier" })]);
      await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id,started_at) values($1,$2,$3,1,$4,clock_timestamp())", [verifierAttemptId, registry.tenantId, verifierWorkItemId, verifierDeploymentId]);
    });
    const repository = new PostgresVerificationRepository(database, new SupabaseArtifactStore({ projectUrl: local.API_URL, serviceRoleKey: local.SECRET_KEY, bucket, maximumBytes: 32_000_000 }), {
      async authorize(input) { assert.equal(input.tenantId, registry.tenantId); assert.ok(["verification_admission", "verification_replay", "policy_replay"].includes(input.purpose)); },
    });
    const projection = frozen.projections[0]!;
    const admission = new VerificationAdmissionService(repository, { async parse(): Promise<never> { throw new Error("PARSER_FORBIDDEN_IN_CLOUD_PROOF"); } },
      { parserVersion: projection.parserVersion as "verification-native-parser.v1", imageDigest: projection.imageDigest, limits: VERIFICATION_PARSER_LIMITS },
      { storageBucket: bucket, producerVersion: "verification-cloud-host.v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", now: () => new Date().toISOString() });
    const register = async (value: unknown, artifactType: string): Promise<VerificationArtifactHandle> => repository.registerContentAddressedArtifact({ tenantId: registry.tenantId,
      producerAttemptId, missionId, artifactType, bytes: new TextEncoder().encode(canonicalizeJson(value)), createdAt: new Date().toISOString(), parentArtifactIds: [],
      producerActivityId: "verification-cloud-fixture-host", producerVersion: "v1", mediaType: "application/json", encryptionClass: "supabase-managed",
      retentionClass: "verification-audit", dataClassification: "restricted", bucketClass: "ledger", storageBucket: bucket });
    const policyVersion = `verification-cloud-policy-${namespace}`;
    const policy: VerificationPolicyDefinition = { schemaVersion: "verification-policy.v1", policyVersion, definitionId: policyVersion, criticalDownstreamUses: [],
      requireCrossFamilyForRisk: [], requireIndependentAuthorityForScopes: [], mixedEvidenceOutcome: "review", unknownCriticalOutcome: "review", authorityWithheldOutcome: "review", reviewAvailable: true };
    const policyArtifact = await register(policy, "verification_policy");
    const fixture = await createVerificationSemanticMissionFixture({ database, repository, admission, tenantId: registry.tenantId, namespace, missionId,
      producerAttemptId, producerDeploymentId, verifierDeploymentId, kind: "report", verifierAttemptId, policyVersion, frozenRecord: frozen });
    const request = fixture.request as VerifyReportRequest;
    const projectionGrant = fixture.projectionGrant;
    const keys = generateKeyPairSync("ed25519");
    const keyId = `verification-cloud-host-${namespace}`;
    const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKeyPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
    const ownershipGrants = JSON.stringify([{ tenantId: registry.tenantId, actor, missionId, agentDeploymentId: verifierDeploymentId,
      capabilityVersion: context.capabilityVersion, externalExecution: context.externalExecution }]);
    const claimsReportReads = createVerificationClaimsReportReads(database, { VERIFICATION_CLAIMS_REPORT_READ_PUBLIC_KEYS_JSON: JSON.stringify([{ keyId, publicKeyPem }]),
      VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON: ownershipGrants, SUPABASE_URL: local.API_URL, SUPABASE_SECRET_KEY: local.SECRET_KEY, VERIFICATION_STORAGE_BUCKET: bucket });
    const verificationReads = createVerificationReads(database, { VERIFICATION_READS_ENABLED: "1", SUPABASE_URL: local.API_URL, SUPABASE_SECRET_KEY: local.SECRET_KEY, VERIFICATION_STORAGE_BUCKET: bucket });
    assert.ok(claimsReportReads && verificationReads, "CLOUD_HOST_TYPED_READS_REQUIRED");
    const catalog = new VerificationClaimsProjectionGrantCatalog([projectionGrant]);
    const operations = new PostgresKnowledgeOperationService(database, { admittedOperationKinds: ["verification_report"] });
    const knowledgeToken = `verification-cloud-host-${randomUUID()}`;
    server = buildServer({ publicOrigin: "http://127.0.0.1", verificationOperationService: operations, resourceReader: database,
      verificationClaimsReportReads: claimsReportReads, verificationReads, verificationCaseReads: verificationReads.cases,
      isClaimsRequestAdmitted: (tenantId, candidate) => { try { catalog.resolve(tenantId, "assertions" in candidate ? candidate.assertions : candidate.claimLedger); return true; } catch { return false; } },
      resolveIdentity: token => token === knowledgeToken ? { actor, grants: [{ tenantId: registry.tenantId, roles: ["knowledge_operator"], scopes: [] }] } : undefined,
      resolveVerificationContext: createVerificationOwnershipResolver(database, ownershipGrants) });
    await server.listen({ host: "127.0.0.1", port: 0 });
    const address = server.server.address(); assert.ok(address && typeof address !== "string");
    const knowledgeBaseUrl = `http://127.0.0.1:${address.port}`;
    worker = await startWorker({ NODE_ENV: "test", KNOWLEDGE_PERSISTENCE_MODE: "postgres", WORKER_TENANT_ID: registry.tenantId, WORKER_OPERATION_ID: operationId,
      WORKER_POLL_MS: "25", POSTGRES_URL: databaseUrl.toString(), CANONICAL_LOCAL_ONLY: "1", SUPABASE_URL: local.API_URL, SUPABASE_SECRET_KEY: local.SECRET_KEY,
      SUPABASE_STORAGE_BUCKET: "source-captures", VERIFICATION_STORAGE_BUCKET: bucket, VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON: JSON.stringify([projectionGrant]),
      VERIFICATION_SEAL_POLICY_GRANTS_JSON: JSON.stringify([{ tenantId: registry.tenantId, policyVersion, policyArtifact: { artifactId: policyArtifact.artifactId, digest: policyArtifact.digest } }]),
      VERIFICATION_PARSER_IMAGE_DIGEST: projection.imageDigest, VERIFICATION_CODE_GIT_SHA: "uncommitted-cloud-proof", VERIFICATION_CODE_DIRTY: "1",
      VERIFICATION_RUNTIME_PLATFORM: "node24-windows", VERIFICATION_RUNTIME_DEPLOYMENT_ID: verifierDeploymentId,
      VERIFICATION_AUDIT_SIGNING_KEY_ID: keyId, VERIFICATION_AUDIT_SIGNING_PRIVATE_KEY_PEM: privateKeyPem });

    const dispatchGrant = { tenantId: registry.tenantId, missionId, actor, capabilityVersion: context.capabilityVersion };
    const dispatch = { operation: "verifyReport" as const, context: { tenantId: registry.tenantId, missionId, missionExecutionId: workflowId, workItemId: verifierWorkItemId,
      attemptId: verifierAttemptId, correlationId: context.correlationId }, requestDigest: digestCanonicalJson(request), request };
    phase = "temporal-cloud";
    const helper = await import(pathToFileURL(resolve("../ai-engineer-mission-control/scripts/prove-verification-temporal-cloud.ts")).href) as {
      proveVerificationTemporalCloud(config: unknown): Promise<{ receiptPath: string; historyPath: string; workflowId: string; taskQueue: string; result: Record<string, unknown> }> };
    const cloudResult = await helper.proveVerificationTemporalCloud({ temporalAddress: cloud.temporalAddress, temporalNamespace: cloud.temporalNamespace,
      temporalApiKey, knowledgeBaseUrl, knowledgeToken, fixture: dispatch, dispatchGrant, workflowId, taskQueue });
    assert.equal(cloudResult.workflowId, workflowId, "CLOUD_HOST_WORKFLOW_ID_DRIFT");
    assert.equal(cloudResult.result.operationId, operationId, "CLOUD_HOST_OPERATION_ID_DRIFT");
    assert.equal(cloudResult.result.state, "succeeded", "CLOUD_HOST_OPERATION_NOT_SUCCEEDED");
    assert.equal(cloudResult.result.disposition, "review_required", "CLOUD_HOST_REPORT_REVIEW_REQUIRED");
    const terminal = await claimsReportReads.getReport({ tenantId: registry.tenantId, operationId, actor });
    assert.equal(terminal.useCase, "verifyReport", "CLOUD_HOST_TYPED_REPORT_REQUIRED");
    assert.equal(terminal.output.mode, "deterministic_only", "CLOUD_HOST_DETERMINISTIC_ONLY_REQUIRED");
    assert.deepEqual(terminal.output.deterministic.reviewReasons, ["REPORT_CITATION_SEMANTICS_UNASSESSED"], "CLOUD_HOST_UNASSESSED_SEMANTICS_REQUIRED");
    const response = await fetch(`${knowledgeBaseUrl}/v1/verification/reports/${operationId}`, { headers: { authorization: `Bearer ${knowledgeToken}`, "x-tenant-id": registry.tenantId } });
    assert.equal(response.status, 200, "CLOUD_HOST_TYPED_REPORT_HTTP_STATUS");
    assert.equal(canonicalizeJson(await response.json()), canonicalizeJson(terminal), "CLOUD_HOST_TYPED_REPORT_HTTP_DRIFT");
    const operation = await database.getOperationRecord(registry.tenantId, operationId); assert.ok(operation);
    assert.equal(operation.ownershipMode, "mission_control"); assert.equal(operation.externalRunId, workflowId); assert.equal(operation.status, "succeeded");
    phase = "receipt";
    await writeFile(receiptPath, JSON.stringify({ schemaVersion: "verification-cloud-fixture-host-proof.v1", namespace, tenantId: registry.tenantId, missionId,
      workItemId: verifierWorkItemId, attemptId: verifierAttemptId, operationId, workflowId, taskQueue, temporalAddress: cloud.temporalAddress,
      temporalNamespace: cloud.temporalNamespace, requestDigest: digestCanonicalJson(request), cloudProof: { receiptPath: cloudResult.receiptPath, historyPath: cloudResult.historyPath },
      result: cloudResult.result, typedTerminal: terminal, operation: { ownershipMode: operation.ownershipMode, externalRunId: operation.externalRunId, status: operation.status }, publicKeyPem,
      checks: { productionVerificationWorkflowCompletedOnTemporalCloud: true, cloudToLocalKnowledgeHttpCompleted: true, exactOperationScopedWorker: true,
        deterministicReportVerificationPassed: true, semanticAssessmentWithheld: true, signedTypedTerminalVerified: true, cloudHistoryReplayPassed: true,
        duplicateWorkflowStartRejected: true, secretAbsenceCheckedByCloudHelper: true },
      limitations: ["No model or Gateway call was made", "Citation semantics were deliberately left unassessed, so the terminal disposition is review_required",
        "Local Knowledge Services database and Storage were used behind the Temporal Cloud activity"],
      sourceSha256: createHash("sha256").update(await readFile(new URL(import.meta.url))).digest("hex"), createdAt: new Date().toISOString() }, null, 2) + "\n", { flag: "wx" });
    process.stdout.write(JSON.stringify({ event: "verification.cloud_fixture_host.completed", receiptPath, cloudProofReceipt: cloudResult.receiptPath, workflowId, operationId }) + "\n");
  } catch (error) {
    await writeFile(failurePath, JSON.stringify({ schemaVersion: "verification-cloud-fixture-host-failure.v1", namespace, phase, operationId, workflowId,
      errorClass: error instanceof Error ? error.name : "unknown", errorCode: error instanceof Error ? error.message : "unknown", createdAt: new Date().toISOString() }, null, 2) + "\n", { flag: "wx" }).catch(() => undefined);
    throw error;
  } finally {
    if (worker) await worker.stop("verification-cloud-fixture-host");
    if (server) await server.close();
    await database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch(error => { process.stderr.write(JSON.stringify({ event: "verification.cloud_fixture_host.failed", error: error instanceof Error ? error.message : "unknown" }) + "\n"); process.exitCode = 1; });
}
