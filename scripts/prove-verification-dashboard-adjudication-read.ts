import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { VerificationClaimsOperationResultSchema, VerificationReportOperationResultSchema, type Actor, type VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { VerificationAdmissionService, VerificationAuditInspectionGrantCatalog, VerificationClaimsProjectionGrantCatalog } from "@aiengineer/knowledge-application";
import { VERIFICATION_PARSER_LIMITS } from "@aiengineer/knowledge-conversion";
import { PostgresCanonicalRepository, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { buildServer } from "../apps/api/src/server.js";
import { createVerificationAdjudicationReads } from "../apps/api/src/verification-adjudication-reads-runtime.js";

const root = resolve(import.meta.dirname, "../..");
const missionControl = resolve(root, "ai-engineer-mission-control");
const runId = randomUUID();
const output = resolve(root, "internal", `verification-dashboard-adjudication-read-${runId}.json`);
const sourceProof = JSON.parse(await readFile(resolve(root, "internal/verification-claims-report-worker-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json"), "utf8")) as any;
const adjudicationProof = JSON.parse(await readFile(resolve(root, "internal/verification-adjudication-worker-ad8630a5-5fce-4041-8218-42a581215198.json"), "utf8")) as any;
const frozen = JSON.parse(await readFile(resolve(root, "internal/verification-frozen-source-registry-7a74a7a8-0dc4-4591-8bb1-5781ebddef42.json"), "utf8")) as any;
const target = adjudicationProof.results.find((item: any) => item.surface === "http" && item.kind === "claims"); assert.ok(target);
// @ts-expect-error local proof config is deliberately outside package exports.
const { loadVerifiedLocalDevelopmentConfig } = await import("../../internal/verification-local-direct-config.mjs");
const local = await loadVerifiedLocalDevelopmentConfig();
for (const [value, port] of [[local.DB_URL, "54322"], [local.API_URL, "54321"]] as const) { const url = new URL(value); assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.port === port && !url.search && !url.hash, "LOCAL_PROOF_CONFIGURATION_REQUIRED"); }
const database = new PostgresCanonicalRepository({ connectionString: local.DB_URL, localOnly: true });
const token = `dashboard-read-${runId}`, operatorToken = `${randomUUID()}${randomUUID()}`, sessionSecret = `${randomUUID()}${randomUUID()}`;
const operatorDigest = `sha256:${createHash("sha256").update(operatorToken).digest("hex")}`;
let api: ReturnType<typeof buildServer> | undefined, next: ReturnType<typeof spawn> | undefined, browser: any;
const sourcePaths = ["scripts/prove-verification-dashboard-adjudication-read.ts", "apps/api/src/server.ts", "apps/api/src/verification-adjudication-reads-runtime.ts", "packages/persistence/src/verification-adjudication-reads.ts", "ai-engineer-mission-control/apps/dashboard/src/features/adjudications/adjudication-detail.tsx"];
const hash = async (path: string) => createHash("sha256").update(await readFile(resolve(root, path.startsWith("ai-engineer-mission-control/") ? path : `ai-engineer-knowledge-services/${path}`))).digest("hex");
const reservePort = () => new Promise<number>((resolvePort, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(error => error ? reject(error) : resolvePort(typeof address === "object" && address ? address.port : 0)); }); });
async function ready(url: string) { for (let i = 0; i < 300; i += 1) { try { if ((await fetch(url, { signal: AbortSignal.timeout(1_000) })).ok) return; } catch {} await new Promise(resolveWait => setTimeout(resolveWait, 200)); } throw new Error("DASHBOARD_READY_TIMEOUT"); }
async function stop(child: ReturnType<typeof spawn> | undefined) { if (!child?.pid || child.exitCode !== null) return; if (process.platform === "win32") await new Promise<void>((resolveStop, reject) => { const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true }); killer.once("error", reject); killer.once("close", () => resolveStop()); }); else child.kill("SIGTERM"); }

