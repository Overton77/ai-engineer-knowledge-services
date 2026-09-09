import {randomUUID} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
import {semanticReconciliationOriginalBinding} from "@aiengineer/knowledge-application";
import {PostgresSemanticProviderReconciliationStore} from "./verification-semantic-reconciliation-store.js";
import {loadNativeSemanticReconciliationBinding} from "./verification-semantic-reconciliation-binding.js";
vi.mock("./verification-semantic-reconciliation-binding.js",()=>({loadNativeSemanticReconciliationBinding:vi.fn()}));
function fixture(existing=false){
  const receipt={tenantId:randomUUID(),operationId:randomUUID(),providerAttemptId:randomUUID(),budgetId:randomUUID(),host:"claims",reservationCostMicros:100,decision:{actualCostMicros:12},originalState:"uncertain"};
  const artifact={artifactId:randomUUID(),digest:`sha256:${"a".repeat(64)}`},permit={receipt,artifact},time="2026-09-07T12:00:00.000Z";
  const row={operation_id:receipt.operationId,artifact_id:artifact.artifactId,artifact_sha256:artifact.digest.slice(7),body:receipt,applied_at:time};
  const query=vi.fn(async(sql:string)=>{
    if(sql.startsWith("select * from orchestration.verification_provider_reconciliation"))return {rows:existing?[row]:[]};
    if(sql.startsWith("insert into orchestration.verification_provider_reconciliation"))return {rows:[row]};
    if(sql.startsWith("select state,"))return {rows:[{state:"settled",actual_cost_micros:12,reconciled_at:time}]};
    return {rows:[{id:receipt.operationId}]};
  });
  const assertPermit=vi.fn(()=>permit);
  vi.mocked(loadNativeSemanticReconciliationBinding).mockReset().mockResolvedValue(semanticReconciliationOriginalBinding(receipt as never));
  const store=new PostgresSemanticProviderReconciliationStore({database:{transaction:async(_tenant:any,work:any)=>work({query})},repository:{} as never,admission:{assertPermit} as never});
  return {store,permit,query,assertPermit,row};
}
describe("semantic reconciliation store transaction boundary",()=>{
  it("locks operation, budget and attempt before binding and one guarded insert",async()=>{const f=fixture();const result=await f.store.apply(f.permit as never);expect(result.actualCostMicros).toBe(12);expect(f.query.mock.calls.slice(0,3).map(([sql])=>sql)).toEqual([expect.stringContaining("knowledge_service.operation"),expect.stringContaining("verification_provider_budget"),expect.stringContaining("verification_provider_attempt")]);expect(f.query.mock.calls.slice(0,3).every(([sql])=>sql.endsWith("for update"))).toBe(true);expect(f.query.mock.calls.filter(([sql])=>sql.startsWith("insert"))).toHaveLength(1);expect(loadNativeSemanticReconciliationBinding).toHaveBeenCalledOnce();});
  it("returns an identical existing settlement without hydration or another write",async()=>{const f=fixture(true);expect((await f.store.apply(f.permit as never)).releasedReservationCostMicros).toBe(100);expect(loadNativeSemanticReconciliationBinding).not.toHaveBeenCalled();expect(f.query.mock.calls.some(([sql])=>sql.startsWith("insert"))).toBe(false);});
  it("rejects conflicting prior receipts and changed original bindings",async()=>{const existing=fixture(true);existing.row.artifact_id=randomUUID();await expect(existing.store.apply(existing.permit as never)).rejects.toThrow("IDEMPOTENCY_CONFLICT");const fresh=fixture();vi.mocked(loadNativeSemanticReconciliationBinding).mockResolvedValue({} as never);await expect(fresh.store.apply(fresh.permit as never)).rejects.toThrow("ORIGINAL_CHANGED");expect(fresh.query.mock.calls.some(([sql])=>sql.startsWith("insert"))).toBe(false);});
  it("rechecks permit validity after locks and rejects expired decisions before writes",async()=>{const f=fixture();f.assertPermit.mockImplementationOnce(()=>f.permit).mockImplementation(()=>{throw new Error("EXPIRED");});await expect(f.store.apply(f.permit as never)).rejects.toThrow("EXPIRED");expect(f.query.mock.calls.some(([sql])=>sql.startsWith("insert"))).toBe(false);});
});
