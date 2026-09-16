import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../server.js";
const tenant = "11111111-1111-4111-8111-111111111111",
  otherTenant = "99999999-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  token = "x".repeat(16),
  headers = { authorization: `Bearer ${token}`, "x-tenant-id": tenant };
const resolve =
  (
    actor: unknown,
    scopes: readonly string[] = ["verification.drift.consume"],
    grantTenant = tenant,
  ) =>
  (candidate: string) =>
    candidate === token
      ? ({
          actor,
          grants: [{ tenantId: grantTenant, roles: [], scopes }],
        } as any)
      : undefined;
const queue = (extra: Record<string, unknown> = {}) => ({
  serviceIdentities: ["mission_control_client"] as const,
  scan: vi.fn().mockResolvedValue({ planned: 1, alreadyPlanned: 0 }),
  claim: vi
    .fn()
    .mockResolvedValue([
      {
        id,
        observationArtifactId: id,
        sourceOperationId: id,
        dimensions: ["model"],
        disposition: "review_required",
        reviewReason: "MODEL_DRIFT_REVIEW_REQUIRED",
        claimToken: id,
        ...extra,
      },
    ]),
  ack: vi.fn().mockResolvedValue(undefined),
  listAlerts: vi
    .fn()
    .mockResolvedValue([
      {
        id,
        observationArtifactId: id,
        sourceOperationId: id,
        dimensions: ["model"],
        reviewReason: "MODEL_DRIFT_REVIEW_REQUIRED",
        publishedAt: "2026-09-08T00:00:00.000Z",
        ...extra,
      },
    ]),
});
const service = {
  kind: "service",
  id,
  serviceIdentity: "mission_control_client",
} as const;
describe("internal drift revalidation routes", () => {
  it("requires an explicit tenant scope even for an allowlisted admin service", async () => {
    const q = queue();
    const api = buildServer({
      resolveIdentity: () => ({
        actor: service,
        grants: [{ tenantId: tenant, roles: ["knowledge_admin"], scopes: [] }],
      }),
      verificationDriftRevalidation: q,
    });
    try {
      const result = await api.inject({
        method: "POST",
        url: "/v1/internal/verification/drift-revalidations/scan",
        headers,
        payload: { limit: 1 },
      });
      expect(result.statusCode).toBe(403);
      expect(q.scan).not.toHaveBeenCalled();
    } finally {
      await api.close();
    }
  });
  it("is disabled without composition", async () => {
    const api = buildServer({ resolveIdentity: resolve(service) });
    expect(
      (
        await api.inject({
          method: "POST",
          url: "/v1/internal/verification/drift-revalidations/scan",
          headers,
          payload: { limit: 1 },
        })
      ).statusCode,
    ).toBe(503);
    await api.close();
  });
  it("projects scan, claim, ack and durable alert inbox DTOs", async () => {
    const q = queue({ secret: "must-not-leak" }),
      api = buildServer({
        resolveIdentity: resolve(service),
        verificationDriftRevalidation: q,
      });
    const scan = await api.inject({
      method: "POST",
      url: "/v1/internal/verification/drift-revalidations/scan",
      headers,
      payload: { limit: 1 },
    });
    expect(scan.json()).toEqual({ planned: 1, alreadyPlanned: 0 });
    const claim = await api.inject({
      method: "POST",
      url: "/v1/internal/verification/drift-revalidations/claim",
      headers,
      payload: { limit: 1, visibilityTimeoutMs: 1000 },
    });
    expect(claim.json()).toEqual({
      items: [
        {
          id,
          observationArtifactId: id,
          sourceOperationId: id,
          dimensions: ["model"],
          disposition: "review_required",
          reviewReason: "MODEL_DRIFT_REVIEW_REQUIRED",
          claimToken: id,
        },
      ],
    });
    expect(claim.body).not.toContain("secret");
    const ack = await api.inject({
      method: "POST",
      url: "/v1/internal/verification/drift-revalidations/ack",
      headers,
      payload: { id, claimToken: id },
    });
    expect(ack.json()).toEqual({ acknowledged: true });
    expect(q.ack).toHaveBeenCalledWith({
      tenantId: tenant,
      owner: "mission_control_client",
      id,
      claimToken: id,
    });
    const inbox = await api.inject({
      method: "GET",
      url: "/v1/internal/verification/drift-alerts?limit=1",
      headers,
    });
    expect(inbox.json()).toEqual({
      items: [
        {
          id,
          observationArtifactId: id,
          sourceOperationId: id,
          dimensions: ["model"],
          reviewReason: "MODEL_DRIFT_REVIEW_REQUIRED",
          publishedAt: "2026-09-08T00:00:00.000Z",
        },
      ],
    });
    await api.close();
  });
  it("fails closed for missing scope, wrong tenant, actor and malformed/injected bodies", async () => {
    const q = queue();
    for (const [actor, scopes, requestHeaders, payload, status] of [
      [service, [], headers, { limit: 1 }, 403],
      [
        service,
        ["verification.drift.consume"],
        { ...headers, "x-tenant-id": otherTenant },
        { limit: 1 },
        403,
      ],
      [
        { kind: "human", id },
        ["verification.drift.consume"],
        headers,
        { limit: 1 },
        403,
      ],
      [service, ["verification.drift.consume"], headers, { limit: 101 }, 400],
      [
        service,
        ["verification.drift.consume"],
        headers,
        { limit: 1, owner: "injected" },
        400,
      ],
      [
        service,
        ["verification.drift.consume"],
        headers,
        { limit: 1, visibilityTimeoutMs: 1000, claimToken: id },
        400,
      ],
    ] as const) {
      const api = buildServer({
        resolveIdentity: resolve(
          actor,
          scopes,
          requestHeaders["x-tenant-id"] === otherTenant ? tenant : tenant,
        ),
        verificationDriftRevalidation: q,
      });
      const result = await api.inject({
        method: "POST",
        url: "/v1/internal/verification/drift-revalidations/scan",
        headers: requestHeaders,
        payload,
      });
      expect(result.statusCode).toBe(status);
      await api.close();
    }
    expect(q.scan).not.toHaveBeenCalled();
  });
  it("rejects malformed runtime output without emitting extra fields", async () => {
    const api = buildServer({
      resolveIdentity: resolve(service),
      verificationDriftRevalidation: queue({ disposition: "revalidate" }),
    });
    const result = await api.inject({
      method: "POST",
      url: "/v1/internal/verification/drift-revalidations/claim",
      headers,
      payload: { limit: 1, visibilityTimeoutMs: 1000 },
    });
    expect(result.statusCode).toBe(400);
    expect(result.body).not.toContain("secret");
    await api.close();
  });
});
