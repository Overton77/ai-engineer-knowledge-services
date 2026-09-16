import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildServer } from "../apps/api/src/server.js";
import { createVerificationBenchmarkComparisonReads } from "../apps/api/src/verification-benchmark-comparison-reads-runtime.js";
import { buildKnowledgeMcpApp } from "../apps/mcp/src/index.js";
import { KnowledgeClient } from "@aiengineer/knowledge-client";
import { VerificationBenchmarkComparisonResourceSchema } from "@aiengineer/knowledge-contracts";
import { PostgresCanonicalRepository, PostgresKnowledgeOperationService, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson } from "@aiengineer/knowledge-verification";

type WorkerReceipt = {
  tenantId: string;
  missionId: string;
  workItemId: string;
  attemptId: string;
  publicKey: { keyId: string; pem: string };
  results: readonly {
    output: { comparisonId: string };
    publication: { result: { artifact: { artifactId: string } } };
  }[];
};

const postgres = process.env.POSTGRES_URL;
const projectUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SECRET_KEY;
if (!postgres || !/^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:127\.0\.0\.1|localhost):54322\//u.test(postgres)) throw new Error("COMPARISON_READ_LOCAL_DB_REQUIRED");
if (!projectUrl || !serviceRoleKey || !["localhost", "127.0.0.1"].includes(new URL(projectUrl).hostname) || new URL(projectUrl).port !== "54321") throw new Error("COMPARISON_READ_LOCAL_STORAGE_REQUIRED");

const internal = resolve("../internal");
const worker = JSON.parse(await readFile(resolve(internal, "verification-benchmark-comparison-worker-f861733d-499b-43d0-96a5-4596ee51944c.json"), "utf8")) as WorkerReceipt;
const tenantId = worker.tenantId;
const comparisonId = worker.results[0]!.output.comparisonId;
const namespace = randomUUID();
const foreignTenant = randomUUID();
const token = `comparison-read-${namespace}`;
const bucket = "ai-engineer-cloud-bucket";
const database = new PostgresCanonicalRepository({ connectionString: postgres, localOnly: true });
const readKeys = [{ keyId: worker.publicKey.keyId, publicKeyPem: worker.publicKey.pem }];
const reads = createVerificationBenchmarkComparisonReads(database, {
  ...process.env,
  VERIFICATION_BENCHMARK_COMPARISON_READ_PUBLIC_KEYS_JSON: JSON.stringify(readKeys),
});
assert.ok(reads);
const actor = { kind: "human" as const, id: randomUUID() };
const identity = { actor, grants: [{ tenantId, roles: ["knowledge_reader" as const], scopes: [] }, { tenantId: foreignTenant, roles: ["knowledge_reader" as const], scopes: [] }] };
const operationService = new PostgresKnowledgeOperationService(database);
const api = buildServer({ verificationBenchmarkComparisonReads: reads, resolveIdentity: value => value === token ? identity : undefined });
const checks: Record<string, boolean> = {};
let mcp: ReturnType<typeof buildKnowledgeMcpApp> | undefined;

function runCli(baseUrl: string) {
  const context = {
    tenantId,
    operationId: randomUUID(),
    attemptId: worker.attemptId,
    missionId: worker.missionId,
    workItemId: worker.workItemId,
    actor,
    capabilityVersion: "verification-service.v1",
    idempotencyKey: `comparison-read-${namespace}`,
    reason: "Read signed benchmark comparison",
    contractVersion: "v1",
    correlationId: namespace,
  };
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(process.execPath, [resolve("apps/cli/dist/index.js"), "benchmark", "comparison", "--base-url", baseUrl, "--context", JSON.stringify(context), "--input", JSON.stringify({ comparisonId })], {
      windowsHide: true,
      env: { SYSTEMROOT: process.env.SYSTEMROOT, WINDIR: process.env.WINDIR, KNOWLEDGE_API_TOKEN: token },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); done({ code, stdout, stderr }); });
  });
}

