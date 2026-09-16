import type { PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import { digestCanonicalJson } from "@aiengineer/knowledge-verification";
import { deterministicUuid } from "./store.js";
import { z } from "zod";

const Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const Submission = z.strictObject({ tenantId: z.uuid(), missionId: z.uuid(), attemptId: z.uuid(), runId: z.uuid(),
  artifactId: z.uuid(), digest: Digest });
const Completion = z.strictObject({ schemaVersion: z.literal("root-verification-receipt.v1"), submission: Submission,
  manifestDigest: Digest, auditArtifact: z.strictObject({ artifactId: z.uuid(), digest: Digest }), resultArtifactId: z.uuid(),
  dispositions: z.array(z.strictObject({ claimId: z.string().min(1), digest: Digest, eligible: z.boolean(),
    verdict: z.string().min(1), policyOutcome: z.string().min(1) })).min(1).max(256), usage: z.null() });

export interface RetainedVerificationSubmission {
  tenantId: string; missionId: string; attemptId: string; runId: string; artifactId: string; digest: string;
}

/** Records actual executor work in the existing ledger; this does not enqueue a native worker operation. */
export function createVerificationReceiptRecorder(database: Pick<PostgresCanonicalRepository, "transaction">) {
  const operationId = (submission: RetainedVerificationSubmission) => deterministicUuid("root-verification-intent.v1",
    `${submission.tenantId}:${submission.runId}:${submission.artifactId}:${submission.digest}`);
  return {
    async read(scope: { tenantId: string; missionId: string; attemptId: string; runId: string }) {
      return database.transaction(scope.tenantId, async client => {
        const rows = (await client.query<{ id: string; idempotency_key: string; payload: unknown;
          receipt_id: string | null; executor_version: string | null; outcome: string | null; changes_summary: unknown }>(`
          select i.id,i.idempotency_key,i.payload,r.id as receipt_id,r.executor_version,r.outcome,r.changes_summary
          from orchestration.operation_intent i left join orchestration.operation_receipt r on r.intent_id=i.id
          where i.tenant_id=$1 and i.mission_id=$2 and i.proposed_by_attempt=$3
            and i.intent_type='verify_claim' and i.idempotency_key like 'root-verification:%'
          order by i.created_at,i.id limit 257`, [scope.tenantId, scope.missionId, scope.attemptId])).rows;
        if (rows.length > 256) throw new Error("ROOT_VERIFICATION_HISTORY_CAPACITY");
        return rows.map(row => {
          const { submission } = z.strictObject({ schemaVersion: z.literal("root-verification-intent.v1"), submission: Submission }).parse(row.payload);
          if (submission.tenantId !== scope.tenantId || submission.missionId !== scope.missionId || submission.attemptId !== scope.attemptId
            || operationId(submission) !== row.id || row.idempotency_key !== `root-verification:${row.id}`)
            throw new Error("ROOT_VERIFICATION_HISTORY_SCOPE");
          const summary = row.receipt_id ? Completion.parse(row.changes_summary) : null;
          if (summary && (row.receipt_id !== deterministicUuid("root-verification-receipt.v1", row.id)
            || row.executor_version !== "root-verification-receipt.v1" || row.outcome !== "applied"
            || digestCanonicalJson(summary.submission) !== digestCanonicalJson(submission)))
            throw new Error("ROOT_VERIFICATION_HISTORY_RECEIPT");
          return { operationId: row.id, submission, completion: summary
            ? { receiptId: row.receipt_id!, digest: digestCanonicalJson(summary), summary } : null };
        }).filter(record => record.submission.runId === scope.runId);
      });
    },
    async submit(submission: RetainedVerificationSubmission) {
      const id = operationId(submission);
      const payload = { schemaVersion: "root-verification-intent.v1", submission };
      await database.transaction(submission.tenantId, async client => {
        await client.query(`insert into orchestration.operation_intent
          (id,tenant_id,intent_type,schema_version,payload,preconditions,idempotency_key,proposed_by_attempt,mission_id,approval_state,policy_decision)
          values($1,$2,'verify_claim',1,$3,'{}',$4,$5,$6,'approved',$7) on conflict(id) do nothing`,
        [id, submission.tenantId, payload, `root-verification:${id}`, submission.attemptId, submission.missionId,
          { scope: "record-executor-verification", claimAdmission: false }]);
        const row = (await client.query<{ payload: unknown }>("select payload from orchestration.operation_intent where tenant_id=$1 and id=$2 and intent_type='verify_claim'",
          [submission.tenantId, id])).rows[0];
        if (!row || digestCanonicalJson(row.payload) !== digestCanonicalJson(payload)) throw new Error("ROOT_VERIFICATION_INTENT_CONFLICT");
      });
      return { operationId: id };
    },
    async complete(submission: RetainedVerificationSubmission, sealed: { runId: string; tenantId: string;
      manifestDigest: string; auditArtifact: { artifactId: string; digest: string }; resultArtifactId: string;
      claims: readonly { claimId: string; digest: string; eligible: boolean; verdict: string; policyOutcome: string }[] }) {
      if (sealed.runId !== submission.runId || sealed.tenantId !== submission.tenantId) throw new Error("ROOT_VERIFICATION_RECEIPT_SCOPE");
      const id = operationId(submission), receiptId = deterministicUuid("root-verification-receipt.v1", id);
      const summary = { schemaVersion: "root-verification-receipt.v1", submission,
        manifestDigest: sealed.manifestDigest, auditArtifact: sealed.auditArtifact, resultArtifactId: sealed.resultArtifactId,
        dispositions: sealed.claims.map(({ claimId, digest, eligible, verdict, policyOutcome }) => ({ claimId, digest, eligible, verdict, policyOutcome })),
        usage: null };
      return database.transaction(submission.tenantId, async client => {
        const intent = (await client.query<{ payload: { submission: unknown } }>("select payload from orchestration.operation_intent where tenant_id=$1 and id=$2 and intent_type='verify_claim'",
          [submission.tenantId, id])).rows[0];
        if (!intent || digestCanonicalJson(intent.payload.submission) !== digestCanonicalJson(submission)) throw new Error("ROOT_VERIFICATION_INTENT_REQUIRED");
        await client.query(`insert into orchestration.operation_receipt(id,intent_id,executor_version,outcome,changes_summary)
          values($1,$2,'root-verification-receipt.v1','applied',$3) on conflict(intent_id) do nothing`, [receiptId, id, summary]);
        const receipt = (await client.query<{ id: string; changes_summary: unknown }>(
          "select id,changes_summary from orchestration.operation_receipt where intent_id=$1", [id])).rows[0];
        if (!receipt || receipt.id !== receiptId || digestCanonicalJson(receipt.changes_summary) !== digestCanonicalJson(summary))
          throw new Error("ROOT_VERIFICATION_RECEIPT_CONFLICT");
        return { operationId: id, receiptId, digest: digestCanonicalJson(summary), summary };
      });
    },
  };
}
