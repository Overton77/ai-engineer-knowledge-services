import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildServer } from "../apps/api/src/server.js";
import { createVerificationOwnershipResolver } from "../apps/api/src/verification-ownership.js";
import { buildKnowledgeMcpApp } from "../apps/mcp/src/index.js";
import { CanonicalActivityRegistry, createCanonicalActivityExecutor } from "../apps/worker/src/activity-registry.js";
import { CanonicalDurableKnowledgeWorker } from "../apps/worker/src/canonical-worker.js";
import { createConfiguredVerificationBenchmarkComparisonHandler } from "../apps/worker/src/verification-benchmark-comparison-runtime.js";
import { KnowledgeClient } from "@aiengineer/knowledge-client";
import { parseVerificationBenchmarkComparisonRuntimeConfig } from "@aiengineer/knowledge-application";
import { VerificationBenchmarkComparisonOperationResultSchema } from "@aiengineer/knowledge-contracts";
import { PostgresCanonicalRepository, PostgresKnowledgeOperationService, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore, deterministicUuid } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, createEd25519Verifier, digestCanonicalJson, verifyVerificationBenchmarkComparisonPublication } from "@aiengineer/knowledge-verification";

type Ref = { artifactId: string; digest: string };
type ProfileId = "paired_default" | "regression_gate";
type ApplicationReceipt = {
  tenantId: string;
  baseline: { runId: string; publicationArtifact: Ref };
  candidate: { runId: string; publicationArtifact: Ref };
  profiles: Record<"pairedDefault" | "regressionGate", { profileArtifact: Ref }>;
};
type InputKeyReceipt = { publicKey: { keyId: string; pem: string } };
type CrashReceipt = { keyId: string; publicKey: string };

const postgres = process.env.POSTGRES_URL;
const projectUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
if (!postgres || !/^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:127\.0\.0\.1|localhost):54322\//u.test(postgres)) throw new Error("COMPARISON_WORKER_LOCAL_DB_REQUIRED");
if (!projectUrl || !serviceRoleKey || !["localhost", "127.0.0.1"].includes(new URL(projectUrl).hostname) || new URL(projectUrl).port !== "54321") throw new Error("COMPARISON_WORKER_LOCAL_STORAGE_REQUIRED");

const internal = resolve("../internal");
const readJson = async <T>(name: string): Promise<T> => JSON.parse(await readFile(resolve(internal, name), "utf8")) as T;
const applicationReceipt = await readJson<ApplicationReceipt>("verification-benchmark-comparison-application-a8f9486b-c122-4b7b-b9b5-e5c986dfaa9a.json");
const benchmarkWorker = await readJson<InputKeyReceipt>("verification-benchmark-worker-62c9b30e-fb46-478c-9e8c-3da5701fce3a.json");
const crash = await readJson<CrashReceipt>("verification-benchmark-crash-5b42b488-405c-4b02-b28b-44eeaacc1bcd.json");
const tenantId = applicationReceipt.tenantId;
const namespace = randomUUID();
const missionId = randomUUID();
const workItemId = randomUUID();
const attemptId = randomUUID();
const actor = { kind: "service" as const, id: attemptId, serviceIdentity: "evaluation_executor" as const };
const bucket = "ai-engineer-cloud-bucket";
const token = `comparison-worker-${namespace}`;
const now = () => new Date().toISOString();
const database = new PostgresCanonicalRepository({ connectionString: postgres, localOnly: true });
const artifacts = new SupabaseArtifactStore({ projectUrl, serviceRoleKey, bucket, maximumBytes: 8_000_000 });
const repository = new PostgresVerificationRepository(database, artifacts, {
  async authorize(input) {
    if (input.tenantId !== tenantId || !["verification_admission", "verification_replay"].includes(input.purpose)) throw new Error("COMPARISON_WORKER_ARTIFACT_DENIED");
  },
});
const comparisonOperations = new PostgresKnowledgeOperationService(database, { admittedOperationKinds: ["verification_benchmark_compare"] });
const genericOperations = new PostgresKnowledgeOperationService(database);
const operationIds: string[] = [];
const checks: Record<string, boolean> = {};
const profileRef = (profileId: ProfileId): Ref => {
  const value = profileId === "paired_default"
    ? applicationReceipt.profiles.pairedDefault.profileArtifact
    : applicationReceipt.profiles.regressionGate.profileArtifact;
  return { artifactId: value.artifactId, digest: value.digest };
};
const comparisonRequest = (profileId: ProfileId) => ({
  verificationContractVersion: "verification.v1" as const,
  baselineRunId: applicationReceipt.baseline.runId,
  candidateRunId: applicationReceipt.candidate.runId,
  comparisonProfile: profileId,
});

