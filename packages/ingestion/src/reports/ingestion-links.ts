import type { TenantSqlClient } from "@aiengineer/knowledge-persistence";
import { domainError } from "@aiengineer/knowledge-schema-workspace";
import type { IngestionIntent } from "../intent.js";
import type { IngestionReceipt, ProposalReceipt } from "../receipt.js";

export async function linkReportIngestion(client: TenantSqlClient, input: { intent: IngestionIntent; receipt: IngestionReceipt }): Promise<void> {
  for (const proposal of input.intent.proposals) {
    if (!proposal.reportBinding) continue;
    const binding = proposal.reportBinding;
    const result = input.receipt.proposals.find((item) => item.proposalId === proposal.proposalId);
    if (!result) throw domainError("REPORT_PROPOSAL_RECEIPT_MISSING", "Report-bound proposal has no receipt outcome");
    let assertionId: string | null = null;
    if (binding.assertionKey) {
      assertionId = (await client.query<{ id: string }>("select id from research.report_assertion where report_version_id=$1 and assertion_key=$2", [binding.reportVersionId, binding.assertionKey])).rows[0]?.id ?? null;
      if (!assertionId) throw domainError("REPORT_ASSERTION_UNKNOWN", "Report binding names a missing assertion");
    }
    await client.query(`insert into research.report_ingestion_link(report_version_id,assertion_id,intent_id,proposal_id,receipt_id,outcome,canonical_refs)
      values($1,$2,$3,$4,$5,$6,$7::jsonb)`, [binding.reportVersionId, assertionId, input.receipt.operationIntentId, proposal.proposalId, input.receipt.receiptId, outcome(result), JSON.stringify(result.created ? [result.created] : result.existing ? [result.existing] : [])]);
  }
}

function outcome(result: ProposalReceipt): string {
  if (result.noop || result.outcome === "no_op_duplicate") return "no_op";
  if (result.outcome === "admitted" || result.outcome === "superseded") return "applied";
  if (result.outcome === "rejected") return "rejected";
  return "held";
}
