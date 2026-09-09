import { describe, expect, it } from "vitest";
import { z } from "zod";

import { VerificationSemanticProviderReconciliationSchema } from "./semantic-provider-reconciliation.js";

const tenantId = "10000000-0000-4000-8000-000000000001";
const uuid = (value: number) => `20000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const digest = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as const;
type Input = z.input<typeof VerificationSemanticProviderReconciliationSchema>;

const artifact = (number: number): Input["profileArtifact"] => ({
  artifactId: uuid(number), tenantId, digest: digest(number.toString(16)), byteLength: 42,
  mediaType: "application/json", objectKey: `verification/fixture/${number}`,
  createdAt: "2026-09-07T00:00:00.000Z", producerActivityId: "fixture", producerVersion: "v1",
  encryptionClass: "tenant", retentionClass: "verification", dataClassification: "restricted",
  parentArtifactIds: [], transformationSignature: digest("f"),
});



const valid = (): Input => ({
  schemaVersion: "verification-semantic-provider-reconciliation.v1" as const,
  tenantId, operationId: uuid(10), operationStepId: uuid(11), providerAttemptId: uuid(12), budgetId: uuid(13),
  host: "claims" as const, providerId: "gateway" as const, model: "semantic-v1",
  dispatchFence: uuid(14), dispatchLeaseToken: uuid(15), dispatchHolderIdentity: "verification-worker",
  dispatchFencingToken: 1, requestDigest: artifact(3).digest,
  profileArtifact: artifact(1), blindedInputArtifact: artifact(2), requestArtifact: artifact(3), billingEvidenceArtifact: artifact(4),
  originalState: "uncertain" as const, reservationCostMicros: 100,
  decision: { action: "settle_original_attempt" as const, actualCostMicros: 0, basis: "synthetic_fixture" as const, redispatchAuthorized: false as const },
  operatorId: "accounting-operator.v1", ticketId: "ticket-1", issuedAt: "2026-09-07T00:00:00.000Z", expiresAt: "2026-09-07T01:00:00.000Z",
  seal: { purpose: "provider_accounting_only" as const, payloadDigest: digest("a"), signature: { algorithm: "Ed25519" as const, keyId: "accounting-key.v1", signatureBase64: `${"A".repeat(86)}==` } },
});

describe("semantic provider reconciliation contract", () => {
  it("accepts the three custody states", () => {
    const noCapture = valid();
    const captureOnly = valid(); captureOnly.capture = { transportArtifact: artifact(5), responseEnvelopeArtifact: artifact(6), rawResponseArtifact: artifact(7) };
    const capturedObservation = valid(); capturedObservation.capture = { transportArtifact: artifact(5), responseEnvelopeArtifact: artifact(6), rawResponseArtifact: artifact(7) }; capturedObservation.observationArtifact = artifact(8);
    for (const value of [noCapture, captureOnly, capturedObservation]) expect(VerificationSemanticProviderReconciliationSchema.safeParse(value).success).toBe(true);
  });

  it("does not permit redispatch or an orphaned observation", () => {
    const redispatch = valid(); redispatch.decision.redispatchAuthorized = true as never;
    const orphanedObservation = valid(); orphanedObservation.observationArtifact = artifact(8);
    expect(VerificationSemanticProviderReconciliationSchema.safeParse(redispatch).success).toBe(false);
    expect(VerificationSemanticProviderReconciliationSchema.safeParse(orphanedObservation).success).toBe(false);
  });

  it("rejects tenant drift and duplicate artifact roles", () => {
    const wrongTenant = valid(); wrongTenant.profileArtifact.tenantId = uuid(99);
    const duplicate = valid(); duplicate.billingEvidenceArtifact = duplicate.profileArtifact;
    expect(VerificationSemanticProviderReconciliationSchema.safeParse(wrongTenant).success).toBe(false);
    expect(VerificationSemanticProviderReconciliationSchema.safeParse(duplicate).success).toBe(false);
  });

  it("requires canonical bounded times and costs", () => {
    const nonCanonical = valid(); nonCanonical.issuedAt = "2026-09-07T00:00:00Z";
    const stale = valid(); stale.expiresAt = "2026-09-08T00:00:00.001Z";
    const reservation = valid(); reservation.reservationCostMicros = 0;
    const actual = valid(); actual.decision.actualCostMicros = 20_000_001;
    for (const value of [nonCanonical, stale, reservation, actual]) expect(VerificationSemanticProviderReconciliationSchema.safeParse(value).success).toBe(false);
  });
});




