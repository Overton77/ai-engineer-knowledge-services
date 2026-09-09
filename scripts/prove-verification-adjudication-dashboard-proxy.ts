import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { createApiRuntime } from "../apps/api/src/index.js";
import { startWorker } from "../apps/worker/src/index.js";
import { PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";

type SourceProof = { namespace: string; tenantId: string; publicKeyPem: string; projection: { captureId: string; projectionArtifact: { artifactId: string }; transformationArtifact: { artifactId: string } }; results: { claimsRecovery: { operationId: string; manifestArtifact: { artifactId: string; digest: string } }; reportRecovery: { operationId: string; manifestArtifact: { artifactId: string; digest: string } } } };
type PacketProof = { results: readonly { kind: "claims" | "report"; operationId: string; subjectId: string; packetArtifact: { artifactId: string; digest: string } }[] };
type FrozenRegistry = { records: readonly { captureId: string; projections: readonly { imageDigest: string }[] }[] };

const source = JSON.parse(await readFile(resolve("../internal/verification-claims-report-worker-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json"), "utf8")) as SourceProof;
const packets = JSON.parse(await readFile(resolve("../internal/verification-adjudication-worker-46b38b61-da1f-454d-8ca8-2be87b887f1b.json"), "utf8")) as PacketProof;
const frozen = JSON.parse(await readFile(resolve("../internal/verification-frozen-source-registry-7a74a7a8-0dc4-4591-8bb1-5781ebddef42.json"), "utf8")) as FrozenRegistry;
// @ts-expect-error This reviewed helper is intentionally outside the package graph.
const { loadVerifiedLocalDevelopmentConfig } = await import("../../internal/verification-local-direct-config.mjs") as { loadVerifiedLocalDevelopmentConfig(): Promise<{ DB_URL: string; API_URL: string; SECRET_KEY: string }> };
const local = await loadVerifiedLocalDevelopmentConfig();
for (const [value, port] of [[local.DB_URL, "54322"], [local.API_URL, "54321"]] as const) { const url = new URL(value); assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.port === port, "LOCAL_ONLY_PROOF_REQUIRED"); }

