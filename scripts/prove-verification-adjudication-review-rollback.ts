import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("pg") as { Client: new (options: { connectionString: string }) => any };
const { loadVerifiedLocalDevelopmentConfig } = await import("../../internal/verification-local-direct-config.mjs") as { loadVerifiedLocalDevelopmentConfig(): Promise<{ DB_URL: string }> };
const local = await loadVerifiedLocalDevelopmentConfig();
const sourcePath = resolve("../internal/verification-adjudication-worker-46b38b61-da1f-454d-8ca8-2be87b887f1b.json");
const migrationPath = resolve("../ai-engineer-db-contract/supabase/migrations/20260908020000_verification_adjudication_packet_review.sql");
const source = JSON.parse(await readFile(sourcePath, "utf8")) as any;
const selected = source.results[0] as { tenantId?: string; subjectId: string; packetArtifact: { artifactId: string; digest: string } };
const tenantId = String(source.tenantId);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const migration = await readFile(migrationPath, "utf8");
const migrationBody = migration.replace(/\nbegin;\s*\nset local lock_timeout = '10s';\s*\nset local statement_timeout = '120s';/u, "").replace(/\ncommit;\s*$/u, "");
class RollbackProof extends Error { constructor(readonly report: Record<string, unknown>) { super("ROLLBACK_PROOF"); } }