function assertProjection(publicValue: unknown, rawValue: unknown): void {
  const projected = VerificationBenchmarkComparisonResourceSchema.parse(publicValue);
  assert.equal(projected.comparisonId, comparisonId);
  assert.equal(projected.statisticalScope, "paired_engineering_observations_without_assessed_cluster_independence");
  type RawMetric = Record<string, unknown> & { mcnemar: { pValue: number }; pairedClusterSignFlip: { pValue: number } };
  const raw = rawValue as {
    pairComparisons: readonly { pairId: string; comparison: { pairing: { caseCount: number; clusterCount: number; clusterUnit: string }; metrics: Record<string, RawMetric> } }[];
    globalInference: unknown;
  };
  assert.equal(projected.pairs.length, raw.pairComparisons.length);
  for (const [pairIndex, pair] of projected.pairs.entries()) {
    const retained = raw.pairComparisons[pairIndex]!;
    assert.equal(pair.pairId, retained.pairId);
    assert.equal(pair.caseCount, retained.comparison.pairing.caseCount);
    assert.equal(pair.clusterCount, retained.comparison.pairing.clusterCount);
    assert.equal(pair.clusterUnit, retained.comparison.pairing.clusterUnit);
    assert.equal(pair.metrics.length, 9);
    for (const metric of pair.metrics) {
      const source = retained.comparison.metrics[metric.metric]!;
      const rate = (value: unknown) => {
        const candidate = value as Record<string, unknown>;
        return { successes: candidate.successes, denominator: candidate.denominator, estimate: candidate.estimate, lower: candidate.lower, upper: candidate.upper };
      };
      assert.deepEqual(metric, {
        metric: metric.metric,
        denominator: source.denominator,
        baseline: rate(source.baseline),
        candidate: rate(source.candidate),
        delta: source.delta,
        regressionObservation: source.regressionObservation,
        clusterBootstrap: source.clusterBootstrap,
        mcnemarPValue: source.mcnemar.pValue,
        clusterSignFlipPValue: source.pairedClusterSignFlip.pValue,
      });
    }
  }
  const global = raw.globalInference as { correction: unknown; tests: unknown };
  assert.deepEqual(projected.globalInference, { correction: global.correction, tests: global.tests });
}