async function registerSnapshot(value: unknown) {
  return repository.registerContentAddressedArtifact({
    tenantId,
    bytes: new TextEncoder().encode(canonicalizeJson(value)),
    mediaType: "application/json",
    createdAt: now(),
    producerActivityId: "verification-benchmark-comparison-worker-proof",
    producerVersion: "1",
    encryptionClass: "supabase-managed",
    retentionClass: "verification-audit",
    dataClassification: "restricted",
    artifactType: "verification_benchmark_provenance",
    bucketClass: "ledger",
    storageBucket: bucket,
    producerAttemptId: attemptId,
    missionId,
    parentArtifactIds: [],
  });
}

function runCli(baseUrl: string, request: unknown, context: unknown) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(process.execPath, [resolve("apps/cli/dist/index.js"), "benchmark", "compare", "--base-url", baseUrl, "--context", JSON.stringify(context), "--input", JSON.stringify(request), "--wait", "--timeout-ms", "120000"], {
      windowsHide: true,
      env: { SYSTEMROOT: process.env.SYSTEMROOT, WINDIR: process.env.WINDIR, KNOWLEDGE_API_TOKEN: token },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 130_000);
    let stdout = "", stderr = "", settled = false;
    const finish = (value: { code: number | null; stdout: string; stderr: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done(value);
    };
    child.stdout.on("data", value => { stdout += value; });
    child.stderr.on("data", value => { stderr += value; });
    child.on("error", error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on("close", code => finish({ code, stdout, stderr }));
  });
}

async function waitForQueued(operationId: string): Promise<void> {
  for (let index = 0; index < 400; index += 1) {
    if ((await database.getOperation(tenantId, operationId))?.status === "queued") return;
    await new Promise(resolveWait => setTimeout(resolveWait, 20));
  }
  throw new Error("COMPARISON_OPERATION_NOT_QUEUED");
}

