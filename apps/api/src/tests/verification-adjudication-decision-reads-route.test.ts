import { describe, it, expect, vi } from "vitest";
import { buildServer } from "../server.js";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = {
  kind: "service" as const,
  id: id(3),
  serviceIdentity: "mission_control_client" as const,
};
const resource = {
  verificationContractVersion: "verification.v1" as const,
  tenantId: id(1),
  operationId: id(2),
  requestDigest: `sha256:${"a".repeat(64)}`,
  terminalFencingToken: 2,
  output: {
    schemaVersion: "verification-adjudication-decision-result.v1" as const,
    subjectId: id(4),
    packetArtifact: { artifactId: id(5), digest: `sha256:${"b".repeat(64)}` },
    decisionArtifact: { artifactId: id(6), digest: `sha256:${"c".repeat(64)}` },
    decision: "affirm" as const,
    reviewerProvenance: "synthetic_engineering" as const,
    quorum: {
      required: 2,
      humanAffirmRecorded: 0,
      humanRejectRecorded: 0,
      humanDeferRecorded: 0,
      syntheticAffirmRecorded: 1,
      reached: false,
    },
    admissionChanged: false as const,
    humanGoldScoringEligible: false as const,
  },
};
function fixture(allowed: boolean | undefined) {
  const read = vi.fn().mockResolvedValue(resource),
    authorize = vi.fn().mockResolvedValue(allowed);
  const server = buildServer({
    resolveIdentity: () => ({
      actor,
      grants: [{ tenantId: id(1), roles: ["knowledge_operator"], scopes: [] }],
    }),
    verificationAdjudicationDecisionReadService: { getDecision: read },
    ...(allowed === undefined
      ? {}
      : { isAdjudicationDecisionReadAdmitted: authorize }),
  });
  const send = () =>
    server.inject({
      method: "GET",
      url: `/v1/verification/adjudication-decisions/${id(2)}`,
      headers: { authorization: "Bearer test", "x-tenant-id": id(1) },
    });
  return { server, read, authorize, send };
}
describe("verified decision GET", () => {
  it("requires configured actor authorization before reading", async () => {
    for (const [allowed, status] of [
      [undefined, 503],
      [false, 404],
    ] as const) {
      const f = fixture(allowed);
      try {
        expect((await f.send()).statusCode).toBe(status);
        expect(f.read).not.toHaveBeenCalled();
      } finally {
        await f.server.close();
      }
    }
  });
  it("returns exact public projection for an authorized operation", async () => {
    const f = fixture(true);
    try {
      const response = await f.send();
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual(resource);
      expect(f.authorize).toHaveBeenCalledWith({
        tenantId: id(1),
        operationId: id(2),
        actor,
      });
    } finally {
      await f.server.close();
    }
  });
  it("rejects foreign projections and private fields with a fixed integrity response", async () => {
    for (const hostile of [
      { ...resource, tenantId: id(99) },
      { ...resource, operationId: id(99) },
      { ...resource, storageKey: "private-secret" },
    ]) {
      const f = fixture(true);
      f.read.mockResolvedValue(hostile);
      try {
        const response = await f.send();
        expect(response.statusCode).toBe(503);
        expect(response.body).not.toContain("private-secret");
        expect(response.body).not.toContain(id(99));
      } finally {
        await f.server.close();
      }
    }
  });
});
