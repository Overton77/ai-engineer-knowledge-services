import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgresCanonicalRepository, type TenantSqlClient } from "@aiengineer/knowledge-persistence";

const postgres = process.env.POSTGRES_URL;
if (!postgres || !/^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:127\.0\.0\.1|localhost):54322\//u.test(postgres)) throw new Error("LOCAL_DB_REQUIRED");
const sourcePath = resolve("../internal/verification-benchmark-comparison-lifecycle-3bc94031-9325-4ba3-b3b1-f41b271b7d6a.json");
const source = JSON.parse(await readFile(sourcePath, "utf8")) as any;
const tenantId = String(source.tenantId), operationId = String(source.comparison.identity.operationId);

class ProofRollback extends Error { constructor(readonly report: Record<string, unknown>) { super("PROOF_ROLLBACK"); } }
const database = new PostgresCanonicalRepository({ connectionString: postgres, localOnly: true });

async function rejects(client: TenantSqlClient, sql: string, parameters: readonly unknown[], label: string, code?: string): Promise<void> {
  await client.query("savepoint comparison_terminal_case");
  let failure: unknown;
  try { await client.query(sql, parameters); } catch (error) { failure = error; }
  await client.query("rollback to savepoint comparison_terminal_case");
  await client.query("release savepoint comparison_terminal_case");
  assert.ok(failure, label);
  if (code) assert.equal((failure as { code?: string }).code, code, label);
}

