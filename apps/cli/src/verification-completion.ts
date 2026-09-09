import type { KnowledgeClient } from "@aiengineer/knowledge-client";
import {VerificationBenchmarkComparisonOperationResultSchema, VerificationBenchmarkOperationResultSchema, VerificationClaimsSealResultSchema, type OperationContext } from "@aiengineer/knowledge-contracts";

/** Operation kinds whose terminal success receipt `--wait` knows how to interpret. */
export const WAITABLE_VERIFICATION_RECEIPTS=Object.freeze({
  verification_capture:"register_and_admit.succeeded",
  verification_extraction:"verify_and_register.succeeded",
  verification_replay:"hydrate_and_recompute.succeeded",
  verification_metric:"verify_metric_and_register.succeeded",
  verification_benchmark:"replay_recorded_and_register.succeeded",
  verification_benchmark_compare:"compare_registered_and_publish.succeeded",
  verification_claims:"verify_claims_and_register.succeeded",
  verification_report:"verify_report_and_register.succeeded",
} as const);
export type WaitableVerificationKind=keyof typeof WAITABLE_VERIFICATION_RECEIPTS;

const MECHANICAL_STATUSES=new Set(["passed","failed","review_required"]);
/** Compact, non-authoritative projection of a sealed claims/report result. Exit 0 only for admitted policy outcomes. */
function parseClaimsReportCompletion(output:Record<string,unknown>|undefined){
  const verified=output?.verified as {deterministicResult?:{status?:unknown}}|undefined;
  const mechanicalStatus=verified?.deterministicResult?.status;
  if(typeof mechanicalStatus!=="string"||!MECHANICAL_STATUSES.has(mechanicalStatus))throw new Error("VERIFICATION_RESULT_INVALID");
  return {mechanicalStatus:mechanicalStatus as "passed"|"failed"|"review_required",sealedRun:VerificationClaimsSealResultSchema.parse(output?.sealedRun)};
}

export async function waitForVerification(
  client:Pick<KnowledgeClient,"getVerificationOperation"|"getReceipt">,
  operationId:string,
  context:Pick<OperationContext,"tenantId"|"correlationId">,
  timeoutMs:number,
) {
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    const operation=await client.getVerificationOperation(operationId,context);
    if(operation.state==="succeeded"){
      const expectedKind=WAITABLE_VERIFICATION_RECEIPTS[operation.kind as WaitableVerificationKind];
      if(!expectedKind)throw new Error(`VERIFICATION_WAIT_UNSUPPORTED_KIND:${operation.kind} (poll with \`verify status\` and read the kind-specific result instead)`);
      for(const id of [...operation.receiptIds].reverse()){
        const receipt=await client.getReceipt(id,context);
        if(receipt.operationId!==operationId||receipt.receiptKind!==expectedKind||receipt.outcome!=="succeeded")continue;
        const body=receipt.body as Record<string,unknown>;
        const output=body?.output as Record<string,unknown>|undefined;
        if(operation.kind==="verification_benchmark_compare"){const comparison=VerificationBenchmarkComparisonOperationResultSchema.parse(output);return {operationId,state:operation.state,comparison,receiptId:id,exitCode:comparison.engineeringGateOutcome==="fail"?1:0};}
        if(operation.kind==="verification_benchmark")return {operationId,state:operation.state,benchmark:VerificationBenchmarkOperationResultSchema.parse(output),receiptId:id,exitCode:0};
        if(operation.kind==="verification_claims"||operation.kind==="verification_report"){
          const parsed=parseClaimsReportCompletion(output);
          const mechanicalStatus=parsed.mechanicalStatus,policyOutcome=parsed.sealedRun.policyOutcome;
          // Admitted only when mechanics passed and the sealed policy admitted; `review`/`abstain` are held results, `fail` is a completed quality failure.
          const admitted=mechanicalStatus==="passed"&&(policyOutcome==="pass"||policyOutcome==="pass_with_warnings");
          const held=!admitted&&mechanicalStatus!=="failed"&&policyOutcome!=="fail";
          const summary={runId:parsed.sealedRun.runId,manifestDigest:parsed.sealedRun.manifestDigest,policyOutcome,mechanicalStatus,disposition:admitted?"admitted":held?"held_for_review":"quality_failed"} as const;
          return operation.kind==="verification_claims"
            ?{operationId,state:operation.state,claims:summary,receiptId:id,exitCode:admitted?0:1}
            :{operationId,state:operation.state,report:summary,receiptId:id,exitCode:admitted?0:1};
        }
        const result=output?.result as Record<string,unknown>|undefined;
        const qualityPassed=operation.kind==="verification_capture"?true:result?.valid;
        if(typeof qualityPassed!=="boolean")throw new Error("VERIFICATION_RESULT_INVALID");
        return {operationId,state:operation.state,qualityPassed,receiptId:id,exitCode:qualityPassed?0:1};
      }
      throw new Error("VERIFICATION_SUCCESS_RECEIPT_REQUIRED");
    }
    if(["failed","cancelled","quarantined"].includes(operation.state))throw new Error(`VERIFICATION_OPERATION_${operation.state.toUpperCase()}`);
    if(operation.state==="needs_review")return {operationId,state:operation.state,qualityPassed:false,exitCode:1};
    await new Promise(resolve=>setTimeout(resolve,Math.min(250,Math.max(0,deadline-Date.now()))));
  }
  throw new Error("VERIFICATION_WAIT_TIMEOUT");
}
