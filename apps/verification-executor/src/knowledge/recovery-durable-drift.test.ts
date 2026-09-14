import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { VerificationArtifactHandle } from "@aiengineer/knowledge-contracts";
import { sha256Digest } from "@aiengineer/knowledge-verification";
import { ingestDurableRecoveryDrift } from "./recovery-durable-drift.js";

function fixture() {
  const tenantId = randomUUID(), artifactId = randomUUID(), outboxId = randomUUID();
  const bytes = new TextEncoder().encode('{"schemaVersion":"drift-fixture.v1"}');
  const digest = sha256Digest(bytes);
  const artifact: VerificationArtifactHandle = { tenantId, artifactId, digest, byteLength: bytes.byteLength,
    mediaType: "application/json", objectKey: `${tenantId}/${digest.slice(7, 9)}/${digest.slice(7)}`,
    createdAt: new Date().toISOString(), producerActivityId: "drift-proof", producerVersion: "v1",
    encryptionClass: "filesystem-plain", retentionClass: "experiment", dataClassification: "internal", parentArtifactIds: [] };
  const events: string[] = [];
  const notifications = new Set<string>();
  const notificationOwners = new Map<string, string>();
  let failPersist = true, loseAck = false;
  const input: Parameters<typeof ingestDurableRecoveryDrift>[0] = {
    tenantId, holderIdentity: "recovery-proof", limit: 2, visibilityTimeoutMs: 1000,
    outbox: {
      async claim() { return [{ id: outboxId, observationArtifactId: artifactId, sourceOperationId: randomUUID(), claimToken: "original-claim" }]; },
      async ack() { events.push("ack"); if (loseAck) throw new Error("ACK_LOST"); },
    } as unknown as Parameters<typeof ingestDurableRecoveryDrift>[0]["outbox"],
    custody: { async lookup() { return artifact; }, async register() { throw new Error("unused"); }, async resolve() { return { handle: artifact, bytes }; } },
    recovery: {
      async ingestDrift(_tenantId, request) {
        events.push(`persist:${request.caseId}`);
        if (failPersist && request.caseId === "second") throw new Error("DB_UNAVAILABLE");
        const owner = notificationOwners.get(request.notificationId);
        if (owner && owner !== request.caseId) throw new Error("CROSS_CASE_NOTIFICATION_CONFLICT");
        notificationOwners.set(request.notificationId, request.caseId);
        notifications.add(`${request.caseId}:${request.notificationId}`);
        return {} as never;
      },
    },
    async caseIdsForObservation() { return ["first", "second"]; },
  };
  return { input, events, notifications, artifact, recover() { failPersist = false; }, loseAck() { loseAck = true; } };
}

describe("existing drift outbox to durable recovery case custody", () => {
  it("retains the original notification identity across partial case persistence and acknowledgment loss", async () => {
    const state = fixture();
    await expect(ingestDurableRecoveryDrift(state.input)).rejects.toThrow("DB_UNAVAILABLE");
    expect(state.events).toEqual(["persist:first", "persist:second"]);
    state.recover(); state.loseAck();
    await expect(ingestDurableRecoveryDrift(state.input)).rejects.toThrow("ACK_LOST");
    await expect(ingestDurableRecoveryDrift(state.input)).rejects.toThrow("ACK_LOST");
    expect(state.notifications.size).toBe(2);
    expect(state.events.slice(-3)).toEqual(["persist:first", "persist:second", "ack"]);
  });

  it("leaves unmapped and unavailable observations unacknowledged", async () => {
    const state = fixture();
    expect(await ingestDurableRecoveryDrift({ ...state.input, async caseIdsForObservation() { return []; } })).toEqual({ acknowledged: 0, unmapped: 1 });
    await expect(ingestDurableRecoveryDrift({ ...state.input, custody: { ...state.input.custody, async resolve() { return undefined; } } })).rejects.toThrow("OBSERVATION_UNAVAILABLE");
    expect(state.events).toEqual([]);
  });

  it("rejects a foreign tenant observation before the first case write", async () => {
    const state = fixture();
    state.artifact.tenantId = randomUUID();
    await expect(ingestDurableRecoveryDrift(state.input)).rejects.toThrow("ARTIFACT_TENANT_MISMATCH");
    expect(state.events).toEqual([]);
  });

  it("rejects resolver aliasing before acknowledging a different observation", async () => {
    const state = fixture();
    const resolve = state.input.custody.resolve;
    state.input.custody.resolve = async id => {
      const stored = (await resolve(id))!;
      return { ...stored, handle: { ...stored.handle, artifactId: randomUUID() } };
    };
    await expect(ingestDurableRecoveryDrift(state.input)).rejects.toThrow("OBSERVATION_IDENTITY_MISMATCH");
    expect(state.events).toEqual([]);
  });
});