try {
  await database.transaction(tenantId, async client => {
    await client.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,'Configured benchmark comparison worker proof')", [missionId, tenantId, `comparison-worker-${namespace}`]);
    await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind) values($1,$2,$3,'review_task')", [workItemId, tenantId, missionId]);
    await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,1,'benchmark-comparison-worker-proof')", [attemptId, tenantId, workItemId]);
  });

  const sourcePaths = [
    "apps/worker/src/verification-benchmark-comparison-activity.ts",
    "apps/worker/src/verification-benchmark-comparison-runtime.ts",
    "packages/application/src/verification/benchmark/verification-benchmark-comparison.ts",
    "packages/application/src/verification/benchmark/verification-benchmark-comparison-publication.ts",
    "packages/application/src/verification/benchmark/verification-benchmark-comparison-runtime-config.ts",
    "packages/persistence/src/verification-benchmark-comparison.ts",
    "apps/api/src/server.ts",
    "packages/client-typescript/src/client.ts",
    "apps/cli/src/commands.ts",
    "apps/mcp/src/index.ts",
    "scripts/prove-verification-benchmark-comparison-worker.ts",
  ];
  const sourceFiles = await Promise.all(sourcePaths.map(async path => {
    const bytes = await readFile(path);
    return { path, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, bytesBase64: bytes.toString("base64") };
  }));
  const sourceSnapshot = await registerSnapshot({
    schemaVersion: "verification-benchmark-comparison-worker-source-snapshot.v1",
    scope: "Configured local comparison factory, worker, HTTP, client, built CLI and MCP transport sources; scoped source custody, not a deployment image",
    files: sourceFiles,
  });

  const signingKeys = generateKeyPairSync("ed25519");
  const privateKeyPem = signingKeys.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const publicKeyPem = signingKeys.publicKey.export({ format: "pem", type: "spki" }).toString();
  const keyId = `comparison-worker-${namespace}`;
  const config = {
    schemaVersion: "verification-benchmark-comparison-runtime.v1",
    tenantId,
    profiles: (["paired_default", "regression_gate"] as const).map(profileId => ({ profileId, artifact: profileRef(profileId) })),
    inputPublicKeys: [
      { keyId: benchmarkWorker.publicKey.keyId, publicKeyPem: benchmarkWorker.publicKey.pem },
      { keyId: crash.keyId, publicKeyPem: crash.publicKey },
    ],
    runtime: {
      deploymentId: "benchmark-comparison-worker-proof",
      capabilityVersion: "verification-service.v1",
      targetCodeRef: `uncommitted:${sourceSnapshot.digest}`,
      gitSha: "uncommitted",
      dirty: true,
      dirtyStateArtifact: sourceSnapshot,
    },
  };
  const configText = JSON.stringify(config);
  const parsedConfig = parseVerificationBenchmarkComparisonRuntimeConfig(configText);
  const handler = createConfiguredVerificationBenchmarkComparisonHandler({
    database,
    tenantId,
    projectUrl,
    serviceRoleKey,
    maximumArtifactBytes: 8_000_000,
    environment: {
      VERIFICATION_BENCHMARK_COMPARISON_CONFIG_JSON: configText,
      VERIFICATION_BENCHMARK_COMPARISON_SIGNING_PRIVATE_KEY_PEM: privateKeyPem,
      VERIFICATION_BENCHMARK_COMPARISON_SIGNING_KEY_ID: keyId,
      VERIFICATION_STORAGE_BUCKET: bucket,
    },
  });
  assert.ok(handler);
  assert.equal(createConfiguredVerificationBenchmarkComparisonHandler({ database, tenantId, projectUrl, serviceRoleKey, maximumArtifactBytes: 8_000_000, environment: {} }), undefined);
  checks.configuredFactoryAndUnconfiguredDenial = true;

  const registry = new CanonicalActivityRegistry([handler]);
  const worker = new CanonicalDurableKnowledgeWorker(`comparison-worker-${namespace}`, tenantId, database, createCanonicalActivityExecutor(database, registry), 30_000, registry.operationKinds());
  const resolver = createVerificationOwnershipResolver(database, JSON.stringify([{ tenantId, actor, missionId, agentDeploymentId: "benchmark-comparison-worker-proof", capabilityVersion: "verification-service.v1" }]));
  const admitted = (candidateTenant: string, candidateRequest: ReturnType<typeof comparisonRequest>) => {
    try { parsedConfig.catalog.resolve(candidateTenant, candidateRequest.comparisonProfile); return true; }
    catch (error) { if (error instanceof Error && error.message === "BENCHMARK_COMPARISON_PROFILE_TRUSTED_GRANT_REQUIRED") return false; throw error; }
  };
  const identity = { actor, grants: [{ tenantId, roles: ["knowledge_operator" as const], scopes: [] }] };
  const api = buildServer({
    operationService: genericOperations,
    verificationOperationService: comparisonOperations,
    resourceReader: database,
    resolveVerificationContext: resolver,
    isBenchmarkComparisonRequestAdmitted: admitted,
    resolveIdentity: value => value === token ? identity : undefined,
  });
  let mcp: ReturnType<typeof buildKnowledgeMcpApp> | undefined;
  try {
    const baseUrl = await api.listen({ host: "127.0.0.1", port: 0 });
    const client = new KnowledgeClient({ baseUrl, getAccessToken: () => token });
    const baseContext = { tenantId, missionId, workItemId, attemptId, correlationId: namespace };
    const pairedRequest = comparisonRequest("paired_default");
    const gateRequest = comparisonRequest("regression_gate");

    const unconfiguredApi = buildServer({ operationService: genericOperations, verificationOperationService: comparisonOperations, resourceReader: database, resolveVerificationContext: resolver, resolveIdentity: value => value === token ? identity : undefined });
    const unconfiguredKey = `unconfigured-${namespace}`;
    const denialHeaders = { authorization: `Bearer ${token}`, "x-tenant-id": tenantId, "x-correlation-id": namespace, "idempotency-key": unconfiguredKey, "x-verification-mission-id": missionId, "x-verification-work-item-id": workItemId, "x-verification-attempt-id": attemptId };
    assert.equal((await unconfiguredApi.inject({ method: "POST", url: "/v1/verification/benchmarks:compare", headers: denialHeaders, payload: pairedRequest })).statusCode, 503);
    assert.equal(await database.getOperation(tenantId, deterministicUuid("verification-http-operation", `${tenantId}:compareBenchmarkRuns:${unconfiguredKey}`)), undefined);
    await unconfiguredApi.close();
    const ungrantedApi = buildServer({ operationService: genericOperations, verificationOperationService: comparisonOperations, resourceReader: database, resolveVerificationContext: resolver, isBenchmarkComparisonRequestAdmitted: (_candidateTenant, candidateRequest) => candidateRequest.comparisonProfile === "paired_default", resolveIdentity: value => value === token ? identity : undefined });
    const ungrantedKey = `ungranted-${namespace}`;
    assert.equal((await ungrantedApi.inject({ method: "POST", url: "/v1/verification/benchmarks:compare", headers: { ...denialHeaders, "idempotency-key": ungrantedKey }, payload: gateRequest })).statusCode, 403);
    assert.equal(await database.getOperation(tenantId, deterministicUuid("verification-http-operation", `${tenantId}:compareBenchmarkRuns:${ungrantedKey}`)), undefined);
    await ungrantedApi.close();
    checks.httpUnconfiguredAndUngrantedDeniedBeforeWrite = true;

    const clientContext = { ...baseContext, idempotencyKey: `comparison-client-${namespace}` };
    const accepted = await client.compareBenchmarkRuns(pairedRequest, clientContext);
    const exactRetry = await client.compareBenchmarkRuns(pairedRequest, clientContext);
    assert.equal(exactRetry.operationId, accepted.operationId);
    operationIds.push(accepted.operationId);
    assert.equal((await worker.runOperationOnce(accepted.operationId))?.operation?.status, "succeeded");
    checks.typedClientAndIdempotentSubmission = true;

    const cliContext = {
      ...baseContext,
      operationId: randomUUID(),
      actor,
      capabilityVersion: "verification-service.v1",
      reason: "Configured comparison CLI proof",
      contractVersion: "v1" as const,
      correlationId: randomUUID(),
      idempotencyKey: `comparison-cli-${namespace}`,
    };
    const cliOperationId = deterministicUuid("verification-http-operation", `${tenantId}:compareBenchmarkRuns:${cliContext.idempotencyKey}`);
    operationIds.push(cliOperationId);
    const cliPromise = runCli(baseUrl, gateRequest, cliContext);
    await waitForQueued(cliOperationId);
    assert.equal((await worker.runOperationOnce(cliOperationId))?.operation?.status, "succeeded");
    const cliResult = await cliPromise;
    assert.equal(cliResult.code, 0, cliResult.stderr);
    assert.equal(JSON.parse(cliResult.stdout).comparison.engineeringGateOutcome, "pass");
    checks.builtCliComparisonWait = true;

    mcp = buildKnowledgeMcpApp({
      operationService: genericOperations,
      apiOrigin: baseUrl,
      resolveIdentity: value => value === token ? identity : undefined,
      createApiClient: accessToken => new KnowledgeClient({ baseUrl, getAccessToken: () => accessToken }),
    });
    const mcpOrigin = await mcp.listen({ host: "127.0.0.1", port: 0 });
    const require = createRequire(resolve("apps/mcp/package.json"));
    const { Client } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js")).href);
    const { StreamableHTTPClientTransport } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/streamableHttp.js")).href);
    const protocolClient = new Client({ name: "comparison-worker-proof", version: "1" });
    const mcpContext = { ...baseContext, correlationId: randomUUID(), idempotencyKey: `comparison-mcp-${namespace}` };
    try {
      await protocolClient.connect(new StreamableHTTPClientTransport(new URL(`${mcpOrigin}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
      const result = await protocolClient.callTool({ name: "knowledge_compare_benchmark_runs", arguments: { context: mcpContext, request: pairedRequest } });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      const mcpOperationId = (result.structuredContent as { operationId: string }).operationId;
      operationIds.push(mcpOperationId);
      assert.equal((await worker.runOperationOnce(mcpOperationId))?.operation?.status, "succeeded");
    } finally {
      await protocolClient.close();
    }
    checks.actualMcpHttpComparison = true;

    const verifier = createEd25519Verifier({ [keyId]: publicKeyPem });
    const trusted = repository.createTrustedArtifactResolver();
    const results = [];
    for (const [index, operationId] of operationIds.entries()) {
      const expectedProfile: ProfileId = index === 1 ? "regression_gate" : "paired_default";
      const receipts = (await database.listReceipts(tenantId, operationId)).filter(receipt => receipt.outcome === "succeeded");
      assert.equal(receipts.length, 1);
      const receipt = receipts[0]!;
      assert.equal(receipt.receiptKind, "compare_registered_and_publish.succeeded");
      const body = receipt.body as { schemaVersion: string; operationId: string; useCase: string; resultArtifact: { artifactId: string; digest: string }; output: unknown };
      assert.equal(body.schemaVersion, "verification-operation-result.v1");
      assert.equal(body.operationId, operationId);
      assert.equal(body.useCase, "compareBenchmarkRuns");
      const output = VerificationBenchmarkComparisonOperationResultSchema.parse(body.output);
      assert.equal(output.comparisonId, deterministicUuid("verification-benchmark-comparison", `${tenantId}:${operationId}`));
      assert.equal(output.baselineRunId, applicationReceipt.baseline.runId);
      assert.equal(output.candidateRunId, applicationReceipt.candidate.runId);
      assert.deepEqual(output.qualityClaims, { humanGoldValidated: false, sourceAuthorityAssessed: false, calibrated: false });
      assert.equal(output.engineeringGateOutcome, expectedProfile === "paired_default" ? "not_requested" : "pass");

      const row = await database.transaction(tenantId, async sql => (await sql.query<{ status: string; profile_id: string; result_artifact_id: string; result_sha256: string; result_digest_sha256: string; publication_artifact_id: string; publication_sha256: string; publication_payload_sha256: string; started_at: Date; completed_at: Date }>("select status,profile_id,result_artifact_id,result_sha256,result_digest_sha256,publication_artifact_id,publication_sha256,publication_payload_sha256,started_at,completed_at from evaluation.verification_benchmark_comparison where tenant_id=$1 and operation_id=$2", [tenantId, operationId])).rows[0]);
      assert.ok(row);
      assert.equal(row.status, "sealed");
      assert.equal(row.profile_id, expectedProfile);
      assert.equal(row.publication_artifact_id, body.resultArtifact.artifactId);
      assert.equal(`sha256:${row.publication_sha256}`, body.resultArtifact.digest);
      assert.equal(`sha256:${row.publication_payload_sha256}`, output.manifestDigest);
      assert.equal(`sha256:${row.result_digest_sha256}`, output.resultDigest);
      assert.ok(new Date(row.completed_at).getTime() >= new Date(row.started_at).getTime());

      await trusted.authorizeArtifact({ tenantId, artifactId: body.resultArtifact.artifactId, purpose: "verification_admission" });
      const hydratedPublication = await trusted.hydrateRegisteredArtifact({ tenantId, artifactId: body.resultArtifact.artifactId });
      const verified = await verifyVerificationBenchmarkComparisonPublication(JSON.parse(new TextDecoder().decode(hydratedPublication.bytes)), verifier);
      assert.equal(verified.signatureStatus, "verified");
      assert.equal(verified.manifest.operationId, operationId);
      assert.equal(verified.manifest.comparisonId, output.comparisonId);
      assert.equal(verified.manifest.profile.profileId, expectedProfile);
      assert.equal(verified.manifest.profile.artifact.artifactId, profileRef(expectedProfile).artifactId);
      assert.equal(verified.manifest.result.artifact.artifactId, row.result_artifact_id);
      assert.equal(verified.manifest.result.resultDigest, output.resultDigest);
      assert.equal(verified.manifest.seal.payloadDigest, output.manifestDigest);
      assert.equal(verified.manifest.runtime.attemptId, attemptId);
      assert.equal(verified.manifest.execution.externalProviderRequests, 0);
      await trusted.authorizeArtifact({ tenantId, artifactId: row.result_artifact_id, purpose: "verification_admission" });
      const hydratedResult = await trusted.hydrateRegisteredArtifact({ tenantId, artifactId: row.result_artifact_id });
      assert.equal(hydratedResult.registration.digest, `sha256:${row.result_sha256}`);
      const resultValue = JSON.parse(new TextDecoder().decode(hydratedResult.bytes)) as Record<string, unknown>;
      const { resultDigest: embeddedResultDigest, ...resultMaterial } = resultValue;
      assert.equal(embeddedResultDigest, output.resultDigest);
      assert.equal(digestCanonicalJson(resultMaterial), output.resultDigest);
      results.push({ operationId, receiptId: receipt.id, output, comparison: row, publicationArtifact: body.resultArtifact, publication: verified.manifest });
    }
    assert.equal(new Set(results.map(result => result.output.comparisonId)).size, 3);
    checks.threeCanonicalSucceededSealedComparisons = true;
    checks.exactTerminalReceiptsAndSignedPublications = true;
    checks.originalSignedInputsAndV3ProfilesUsed = true;
    checks.externalProviderRequestsZero = true;

    const reportPath = resolve(internal, `verification-benchmark-comparison-worker-${namespace}.json`);
    const report = {
      status: "passed",
      capturedAt: now(),
      scope: "Configured local benchmark comparison worker through typed HTTP client, built CLI wait and actual MCP Streamable HTTP; no provider requests or public comparison reads",
      tenantId,
      missionId,
      workItemId,
      attemptId,
      operationIds,
      checks,
      results,
      inputPublications: { baseline: applicationReceipt.baseline, candidate: applicationReceipt.candidate },
      profiles: { pairedDefault: profileRef("paired_default"), regressionGate: profileRef("regression_gate") },
      runtime: config.runtime,
      publicKey: { keyId, pem: publicKeyPem },
      sourceSnapshot,
      sourceHashes: Object.fromEntries(sourceFiles.map(source => [source.path, source.digest])),
      sourceSnapshotScope: "Scoped source custody, not a dependency graph or deployment image",
      externalProviderRequests: 0,
    };
    await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ receipt: reportPath, status: "passed", checks, operationIds }));
  } finally {
    await mcp?.close();
    await api.close();
  }
} finally {
  for (const operationId of operationIds) {
    try {
      const operation = await database.getOperation(tenantId, operationId);
      if (operation?.status === "queued" || operation?.status === "running") await comparisonOperations.cancel(operationId, tenantId, {
        tenantId, missionId, workItemId, attemptId, operationId, actor,
        capabilityVersion: "verification-service.v1", reason: "Proof cleanup", contractVersion: "v1",
        correlationId: randomUUID(), idempotencyKey: `comparison-cleanup-${operationId}`,
      });
    } catch { /* Preserve the primary proof failure. */ }
  }
  await database.close();
}
