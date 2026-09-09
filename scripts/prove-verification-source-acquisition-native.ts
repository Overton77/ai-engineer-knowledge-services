import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { VerificationAdmissionService, VerificationServiceCatalog, VerificationOperationApplicationService, TrustedVerificationSourceAcquirer, VerificationSourceAcquisitionCatalog } from "@aiengineer/knowledge-application";
import { SandboxedVerificationParser, VERIFICATION_PARSER_LIMITS } from "@aiengineer/knowledge-conversion";
import { PostgresCanonicalRepository, PostgresVerificationRepository, PostgresKnowledgeOperationService } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore, deterministicUuid } from "@aiengineer/knowledge-runtime";
import { sha256Digest } from "@aiengineer/knowledge-verification";
import { createVerificationOperationExecutor, verificationActivityHandlers } from "../apps/worker/src/verification-activities.js";
import { CanonicalActivityRegistry } from "../apps/worker/src/activity-registry.js";
import { CanonicalDurableKnowledgeWorker } from "../apps/worker/src/canonical-worker.js";
import { createVerificationCaptureReads } from "../apps/api/src/verification-capture-reads-runtime.js";
import { buildServer } from "../apps/api/src/server.js";
import { createVerificationBenchmarkCaptureProfileResolver } from "../apps/api/src/verification-benchmark-capture-profile.js";