let report: Record<string, unknown> | undefined;
try {
  await database.transaction(tenantId, async client => {
    const comparison = (await client.query<any>("select * from evaluation.verification_benchmark_comparison where tenant_id=$1 and operation_id=$2", [tenantId, operationId])).rows[0];
    const operation = (await client.query<any>("select * from knowledge_service.operation where tenant_id=$1 and id=$2", [tenantId, operationId])).rows[0];
    const step = (await client.query<any>("select * from knowledge_service.operation_step where tenant_id=$1 and operation_id=$2 and step_key='compare_registered_and_publish'", [tenantId, operationId])).rows[0];
    const receipts = (await client.query<any>("select * from knowledge_service.receipt where tenant_id=$1 and operation_id=$2 and outcome='succeeded'", [tenantId, operationId])).rows;
    assert.equal(comparison?.status, "sealed");
    assert.equal(operation?.status, "succeeded");
    assert.equal(step?.status, "succeeded");
    assert.equal(receipts.length, 1);
    const receipt = receipts[0]!;
    assert.equal(receipt.id, source.terminalReceipt.id);
    assert.equal(receipt.receipt_kind, "compare_registered_and_publish.succeeded");
    assert.equal(receipt.body?.output?.comparisonId, comparison.id);
    assert.equal(receipt.body?.output?.manifestDigest, `sha256:${comparison.publication_payload_sha256}`);
    assert.equal(receipt.body?.output?.resultDigest, `sha256:${comparison.result_digest_sha256}`);
    assert.equal(receipt.body?.resultArtifact?.artifactId, comparison.publication_artifact_id);
    assert.equal(receipt.body?.resultArtifact?.digest, `sha256:${comparison.publication_sha256}`);
    assert.equal((await client.query<any>("select artifact_type from orchestration.artifact where tenant_id=$1 and id=$2", [tenantId, comparison.publication_artifact_id])).rows[0]?.artifact_type, "verification_benchmark_comparison_publication");

    await rejects(client, `insert into knowledge_service.receipt
      (id,tenant_id,operation_id,step_id,receipt_kind,idempotency_key,executor_identity,input_sha256,output_sha256,outcome,body)
      values($1,$2,$3,$4,$5,$6,'comparison-terminal-proof',$7,$8,'succeeded',$9::jsonb)`,
      [randomUUID(), tenantId, operationId, step.id, receipt.receipt_kind, `duplicate-${randomUUID()}`, receipt.input_sha256, receipt.output_sha256, JSON.stringify(receipt.body)], "duplicate successful receipt must fail", "23503");
    await rejects(client, "update knowledge_service.receipt set body=body||'{\"changed\":true}'::jsonb where tenant_id=$1 and id=$2", [tenantId, receipt.id], "terminal receipt must remain immutable");

    const directOperationId = randomUUID();
    await rejects(client, `insert into knowledge_service.operation
      (id,tenant_id,operation_kind,idempotency_key,correlation_id,actor_identity,request,request_sha256,status,completed_at)
      values($1,$2,'verification_benchmark_compare',$3,$4,'comparison-terminal-proof','{}',repeat('1',64),'succeeded',clock_timestamp())`,
      [directOperationId, tenantId, `direct-success-${randomUUID()}`, randomUUID()], "initial operation success without a sealed comparison must fail", "23503");

    const freshOperationId = randomUUID(), freshStepId = randomUUID();
    await client.query(`insert into knowledge_service.operation
      (id,tenant_id,operation_kind,idempotency_key,correlation_id,actor_identity,request,request_sha256,status)
      values($1,$2,'verification_benchmark_compare',$3,$4,'comparison-terminal-proof','{}',repeat('2',64),'running')`,
      [freshOperationId, tenantId, `fresh-${randomUUID()}`, randomUUID()]);
    await rejects(client, `insert into knowledge_service.operation_step
      (id,tenant_id,operation_id,step_key,step_kind,input,input_sha256,status,attempt_count,completed_at)
      values($1,$2,$3,'compare_registered_and_publish','compare_registered_and_publish','{}',repeat('3',64),'succeeded',1,clock_timestamp())`,
      [freshStepId, tenantId, freshOperationId], "initial step success without a sealed comparison must fail", "23503");
    await client.query(`insert into knowledge_service.operation_step
      (id,tenant_id,operation_id,step_key,step_kind,input,input_sha256,status,attempt_count)
      values($1,$2,$3,'compare_registered_and_publish','compare_registered_and_publish','{}',repeat('3',64),'running',1)`,
      [freshStepId, tenantId, freshOperationId]);
    await rejects(client, "update knowledge_service.operation_step set status='succeeded',completed_at=clock_timestamp() where tenant_id=$1 and id=$2", [tenantId, freshStepId], "updated step success without a sealed comparison must fail", "23503");
    await rejects(client, "update knowledge_service.operation set status='succeeded',completed_at=clock_timestamp() where tenant_id=$1 and id=$2", [tenantId, freshOperationId], "updated operation success without a sealed comparison and receipt must fail", "23503");

    report = {
      status: "passed",
      scope: "rollback-safe terminal SQL negatives plus read-only verification of the actual live-lease completeStep success",
      sourceReceipt: sourcePath,
      tenantId,
      operationId,
      comparisonId: comparison.id,
      stepId: step.id,
      terminalReceiptId: receipt.id,
      publicationArtifactId: comparison.publication_artifact_id,
      checks: {
        actualSealedComparison: true,
        actualSucceededStep: true,
        actualExactReceipt: true,
        actualSucceededOperation: true,
        dedicatedPublicationType: true,
        duplicateReceiptRejected: true,
        immutableReceiptRejected: true,
        initialOperationSuccessRejected: true,
        initialStepSuccessRejected: true,
        updatedStepSuccessRejected: true,
        updatedOperationSuccessRejected: true,
        noProductionTriggerDisabled: true,
        transactionRolledBack: true,
      },
    };
    throw new ProofRollback(report);
  });
} catch (error) {
  if (!(error instanceof ProofRollback)) throw error;
  report = error.report;
}
assert.ok(report);
await database.close();
const outputPath = resolve("../internal", `verification-benchmark-comparison-terminal-success-${randomUUID()}.json`);
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: "passed", output: outputPath, checks: Object.keys((report.checks ?? {}) as object).length }));