try {
  const origin = await api.listen({ host: "127.0.0.1", port: 0 });
  const client = new KnowledgeClient({ baseUrl: origin, getAccessToken: () => token });
  const context = { tenantId, correlationId: namespace };

  const resultArtifactId = worker.results[0]!.publication.result.artifact.artifactId;
  const verificationRepository = new PostgresVerificationRepository(database, new SupabaseArtifactStore({ projectUrl, serviceRoleKey, bucket, maximumBytes: 8_000_000 }), {
    async authorize(input) { if (input.tenantId !== tenantId || input.purpose !== "verification_replay") throw new Error("COMPARISON_READ_PROOF_ARTIFACT_DENIED"); },
  });
  const resolver = verificationRepository.createTrustedArtifactResolver();
  await resolver.authorizeArtifact({ tenantId, artifactId: resultArtifactId, purpose: "verification_replay" });
  const retained = await resolver.hydrateRegisteredArtifact({ tenantId, artifactId: resultArtifactId });
  const rawResult = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(retained.bytes));

  const resource = await client.getBenchmarkComparison(comparisonId, context);
  assertProjection(resource, rawResult);
  assert.equal(resource.tenantId, tenantId);
  assert.equal(resource.publication.signatureStatus, "verified");
  assert.equal(resource.result.artifact.artifactId, resultArtifactId);
  checks.typedClientMatchesActualSignedResult = true;

  const serialized = JSON.stringify(resource);
  for (const field of ["objectKey", "storageBucket", "signatureBase64", "publicKeyPem", "parentArtifactIds", "transformationSignature", "pairComparisons"]) assert.equal(serialized.includes(`\"${field}\"`), false);
  checks.noPrivateStorageOrSignatureFields = true;

  const headers = { authorization: `Bearer ${token}`, "x-tenant-id": tenantId, "x-correlation-id": namespace };
  assert.equal((await api.inject({ url: `/v1/verification/benchmarks/comparisons/${randomUUID()}`, headers })).statusCode, 404);
  assert.equal((await api.inject({ url: `/v1/verification/benchmarks/comparisons/${comparisonId}`, headers: { ...headers, "x-tenant-id": foreignTenant } })).statusCode, 404);
  assert.equal((await api.inject({ url: "/v1/verification/benchmarks/comparisons/not-a-uuid", headers })).statusCode, 400);
  assert.equal((await api.inject({ url: `/v1/verification/benchmarks/comparisons/${comparisonId}?include=result`, headers })).statusCode, 400);
  checks.missingAndForeignHiddenInvalidAndQueryKeysRejected = true;

  const unconfigured = buildServer({ resolveIdentity: value => value === token ? identity : undefined });
  assert.equal((await unconfigured.inject({ url: `/v1/verification/benchmarks/comparisons/${comparisonId}`, headers })).statusCode, 503);
  await unconfigured.close();
  assert.equal(createVerificationBenchmarkComparisonReads(database, { ...process.env, VERIFICATION_BENCHMARK_COMPARISON_READ_PUBLIC_KEYS_JSON: "" }), undefined);
  checks.unconfiguredReadCapabilityDenied = true;

  const wrongPublicKey = generateKeyPairSync("ed25519").publicKey.export({ format: "pem", type: "spki" }).toString();
  const wrongReads = createVerificationBenchmarkComparisonReads(database, { ...process.env, VERIFICATION_BENCHMARK_COMPARISON_READ_PUBLIC_KEYS_JSON: JSON.stringify([{ keyId: worker.publicKey.keyId, publicKeyPem: wrongPublicKey }]) });
  assert.ok(wrongReads);
  const wrongApi = buildServer({ verificationBenchmarkComparisonReads: wrongReads, resolveIdentity: value => value === token ? identity : undefined });
  assert.equal((await wrongApi.inject({ url: `/v1/verification/benchmarks/comparisons/${comparisonId}`, headers })).statusCode, 503);
  await wrongApi.close();
  checks.wrongTrustedKeyFailsClosed = true;

  const cli = await runCli(origin);
  assert.equal(cli.code, 0, cli.stderr);
  assertProjection(JSON.parse(cli.stdout), rawResult);
  checks.builtCliComparisonRead = true;

  mcp = buildKnowledgeMcpApp({
    operationService,
    apiOrigin: origin,
    resolveIdentity: value => value === token ? identity : undefined,
    createApiClient: accessToken => new KnowledgeClient({ baseUrl: origin, getAccessToken: () => accessToken }),
  });
  const mcpOrigin = await mcp.listen({ host: "127.0.0.1", port: 0 });
  const require = createRequire(resolve("apps/mcp/package.json"));
  const { Client } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js")).href);
  const { StreamableHTTPClientTransport } = await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/streamableHttp.js")).href);
  const protocolClient = new Client({ name: "comparison-read-proof", version: "1" });
  try {
    await protocolClient.connect(new StreamableHTTPClientTransport(new URL(`${mcpOrigin}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const mcpResult = await protocolClient.callTool({ name: "knowledge_get_benchmark_comparison", arguments: { context, comparisonId } });
    assert.notEqual(mcpResult.isError, true, JSON.stringify(mcpResult));
    assertProjection(mcpResult.structuredContent, rawResult);
  } finally {
    await protocolClient.close();
  }
  checks.actualMcpHttpComparisonRead = true;

  const sourcePaths = [
    "packages/contracts/src/verification/benchmark-comparison-reads.ts",
    "packages/application/src/verification/benchmark/verification-benchmark-comparison-reads.ts",
    "packages/persistence/src/verification-benchmark-comparison-reads.ts",
    "apps/api/src/verification-benchmark-comparison-reads-runtime.ts",
    "apps/api/src/server.ts",
    "packages/client-typescript/src/client.ts",
    "apps/cli/src/commands.ts",
    "apps/mcp/src/index.ts",
    "scripts/prove-verification-benchmark-comparison-reads.ts",
  ];
  const sources = await Promise.all(sourcePaths.map(async path => {
    const bytes = await readFile(path);
    return { path, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, bytesBase64: bytes.toString("base64") };
  }));
  const output = resolve(internal, `verification-benchmark-comparison-reads-${namespace}.json`);
  await writeFile(output, JSON.stringify({
    status: "passed",
    capturedAt: new Date().toISOString(),
    scope: "Read-only local sealed benchmark comparison SQL/Storage custody through configured HTTP, typed client, built CLI and actual MCP HTTP; no comparison execution",
    tenantId,
    comparisonId,
    checks,
    resource,
    rawResultArtifact: { artifactId: resultArtifactId, digest: retained.registration.digest },
    sources,
    externalProviderRequests: 0,
  }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ status: "passed", output, checks }));
} finally {
  await mcp?.close();
  await api.close();
  await database.close();
}