const connectionString = process.env.POSTGRES_URL!, projectUrl = process.env.SUPABASE_URL!, serviceRoleKey = process.env.SUPABASE_SECRET_KEY!;
assert.ok(connectionString && projectUrl && serviceRoleKey);
assert.ok(new URL(connectionString).pathname.startsWith("/verification_source_acquire_"), "OWNED_CLONE_REQUIRED");
assert.equal(new URL(projectUrl).hostname, "127.0.0.1");
const proofId = randomUUID(), tenantId = randomUUID(), missionId = randomUUID(), workItemId = randomUUID(), attemptId = randomUUID(), sourceId = randomUUID();
const operationId=deterministicUuid("verification-http-operation",`${tenantId}:captureSource:source-acquisition-${proofId}`);
const outputPath = resolve("../internal", `verification-source-acquisition-native-${proofId}.json`);
const database = new PostgresCanonicalRepository({ connectionString, localOnly: true });
const bucket = "ai-engineer-cloud-bucket", now = () => new Date().toISOString();
const repository = new PostgresVerificationRepository(database, new SupabaseArtifactStore({ projectUrl, serviceRoleKey, bucket, maximumBytes: 8_000_000 }), { async authorize(input) { assert.equal(input.tenantId, tenantId); } });
const imageDigest = "sha256:1669a3f9674b2e0a70ba1c8686c1cb3647492b8268bdfa7a9a4452fb0530fb37" as const;
const config = { storageBucket: bucket, producerVersion: "verification-service.v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", now };
const checks: Record<string, boolean> = {};
let acquisitionCalls = 0;
try {
  const ledger = JSON.parse(await readFile(resolve("catalog/verification-benchmarks/diagnostics-companies-v1/source-ledger.json"), "utf8"));
  const row = ledger.sources.find((item: { sourceKey: string }) => item.sourceKey === "gl-faq");
  assert.equal(row.url, "https://www.generationlab.com/FAQs");
  const source = { sourceId, kind: "web_page" as const, canonicalUri: row.url as string, logicalIdentity: "diagnostics:gl-faq" };
  const catalog = new VerificationServiceCatalog({ captureGrants: [], extractionProfileArtifacts: [], acquisitionGrants: [{ tenantId, sourceKey: "gl-faq", source }] });
  const acquirer = new TrustedVerificationSourceAcquirer(new VerificationSourceAcquisitionCatalog([{ sourceKey: "gl-faq", sourceUri: source.canonicalUri, redirectUris: ["https://www.generationlab.com/FAQs/", "https://www.generationlab.com/faqs", "https://www.generationlab.com/faqs/"], acceptedMediaTypes: ["text/html"], maximumBytes: 2_000_000, timeoutMs: 30_000 }]), { resolve: async hostname => (await lookup(hostname, { all: true, verbatim: true })).map(item => item.address) }, now);
  const admission = new VerificationAdmissionService(repository, new SandboxedVerificationParser(imageDigest), { parserVersion: "verification-native-parser.v1", imageDigest, limits: VERIFICATION_PARSER_LIMITS }, config);
  await database.transaction(tenantId, async client => {
    await client.query("insert into orchestration.mission(id,tenant_id,slug,goal) values($1,$2,$3,'Live source acquisition native proof')", [missionId, tenantId, `source-acquisition-${proofId}`]);
    await client.query("insert into orchestration.work_item(id,tenant_id,mission_id,kind) values($1,$2,$3,'verify_extraction')", [workItemId, tenantId, missionId]);
    await client.query("insert into orchestration.attempt(id,tenant_id,work_item_id,attempt_no,agent_deployment_id) values($1,$2,$3,1,'source-acquisition-proof')", [attemptId, tenantId, workItemId]);
  });
  const operations = new PostgresKnowledgeOperationService(database, { admittedOperationKinds: ["verification_capture"] });
  const application = new VerificationOperationApplicationService(operations, "http://localhost", catalog);
  const context = { tenantId, missionId, workItemId, attemptId, operationId, correlationId: proofId, actor: { kind: "service" as const, id: attemptId, serviceIdentity: "knowledge_worker" as const }, capabilityVersion: "verification-service.v1", idempotencyKey: `source-acquisition-${proofId}`, reason: "Live exact catalog source native proof", contractVersion: "v1" as const };
  const profileName="diagnostics-companies", submitToken=randomUUID();
  const ownershipGrants=JSON.stringify([{tenantId,actor:context.actor,missionId,agentDeploymentId:"source-acquisition-proof",capabilityVersion:context.capabilityVersion}]);
  const profileResolver=createVerificationBenchmarkCaptureProfileResolver(database,JSON.stringify([{profileName,tenantId,actor:context.actor,missionId,workItemId,attemptId}]),ownershipGrants);
  const submissionServer=buildServer({verificationOperationService:operations,verificationCaptureCatalog:catalog,resolveVerificationBenchmarkCaptureProfile:profileResolver,resolveIdentity:candidate=>candidate===submitToken?{actor:context.actor,grants:[{tenantId,roles:["knowledge_operator"],scopes:[]}]}:undefined});
  try{
    const response=await submissionServer.inject({method:"POST",url:`/v1/verification/benchmark-capture-profiles/${profileName}/captures`,headers:{authorization:`Bearer ${submitToken}`,"x-correlation-id":proofId,"idempotency-key":context.idempotencyKey},payload:{verificationContractVersion:"verification.v1",source:{mode:"acquire",sourceKind:"web_page",sourceUri:source.canonicalUri},requestedProjectionKinds:["html_dom"]}});
    assert.equal(response.statusCode,202,response.body);assert.equal(response.json().tenantId,tenantId);assert.equal(response.json().operation.operationId,operationId);
    checks.authenticatedServerOwnedProfileSubmission=true;
  }finally{await submissionServer.close();}
  const executor = createVerificationOperationExecutor({ operations: database, repository, admission, catalog, config, sourceAcquirer: { acquire: input => { acquisitionCalls++; return acquirer.acquire(input); } } });
  const registry = new CanonicalActivityRegistry(verificationActivityHandlers(executor));
  const worker = new CanonicalDurableKnowledgeWorker(`source-acquisition-${proofId}`, tenantId, database, async claim => { const operation = await database.getOperationRecord(tenantId, claim.operationId); assert.ok(operation); return registry.execute(operation, claim); }, 60_000, registry.operationKinds());
  const completed = await worker.runOperationOnce(operationId);
  assert.equal(completed?.operation?.status, "succeeded", JSON.stringify(completed?.receipt));
  checks.nativeWorkerCaptureSucceeded = true;
  assert.equal(acquisitionCalls, 1);
  assert.equal(await worker.runOperationOnce(operationId), undefined);
  assert.equal(acquisitionCalls, 1); checks.terminalDoesNotRefetch = true;
  const captureReads = createVerificationCaptureReads(database, {
    VERIFICATION_CAPTURE_READS_ENABLED: "1", SUPABASE_URL: projectUrl,
    SUPABASE_SECRET_KEY: serviceRoleKey, VERIFICATION_PARSER_IMAGE_DIGEST: imageDigest,
    VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON: JSON.stringify([{ tenantId, actor: context.actor, missionId, agentDeploymentId: "source-acquisition-proof", capabilityVersion: context.capabilityVersion }]),
  });
  assert.ok(captureReads);
  const token = randomUUID();
  const server = buildServer({ verificationCaptureReads: captureReads, resolveIdentity: candidate => candidate === token ? { actor: context.actor, grants: [{ tenantId, roles: ["knowledge_reader"], scopes: [] }] } : undefined });
  let compactCapture;
  try {
    const headers = { authorization: `Bearer ${token}`, "x-tenant-id": tenantId, "x-correlation-id": proofId };
    const response = await server.inject({ method: "GET", url: `/v1/verification/captures/${operationId}`, headers });
    assert.equal(response.statusCode, 200, response.body);
    compactCapture = response.json();
    assert.equal(compactCapture.operationId, operationId);
    assert.equal(compactCapture.captureMode, "acquire");
    assert.equal(compactCapture.source.sourceId, sourceId);
    assert.equal(JSON.stringify(compactCapture).includes("objectKey"), false);
    assert.equal((await server.inject({ url: `/v1/verification/captures/${randomUUID()}`, headers })).statusCode, 404);
    assert.equal((await server.inject({ url: `/v1/verification/captures/${operationId}` })).statusCode, 401);
    assert.equal(acquisitionCalls, 1);
    checks.authenticatedCompactCaptureRead = true;
    checks.unknownOperationAndUnauthenticatedReadDenied = true;
    checks.captureReadDoesNotRefetch = true;
  } finally { await server.close(); }
  const rows = await database.transaction(tenantId, async client => (await client.query("select id from orchestration.artifact where tenant_id=$1 order by id", [tenantId])).rows);
  const artifacts = [];
  for (const row of rows) {
    const resolver = repository.createTrustedArtifactResolver();
    await resolver.authorizeArtifact({ tenantId, artifactId: row.id, purpose: "verification_admission" });
    const item = await resolver.hydrateRegisteredArtifact({ tenantId, artifactId: row.id });
    assert.equal(sha256Digest(item.bytes), item.registration.digest); assert.equal(item.bytes.byteLength, item.registration.byteLength); artifacts.push(item.registration);
  }
  const ids = new Set(artifacts.map(item => item.artifactId));
  assert.ok(artifacts.length >= 6 && artifacts.every(item => item.parentArtifactIds.every(id => ids.has(id)))); checks.completeRegisteredByteClosure = true;
  const sourceSnapshot = await Promise.all(["packages/application/src/verification-service.ts", "packages/application/src/verification-source-acquisition.ts", "apps/worker/src/verification-activities.ts", "scripts/prove-verification-source-acquisition-native.ts"].map(async path => ({ path, digest: sha256Digest(await readFile(path)) })));
  await writeFile(outputPath, JSON.stringify({ proofId, passed: true, tenantId, operationId, acquisitionCalls, sourceUri: source.canonicalUri, checks, compactCapture, artifacts, terminal: completed?.receipt.body, sourceSnapshot, scope: "One live public HTML source through actual application/durable worker/PostgreSQL/Storage/sandboxed parser and authenticated Fastify capture read; no proposal-version or CLI completion claim" }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ outputPath, passed: true }));
} catch (error) {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  await writeFile(outputPath, JSON.stringify({ proofId, passed: false, tenantId, operationId, acquisitionCalls, checks, error: code }, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ outputPath, passed: false })); process.exitCode = 1;
} finally { await database.close(); }
