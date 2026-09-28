import { describe, expect, it, vi } from "vitest";

import { KnowledgeClient } from "./client.js";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const digest = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const tenantId = id(1), operationId = id(2), providerAttemptId = id(3);
const context = { tenantId, correlationId: "semantic-reconciliation-client" };
const artifact = {
  artifactId: id(4), tenantId, digest: digest("a"), mediaType: "application/json", byteLength: 64,
  objectKey: "tenant/reconciliation", createdAt: "2026-09-07T00:00:00.000Z", producerActivityId: "fixture", producerVersion: "v1",
  encryptionClass: "managed", retentionClass: "audit", dataClassification: "restricted" as const, parentArtifactIds: [],
};
const result = { tenantId, operationId, providerAttemptId, artifact: { artifactId: artifact.artifactId, digest: artifact.digest }, actualCostMicros: 12, releasedReservationCostMicros: 20, appliedAt: "2026-09-07T01:00:00.000Z", redispatchAuthorized: false as const };

describe("semantic provider reconciliation client", () => {
  it("uses claims/report GET and POST routes with authenticated context headers and strict body", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
    });
    const client = new KnowledgeClient({ baseUrl: "https://knowledge.example", getAccessToken: () => "token", fetch });

    await expect(client.getSemanticProviderReconciliation("claims", operationId, providerAttemptId, context)).resolves.toEqual(result);
    await expect(client.applySemanticProviderReconciliation("report", operationId, providerAttemptId, { artifact }, context)).resolves.toEqual(result);

    expect(calls.map((call) => call.url)).toEqual([
      `https://knowledge.example/v1/verification/claims/${operationId}/provider-attempts/${providerAttemptId}/reconciliation`,
      `https://knowledge.example/v1/verification/reports/${operationId}/provider-attempts/${providerAttemptId}/reconciliation`,
    ]);
    expect(calls.map((call) => call.init?.method)).toEqual(["GET", "POST"]);
    expect(calls[0]?.init?.body).toBeUndefined();
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({ artifact });
    for (const call of calls) {
      const headers = new Headers(call.init?.headers);
      expect(headers.get("authorization")).toBe("Bearer token");
      expect(headers.get("x-tenant-id")).toBe(tenantId);
      expect(headers.get("x-correlation-id")).toBe(context.correlationId);
    }
  });

  it("rejects invalid host, UUID input, strict request, and malformed result before accepting a transport response", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ ...result, redispatchAuthorized: true }), { status: 200 }));
    const client = new KnowledgeClient({ baseUrl: "https://knowledge.example", fetch });

    expect(() => client.getSemanticProviderReconciliation("extractions" as never, operationId, providerAttemptId, context)).toThrow("INVALID_SEMANTIC_RECONCILIATION_HOST");
    expect(() => client.getSemanticProviderReconciliation("claims", "not-a-uuid", providerAttemptId, context)).toThrow();
    expect(() => client.applySemanticProviderReconciliation("report", operationId, providerAttemptId, { artifact: { ...artifact, artifactId: "bad" } }, context)).toThrow();
    await expect(client.getSemanticProviderReconciliation("claims", operationId, providerAttemptId, context)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

