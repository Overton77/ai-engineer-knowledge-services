import type { DurableRecoveryExecution, DurableRecoveryUsage, VerificationRecoveryPlan } from "@aiengineer/knowledge-contracts";

type ProbePlan = Pick<VerificationRecoveryPlan, "probeExecutions">;

/** Regrouping does not create a second charge for an independently observed operation. */
export function assertDurableProbeAccounting(proposed: ProbePlan, previous: readonly ProbePlan[], executions: readonly DurableRecoveryExecution[]): void {
  const charged = new Map<string, DurableRecoveryUsage>();
  function retain(operationId: string, usage: DurableRecoveryUsage): void {
    const prior = charged.get(operationId);
    if (prior && (prior.calls !== usage.calls || prior.costMicros !== usage.costMicros)) throw new Error("RECOVERY_PROBE_USAGE_CONFLICT");
    charged.set(operationId, usage);
  }
  for (const plan of previous) for (const probe of plan.probeExecutions) retain(probe.operationId, probe);
  for (const execution of executions) if (execution.operationId && execution.usage) retain(execution.operationId, execution.usage);
  const withinPlan = new Map<string, DurableRecoveryUsage>();
  for (const probe of proposed.probeExecutions) {
    const previousUsage = charged.get(probe.operationId) ?? withinPlan.get(probe.operationId);
    if (previousUsage && (previousUsage.calls !== probe.calls || previousUsage.costMicros !== probe.costMicros)) throw new Error("RECOVERY_PROBE_USAGE_CONFLICT");
    if (charged.has(probe.operationId) && !probe.previouslyAccounted) throw new Error("RECOVERY_PROBE_ALREADY_CHARGED");
    withinPlan.set(probe.operationId, probe);
  }
}
