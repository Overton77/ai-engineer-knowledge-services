import { describe, expect, it } from "vitest";
import { KnowledgeIntegrationService } from "@aiengineer/knowledge-application";
import { buildServer } from "../server.js";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = id(1),
  actor = {
    kind: "service" as const,
    id: id(2),
    serviceIdentity: "mission_control_client" as const,
  };
const identity = {
  actor,
  grants: [
    { tenantId: tenant, roles: ["knowledge_operator" as const], scopes: [] },
  ],
};
const headers = {
  authorization: "Bearer adjudication-test-token",
  "x-tenant-id": tenant,
  "x-correlation-id": "adjudication-route",
  "idempotency-key": "adjudication-route-001",
};
const request = {
  verificationContractVersion: "verification.v1",
  target: { kind: "assertion", assertionId: "assertion-1" },
  reason: "appeal",
  evidencePacket: { artifactId: id(3), digest: `sha256:${"a".repeat(64)}` },
};
const context = ({
  tenantId,
  identity,
  correlationId,
  idempotencyKey,
}: any) => ({
  tenantId,
  operationId: id(4),
  attemptId: id(5),
  correlationId,
  actor: identity.actor,
  capabilityVersion: "verification-service.v1",
  idempotencyKey,
  reason: "adjudication route test",
  contractVersion: "v1" as const,
});

describe("requestAdjudication HTTP route", () => {
  it("fails closed without a configured exact grant and only enqueues the admitted strict request", async () => {
    const unavailableOps = new KnowledgeIntegrationService(),
      unavailable = buildServer({
        verificationOperationService: unavailableOps,
        resolveIdentity: () => identity,
        resolveVerificationContext: context,
      });
    try {
      expect(
        (
          await unavailable.inject({
            method: "POST",
            url: "/v1/verification/adjudications:request",
            headers,
            payload: request,
          })
        ).statusCode,
      ).toBe(503);
      expect(unavailableOps.get(id(4), tenant)).toBeUndefined();
    } finally {
      await unavailable.close();
    }
    const deniedOps = new KnowledgeIntegrationService(),
      denied = buildServer({
        verificationOperationService: deniedOps,
        resolveIdentity: () => identity,
        resolveVerificationContext: context,
        isAdjudicationRequestAdmitted: () => false,
      });
    try {
      expect(
        (
          await denied.inject({
            method: "POST",
            url: "/v1/verification/adjudications:request",
            headers,
            payload: request,
          })
        ).statusCode,
      ).toBe(403);
      expect(deniedOps.get(id(4), tenant)).toBeUndefined();
    } finally {
      await denied.close();
    }
    const admittedOps = new KnowledgeIntegrationService(),
      admitted = buildServer({
        verificationOperationService: admittedOps,
        resolveIdentity: () => identity,
        resolveVerificationContext: context,
        isAdjudicationRequestAdmitted: (candidate, input) =>
          candidate === tenant && input.evidencePacket.artifactId === id(3),
      });
    try {
      expect(
        (
          await admitted.inject({
            method: "POST",
            url: "/v1/verification/adjudications:request",
            headers,
            payload: { ...request, reviewerRole: "caller" },
          })
        ).statusCode,
      ).toBe(400);
      const response = await admitted.inject({
        method: "POST",
        url: "/v1/verification/adjudications:request",
        headers,
        payload: request,
      });
      expect(response.statusCode, response.body).toBe(202);
      expect(admittedOps.get(id(4), tenant)).toMatchObject({
        kind: "verification_adjudication",
        context: { actor },
      });
      expect(admittedOps.input(id(4), tenant)).toEqual({
        schemaVersion: "verification-service-request.v1",
        useCase: "requestAdjudication",
        request,
      });
    } finally {
      await admitted.close();
    }
  });
});
