import { describe, expect, it, vi } from "vitest";
import { CanonicalActivityError, type CanonicalActivityHandler } from "./activity-registry.js";
import { verificationSealedReplayActivityHandler } from "./verification-sealed-replay-activity.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context = { tenantId: id(1), operationId: id(2), missionId: id(3), workItemId: id(4), attemptId: id(5), correlationId: "sealed-replay-test",
  actor: { kind: "service" as const, id: id(6), serviceIdentity: "knowledge_worker" as const }, capabilityVersion: "verification.v1", idempotencyKey: "sealed-replay-test", reason: "focused replay test", contractVersion: "v1" as const };
const request = { verificationContractVersion: "verification.v1" as const, runId: id(7), replayMode: "deterministic_only" as const };
const invocation = (input: unknown = { schemaVersion: "verification-service-request.v1", useCase: "replayRun", request }) => ({
  operation: {} as never, claim: {} as never,
  activity: { schemaVersion: "knowledge-operation-request/v1" as const, kind: "verification_replay" as const, operationInput: input,
    expectedVersions: { verification: "verification.v1" }, context, step: { name: "hydrate_and_recompute", ordinal: 0 } },
}) as never;
const replayed = { runId: request.runId, manifestDigest: `sha256:${"1".repeat(64)}`, deterministicResultDigest: `sha256:${"2".repeat(64)}`,
  policyOutcome: "abstain" as const, replayedArtifactIds: [id(8), id(9)] };

function handler(options: { replay?: ReturnType<typeof vi.fn>; states?: string[]; fallback?: CanonicalActivityHandler } = {}) {
  const registerContentAddressedArtifact = vi.fn(async () => ({ artifactId: id(10) }));
  const states = [...(options.states ?? ["running", "running", "running"])];
  const getOperationRecord = vi.fn(async () => ({ status: states.shift() ?? "running" }));
  const replay = options.replay ?? vi.fn(async () => replayed);
  return { handler: verificationSealedReplayActivityHandler({ repository: { registerContentAddressedArtifact } as never, operations: { getOperationRecord } as never,
    replay: replay as never, storageBucket: "test", now: () => "2026-09-05T12:00:00.000Z", ...(options.fallback ? { fallback: options.fallback } : {}) }), registerContentAddressedArtifact, getOperationRecord, replay };
}

describe("sealed verification replay activity", () => {
  it("replays only the sealed trusted result and records a restricted compact operation result", async () => {
    const test = handler(); const output = await test.handler.execute(invocation()) as Record<string, unknown>;
    expect(test.replay).toHaveBeenCalledWith({ tenantId: context.tenantId, runId: request.runId, context });
    expect(test.getOperationRecord).toHaveBeenCalledTimes(3);
    expect(test.registerContentAddressedArtifact).toHaveBeenCalledWith(expect.objectContaining({ dataClassification: "restricted", artifactType: "deterministic_verification_result", parentArtifactIds: replayed.replayedArtifactIds }));
    expect(output).toMatchObject({ useCase: "replayRun", output: { result: { valid: true }, replayMatched: true, sourceRunId: request.runId,
      manifestDigest: replayed.manifestDigest, deterministicResultDigest: replayed.deterministicResultDigest, policyOutcome: "abstain" } });
  });

  it("uses the legacy extraction handler only for the dedicated sealed-run-not-found signal", async () => {
    const fallback = { operationKind: "verification_replay", stepName: "hydrate_and_recompute", execute: vi.fn(async () => ({ fallback: true })) } satisfies CanonicalActivityHandler;
    const test = handler({ replay: vi.fn(async () => { throw new Error("SEALED_REPLAY_RUN_NOT_FOUND"); }), fallback });
    await expect(test.handler.execute(invocation())).resolves.toEqual({ fallback: true });
    expect(fallback.execute).toHaveBeenCalledOnce(); expect(test.registerContentAddressedArtifact).not.toHaveBeenCalled();
  });

  it("does not fall back for an integrity or authorization failure", async () => {
    const fallback = { operationKind: "verification_replay", stepName: "hydrate_and_recompute", execute: vi.fn() } satisfies CanonicalActivityHandler;
    const test = handler({ replay: vi.fn(async () => { throw new Error("VERIFICATION_REPLAY_INTEGRITY_FAILURE"); }), fallback });
    await expect(test.handler.execute(invocation())).rejects.toMatchObject({ code: "VERIFICATION_REPLAY_INTEGRITY_FAILURE", retryable: false });
    expect(fallback.execute).not.toHaveBeenCalled(); expect(test.registerContentAddressedArtifact).not.toHaveBeenCalled();
  });

  it("rejects caller-controlled extras before replay and leaves no artifact", async () => {
    const test = handler();
    await expect(test.handler.execute(invocation({ schemaVersion: "verification-service-request.v1", useCase: "replayRun", request, raw: "caller-data" }))).rejects
      .toMatchObject({ code: "INVALID_VERIFICATION_REPLAY_INPUT", retryable: false });
    expect(test.replay).not.toHaveBeenCalled(); expect(test.registerContentAddressedArtifact).not.toHaveBeenCalled();
  });

  it("does not register after canonical cancellation arrives during replay", async () => {
    const test = handler({ states: ["running", "cancelled"] });
    await expect(test.handler.execute(invocation())).rejects.toMatchObject({ code: "VERIFICATION_OPERATION_NOT_ACTIVE", retryable: false });
    expect(test.replay).toHaveBeenCalledOnce(); expect(test.registerContentAddressedArtifact).not.toHaveBeenCalled();
  });

  it("scrubs an unrecognized replay failure into a retryable infrastructure code", async () => {
    const test = handler({ replay: vi.fn(async () => { throw new Error("credential=secret"); }) });
    const failure = await Promise.resolve(test.handler.execute(invocation())).catch((error: unknown) => error) as CanonicalActivityError;
    expect(failure).toMatchObject({ code: "VERIFICATION_REPLAY_INFRASTRUCTURE_FAILURE", retryable: true }); expect(String(failure)).not.toContain("secret");
  });
});
