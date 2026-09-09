import { describe, expect, it, vi } from "vitest";
import { PostgresSemanticProviderReconciliationReadRepository, SemanticProviderReconciliationReadError } from "./verification-semantic-reconciliation-read.js";

const tenantId = "10000000-0000-4000-8000-000000000001";
const id = (value: number) => `20000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const digest = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const artifact = (value: number) => ({ artifactId: id(value), tenantId, digest: digest(value.toString(16)), byteLength: 42, mediaType: "application/json", objectKey: `fixture/${value}`, createdAt: "2026-09-07T00:00:00.000Z", producerActivityId: "fixture", producerVersion: "v1", encryptionClass: "tenant", retentionClass: "verification", dataClassification: "restricted", parentArtifactIds: [], transformationSignature: digest("f") });

function fixture(patch: Record<string, unknown> = {}) {
  const receipt = { schemaVersion: "verification-semantic-provider-reconciliation.v1", tenantId, operationId: id(10), operationStepId: id(11), providerAttemptId: id(12), budgetId: id(13), host: "claims", providerId: "gateway", model: "semantic-v1", dispatchFence: id(14), dispatchLeaseToken: id(15), dispatchHolderIdentity: "worker", dispatchFencingToken: 1, requestDigest: digest("3"), profileArtifact: artifact(1), blindedInputArtifact: artifact(2), requestArtifact: artifact(3), billingEvidenceArtifact: artifact(4), originalState: "uncertain", reservationCostMicros: 100, decision: { action: "settle_original_attempt", actualCostMicros: 12, basis: "synthetic_fixture", redispatchAuthorized: false }, operatorId: "operator.v1", ticketId: "ticket-1", issuedAt: "2026-09-07T00:00:00.000Z", expiresAt: "2026-09-07T01:00:00.000Z", seal: { purpose: "provider_accounting_only", payloadDigest: digest("a"), signature: { algorithm: "Ed25519", keyId: "accounting-key.v1", signatureBase64: `${"A".repeat(86)}==` } } };
  const reconciliationArtifact = { ...artifact(20), digest: digest("b"), producerActivityId: "verification-service:semantic-provider-reconciliation", createdAt: receipt.issuedAt };
  const row = { body: receipt, artifact_id: reconciliationArtifact.artifactId, artifact_sha256: reconciliationArtifact.digest.slice(7), applied_at: "2026-09-07T00:30:00.000Z", state: "settled", actual_cost_micros: 12, reconciled_at: "2026-09-07T00:30:00.000Z", operation_kind: "verification_claims", ...patch };
  const query = vi.fn(async () => ({ rows: [row] }));
  const verifyEvidenceAt = vi.fn(async () => ({ receipt, artifact: reconciliationArtifact }));
  const resolver = { authorizeArtifact: vi.fn(async () => undefined), hydrateRegisteredArtifact: vi.fn(async () => ({ registration: reconciliationArtifact })) };
  const repository = new PostgresSemanticProviderReconciliationReadRepository({ transaction: async (_tenant: string, work: any) => work({ query }) } as never, { verifyEvidenceAt } as never, () => resolver as never);
  return { receipt, reconciliationArtifact, row, query, verifyEvidenceAt, resolver, repository };
}

describe("semantic provider reconciliation native read", () => {
  it("hydrates the exact ledger artifact, verifies at durable appliedAt, and repeats the native snapshot", async () => {
    const f = fixture();
    await expect(f.repository.loadAppliedDecision(tenantId, f.receipt.operationId, f.receipt.providerAttemptId)).resolves.toMatchObject({ artifact: { artifactId: f.reconciliationArtifact.artifactId, digest: f.reconciliationArtifact.digest }, actualCostMicros: 12, releasedReservationCostMicros: 100, appliedAt: "2026-09-07T00:30:00.000Z", redispatchAuthorized: false });
    expect(f.resolver.authorizeArtifact).toHaveBeenCalledWith({ tenantId, artifactId: f.reconciliationArtifact.artifactId, purpose: "verification_replay" });
    expect(f.verifyEvidenceAt).toHaveBeenCalledWith(expect.objectContaining({ tenantId, artifact: expect.objectContaining({ artifactId: f.reconciliationArtifact.artifactId, digest: f.reconciliationArtifact.digest }), appliedAt: "2026-09-07T00:30:00.000Z" }));
    expect(f.query).toHaveBeenCalledTimes(2);
  });

  it("fails closed for settled-ledger amount drift or resolved artifact identity drift", async () => {
    const amount = fixture({ actual_cost_micros: 13 });
    await expect(amount.repository.loadAppliedDecision(tenantId, amount.receipt.operationId, amount.receipt.providerAttemptId)).rejects.toEqual(expect.objectContaining({ code: "INTEGRITY" }));
    const identity = fixture(); identity.resolver.hydrateRegisteredArtifact.mockResolvedValue({ registration: { ...identity.reconciliationArtifact, digest: digest("c") } });
    await expect(identity.repository.loadAppliedDecision(tenantId, identity.receipt.operationId, identity.receipt.providerAttemptId)).rejects.toBeInstanceOf(SemanticProviderReconciliationReadError);
    expect(identity.verifyEvidenceAt).not.toHaveBeenCalled();
  });

  it("rejects a null native cost even when a zero-cost receipt would otherwise coerce equally", async () => {
    const f = fixture(); f.receipt.decision.actualCostMicros = 0; f.row.actual_cost_micros = null as never;
    await expect(f.repository.loadAppliedDecision(tenantId, f.receipt.operationId, f.receipt.providerAttemptId)).rejects.toEqual(expect.objectContaining({ code: "INTEGRITY" }));
    expect(f.verifyEvidenceAt).not.toHaveBeenCalled();
  });
});
