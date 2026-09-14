import { describe, expect, it } from "vitest";
import { DurableRecoveryClaimSchema, DurableRecoveryExecutionSchema } from "./verification-recovery-durable.js";
const uuid = "11111111-1111-4111-8111-111111111111";
const digest = `sha256:${"a".repeat(64)}`;
const claim = { tenantId: uuid, caseId: "case", planDigest: digest, holderIdentity: "worker", token: uuid, fencingToken: 1, expiresAt: "2026-09-14T00:00:00.000Z", keys: ["dependency:shared"] };
describe("durable repair boundary", () => {
  it("requires positive fencing and bounded resource keys", () => {
    expect(DurableRecoveryClaimSchema.safeParse(claim).success).toBe(true);
    expect(DurableRecoveryClaimSchema.safeParse({ ...claim, fencingToken: 0 }).success).toBe(false);
    expect(DurableRecoveryClaimSchema.safeParse({ ...claim, keys: [] }).success).toBe(false);
  });
  it("requires explicit original operation authorization and nonnegative accounting", () => {
    const execution = { executionId: uuid, tenantId: uuid, caseId: "case", originalId: "original", planDigest: digest, repairDigest: digest, inputDigest: digest,
      plannedOperationId: uuid, reservation: { calls: 1, costMicros: 10 }, state: "authorized", authorizationToken: uuid, claimToken: uuid, claimFence: 1 };
    expect(DurableRecoveryExecutionSchema.safeParse(execution).success).toBe(true);
    expect(DurableRecoveryExecutionSchema.safeParse({ ...execution, authorizationToken: undefined }).success).toBe(false);
    expect(DurableRecoveryExecutionSchema.safeParse({ ...execution, state: "settled" }).success).toBe(false);
    expect(DurableRecoveryExecutionSchema.safeParse({ ...execution, reservation: { calls: -1, costMicros: 0 } }).success).toBe(false);
  });
});
