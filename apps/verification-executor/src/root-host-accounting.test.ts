import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { selectVerificationAccounting } from "./root-host-accounting.js";

type Snapshot = NonNullable<ReturnType<typeof selectVerificationAccounting>>;
const digest = `sha256:${"a".repeat(64)}`;
function snapshot(): Snapshot {
  const tenantId = randomUUID(), runId = randomUUID();
  return { artifactId: randomUUID(), digest, value: { schemaVersion: "root-verification-accounting.v1",
    operationId: randomUUID(), receiptId: randomUUID(), receiptDigest: digest, auditArtifact: { artifactId: randomUUID(), digest },
    usage: { tenantId, runId, calls: 1, costMicros: 5, executions: [{
      execution: { tenantId, runId, resultArtifactId: randomUUID(), resultDigest: digest }, calls: 1, costMicros: 5,
      evidence: [{ callId: "initial", requestDigest: digest, reservationDigest: "a".repeat(64), settlementDigest: "b".repeat(64) }] }] } } };
}

it("chooses cumulative evidence regardless of ordering and preserves an empty history as unresolved", () => {
  expect(selectVerificationAccounting([])).toBeNull();
  const earlier = snapshot(), later = structuredClone(earlier);
  later.artifactId = randomUUID();
  const execution = later.value.usage.executions[0]!;
  execution.evidence.push({ ...execution.evidence[0]!, callId: "retry", settlementDigest: "c".repeat(64) });
  execution.calls = 2; execution.costMicros = 8;
  later.value.usage.calls = 2; later.value.usage.costMicros = 8;
  expect(selectVerificationAccounting([earlier, later])).toEqual(later);
  expect(selectVerificationAccounting([later, earlier])).toEqual(later);
});

it("rejects branched evidence and changes to a previously settled call", () => {
  const first = snapshot(), changed = structuredClone(first);
  changed.value.usage.executions[0]!.evidence[0]!.callId = "different-branch";
  expect(() => selectVerificationAccounting([first, changed])).toThrow("SNAPSHOTS_INCOMPARABLE");
  changed.value.usage.executions[0]!.evidence[0] = { ...first.value.usage.executions[0]!.evidence[0]!, settlementDigest: "c".repeat(64) };
  expect(() => selectVerificationAccounting([first, changed])).toThrow("SNAPSHOTS_INCOMPARABLE");
});

it("preserves zero-dispatch revisions alongside earlier charged executions", () => {
  const earlier = snapshot(), later = structuredClone(earlier);
  later.artifactId = randomUUID();
  later.value.usage.executions.push({ execution: { ...earlier.value.usage.executions[0]!.execution, resultArtifactId: randomUUID() },
    calls: 0, costMicros: 0, evidence: [], lifecycle: { openedDigest: "c".repeat(64), closedDigest: "d".repeat(64) } });
  expect(selectVerificationAccounting([earlier, later])).toEqual(later);
  expect(selectVerificationAccounting([later, earlier])).toEqual(later);
  const lost = structuredClone(later);
  lost.artifactId = randomUUID();
  lost.value.usage.executions.pop();
  lost.value.usage.executions[0]!.calls++;
  lost.value.usage.executions[0]!.evidence.push({ ...lost.value.usage.executions[0]!.evidence[0]!, callId: "new" });
  lost.value.usage.calls++;
  expect(() => selectVerificationAccounting([later, lost])).toThrow("SETTLEMENT_CONFLICT");
});

it("rejects cost changes without new calls and prevents mixing receipts", () => {
  const first = snapshot(), changed = structuredClone(first);
  changed.value.usage.costMicros = 4; changed.value.usage.executions[0]!.costMicros = 4;
  expect(() => selectVerificationAccounting([first, changed])).toThrow("SETTLEMENT_CONFLICT");
  changed.value.receiptId = randomUUID();
  expect(() => selectVerificationAccounting([first, changed])).toThrow("SNAPSHOT_SCOPE");
});