const tenantId = source.tenantId;
const selected = packets.results.find(result => result.kind === "claims");
assert.ok(selected, "RETAINED_SIGNED_SUBJECT_REQUIRED");
const projection = frozen.records.find(record => record.captureId === source.projection.captureId)?.projections[0];
assert.ok(projection, "RETAINED_PROJECTION_REQUIRED");
const database = new PostgresCanonicalRepository({ connectionString: local.DB_URL, localOnly: true });
let api: Awaited<ReturnType<typeof createApiRuntime>> | undefined;
let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
let dashboard: ChildProcess | undefined;
let operationId: string | undefined;
let operationContext: Record<string, unknown> | undefined;
let dashboardPort: number | undefined;
try {
  const parent = await database.getOperationRecord(tenantId, selected.operationId);
  assert.ok(parent, "RETAINED_SUBJECT_OPERATION_REQUIRED");
  const parentContext = (parent.request as { authenticatedContext?: Record<string, unknown> }).authenticatedContext;
  assert.ok(parentContext, "RETAINED_SUBJECT_CONTEXT_REQUIRED");
  const ownership = await database.transaction(tenantId, async client => (await client.query<{ agent_deployment_id: string }>("select a.agent_deployment_id from orchestration.attempt a where a.tenant_id=$1 and a.id=$2", [tenantId, parentContext.attemptId])).rows[0]);
  assert.ok(ownership, "RETAINED_SUBJECT_OWNERSHIP_REQUIRED");
  const subject = await database.transaction(tenantId, async client => (await client.query<{ eligible_reviewer_roles: string[]; quorum_required: number }>("select eligible_reviewer_roles, quorum_required from evidence.verification_adjudication_subject where tenant_id=$1 and id=$2", [tenantId, selected.subjectId])).rows[0]);
  assert.ok(subject && subject.eligible_reviewer_roles.length > 0, "RETAINED_REVIEW_REQUIREMENTS_REQUIRED");

  const actor = { kind: "service" as const, id: randomUUID(), serviceIdentity: "human_reviewer" as const };
  const reviewerSubject = `synthetic-reviewer-${actor.id}`;
  const reviewerToken = `local-dashboard-decision-${randomUUID()}-${randomUUID()}`;
  const operatorToken = `${randomUUID()}${randomUUID()}`;
  const sessionSecret = `${randomUUID()}${randomUUID()}`;
  const claims = await database.listReceipts(tenantId, source.results.claimsRecovery.operationId);
  const reports = await database.listReceipts(tenantId, source.results.reportRecovery.operationId);
  assert.equal(claims.length, 1); assert.equal(reports.length, 1);
  const assertions = (receipt: (typeof claims)[number]) => { const body = receipt.body as { output: { verified: { assertionsArtifact: { artifactId: string; digest: string } } } }; const artifact = body.output.verified.assertionsArtifact; return { artifactId: artifact.artifactId, digest: artifact.digest }; };
  const projectionGrants = [claims[0], reports[0]].map(receipt => ({ tenantId, assertions: assertions(receipt!), admissions: [{ captureId: source.projection.captureId, projectionArtifactId: source.projection.projectionArtifact.artifactId, transformationArtifactId: source.projection.transformationArtifact.artifactId }] }));
  const auditGrants = [
    { tenantId, auditArtifact: { artifactId: source.results.claimsRecovery.manifestArtifact.artifactId, digest: source.results.claimsRecovery.manifestArtifact.digest }, runKind: "claims" },
    { tenantId, auditArtifact: { artifactId: source.results.reportRecovery.manifestArtifact.artifactId, digest: source.results.reportRecovery.manifestArtifact.digest }, runKind: "report" },
  ];
  const ownershipGrant = { tenantId, actor, missionId: parentContext.missionId, agentDeploymentId: ownership.agent_deployment_id, capabilityVersion: parentContext.capabilityVersion };
  const environment = {
    NODE_ENV: "test", CANONICAL_LOCAL_ONLY: "1", POSTGRES_URL: local.DB_URL, SUPABASE_URL: local.API_URL, SUPABASE_SECRET_KEY: local.SECRET_KEY, SUPABASE_STORAGE_BUCKET: "source-captures", VERIFICATION_STORAGE_BUCKET: "ai-engineer-cloud-bucket", KNOWLEDGE_PERSISTENCE_MODE: "postgres", WORKER_TENANT_ID: tenantId, WORKER_ID: `dashboard-decision-${actor.id}`, WORKER_POLL_MS: "25",
    KNOWLEDGE_API_IDENTITIES: JSON.stringify([{ token: reviewerToken, actor, grants: [{ tenantId, roles: ["knowledge_operator"], scopes: [] }] }]), VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON: JSON.stringify([ownershipGrant]),
    VERIFICATION_ADJUDICATION_DECISIONS_ENABLED: "1", VERIFICATION_ADJUDICATION_SYNTHETIC_REVIEWER_GRANTS_JSON: JSON.stringify([{ tenantId, actorId: actor.id, role: subject.eligible_reviewer_roles[0] }]), VERIFICATION_ADJUDICATION_GRANTS_JSON: JSON.stringify(auditGrants), VERIFICATION_ADJUDICATION_REVIEW_REQUIREMENTS_JSON: JSON.stringify({ eligibleReviewerRoles: subject.eligible_reviewer_roles, quorumRequired: Number(subject.quorum_required) }), VERIFICATION_ADJUDICATION_PUBLIC_KEYS_JSON: JSON.stringify([{ keyId: `claims-report-proof-${source.namespace}`, publicKeyPem: source.publicKeyPem }]), VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON: JSON.stringify(projectionGrants), VERIFICATION_SEAL_POLICY_GRANTS_JSON: JSON.stringify([{ tenantId, policyVersion: "dashboard-decision-unused.v1", policyArtifact: { artifactId: randomUUID(), digest: `sha256:${"0".repeat(64)}` } }]), VERIFICATION_PARSER_IMAGE_DIGEST: projection.imageDigest, VERIFICATION_CODE_GIT_SHA: "local-dashboard-decision-proof", VERIFICATION_CODE_DIRTY: "1", VERIFICATION_RUNTIME_PLATFORM: "local", VERIFICATION_RUNTIME_DEPLOYMENT_ID: `dashboard-decision-${actor.id}`,
  } as const;

  api = await createApiRuntime(environment);
  const knowledgeUrl = await api.server.listen({ host: "127.0.0.1", port: 0 });
  dashboardPort = await reservePort();
  // Next dev canonicalizes request URLs to localhost; use the same loopback
  // origin for the signed-session route and the CSRF-bound proxy calls.
  const dashboardUrl = `http://localhost:${dashboardPort}`;
  dashboard = spawn(process.execPath, ["./node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(dashboardPort)], { cwd: resolve("../ai-engineer-mission-control/apps/dashboard"), env: dashboardEnvironment({ sessionSecret, operatorToken, reviewerSubject, tenantId, missionId: String(parentContext.missionId), workItemId: String(parentContext.workItemId), attemptId: String(parentContext.attemptId), knowledgeUrl, reviewerToken }), stdio: "ignore", windowsHide: true });
  let dashboardSpawnFailed = false; dashboard.once("error", () => { dashboardSpawnFailed = true; });
  await ready(`http://127.0.0.1:${dashboardPort}`, 60_000, () => dashboardSpawnFailed || dashboard?.exitCode !== null || dashboard?.signalCode !== null);

  const login = await fetch(`${dashboardUrl}/api/dashboard/session`, { method: "POST", headers: { origin: dashboardUrl, "content-type": "application/json" }, body: JSON.stringify({ token: operatorToken }) });
  if (login.status !== 200) throw new Error(`DASHBOARD_SIGNED_LOGIN_${login.status}:${await login.text()}`);
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie?.startsWith("mc_dashboard_session="), "DASHBOARD_SESSION_COOKIE_REQUIRED");
  const csrf = await fetch(`${dashboardUrl}/api/dashboard/csrf`, { headers: { cookie } });
  assert.equal(csrf.status, 200, "DASHBOARD_CSRF_READ_REQUIRED");
  const csrfToken = (await csrf.json() as { csrfToken?: string; reviewerDecisionReady?: boolean }); assert.equal(csrfToken.reviewerDecisionReady, true, "DASHBOARD_REVIEWER_MAPPING_REQUIRED"); assert.ok(csrfToken.csrfToken, "DASHBOARD_CSRF_TOKEN_REQUIRED");
  const browserIdempotencyKey = `dashboard-proof-${randomUUID()}`;
  const request = { verificationContractVersion: "verification.v1", subjectId: selected.subjectId, packetArtifact: selected.packetArtifact, decision: "affirm", rationale: "Synthetic local dashboard proxy proof only; not human evidence, gold scoring, or admission authority." };
  const post = await fetch(`${dashboardUrl}/api/knowledge/verification/adjudications:record-decision`, { method: "POST", headers: { cookie, origin: dashboardUrl, "x-dashboard-csrf": csrfToken.csrfToken, "content-type": "application/json", "idempotency-key": browserIdempotencyKey }, body: JSON.stringify(request) });
  if (post.status !== 202) throw new Error(`DASHBOARD_PROXY_POST_${post.status}:${await post.text()}`);
  const accepted = await post.json() as { operationId: string; state: string };
  assert.equal(accepted.state, "queued", "DASHBOARD_COMPACT_ACCEPTED_DTO"); operationId = accepted.operationId;
  const record = await database.getOperationRecord(tenantId, operationId); operationContext = (record?.request as { authenticatedContext?: Record<string, unknown> }).authenticatedContext;
  assert.deepEqual(operationContext?.actor, actor, "DASHBOARD_SERVER_TOKEN_ACTOR_BINDING");
  worker = await startWorker({ ...environment, WORKER_OPERATION_ID: operationId });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) { const state = await database.getOperation(tenantId, operationId); if (state?.status === "succeeded") break; if (["failed", "cancelled", "superseded"].includes(state?.status ?? "")) throw new Error(`DECISION_OPERATION_${state?.status}`); await new Promise(done => setTimeout(done, 50)); }
  assert.equal((await database.getOperation(tenantId, operationId))?.status, "succeeded", "SCOPED_WORKER_TERMINAL_TIMEOUT");
  const terminalRead = await fetch(`${dashboardUrl}/api/knowledge/verification/adjudication-decisions/${operationId}`, { headers: { cookie } });
  if (terminalRead.status !== 200) throw new Error(`DASHBOARD_PROXY_TERMINAL_${terminalRead.status}:${await terminalRead.text()}`);
  const terminal = await terminalRead.json() as { operationId: string; output: { reviewerProvenance: string; admissionChanged: boolean; humanGoldScoringEligible: boolean } };
  assert.equal(terminal.operationId, operationId); assert.equal(terminal.output.reviewerProvenance, "synthetic_engineering"); assert.equal(terminal.output.admissionChanged, false); assert.equal(terminal.output.humanGoldScoringEligible, false);
  const output = resolve("../internal", `verification-decision-dashboard-proxy-${operationId}.json`);
  await writeFile(output, JSON.stringify({ schemaVersion: "verification-decision-dashboard-proxy-proof.v1", tenantId, operationId, sourceSubjectOperationId: selected.operationId, subjectId: selected.subjectId, dashboard: { server: "Mission Control Next dev process", signedSessionLoginStatus: login.status, csrfStatus: csrf.status, reviewerDecisionReady: csrfToken.reviewerDecisionReady, proxyPostStatus: post.status, proxyTerminalReadStatus: terminalRead.status, compactAcceptedDto: true, compactTerminalDto: true, serverOwnedReviewerMapping: { subject: reviewerSubject, missionId: String(parentContext.missionId), workItemId: String(parentContext.workItemId), attemptId: String(parentContext.attemptId) } }, knowledgeApi: "createApiRuntime production composition", worker: "startWorker production composition with WORKER_OPERATION_ID", exactOperationScoped: true, providerCalls: 0, provenance: terminal.output.reviewerProvenance, admissionChanged: terminal.output.admissionChanged, humanGoldScoringEligible: terminal.output.humanGoldScoringEligible, limitations: ["Local Supabase/Postgres only", "Synthetic reviewer service actor only; no human grant row or human evidence", "HTTP signed-session proof; browser UI coverage is maintained separately", "Scoped worker was confined to returned operation ID"] }, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ output, operationId, passed: true }));
} catch (error) {
  if (operationId) { const record = await database.getOperationRecord(tenantId, operationId).catch(() => undefined); const context = (record?.request as { authenticatedContext?: Record<string, unknown> } | undefined)?.authenticatedContext ?? operationContext; if (context?.actor) await database.cancelOperation(tenantId, operationId, { actorIdentity: `${(context.actor as { kind: string; id: string }).kind}:${(context.actor as { kind: string; id: string }).id}`, correlationId: String(context.correlationId) }).catch(() => undefined); }
  throw error;
} finally {
  await stopProcessTree(dashboard).catch(() => undefined); await api?.server.close().catch(() => undefined); await api?.database?.close().catch(() => undefined); await worker?.stop("dashboard-decision-proof").catch(() => undefined); await database.close();
}

