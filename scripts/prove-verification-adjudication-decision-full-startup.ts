import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createApiRuntime } from "../apps/api/src/index.js";
import { startWorker } from "../apps/worker/src/index.js";
import { PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import { deterministicUuid } from "@aiengineer/knowledge-runtime";

type SourceProof = { namespace: string; tenantId: string; publicKeyPem: string; projection: { captureId: string; projectionArtifact: { artifactId: string }; transformationArtifact: { artifactId: string } }; results: { claimsRecovery: { operationId: string; manifestArtifact: { artifactId: string; digest: string } }; reportRecovery: { operationId: string; manifestArtifact: { artifactId: string; digest: string } } } };
type PacketProof = { results: readonly { kind: "claims" | "report"; operationId: string; subjectId: string; packetArtifact: { artifactId: string; digest: string } }[] };
type FrozenRegistry = { records: readonly { captureId: string; projections: readonly { imageDigest: string }[] }[] };

const source = JSON.parse(await readFile(resolve("../internal/verification-claims-report-worker-22c6b3e4-b5d6-4d34-923b-4846e37fdfaa.json"), "utf8")) as SourceProof;
const packetProof = JSON.parse(await readFile(resolve("../internal/verification-adjudication-worker-46b38b61-da1f-454d-8ca8-2be87b887f1b.json"), "utf8")) as PacketProof;
const frozen = JSON.parse(await readFile(resolve("../internal/verification-frozen-source-registry-7a74a7a8-0dc4-4591-8bb1-5781ebddef42.json"), "utf8")) as FrozenRegistry;
// @ts-expect-error This reviewed helper is intentionally outside the package graph.
const { loadVerifiedLocalDevelopmentConfig } = await import("../../internal/verification-local-direct-config.mjs") as { loadVerifiedLocalDevelopmentConfig(): Promise<{ DB_URL: string; API_URL: string; SECRET_KEY: string }> };
const local = await loadVerifiedLocalDevelopmentConfig();
for (const [value, port] of [[local.DB_URL, "54322"], [local.API_URL, "54321"]] as const) {
  const url = new URL(value);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.port === port, "LOCAL_ONLY_PROOF_REQUIRED");
}

