import { describe, expect, it } from "vitest";
import type { TenantSqlClient } from "./postgres.js";
import { assertRecoveryProviderBudget } from "./verification-recovery-provider-budget.js";

function database(input: { active?: boolean; deadline?: boolean; calls?: number; cost?: number; absent?: boolean } = {}) {
  return { query: async (sql: string) => ({ rows: sql.includes("for update of e")
    ? input.absent ? [] : [{ reservation_calls: 2, reservation_cost_micros: 100, state: "linked",
      case_state: input.active === false ? "waiting" : "active", before_deadline: input.deadline !== false }]
    : [{ calls: String(input.calls ?? 0), cost_micros: String(input.cost ?? 0) }] }) } as unknown as TenantSqlClient;
}
const request = { tenantId: "tenant", operationId: "operation", additionalCalls: 1, additionalCostMicros: 50 };

describe("native provider dispatch honors durable recovery reservations", () => {
  it("rejects calls and cumulative charged/reserved cost outside the original execution reservation", async () => {
    await expect(assertRecoveryProviderBudget(database({ calls: 2 }), request)).rejects.toThrow("RECOVERY_PROVIDER_BUDGET_EXCEEDED");
    await expect(assertRecoveryProviderBudget(database({ calls: 1, cost: 51 }), request)).rejects.toThrow("RECOVERY_PROVIDER_BUDGET_EXCEEDED");
    await expect(assertRecoveryProviderBudget(database({ calls: 1, cost: 50 }), request)).resolves.toBeUndefined();
  });
  it("rechecks active authority and deadline at dispatch without counting the reserved call twice", async () => {
    const dispatch = { ...request, additionalCalls: 0, additionalCostMicros: 0 };
    await expect(assertRecoveryProviderBudget(database({ calls: 2, cost: 100 }), dispatch)).resolves.toBeUndefined();
    for (const changed of [{ active: false }, { deadline: false }]) {
      await expect(assertRecoveryProviderBudget(database(changed), dispatch)).rejects.toThrow("RECOVERY_PROVIDER_EXECUTION_NOT_ACTIVE");
    }
  });
  it("leaves unrelated native verification operations under their existing provider budget", async () => {
    await expect(assertRecoveryProviderBudget(database({ absent: true }), request)).resolves.toBeUndefined();
  });
});