function dashboardEnvironment(input: { sessionSecret: string; operatorToken: string; reviewerSubject: string; tenantId: string; missionId: string; workItemId: string; attemptId: string; knowledgeUrl: string; reviewerToken: string }): Record<string, string> {
  const inherited = ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "COMSPEC", "ComSpec"].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []);
  const operatorDigest = `sha256:${createHash("sha256").update(input.operatorToken).digest("hex")}`;
  return Object.fromEntries([...inherited, ["NODE_ENV", "development"], ["DASHBOARD_SESSION_SECRET", input.sessionSecret], ["DASHBOARD_OPERATOR_TOKEN_DIGESTS_JSON", JSON.stringify([{ tokenDigest: operatorDigest, subject: input.reviewerSubject, tenantId: input.tenantId, missionId: input.missionId, role: "operator" }])], ["DASHBOARD_HUMAN_REVIEWER_KNOWLEDGE_TOKENS_JSON", JSON.stringify([{ subject: input.reviewerSubject, tenantId: input.tenantId, missionId: input.missionId, workItemId: input.workItemId, attemptId: input.attemptId, knowledgeToken: input.reviewerToken }])], ["KNOWLEDGE_API_URL", input.knowledgeUrl], ["KNOWLEDGE_API_TOKEN", input.reviewerToken], ["MISSION_CONTROL_API_URL", "http://127.0.0.1:9/"], ["MISSION_CONTROL_API_TOKEN", "dashboard-proof-unused"]]);
}
async function reservePort(): Promise<number> { return await new Promise((done, fail) => { const server = createServer(); server.once("error", fail); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(error => error ? fail(error) : done(typeof address === "object" && address ? address.port : 0)); }); }); }
async function ready(url: string, timeoutMs: number, exited: () => boolean): Promise<void> { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { if (exited()) throw new Error("DASHBOARD_PROCESS_EXITED"); try { if ((await fetch(url, { signal: AbortSignal.timeout(2_000) })).ok) return; } catch {} await new Promise(done => setTimeout(done, 200)); } throw new Error("DASHBOARD_READY_TIMEOUT"); }
async function stopProcessTree(child: ChildProcess | undefined): Promise<void> { if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return; const exited = new Promise<void>(done => child.once("exit", () => done())); if (process.platform === "win32") { await new Promise<void>((done, fail) => { const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true }); killer.once("error", fail); killer.once("exit", code => code === 0 || child.exitCode !== null || child.signalCode !== null ? done() : fail(new Error("DASHBOARD_TREE_STOP_FAILED"))); }); } else child.kill("SIGTERM"); await Promise.race([exited, new Promise<never>((_done, fail) => setTimeout(() => fail(new Error("DASHBOARD_PROCESS_EXIT_TIMEOUT")), 10_000))]); }
