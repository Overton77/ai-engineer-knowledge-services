import type { TenantSqlClient } from "./postgres.js";

/** Runs inside the existing native provider transaction, after its operation lease is checked. */
export async function assertRecoveryProviderBudget(client: TenantSqlClient, input: {
  tenantId: string; operationId: string; additionalCalls: number; additionalCostMicros: number;
}): Promise<void> {
  const execution = (await client.query<{
    reservation_calls: string | number; reservation_cost_micros: string | number;
    state: string; case_state: string; before_deadline: boolean;
  }>(`select e.reservation_calls,e.reservation_cost_micros,e.state,c.state case_state,
      clock_timestamp() < (c.initial_batch->'limits'->>'deadline')::timestamptz before_deadline
    from knowledge_service.recovery_execution e join knowledge_service.recovery_case c
      on c.tenant_id=e.tenant_id and c.case_id=e.case_id
    where e.tenant_id=$1 and e.planned_operation_id=$2 for update of e`, [input.tenantId, input.operationId])).rows;
  if (!execution.length) return;
  if (execution.length !== 1) throw new Error("RECOVERY_PROVIDER_EXECUTION_AMBIGUOUS");
  const row = execution[0]!;
  if (!row.before_deadline || row.case_state !== "active" || !["authorized", "linked"].includes(row.state)) {
    throw new Error("RECOVERY_PROVIDER_EXECUTION_NOT_ACTIVE");
  }
  const aggregate = (await client.query<{ calls: string; cost_micros: string }>(
    `select count(*)::text calls,coalesce(sum(case when state='settled' then coalesce(actual_cost_micros,reservation_cost_micros) else reservation_cost_micros end),0)::text cost_micros
     from orchestration.verification_provider_attempt where tenant_id=$1 and operation_id=$2`,
    [input.tenantId, input.operationId])).rows[0];
  const values = [row.reservation_calls, row.reservation_cost_micros, aggregate?.calls, aggregate?.cost_micros,
    input.additionalCalls, input.additionalCostMicros].map(Number);
  if (values.some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error("RECOVERY_PROVIDER_ACCOUNTING_INVALID");
  if (values[2]! + input.additionalCalls > values[0]! || values[3]! + input.additionalCostMicros > values[1]!) {
    throw new Error("RECOVERY_PROVIDER_BUDGET_EXCEEDED");
  }
}