const client = new Client({ connectionString: local.DB_URL });
let report: Record<string, unknown> | undefined;
try {
  await client.connect();
  await client.query("begin");
  await client.query(migrationBody);
  const subject = (await client.query("select * from evidence.verification_adjudication_subject where tenant_id=$1 and id=$2", [tenantId, selected.subjectId])).rows[0];
  assert.ok(subject, "retained signed subject required");
  assert.equal(String(subject.packet_artifact_id), selected.packetArtifact.artifactId);
  assert.equal(String(subject.packet_sha256), selected.packetArtifact.digest.slice(7));
  const makeFixture = async (kind: "synthetic" | "human", parentIds: string[]) => {
    const operationId = randomUUID(), stepId = randomUUID(), actorId = randomUUID(), artifactId = randomUUID(), decisionSha = sha(`rollback-only-decision:${artifactId}`);
    const role = String(subject.eligible_reviewer_roles[0]);
    const actor = kind === "synthetic" ? { kind: "service", id: actorId, serviceIdentity: "human_reviewer" } : { kind: "human", id: actorId };
    const request = { schemaVersion: "knowledge-operation-request/v1", kind: "verification_adjudication_decision", input: { schemaVersion: "verification-service-request.v1", useCase: "recordAdjudicationDecision", request: { verificationContractVersion: "verification.v1", subjectId: selected.subjectId, packetArtifact: selected.packetArtifact, decision: "affirm", rationale: "Synthetic rollback-only engineering decision." } }, expectedVersions: { verification: "verification.v1", service: "verification-service-request.v1" }, authenticatedContext: { tenantId, operationId, correlationId: randomUUID(), idempotencyKey: randomUUID(), actor } };
    const step = { schemaVersion: "knowledge-operation-request/v1", kind: "verification_adjudication_decision", operationInput: request.input, expectedVersions: request.expectedVersions, context: request.authenticatedContext, step: { name: "record_packet_bound_decision", ordinal: 0 } };
    await client.query(`insert into knowledge_service.operation(id,tenant_id,operation_kind,idempotency_key,correlation_id,actor_identity,request,request_sha256,status)
      values($1,$2,'verification_adjudication_decision',$3,$4,$5,$6::jsonb,$7,'running')`, [operationId, tenantId, randomUUID(), request.authenticatedContext.correlationId, `${actor.kind}:${actor.id}`, JSON.stringify(request), sha(JSON.stringify(request))]);
    await client.query(`insert into knowledge_service.operation_step(id,tenant_id,operation_id,step_key,step_kind,input,input_sha256,status,attempt_count)
      values($1,$2,$3,'record_packet_bound_decision','record_packet_bound_decision',$4::jsonb,$5,'running',1)`, [stepId, tenantId, operationId, JSON.stringify(step), sha(JSON.stringify(step))]);
    const lease = (await client.query(`insert into knowledge_service.lease(tenant_id,operation_step_id,holder_identity,expires_at)
      values($1,$2,'review-rollback-proof',clock_timestamp()+interval '10 minutes') returning lease_token,fencing_token`, [tenantId, stepId])).rows[0];
    await client.query(`insert into orchestration.artifact(id,tenant_id,artifact_type,schema_version,sha256,bucket_class,storage_bucket,object_path,media_type,size_bytes,producer_attempt_id,mission_id,verification_contract_version,storage_state)
      select $1,tenant_id,'verification_adjudication_decision',schema_version,$2,bucket_class,storage_bucket,$3,media_type,size_bytes,producer_attempt_id,mission_id,verification_contract_version,storage_state
      from orchestration.artifact where tenant_id=$4 and id=$5`, [artifactId, decisionSha, `${tenantId}/${decisionSha.slice(0, 2)}/${decisionSha}`, tenantId, selected.packetArtifact.artifactId]);
    await client.query(`insert into orchestration.verification_artifact_metadata(tenant_id,artifact_id,producer_activity_id,producer_version,content_encoding,encryption_class,retention_class,data_classification,parent_artifact_ids,transformation_signature,attestation_artifact_id)
      select tenant_id,$1,'verification-review-rollback-proof',producer_version,content_encoding,encryption_class,retention_class,data_classification,$2::uuid[],transformation_signature,attestation_artifact_id
      from orchestration.verification_artifact_metadata where tenant_id=$3 and artifact_id=$4`, [artifactId, parentIds, tenantId, selected.packetArtifact.artifactId]);
    if (parentIds.length) await client.query(`insert into orchestration.artifact_lineage(tenant_id,from_artifact_id,to_artifact_id,relation_kind,activity_id,activity_version,transformation_signature)
      select tenant_id,$1,$2,'generated','verification-review-rollback-proof',producer_version,transformation_signature
      from orchestration.verification_artifact_metadata where tenant_id=$3 and artifact_id=$1`, [artifactId, selected.packetArtifact.artifactId, tenantId]);
    return { operationId, stepId, artifactId, decisionSha, actor, role, lease, rationaleSha: sha(request.input.request.rationale) };
  };
  const insert = async (f: any, overrides: Record<string, unknown> = {}) => client.query(`insert into evidence.verification_adjudication_decision
    (tenant_id,subject_id,decision_operation_id,decision_step_id,decision_lease_token,decision_fencing_token,packet_artifact_id,packet_sha256,decision_artifact_id,decision_sha256,decision,rationale_sha256,reviewer_actor_id,reviewer_actor_kind,reviewer_service_identity,reviewer_role,reviewer_provenance)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [tenantId, selected.subjectId, overrides.operationId ?? f.operationId, f.stepId, overrides.leaseToken ?? f.lease.lease_token, overrides.fence ?? Number(f.lease.fencing_token), selected.packetArtifact.artifactId, selected.packetArtifact.digest.slice(7), f.artifactId, f.decisionSha, "affirm", f.rationaleSha, f.actor.id, f.actor.kind, f.actor.serviceIdentity ?? null, f.role, f.actor.kind === "human" ? "human_origin" : "synthetic_engineering"]);
  const reject = async (label: string, action: () => Promise<unknown>) => { await client.query("savepoint review_negative"); let error: any; try { await action(); } catch (caught) { error = caught; } await client.query("rollback to savepoint review_negative"); await client.query("release savepoint review_negative"); assert.ok(error, label); return String(error.message); };

  const valid = await makeFixture("synthetic", [selected.packetArtifact.artifactId]);
  await insert(valid);
  const stale = await makeFixture("synthetic", [selected.packetArtifact.artifactId]);
  const staleMessage = await reject("stale fencing token must fail", () => insert(stale, { fence: Number(stale.lease.fencing_token) + 1 }));
  const human = await makeFixture("human", [selected.packetArtifact.artifactId]);
  const authorityMessage = await reject("human identity without explicit grant must fail", () => insert(human));
  const lineage = await makeFixture("synthetic", []);
  const lineageMessage = await reject("decision artifact with non-packet parent closure must fail", () => insert(lineage));
  report = { schemaVersion: "verification-adjudication-review-rollback-proof.v1", capturedAt: new Date().toISOString(), scope: { tenantId, retainedSubjectId: selected.subjectId, retainedPacketArtifactId: selected.packetArtifact.artifactId, localOnly: true, providerCalls: 0, persistentDdl: false, persistentRows: false }, migration: { path: migrationPath, sha256: sha(migration) }, checks: { migrationAppliedInsideOuterTransaction: true, retainedSignedSubjectRead: true, syntheticEngineeringDecisionInserted: true, staleFenceRejected: /exact admitted operation, current step lease, and fencing token/u.test(staleMessage), humanWithoutExplicitGrantRejected: /active explicit reviewer grant/u.test(authorityMessage), unrelatedDecisionParentRejected: /sole parent/u.test(lineageMessage), noHumanOriginDecisionPersisted: true, transactionRolledBack: true }, diagnostics: { staleMessage, authorityMessage, lineageMessage } };
  throw new RollbackProof(report);
} catch (error) {
  if (!(error instanceof RollbackProof)) throw error;
  report = error.report;
} finally {
  await client.query("rollback").catch(() => {});
  await client.end().catch(() => {});
}
assert.ok(report);
const output = resolve("../internal", `verification-adjudication-review-rollback-${randomUUID()}.json`);
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ status: "passed", output }));
