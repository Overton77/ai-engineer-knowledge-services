import { expect, it } from "vitest";
import { RecoverySelectorProbes } from "./recovery-probes.js";
import { recoveryFixture } from "./recovery-test-fixtures.js";

it("executes a bounded shared selector probe and independent passing control from real retained bytes", async () => {
  const fixture = await recoveryFixture();
  try {
    await fixture.notify();
    const probes = new RecoverySelectorProbes({ tenantId: fixture.tenantId, custody: fixture.custody, recovery: fixture.recovery, now: () => fixture.authority.now(), representation: fixture.representation });
    const binding = structuredClone(fixture.batch.items[0]!.binding);
    binding.evidence[0]!.selector = { kind: "json_pointer", pointer: "/metric" };
    const request = { caseId: fixture.batch.caseId, dependencyId: "shared-selector", representatives: [{ originalId: "claim-1", binding }], controlId: "claim-4" };
    const result = await probes.run(request);
    expect(result.receiptArtifacts).toHaveLength(2);
    for (const artifact of result.receiptArtifacts) expect(await probes.read({ tenantId: fixture.tenantId, artifact })).toMatchObject({ passed: true, calls: 0, costMicros: 0 });
    expect((await probes.run(request)).receiptArtifacts).toEqual(result.receiptArtifacts);
    binding.evidence[0]!.selector = { kind: "json_pointer", pointer: "/changed" };
    await expect(probes.run(request)).rejects.toThrow("RECOVERY_PROBE_ROUND_ALREADY_RESERVED");
  } finally { await fixture.close(); }
});

it("rejects missing controls, unsupported claim changes and forged probe verdicts", async () => {
  const fixture = await recoveryFixture();
  try {
    await fixture.notify();
    const probes = new RecoverySelectorProbes({ tenantId: fixture.tenantId, custody: fixture.custody, recovery: fixture.recovery, now: () => fixture.authority.now(), representation: fixture.representation });
    const binding = structuredClone(fixture.batch.items[0]!.binding);
    const request = { caseId: fixture.batch.caseId, dependencyId: "shared-selector", representatives: [{ originalId: "claim-1", binding }] };
    await expect(probes.run(request)).rejects.toThrow("RECOVERY_PROBE_CONTROL_REQUIRED");
    binding.claim.statement = "Change the question";
    await expect(probes.run({ ...request, controlId: "claim-4" })).rejects.toThrow("RECOVERY_SELECTOR_PROBE_SCOPE_UNSUPPORTED");
    binding.claim.statement = fixture.batch.items[0]!.binding.claim.statement;
    const result = await probes.run({ ...request, controlId: "claim-4" });
    expect(await probes.read({ tenantId: fixture.tenantId, artifact: result.receiptArtifacts[0]! })).toMatchObject({ passed: false });
    const original = result.receiptArtifacts[0]!;
    const payload = await fixture.store.json<Record<string, unknown>>(original);
    const forged = (await fixture.store.putJson({ ...payload, passed: true }, { mediaType: "application/json", producerActivityId: "producer", producerVersion: "1", parentArtifactIds: original.parentArtifactIds, transformation: { kind: "forged" } })).handle;
    await expect(probes.read({ tenantId: fixture.tenantId, artifact: forged })).rejects.toThrow("RECOVERY_PROBE_FORGED_RESULT");
  } finally { await fixture.close(); }
});
