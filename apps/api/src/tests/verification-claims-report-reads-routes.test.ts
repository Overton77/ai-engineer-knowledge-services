import { describe, expect, it } from "vitest";
import type { LocalApiIdentity } from "../auth.js";
import { buildServer } from "../server.js";

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const digest = (value: string) => `sha256:${value.repeat(64)}` as const;
const tenant = id(1),
  operationId = id(2),
  token = "claims-report-read-token";
const identity: LocalApiIdentity = {
  actor: {
    kind: "service",
    id: id(3),
    serviceIdentity: "mission_control_client",
  },
  grants: [{ tenantId: tenant, roles: ["knowledge_reader"], scopes: [] }],
};
const headers = {
  authorization: `Bearer ${token}`,
  "x-tenant-id": tenant,
  "x-correlation-id": "claims-report-read",
};
const claims = {
  verificationContractVersion: "verification.v1" as const,
  tenantId: tenant,
  operationId,
  useCase: "verifyClaims" as const,
  requestDigest: digest("a"),
  resultArtifact: { artifactId: id(4), digest: digest("b") },
  sealedRun: {
    runId: id(5),
    manifestDigest: digest("c"),
    manifestArtifact: { artifactId: id(6), digest: digest("d") },
    policyOutcome: "review" as const,
    policy: { availability: "unavailable" as const },
  },
  output: {
    mode: "deterministic_only" as const,
    deterministic: {
      status: "review_required" as const,
      semanticEligibility: false,
      capturesTotal: 1,
      capturesPassed: 1,
      assertionsTotal: 1,
      assertionsPassed: 1,
      metricsTotal: 0,
      metricsPassed: 0,
      failedCheckCodes: [],
      reviewReasons: ["POLICY_REVIEW"],
    },
    assertionsArtifact: { artifactId: id(7), digest: digest("e") },
  },
};
const report = {
  ...claims,
  useCase: "verifyReport" as const,
  output: {
    ...claims.output,
    reportArtifact: { artifactId: id(8), digest: digest("f") },
    claimLedgerArtifact: claims.output.assertionsArtifact,
    reportWide: {
      claimWeightedCitationCompleteness: 1,
      citationCorrectness: 1,
      validPointerConditionalCitationCorrectness: 1,
      pointerFailureCount: 0,
      misplacedCitationCount: 0,
      duplicateAssertionGroupCount: 0,
      conflictAssertionGroupCount: 0,
      missingQualifierCount: 0,
      consistencyMismatchGroupCount: 0,
      crossSectionMismatchCount: 0,
      independentSourceFamilyCount: 1,
      distinctSourceFamilyCount: 1,
      unsupportedHighSeverityCount: 0,
    },
    coverageScope: "producer_declared_assertions_only" as const,
    reportGateArtifact: { artifactId: id(9), digest: digest("1") },
  },
};
const base = {
  resolveIdentity: (candidate: string) =>
    candidate === token ? identity : undefined,
};

describe("claims/report terminal HTTP reads", () => {
  it.each([
    ["fail", ["SEMANTIC_HARD_FAILURE", "SEMANTIC_DISPOSITION_FAIL"]],
    ["review", ["SEMANTIC_REVIEW_REQUIRED"]],
  ] as const)(
    "preserves completed %s policy evidence without inventing an execution failure",
    async (outcome, reasonCodes) => {
      const completed = {
        ...claims,
        sealedRun: {
          ...claims.sealedRun,
          policyOutcome: outcome,
          policy: {
            availability: "verified" as const,
            outcome,
            reasonCodes: [...reasonCodes],
          },
        },
      };
      const server = buildServer({
        ...base,
        verificationClaimsReportReads: {
          getClaims: async () => completed,
          getReport: async () => report,
        },
      });
      try {
        const response = await server.inject({
          url: `/v1/verification/claims/${operationId}`,
          headers,
        });
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json().sealedRun.policy).toEqual(
          completed.sealedRun.policy,
        );
        expect(response.json()).not.toHaveProperty("failure");
      } finally {
        await server.close();
      }
    },
  );
  it.each([
    { outcome: "review", reasonCodes: ["INVENTED_SEMANTIC_FAILURE"] },
    { outcome: "fail", reasonCodes: ["SEMANTIC_DISPOSITION_FAIL"] },
  ])(
    "rejects invalid or contradictory policy evidence at the public boundary: %j",
    async (policy) => {
      const malformed = {
        ...claims,
        sealedRun: {
          ...claims.sealedRun,
          policy: { availability: "verified", ...policy },
        },
      };
      const server = buildServer({
        ...base,
        verificationClaimsReportReads: {
          getClaims: async () => malformed as never,
          getReport: async () => report,
        },
      });
      try {
        const response = await server.inject({
          url: `/v1/verification/claims/${operationId}`,
          headers,
        });
        expect(response.statusCode).toBe(503);
        expect(response.body).not.toContain("INVENTED_SEMANTIC_FAILURE");
      } finally {
        await server.close();
      }
    },
  );
  it("returns only strict family-specific resources under read authority", async () => {
    const server = buildServer({
      ...base,
      verificationClaimsReportReads: {
        getClaims: async () => claims,
        getReport: async () => report,
      },
    });
    try {
      expect(
        (
          await server.inject({
            url: `/v1/verification/claims/${operationId}`,
            headers,
          })
        ).json(),
      ).toEqual(claims);
      expect(
        (
          await server.inject({
            url: `/v1/verification/reports/${operationId}`,
            headers,
          })
        ).json(),
      ).toEqual(report);
      const malformed = buildServer({
        ...base,
        verificationClaimsReportReads: {
          getClaims: async () =>
            ({ ...claims, rawBundle: { secret: true } }) as never,
          getReport: async () => report,
        },
      });
      try {
        expect(
          (
            await malformed.inject({
              url: `/v1/verification/claims/${operationId}`,
              headers,
            })
          ).statusCode,
        ).toBe(503);
      } finally {
        await malformed.close();
      }
    } finally {
      await server.close();
    }
  });
  it.each(["claims", "reports"] as const)(
    "rejects a schema-valid foreign %s terminal resource",
    async (family) => {
      const foreign = {
        ...(family === "claims" ? claims : report),
        tenantId: id(99),
      };
      const server = buildServer({
        ...base,
        verificationClaimsReportReads: {
          getClaims: async () => foreign as never,
          getReport: async () => foreign as never,
        },
      });
      try {
        const response = await server.inject({
          url: `/v1/verification/${family}/${operationId}`,
          headers,
        });
        expect(response.statusCode).toBe(503);
        expect(response.body).not.toContain(id(99));
      } finally {
        await server.close();
      }
    },
  );
  it("maps unavailable and durable nonterminal states without returning an unverified body", async () => {
    const unavailable = buildServer(base);
    try {
      expect(
        (
          await unavailable.inject({
            url: `/v1/verification/claims/${operationId}`,
            headers,
          })
        ).statusCode,
      ).toBe(503);
    } finally {
      await unavailable.close();
    }
    const pending = buildServer({
      ...base,
      verificationClaimsReportReads: {
        getClaims: async () => {
          throw Object.assign(new Error("pending"), { code: "PENDING" });
        },
        getReport: async () => report,
      },
    });
    try {
      const response = await pending.inject({
        url: `/v1/verification/claims/${operationId}`,
        headers,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).not.toHaveProperty("output");
    } finally {
      await pending.close();
    }
  });
});
