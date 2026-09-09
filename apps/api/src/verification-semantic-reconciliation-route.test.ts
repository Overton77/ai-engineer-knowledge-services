import { describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";

const id = (value: number) => `20000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const tenantId = id(1), operationId = id(2), providerAttemptId = id(3), actor = { kind: "service" as const, id: id(4), serviceIdentity: "mission_control_client" as const };
const headers = { authorization: "Bearer semantic-route-test", "x-tenant-id": tenantId, "x-correlation-id": "semantic-route", "idempotency-key": "semantic-route-key" };
const digest = `sha256:${"a".repeat(64)}`;
const artifact = { artifactId: id(5), tenantId, digest, byteLength: 1, mediaType: "application/json", objectKey: "fixture", createdAt: "2026-09-07T00:00:00.000Z", producerActivityId: "fixture", producerVersion: "v1", encryptionClass: "tenant", retentionClass: "verification", dataClassification: "restricted", parentArtifactIds: [], transformationSignature: digest };
const resource = { tenantId, operationId, providerAttemptId, artifact: { artifactId: artifact.artifactId, digest }, actualCostMicros: 0, releasedReservationCostMicros: 1, appliedAt: "2026-09-07T00:30:00.000Z", redispatchAuthorized: false as const };
const resolveIdentity = () => ({ actor, grants: [{ tenantId, roles: ["knowledge_operator" as const], scopes: [] }] });

describe("semantic claims/report reconciliation routes", () => {
  it("keeps semantic service host-scoped and validates its compact result", async () => {
    const getDecision = vi.fn(async (input) => { expect(input).toMatchObject({ tenantId, operationId, providerAttemptId, actor }); return resource; });
    const applyDecision = vi.fn(async (input) => { expect(input).toMatchObject({ tenantId, operationId, providerAttemptId, host: "claims", actor, artifact }); return resource; });
    const api = buildServer({ resolveIdentity, verificationSemanticReconciliation: { getDecision, applyDecision } as never });
    try {
      for (const path of ["claims", "reports"]) expect((await api.inject({ method: "GET", url: `/v1/verification/${path}/${operationId}/provider-attempts/${providerAttemptId}/reconciliation`, headers })).statusCode).toBe(200);
      expect(getDecision.mock.calls.map(([input]) => input.host)).toEqual(["claims", "report"]);
      const posted = await api.inject({ method: "POST", url: `/v1/verification/claims/${operationId}/provider-attempts/${providerAttemptId}/reconciliation`, headers, payload: { artifact } });
      expect(posted.statusCode).toBe(200); expect(posted.json()).toEqual(resource);
      const malformed = await api.inject({ method: "POST", url: `/v1/verification/claims/${operationId}/provider-attempts/${providerAttemptId}/reconciliation`, headers, payload: { artifact, context: { actor: { kind: "human", id: id(9) } } } });
      expect(malformed.statusCode).toBe(400); expect(applyDecision).toHaveBeenCalledOnce();
    } finally { await api.close(); }
  });

  it("rejects a schema-valid reconciliation result outside the route scope", async () => {
    const api = buildServer({ resolveIdentity, verificationSemanticReconciliation: { getDecision: async () => ({ ...resource, providerAttemptId: id(99) }), applyDecision: async () => resource } as never });
    try { const response=await api.inject({ method: "GET", url: `/v1/verification/claims/${operationId}/provider-attempts/${providerAttemptId}/reconciliation`, headers }); expect(response.statusCode).toBe(503); expect(response.body).not.toContain(id(99)); } finally { await api.close(); }
  });

  it("returns capability unavailable without changing extraction reconciliation behavior", async () => {
    const api = buildServer({ resolveIdentity });
    try {
      const semantic = await api.inject({ method: "GET", url: `/v1/verification/claims/${operationId}/provider-attempts/${providerAttemptId}/reconciliation`, headers });
      const extraction = await api.inject({ method: "GET", url: `/v1/verification/extractions/${operationId}/provider-attempts/${providerAttemptId}/reconciliation`, headers });
      expect(semantic.statusCode).toBe(503); expect(semantic.json()).toMatchObject({ code: "CAPABILITY_NOT_ADMITTED" });
      expect(extraction.statusCode).toBe(503); expect(extraction.json()).toMatchObject({ code: "CAPABILITY_NOT_ADMITTED" });
    } finally { await api.close(); }
  });
});
