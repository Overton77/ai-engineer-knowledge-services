import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { createVerificationSemanticReconciliationService } from "./verification-semantic-reconciliation-runtime.js";

const id = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const tenantId = id(1), operationId = id(2), providerAttemptId = id(3), actor = { kind: "service" as const, id: id(4), serviceIdentity: "mission_control_client" as const };
const digest = `sha256:${"a".repeat(64)}`;
const artifact = { artifactId: id(5), tenantId, digest, byteLength: 1, mediaType: "application/json", objectKey: "fixture", createdAt: "2026-09-07T00:00:00.000Z", producerActivityId: "fixture", producerVersion: "v1", encryptionClass: "tenant", retentionClass: "verification", dataClassification: "restricted" as const, parentArtifactIds: [], transformationSignature: digest };
const publicKeyPem = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
const environment = { VERIFICATION_SEMANTIC_PROVIDER_RECONCILIATION_GRANTS_JSON: JSON.stringify([{ tenantId, actor, operationId, providerAttemptId, keyId: "key.v1", operatorId: "operator.v1", executionMode: "synthetic_transport", billingEvidenceArtifact: artifact }]), VERIFICATION_PROVIDER_RECONCILIATION_PUBLIC_KEYS_JSON: JSON.stringify([{ keyId: "key.v1", publicKeyPem }]), VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON: JSON.stringify([{ tenantId, actor, missionId: id(6), agentDeploymentId: "worker", capabilityVersion: "verification-semantic.v1" }]), SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SECRET_KEY: "local-test-key" };

describe("semantic reconciliation runtime configuration and scope", () => {
  it("is disabled without grants and fails closed for incomplete configured trust", () => {
    expect(createVerificationSemanticReconciliationService(undefined, {})).toBeUndefined();
    expect(() => createVerificationSemanticReconciliationService(undefined, { VERIFICATION_SEMANTIC_PROVIDER_RECONCILIATION_GRANTS_JSON: environment.VERIFICATION_SEMANTIC_PROVIDER_RECONCILIATION_GRANTS_JSON })).toThrow("SEMANTIC_RECONCILIATION_STORAGE_KEYS_OWNERSHIP_REQUIRED");
  });

  it("denies wrong actor, operation, attempt, and host ownership before artifact hydration", async () => {
    const query = vi.fn(async (_sql: string, params?: unknown[]) => ({ rows: Array.isArray(params?.[2]) ? [] : [] }));
    const database = { transaction: async (_tenant: string, work: any) => work({ query }) };
    const service = createVerificationSemanticReconciliationService(database as never, environment)!;
    for (const input of [
      { tenantId, operationId, providerAttemptId, host: "claims" as const, actor: { ...actor, id: id(9) } },
      { tenantId, operationId: id(9), providerAttemptId, host: "claims" as const, actor },
      { tenantId, operationId, providerAttemptId: id(9), host: "claims" as const, actor },
      { tenantId, operationId, providerAttemptId, host: "report" as const, actor },
    ]) await expect(service.getDecision(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![1]?.[2]).toEqual(["verification_report"]);
  });
});