try {
  const ownership = await database.transaction(sourceProof.tenantId, async client => (await client.query<any>("select o.mission_id,o.work_item_id,o.attempt_id,o.request->'authenticatedContext' context,a.agent_deployment_id from knowledge_service.operation o join orchestration.attempt a on a.tenant_id=o.tenant_id and a.id=o.attempt_id where o.tenant_id=$1 and o.id=$2", [sourceProof.tenantId, target.operationId])).rows[0]);
  assert.ok(ownership);
  const context = ownership.context as { actor: Actor; capabilityVersion: string };
  const actor = context.actor;
  const nativeProjection = frozen.records.find((record: any) => record.captureId === sourceProof.projection.captureId)?.projections[0]; assert.ok(nativeProjection);
  const artifacts = new SupabaseArtifactStore({ projectUrl: local.API_URL, serviceRoleKey: local.SECRET_KEY, bucket: "ai-engineer-cloud-bucket", maximumBytes: 32_000_000 });
  const repository = new PostgresVerificationRepository(database, artifacts, { async authorize(input) { assert.equal(input.tenantId, sourceProof.tenantId); assert.ok(["verification_admission", "verification_replay", "policy_replay"].includes(input.purpose)); } });
  const admission = new VerificationAdmissionService(repository, { async parse(): Promise<never> { throw new Error("PARSER_FORBIDDEN_IN_DASHBOARD_READ_PROOF"); } }, { parserVersion: nativeProjection.parserVersion, imageDigest: nativeProjection.imageDigest, limits: VERIFICATION_PARSER_LIMITS }, { storageBucket: "ai-engineer-cloud-bucket", producerVersion: "verification-admission.v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", now: () => new Date().toISOString() });
  const claimReceipts = await database.listReceipts(sourceProof.tenantId, sourceProof.results.claimsRecovery.operationId), reportReceipts = await database.listReceipts(sourceProof.tenantId, sourceProof.results.reportRecovery.operationId);
  const { eventId: _claimsEvent, fencingToken: _claimsFence, ...claimsBody } = claimReceipts[0]!.body as Record<string, unknown>;
  const { eventId: _reportEvent, fencingToken: _reportFence, ...reportBody } = reportReceipts[0]!.body as Record<string, unknown>;
  const claims = VerificationClaimsOperationResultSchema.parse(claimsBody), report = VerificationReportOperationResultSchema.parse(reportBody);
  const source = sourceProof.results.claimsRecovery;
  const auditGrants = [{ tenantId: sourceProof.tenantId, auditArtifact: { artifactId: source.manifestArtifact.artifactId, digest: source.manifestArtifact.digest }, runKind: "claims" }];
  const projectionGrants = [{ tenantId: sourceProof.tenantId, assertions: { artifactId: claims.output.verified.assertionsArtifact.artifactId, digest: claims.output.verified.assertionsArtifact.digest }, admissions: [{ captureId: sourceProof.projection.captureId, projectionArtifactId: nativeProjection.projectionArtifact.artifactId, transformationArtifactId: nativeProjection.transformationArtifact.artifactId }] }];
  const ownershipGrants = [{ tenantId: sourceProof.tenantId, actor, missionId: ownership.mission_id, agentDeploymentId: ownership.agent_deployment_id, capabilityVersion: context.capabilityVersion }];
  const reads = createVerificationAdjudicationReads(database, { VERIFICATION_ADJUDICATION_PUBLIC_KEYS_JSON: JSON.stringify([{ keyId: `claims-report-proof-${sourceProof.namespace}`, publicKeyPem: sourceProof.publicKeyPem }]), VERIFICATION_ADJUDICATION_GRANTS_JSON: JSON.stringify(auditGrants), VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON: JSON.stringify(projectionGrants), VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON: JSON.stringify(ownershipGrants), VERIFICATION_PARSER_IMAGE_DIGEST: nativeProjection.imageDigest, SUPABASE_URL: local.API_URL, SUPABASE_SECRET_KEY: local.SECRET_KEY, VERIFICATION_STORAGE_BUCKET: "ai-engineer-cloud-bucket" });
  assert.ok(reads);
  api = buildServer({ publicOrigin: "http://127.0.0.1", verificationAdjudicationReadService: reads, resolveIdentity: candidate => candidate === token ? { actor, grants: [{ tenantId: sourceProof.tenantId, roles: ["knowledge_operator"], scopes: [] }] } : undefined });
  await api.listen({ host: "127.0.0.1", port: 0 }); const address = api.server.address(); assert.ok(address && typeof address !== "string"); const apiUrl = `http://127.0.0.1:${address.port}`;
  const dashboardPort = await reservePort();
  const env = Object.fromEntries(["PATH", "Path", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "COMSPEC", "ComSpec"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
  next = spawn(process.execPath, ["./node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(dashboardPort)], { cwd: resolve(missionControl, "apps/dashboard"), env: { ...env, NODE_ENV: "development", DASHBOARD_SESSION_SECRET: sessionSecret, DASHBOARD_OPERATOR_TOKEN_DIGESTS_JSON: JSON.stringify([{ tokenDigest: operatorDigest, subject: "native-dashboard-reader", tenantId: sourceProof.tenantId, missionId: ownership.mission_id, role: "operator" }]), KNOWLEDGE_API_URL: apiUrl, KNOWLEDGE_API_TOKEN: token, MISSION_CONTROL_API_URL: "http://127.0.0.1:1", MISSION_CONTROL_API_TOKEN: "unused" }, stdio: "ignore", windowsHide: true });
  await ready(`http://127.0.0.1:${dashboardPort}`);
  const playwright = createRequire(resolve(missionControl, "apps/dashboard/package.json"))("@playwright/test"); browser = await playwright.chromium.launch({ channel: "chrome", headless: true, timeout: 10_000 }); const page = await browser.newPage(); page.setDefaultTimeout(30_000);
  const base = `http://localhost:${dashboardPort}`;
  await page.goto(base); await page.locator("#operator-token").fill(operatorToken); await page.getByRole("button", { name: "Sign in" }).click(); await page.getByText("Session established").waitFor();
  await page.goto(`${base}/verification/adjudications?operationId=${target.operationId}`); await page.getByText("Pending human review").waitFor({ timeout: 60_000 });
  const rendered = await page.locator("body").innerText(); assert.ok(rendered.includes("Pending human review"), `DASHBOARD_ADJUDICATION_RENDER_FAILED:${rendered.slice(0, 300)}`);
  assert.ok(rendered.includes("Original policy outcome") && rendered.includes(target.originalPolicyOutcome) && rendered.includes("Reviewer requirements") && rendered.includes("Source manifest") && rendered.includes("Admission") && rendered.includes("Unchanged"), "DASHBOARD_ADJUDICATION_COMPACT_PROJECTION_MISSING");
  const proxy = await page.evaluate(async operationId => { const response = await fetch(`/api/knowledge/verification/adjudications/${operationId}`); return { status: response.status, body: await response.json() }; }, target.operationId);
  assert.equal(proxy.status, 200); assert.equal(proxy.body.operationId, target.operationId); assert.equal(proxy.body.output.humanDecisionRecorded, false); assert.equal(proxy.body.output.admissionChanged, false); assert.equal(JSON.stringify(proxy.body).includes("objectKey"), false);
  const screenshot = output.replace(/\.json$/u, ".png"); await page.screenshot({ path: screenshot });
  const sourceFiles = await Promise.all(sourcePaths.map(async path => ({ path, sha256: await hash(path) })));
  await writeFile(output, JSON.stringify({ schemaVersion: "verification-dashboard-adjudication-read.v1", target: { operationId: target.operationId, subjectId: target.subjectId, originalPolicyOutcome: target.originalPolicyOutcome }, checks: { operatorLogin: true, actualKsAdjudicationRead: true, dashboardProxy: true, pendingDetailRendered: true, noDecisionOrAdmissionControl: true }, providerCalls: 0, mutations: 0, screenshot, sourceFiles, limitations: ["Retained local adjudication subject only", "No launch, human decision, provider call, or remote deployment"] }, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ output, passed: true }));
} catch (error) {
  await writeFile(output.replace(/\.json$/u, ".failure.json"), JSON.stringify({ proof: "verification-dashboard-adjudication-read.v1", errorClass: error instanceof Error ? error.name : "UNKNOWN", error: error instanceof Error ? error.message.slice(0, 400) : "unknown" }, null, 2) + "\n", { flag: "wx" }).catch(() => undefined);
  throw error;
} finally { await browser?.close(); await stop(next); await api?.close(); await database.close(); }
