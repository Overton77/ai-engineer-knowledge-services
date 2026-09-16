import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { loadExecutorConfig, VerificationExecutor } from "../executor.js";
import { recoveryFixture } from "./recovery-test-fixtures.js";
import type { ExecutorRecoveryRouting } from "./recovery-routing.js";

describe("automatic recovery routing", () => {
  it("retains every original and deduplicates crash/replayed notifications", async () => {
    const fixture = await recoveryFixture();
    try {
      const first = await fixture.notify();
      expect(first).toMatchObject({ state: "ready", questionDenominator: 4, submitted: 4, cohortTriage: true, counts: { failed: 3, passed: 1 } });
      expect(first.items.map(item => item.route)).toEqual(["repair", "repair", "repair", "preserve"]);
      const replay = await fixture.notify();
      expect(replay.revision).toBe(first.revision);
      expect(replay.artifacts).toEqual(first.artifacts);
      expect((await fixture.recovery.read(fixture.tenantId, first.caseId)).spent).toEqual({ calls: 0, costMicros: 0 });
    } finally { await fixture.close(); }
  });

  it("routes held policy to adjudication without treating structural completion as admission", async () => {
    const fixture = await recoveryFixture();
    try {
      for (const result of fixture.results.values()) result.observation.policy = "review";
      const routed = await fixture.notify();
      expect(routed.counts.held).toBe(4);
      expect(routed.items.every(item => item.route === "adjudicate")).toBe(true);
    } finally { await fixture.close(); }
  });

  it("does not create a case for all passing results and retains missing members for original-operation reconciliation", async () => {
    const fixture = await recoveryFixture();
    try {
      for (const result of fixture.results.values()) Object.assign(result.observation, { mechanical: "passed", semantic: "directly_supported", policy: "pass", family: "none" });
      expect(await fixture.notify()).toMatchObject({ state: "not_required", submitted: 4 });
      fixture.results.delete(fixture.batch.items[0]!.inputDigest);
      const unresolved = await fixture.notify();
      expect(unresolved.counts.pending).toBe(1);
      expect(unresolved.items[0]!.route).toBe("reconcile");
      fixture.results.clear();
      await expect(fixture.notify()).rejects.toThrow("RECOVERY_RESULT_NOT_YET_AUTHORITATIVE");
    } finally { await fixture.close(); }
  });

  it("requires the host to be present before verification when the explicit pin requires recovery", async () => {
    const fixture = await recoveryFixture();
    try {
      const config = loadExecutorConfig({ VERIFY_STORE_DIR: fixture.store.rootDir, VERIFY_TENANT_ID: fixture.tenantId, VERIFY_GIT_SHA: "test", VERIFY_RECOVERY_REQUIRED: "1" });
      const executor = await VerificationExecutor.create(config);
      await executor.store.writeCapture({ captureId: "source", sourceId: "fixture", sourceKind: "api", logicalIdentity: "fixture", requestedUrl: "https://example.com", finalUrl: "https://example.com",
        capturedAt: new Date().toISOString(), captureMethod: "fixture", captureMethodVersion: "1", contentArtifact: fixture.source, characters: 13 });
      await expect(executor.verifyClaims({ runId: fixture.runId, intent: fixture.intent })).rejects.toThrow("RECOVERY_HOST_REQUIRED");
      expect((await executor.store.readRun(fixture.runId)).resultArtifactId).toBeUndefined();
    } finally { await fixture.close(); }
  });

  it("automatically notifies after persisted policy and retries the interrupted notification before seal", async () => {
    const fixture = await recoveryFixture();
    try {
      const executor = await VerificationExecutor.create(loadExecutorConfig({ VERIFY_STORE_DIR: fixture.store.rootDir, VERIFY_TENANT_ID: fixture.tenantId, VERIFY_GIT_SHA: "test", VERIFY_RECOVERY_REQUIRED: "1" }));
      const summary = await fixture.notify();
      const notify = vi.fn<ExecutorRecoveryRouting["notify"]>().mockRejectedValueOnce(new Error("SIMULATED_NOTIFICATION_INTERRUPTION")).mockResolvedValue(summary);
      executor.attachRecoveryRouting({ authorize: async () => ({ batchId: fixture.batch.batchId, caseId: fixture.batch.caseId, authorityArtifact: fixture.authorization }), notify });
      await executor.store.writeCapture({ captureId: "source", sourceId: "fixture", sourceKind: "api", logicalIdentity: "fixture", requestedUrl: "https://example.com", finalUrl: "https://example.com",
        capturedAt: new Date().toISOString(), captureMethod: "fixture", captureMethodVersion: "1", contentArtifact: fixture.source, characters: fixture.source.byteLength });
      await executor.verifyClaims({ runId: fixture.runId, intent: fixture.intent });
      await expect(executor.evaluatePolicy({ runId: fixture.runId })).rejects.toThrow("SIMULATED_NOTIFICATION_INTERRUPTION");
      const interrupted = await executor.store.readRun(fixture.runId);
      expect(interrupted.decisionArtifactId).toBeDefined();
      expect(interrupted.recoveryAuthorityArtifactId).toBe(fixture.authorization.artifactId);
      expect(interrupted.recoveryNotificationArtifactId).toBeUndefined();
      await executor.sealRun({ runId: fixture.runId });
      expect(notify).toHaveBeenCalledTimes(2);
      expect(notify.mock.calls[1]![0].decisionArtifact.artifactId).toBe(interrupted.decisionArtifactId);
      expect((await executor.store.readRun(fixture.runId)).recoveryNotificationArtifactId).toBe(interrupted.decisionArtifactId);
    } finally { await fixture.close(); }
  });

  it("binds configured producer/verifier attempts and rejects contradictory model producer identity", async () => {
    const fixture = await recoveryFixture();
    try {
      const producer = randomUUID(), verifier = randomUUID();
      expect(() => loadExecutorConfig({ VERIFY_PRODUCER_ATTEMPT_ID: producer, VERIFY_GIT_SHA: "test" })).toThrow("VERIFICATION_DISTINCT_CANONICAL_ATTEMPTS_REQUIRED");
      expect(() => loadExecutorConfig({ VERIFY_PRODUCER_ATTEMPT_ID: producer, VERIFY_VERIFIER_ATTEMPT_ID: producer, VERIFY_GIT_SHA: "test" })).toThrow("VERIFICATION_DISTINCT_CANONICAL_ATTEMPTS_REQUIRED");
      const executor = await VerificationExecutor.create(loadExecutorConfig({ VERIFY_STORE_DIR: fixture.store.rootDir, VERIFY_TENANT_ID: fixture.tenantId,
        VERIFY_PRODUCER_ATTEMPT_ID: producer, VERIFY_VERIFIER_ATTEMPT_ID: verifier, VERIFY_GIT_SHA: "test" }));
      await expect(executor.compileClaims(fixture.intent, "non-uuid-run")).rejects.toThrow("VERIFICATION_CANONICAL_RUN_ID_REQUIRED");
      await expect(executor.compileClaims({ ...fixture.intent, producer: { attemptId: randomUUID(), deploymentId: "producer", capabilityVersion: "1" } }, fixture.runId)).rejects.toThrow("VERIFICATION_PRODUCER_PIN_MISMATCH");
    } finally { await fixture.close(); }
  });
});
