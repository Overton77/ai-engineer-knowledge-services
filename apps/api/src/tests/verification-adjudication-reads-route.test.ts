import { describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
const id = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  tenant = id(1),
  operationId = id(2),
  actor = {
    kind: "service" as const,
    id: id(3),
    serviceIdentity: "mission_control_client" as const,
  };
const headers = {
  authorization: "Bearer test",
  "x-tenant-id": tenant,
  "x-correlation-id": "adjudication-read",
  "idempotency-key": "adjudication-read-key",
};
const value = {
  verificationContractVersion: "verification.v1" as const,
  tenantId: tenant,
  operationId,
  requestDigest: `sha256:${"a".repeat(64)}`,
  packetArtifact: { artifactId: id(4), digest: `sha256:${"b".repeat(64)}` },
  output: {
    subjectId: id(5),
    status: "pending_human_adjudication" as const,
    target: {
      kind: "run" as const,
      runId: id(6),
      objectDigest: `sha256:${"c".repeat(64)}`,
    },
    reason: "appeal" as const,
    reviewRequirements: {
      eligibleReviewerRoles: ["expert"],
      quorumRequired: 1,
    },
    originalPolicyOutcome: "review" as const,
    source: {
      runKind: "claims" as const,
      runId: id(6),
      manifestArtifact: {
        artifactId: id(7),
        digest: `sha256:${"d".repeat(64)}`,
      },
      manifestDigest: `sha256:${"e".repeat(64)}`,
      bundleArtifact: { artifactId: id(8), digest: `sha256:${"f".repeat(64)}` },
      deterministicResultArtifact: {
        artifactId: id(9),
        digest: `sha256:${"1".repeat(64)}`,
      },
      policyDecisionArtifact: {
        artifactId: id(10),
        digest: `sha256:${"2".repeat(64)}`,
      },
    },
    proof: {
      payloadDigest: `sha256:${"3".repeat(64)}`,
      signatureStatus: "verified" as const,
      deterministicReplay: "exact" as const,
      policyReplay: "exact" as const,
      terminalFencingToken: 1,
    },
    humanDecisionRecorded: false as const,
    admissionChanged: false as const,
  },
};
const options = (
  read?: any,
  identity: any = () => ({
    actor,
    grants: [{ tenantId: tenant, roles: ["knowledge_operator"], scopes: [] }],
  }),
) => ({
  resolveIdentity: identity,
  ...(read
    ? { verificationAdjudicationReadService: { getPendingSubject: read } }
    : {}),
});
describe("adjudication terminal read", () => {
  it("rejects a schema-valid foreign terminal projection", async () => {
    const s = buildServer(
      options(async () => ({ ...value, tenantId: id(99) })),
    );
    try {
      const response = await s.inject({
        method: "GET",
        url: `/v1/verification/adjudications/${operationId}`,
        headers,
      });
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toContain(id(99));
    } finally {
      await s.close();
    }
  });
  it("fails closed and maps bounded terminal states", async () => {
    for (const [read, status] of [
      [undefined, 503],
      [
        async () => {
          throw Object.assign(new Error(), { code: "NOT_FOUND" });
        },
        404,
      ],
      [
        async () => {
          throw Object.assign(new Error(), { code: "PENDING" });
        },
        409,
      ],
      [
        async () => {
          throw Object.assign(new Error(), { code: "CANCELLED" });
        },
        422,
      ],
      [
        async () => {
          throw new Error();
        },
        503,
      ],
    ] as const) {
      const s = buildServer(options(read));
      try {
        expect(
          (
            await s.inject({
              method: "GET",
              url: `/v1/verification/adjudications/${operationId}`,
              headers,
            })
          ).statusCode,
        ).toBe(status);
      } finally {
        await s.close();
      }
    }
  });
  it("requires actor access and returns only the strict projection", async () => {
    const read = async (input: any) => {
      expect(input).toMatchObject({ tenantId: tenant, operationId, actor });
      return value;
    };
    const s = buildServer(options(read));
    try {
      const ok = await s.inject({
        method: "GET",
        url: `/v1/verification/adjudications/${operationId}`,
        headers,
      });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json()).toEqual(value);
      expect(
        (
          await s.inject({
            method: "GET",
            url: `/v1/verification/adjudications/${operationId}?x=1`,
            headers,
          })
        ).statusCode,
      ).toBe(400);
      const denied = buildServer(options(read, () => undefined));
      try {
        expect(
          (
            await denied.inject({
              method: "GET",
              url: `/v1/verification/adjudications/${operationId}`,
              headers,
            })
          ).statusCode,
        ).toBe(401);
      } finally {
        await denied.close();
      }
    } finally {
      await s.close();
    }
  });
});
