import {VerificationProviderReconciliationResourceSchema} from "@aiengineer/knowledge-contracts";
import {semanticReconciliationOriginalBinding,type AdmittedSemanticProviderReconciliation,type SemanticProviderReconciliationAdmission} from "@aiengineer/knowledge-application";
import {deepFreeze} from "@aiengineer/knowledge-domain";
import {canonicalizeJson} from "@aiengineer/knowledge-verification";
import type {PostgresCanonicalRepository} from "./postgres.js";
import type {PostgresVerificationRepository} from "./verification.js";
import {loadNativeSemanticReconciliationBinding} from "./verification-semantic-reconciliation-binding.js";

/** Control-plane only. Native ledger triggers own the one-time accounting transition. */
export class PostgresSemanticProviderReconciliationStore {
  constructor(private readonly dependencies:{database:Pick<PostgresCanonicalRepository,"transaction">;repository:PostgresVerificationRepository;admission:SemanticProviderReconciliationAdmission}){}
  async apply(value:AdmittedSemanticProviderReconciliation){
    const {receipt,artifact}=this.dependencies.admission.assertPermit(value);
    return this.dependencies.database.transaction(receipt.tenantId,async client=>{
      const kind=receipt.host==="claims"?"verification_claims":"verification_report";
      const op=(await client.query("select id from knowledge_service.operation where tenant_id=$1 and id=$2 and operation_kind=$3 and status in ('succeeded','failed','cancelled') for update",[receipt.tenantId,receipt.operationId,kind])).rows[0];
      if(!op)throw new Error("SEMANTIC_RECONCILIATION_TERMINAL_OPERATION_REQUIRED");
      const budget=(await client.query("select id from orchestration.verification_provider_budget where tenant_id=$1 and id=$2 for update",[receipt.tenantId,receipt.budgetId])).rows[0];
      const attempt=(await client.query("select id from orchestration.verification_provider_attempt where tenant_id=$1 and id=$2 and operation_id=$3 and budget_id=$4 for update",[receipt.tenantId,receipt.providerAttemptId,receipt.operationId,receipt.budgetId])).rows[0];
      if(!budget||!attempt)throw new Error("SEMANTIC_RECONCILIATION_ORIGINAL_REQUIRED");
      this.dependencies.admission.assertPermit(value);
      let row=(await client.query<Record<string,unknown>>("select * from orchestration.verification_provider_reconciliation where tenant_id=$1 and provider_attempt_id=$2",[receipt.tenantId,receipt.providerAttemptId])).rows[0];
      if(!row){
        // Reuse the same transaction so all original identity reads follow the locks.
        const original=await loadNativeSemanticReconciliationBinding({database:{transaction:async(tenantId,work)=>{
          if(tenantId!==receipt.tenantId)throw new Error("SEMANTIC_RECONCILIATION_TENANT_MISMATCH");return work(client);
        }},repository:this.dependencies.repository,tenantId:receipt.tenantId,providerAttemptId:receipt.providerAttemptId});
        if(canonicalizeJson(original)!==canonicalizeJson(semanticReconciliationOriginalBinding(receipt)))throw new Error("SEMANTIC_RECONCILIATION_ORIGINAL_CHANGED");
        this.dependencies.admission.assertPermit(value);
        row=(await client.query<Record<string,unknown>>("insert into orchestration.verification_provider_reconciliation(tenant_id,provider_attempt_id,operation_id,artifact_id,artifact_sha256,body) values($1,$2,$3,$4,$5,$6::jsonb) returning *",[receipt.tenantId,receipt.providerAttemptId,receipt.operationId,artifact.artifactId,artifact.digest.slice(7),JSON.stringify(receipt)])).rows[0];
      }
      if(!row||row.operation_id!==receipt.operationId||row.artifact_id!==artifact.artifactId||row.artifact_sha256!==artifact.digest.slice(7)||canonicalizeJson(row.body)!==canonicalizeJson(receipt))throw new Error("SEMANTIC_RECONCILIATION_IDEMPOTENCY_CONFLICT");
      const settled=(await client.query<Record<string,unknown>>("select state,actual_cost_micros,reconciled_at from orchestration.verification_provider_attempt where tenant_id=$1 and id=$2",[receipt.tenantId,receipt.providerAttemptId])).rows[0];
      const appliedAt=new Date(row.applied_at as Date|string).toISOString();
      if(!settled||settled.state!=="settled"||settled.actual_cost_micros===null||Number(settled.actual_cost_micros)!==receipt.decision.actualCostMicros||new Date(settled.reconciled_at as Date|string).toISOString()!==appliedAt)throw new Error("SEMANTIC_RECONCILIATION_SETTLEMENT_MISMATCH");
      return deepFreeze(VerificationProviderReconciliationResourceSchema.parse({tenantId:receipt.tenantId,operationId:receipt.operationId,providerAttemptId:receipt.providerAttemptId,artifact:{artifactId:artifact.artifactId,digest:artifact.digest},actualCostMicros:receipt.decision.actualCostMicros,releasedReservationCostMicros:receipt.reservationCostMicros,appliedAt,redispatchAuthorized:false}));
    });
  }
}