const tenantId = source.tenantId;
const selected = packetProof.results.find(result => result.kind === "claims");
assert.ok(selected, "RETAINED_SIGNED_SUBJECT_REQUIRED");
const projection = frozen.records.find(record => record.captureId === source.projection.captureId)?.projections[0];
assert.ok(projection, "RETAINED_PROJECTION_REQUIRED");
const database = new PostgresCanonicalRepository({ connectionString: local.DB_URL, localOnly: true });
let api: Awaited<ReturnType<typeof createApiRuntime>> | undefined;
let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
let operationId: string | undefined;
let operationContext: Record<string, unknown> | undefined;
try {
  const parent = await database.getOperationRecord(tenantId, selected.operationId);
  assert.ok(parent, "RETAINED_SUBJECT_OPERATION_REQUIRED");
  const parentContext = (parent.request as { authenticatedContext?: Record<string, unknown> }).authenticatedContext;
  assert.ok(parentContext, "RETAINED_SUBJECT_CONTEXT_REQUIRED");
  const ownership = await database.transaction(tenantId, async client => (await client.query<{ agent_deployment_id: string }>(
    "select a.agent_deployment_id from orchestration.attempt a where a.tenant_id=$1 and a.id=$2",
    [tenantId, parentContext.attemptId],
  )).rows[0]);
  assert.ok(ownership, "RETAINED_SUBJECT_OWNERSHIP_REQUIRED");
  const subject = await database.transaction(tenantId, async client => (await client.query<{ eligible_reviewer_roles: string[]; quorum_required: number }>(
    "select eligible_reviewer_roles, quorum_required from evidence.verification_adjudication_subject where tenant_id=$1 and id=$2",
    [tenantId, selected.subjectId],
  )).rows[0]);
  assert.ok(subject && Array.isArray(subject.eligible_reviewer_roles) && subject.eligible_reviewer_roles.length > 0, "RETAINED_REVIEW_REQUIREMENTS_REQUIRED");
  const activeBefore = await database.transaction(tenantId, async client => (await client.query<{ count: string }>(
    "select count(*)::text as count from knowledge_service.operation where tenant_id=$1 and status in ('queued','running')",
    [tenantId],
  )).rows[0]);

  const actor = { kind: "service" as const, id: randomUUID(), serviceIdentity: "human_reviewer" as const };
  const token = `local-decision-proof-${randomUUID()}`;
  const claims = await database.listReceipts(tenantId, source.results.claimsRecovery.operationId);
  const reports = await database.listReceipts(tenantId, source.results.reportRecovery.operationId);
  assert.equal(claims.length, 1); assert.equal(reports.length, 1);
  const result = (receipt: (typeof claims)[number]) => {
    const body = receipt.body as { output: { verified: { assertionsArtifact: { artifactId: string; digest: string } } } };
    const artifact = body.output.verified.assertionsArtifact;
    return { artifactId: artifact.artifactId, digest: artifact.digest };
  };
  const projectionGrants = [
    { tenantId, assertions: result(claims[0]!), admissions: [{ captureId: source.projection.captureId, projectionArtifactId: source.projection.projectionArtifact.artifactId, transformationArtifactId: source.projection.transformationArtifact.artifactId }] },
    { tenantId, assertions: result(reports[0]!), admissions: [{ captureId: source.projection.captureId, projectionArtifactId: source.projection.projectionArtifact.artifactId, transformationArtifactId: source.projection.transformationArtifact.artifactId }] },
  ];
  const auditGrants = [
    { tenantId, auditArtifact: { artifactId: source.results.claimsRecovery.manifestArtifact.artifactId, digest: source.results.claimsRecovery.manifestArtifact.digest }, runKind: "claims" },
    { tenantId, auditArtifact: { artifactId: source.results.reportRecovery.manifestArtifact.artifactId, digest: source.results.reportRecovery.manifestArtifact.digest }, runKind: "report" },
  ];
  const ownershipGrant = { tenantId, actor, missionId: parentContext.missionId, agentDeploymentId: ownership.agent_deployment_id, capabilityVersion: parentContext.capabilityVersion };
  const environment = {
    NODE_ENV: "test", CANONICAL_LOCAL_ONLY: "1", POSTGRES_URL: local.DB_URL, SUPABASE_URL: local.API_URL, SUPABASE_SECRET_KEY: local.SECRET_KEY,
    SUPABASE_STORAGE_BUCKET: "source-captures", VERIFICATION_STORAGE_BUCKET: "ai-engineer-cloud-bucket", KNOWLEDGE_PERSISTENCE_MODE: "postgres", WORKER_TENANT_ID: tenantId, WORKER_ID: `decision-full-startup-${actor.id}`, WORKER_POLL_MS: "25",
    KNOWLEDGE_API_IDENTITIES: JSON.stringify([{ token, actor, grants: [{ tenantId, roles: ["knowledge_operator"], scopes: [] }] }]),
    VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON: JSON.stringify([ownershipGrant]),
    VERIFICATION_ADJUDICATION_DECISIONS_ENABLED: "1", VERIFICATION_ADJUDICATION_SYNTHETIC_REVIEWER_GRANTS_JSON: JSON.stringify([{ tenantId, actorId: actor.id, role: subject.eligible_reviewer_roles[0] }]),
    VERIFICATION_ADJUDICATION_GRANTS_JSON: JSON.stringify(auditGrants), VERIFICATION_ADJUDICATION_REVIEW_REQUIREMENTS_JSON: JSON.stringify({ eligibleReviewerRoles: subject.eligible_reviewer_roles, quorumRequired: Number(subject.quorum_required) }),
    VERIFICATION_ADJUDICATION_PUBLIC_KEYS_JSON: JSON.stringify([{ keyId: `claims-report-proof-${source.namespace}`, publicKeyPem: source.publicKeyPem }]),
    VERIFICATION_CLAIMS_PROJECTION_GRANTS_JSON: JSON.stringify(projectionGrants), VERIFICATION_SEAL_POLICY_GRANTS_JSON: JSON.stringify([{ tenantId, policyVersion: "decision-startup-unused.v1", policyArtifact: { artifactId: randomUUID(), digest: `sha256:${"0".repeat(64)}` } }]),
    VERIFICATION_PARSER_IMAGE_DIGEST: projection.imageDigest, VERIFICATION_CODE_GIT_SHA: "local-decision-startup-proof", VERIFICATION_CODE_DIRTY: "1", VERIFICATION_RUNTIME_PLATFORM: "local", VERIFICATION_RUNTIME_DEPLOYMENT_ID: `decision-startup-${actor.id}`,
  } as const;

  api = await createApiRuntime(environment);
  api.server.addHook("onError", async (_request, _reply, error) => { process.stderr.write(`decision-startup-api-error:${error instanceof Error ? error.stack ?? error.message : "unknown"}\n`); });
  const baseUrl = await api.server.listen({ host: "127.0.0.1", port: 0 });
  const correlationId = randomUUID(), idempotencyKey = `decision-startup-${randomUUID()}`;
  const headers = { authorization: `Bearer ${token}`, "x-tenant-id": tenantId, "x-correlation-id": correlationId, "idempotency-key": idempotencyKey,
    "x-verification-attempt-id": String(parentContext.attemptId), "x-verification-work-item-id": String(parentContext.workItemId), "x-verification-mission-id": String(parentContext.missionId), "content-type": "application/json" };
  const request = { verificationContractVersion: "verification.v1", subjectId: selected.subjectId, packetArtifact: selected.packetArtifact, decision: "affirm", rationale: "Synthetic local startup proof only; not human evidence, gold scoring, or admission authority." };
  operationId = deterministicUuid("verification-http-operation", `${tenantId}:recordAdjudicationDecision:${idempotencyKey}`);
  const post = await fetch(`${baseUrl}/v1/verification/adjudications:record-decision`, { method: "POST", headers, body: JSON.stringify(request) });
  if (post.status !== 202) throw new Error(`POST_STATUS_${post.status}:${await post.text()}`);
  const accepted = await post.json() as { operationId: string };
  assert.equal(accepted.operationId, operationId, "POST_OPERATION_ID_BINDING");
  const record = await database.getOperationRecord(tenantId, operationId);
  operationContext = (record?.request as { authenticatedContext?: Record<string, unknown> }).authenticatedContext;
  assert.deepEqual(operationContext?.actor, actor, "POST_ACTOR_BINDING");
  // Scope production startup after POST to this one returned operation. Both
  // startup reconciliation and every scheduled claim are exact-operation only.
  worker = await startWorker({ ...environment, WORKER_OPERATION_ID: operationId });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const state = await database.getOperation(tenantId, operationId);
    if (state?.status === "succeeded") break;
    if (["failed", "cancelled", "superseded"].includes(state?.status ?? "")) throw new Error(`DECISION_OPERATION_${state?.status}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal((await database.getOperation(tenantId, operationId))?.status, "succeeded", "WORKER_TERMINAL_TIMEOUT");
  const get = await fetch(`${baseUrl}/v1/verification/adjudication-decisions/${operationId}`, { headers: { authorization: `Bearer ${token}`, "x-tenant-id": tenantId, "x-correlation-id": randomUUID() } });
  if (get.status !== 200) throw new Error(`TERMINAL_READ_STATUS_${get.status}:${await get.text()}`);
  const terminal = await get.json() as { output: { reviewerProvenance: string; admissionChanged: boolean; humanGoldScoringEligible: boolean }; operationId: string };
  assert.equal(terminal.operationId, operationId); assert.equal(terminal.output.reviewerProvenance, "synthetic_engineering");
  assert.equal(terminal.output.admissionChanged, false); assert.equal(terminal.output.humanGoldScoringEligible, false);
  const output = resolve("../internal", `verification-decision-full-startup-${operationId}.json`);
  await writeFile(output, JSON.stringify({ schemaVersion: "verification-decision-full-startup-proof.v1", tenantId, operationId, sourceSubjectOperationId: selected.operationId, subjectId: selected.subjectId, postStatus: post.status, terminalReadStatus: get.status, worker: "startWorker production composition with WORKER_OPERATION_ID", api: "createApiRuntime production composition", unrelatedQueuedOrRunningBeforeProof: Number(activeBefore?.count), exactOperationScoped: true, providerCalls: 0, provenance: terminal.output.reviewerProvenance, admissionChanged: terminal.output.admissionChanged, humanGoldScoringEligible: terminal.output.humanGoldScoringEligible, limitations: ["Local Supabase/Postgres only", "Synthetic reviewer only; no human grant or human evidence", "The worker was explicitly operation-scoped; no claim or reconciliation of unrelated tenant work"] }, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ output, operationId, passed: true }));
} catch (error) {
  if (operationId) {
    const record = await database.getOperationRecord(tenantId, operationId).catch(() => undefined);
    const context = (record?.request as { authenticatedContext?: Record<string, unknown> } | undefined)?.authenticatedContext ?? operationContext;
    if (context?.actor) await database.cancelOperation(tenantId, operationId, { actorIdentity: `${(context.actor as { kind: string; id: string }).kind}:${(context.actor as { kind: string; id: string }).id}`, correlationId: String(context.correlationId) }).catch(() => undefined);
  }
  throw error;
} finally {
  await api?.server.close().catch(() => undefined);
  await api?.database?.close().catch(() => undefined);
  await worker?.stop("decision-full-startup-proof").catch(() => undefined);
  await database.close();
}
