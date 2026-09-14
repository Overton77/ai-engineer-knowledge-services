import { describe, expect, it } from "vitest";
import { assertDurableProbeAccounting } from "./verification-recovery-durable-accounting.js";
const probe = { operationId: "11111111-1111-4111-8111-111111111111", calls: 1, costMicros: 7, previouslyAccounted: false };
const prior = [{ probeExecutions: [probe] }];
describe("durable probe accounting across regrouping", () => {
  it("rejects another charge for the same operation in a new dependency group", () => {
    expect(() => assertDurableProbeAccounting({ probeExecutions: [probe] }, prior, [])).toThrow("RECOVERY_PROBE_ALREADY_CHARGED");
  });
  it("allows the same dependency receipt to remain accounted without another charge", () => {
    expect(() => assertDurableProbeAccounting({ probeExecutions: [{ ...probe, previouslyAccounted: true }] }, prior, [])).not.toThrow();
  });
  it("rejects contradictory usage for one observed operation", () => {
    expect(() => assertDurableProbeAccounting({ probeExecutions: [{ ...probe, previouslyAccounted: true, costMicros: 8 }] }, prior, [])).toThrow("RECOVERY_PROBE_USAGE_CONFLICT");
    expect(() => assertDurableProbeAccounting({ probeExecutions: [probe, { ...probe, calls: 2 }] }, [], [])).toThrow("RECOVERY_PROBE_USAGE_CONFLICT");
  });
});
