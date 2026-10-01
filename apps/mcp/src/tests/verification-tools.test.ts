import { describe, expect, it, vi } from "vitest";
import {
  createVerificationResourceReads,
  type VerificationContextResolutionInput,
} from "@aiengineer/knowledge-application";
import { createClaimsReportReadMcpExecutor, createVerificationMcpToolExecutor } from "../index.js";

// Submissions run in process: trusted ownership resolves the context, the shared
// admission gates admit the request, and the application service enqueues it.
const admitAll = {
  isParseArtifactRequestAdmitted: () => true,
  isStructuredExtractionRequestAdmitted: () => true,
  isBenchmarkRequestAdmitted: () => true,
  isBenchmarkComparisonRequestAdmitted: () => true,
  isClaimsRequestAdmitted: () => true,
  isAuditInspectionRequestAdmitted: () => true,
  isAdjudicationRequestAdmitted: () => true,
};
function inProcess(submissions: Record<string, ReturnType<typeof vi.fn>>, grantTenant = tenant) {
  const resolveVerificationContext = vi.fn((input: VerificationContextResolutionInput) => ({
    tenantId: input.tenantId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    operationId: id(90),
    attemptId: input.hints.attemptId ?? id(91),
    ...(input.hints.missionId ? { missionId: input.hints.missionId } : {}),
    ...(input.hints.workItemId ? { workItemId: input.hints.workItemId } : {}),
    actor,
    capabilityVersion: "verification-service.v1",
    reason: "mcp verification test",
    contractVersion: "v1" as const,
  }));
  const execute = createVerificationMcpToolExecutor({
    operationService: {} as never,
    apiOrigin: "https://knowledge.example",
    identity: {
      actor,
      grants: [{ tenantId: grantTenant, roles: ["knowledge_operator"], scopes: [] }],
    },
    verificationOperations: submissions as never,
    resolveVerificationContext,
    verificationAdmission: admitAll,
  });
  return { execute, resolveVerificationContext };
}
const queued = (operationId: string) => vi.fn(async () => ({ operationId, state: "queued" }));
const bound = (value: Record<string, unknown> = context) =>
  expect.objectContaining({ ...value, actor, operationId: id(90) });

describe("metric MCP adapter", () => {
  it("submits comparison references in process and rejects caller inference", async () => {
    const submitCompareBenchmarkRuns = queued(id(80)),
      { execute } = inProcess({ submitCompareBenchmarkRuns });
    const request = {
      verificationContractVersion: "verification.v1",
      baselineRunId: id(81),
      candidateRunId: id(82),
      comparisonProfile: "paired_default",
    };
    await expect(execute("verify_benchmark_compare", { context, request })).resolves.toMatchObject({
      structuredContent: { operationId: id(80) },
    });
    expect(submitCompareBenchmarkRuns).toHaveBeenCalledWith(request, bound());
    await expect(
      execute("verify_benchmark_compare", {
        context,
        request: { ...request, statistics: {} },
      }),
    ).rejects.toThrow();
    expect(submitCompareBenchmarkRuns).toHaveBeenCalledTimes(1);
  });
  it("routes offline benchmarks and rejects caller checkpoint plans", async () => {
    const submitRunBenchmark = queued(id(8)),
      { execute } = inProcess({ submitRunBenchmark });
    const request = {
      verificationContractVersion: "verification.v1",
      dataset: { artifactId: id(12), digest: `sha256:${"3".repeat(64)}` },
      experimentDefinition: {
        artifactId: id(13),
        digest: `sha256:${"4".repeat(64)}`,
      },
      executionMode: "offline_recorded",
    };
    await expect(execute("verify_benchmark_run", { context, request })).resolves.toMatchObject({
      structuredContent: { operationId: id(8) },
    });
    expect(submitRunBenchmark).toHaveBeenCalledWith(request, bound());
    await expect(
      execute("verify_benchmark_run", {
        context,
        request: { ...request, checkpointPlan: [] },
      }),
    ).rejects.toThrow();
    expect(submitRunBenchmark).toHaveBeenCalledTimes(1);
  });
  it("forwards metric routing hints to trusted ownership and rejects synthesized findings", async () => {
    const submitVerifyMetricObservation = queued(id(8)),
      { execute, resolveVerificationContext } = inProcess({
        submitVerifyMetricObservation,
      });
    const hints = { missionId: id(9), workItemId: id(10), attemptId: id(11) };
    const metricContext = { ...context, ...hints };
    const metricRequest = {
      verificationContractVersion: "verification.v1",
      captureIds: ["capture-1"],
      observations: { artifactId: id(12), digest: `sha256:${"3".repeat(64)}` },
    };
    await expect(
      execute("verify_metric", {
        context: metricContext,
        request: metricRequest,
      }),
    ).resolves.toMatchObject({ structuredContent: { operationId: id(8) } });
    expect(resolveVerificationContext).toHaveBeenCalledWith(
      expect.objectContaining({
        useCase: "verifyMetricObservation",
        hints: expect.objectContaining(hints),
      }),
    );
    expect(submitVerifyMetricObservation).toHaveBeenCalledWith(metricRequest, bound(metricContext));
    await expect(
      execute("verify_metric", {
        context: metricContext,
        request: { ...metricRequest, findings: [] },
      }),
    ).rejects.toThrow();
  });
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  tenant = id(1),
  actor = {
    kind: "service" as const,
    id: id(2),
    serviceIdentity: "mission_control_client" as const,
  };
const context = {
    tenantId: tenant,
    correlationId: "mcp-verification",
    idempotencyKey: "mcp-verification-001",
  },
  request = {
    verificationContractVersion: "verification.v1" as const,
    captureIds: ["capture-1"],
    extractionSchema: {
      artifactId: id(3),
      digest: `sha256:${"1".repeat(64)}` as const,
    },
    extractionOutput: {
      artifactId: id(4),
      digest: `sha256:${"2".repeat(64)}` as const,
    },
  };
describe("verification MCP adapter", () => {
  it("uses bearer-bound identity and strict in-process admission without accepting actor context", async () => {
    const submitVerifyExtraction = queued(id(5)),
      { execute, resolveVerificationContext } = inProcess({
        submitVerifyExtraction,
      });
    await expect(execute("verify_extract", { context, request })).resolves.toMatchObject({
      structuredContent: { operationId: id(5) },
    });
    expect(resolveVerificationContext).toHaveBeenCalledWith(
      expect.objectContaining({ identity: expect.objectContaining({ actor }) }),
    );
    expect(submitVerifyExtraction).toHaveBeenCalledWith(request, bound());
    await expect(
      execute("verify_extract", {
        context: { ...context, actor },
        request,
      }),
    ).rejects.toThrow();
  });
  it("denies a tenant outside the authenticated grant before submission", async () => {
    const submitVerifyExtraction = vi.fn(),
      { execute, resolveVerificationContext } = inProcess({ submitVerifyExtraction }, id(99));
    await expect(execute("verify_extract", { context, request })).resolves.toMatchObject({
      isError: true,
    });
    expect(resolveVerificationContext).not.toHaveBeenCalled();
    expect(submitVerifyExtraction).not.toHaveBeenCalled();
  });
});

describe("parse MCP adapter", () => {
  it("forwards only a strict artifact handle to in-process submission", async () => {
    const submitParseArtifact = queued(id(70)),
      { execute } = inProcess({ submitParseArtifact }),
      parse = {
        verificationContractVersion: "verification.v1",
        captureId: id(71),
        sourceArtifact: {
          artifactId: id(72),
          tenantId: tenant,
          digest: `sha256:${"7".repeat(64)}`,
          mediaType: "text/html",
          byteLength: 4,
          objectKey: "tenant/object",
          createdAt: "2026-09-07T00:00:00.000Z",
          producerActivityId: "capture",
          producerVersion: "v1",
          encryptionClass: "managed",
          retentionClass: "audit",
          dataClassification: "restricted",
          parentArtifactIds: [],
        },
      };
    await execute("verify_artifact_parse", { context, request: parse });
    expect(submitParseArtifact).toHaveBeenCalledWith(parse, bound());
    await expect(
      execute("verify_artifact_parse", {
        context,
        request: { ...parse, parserKind: "html" },
      }),
    ).rejects.toThrow();
  });
});

describe("claims MCP adapter", () => {
  it("routes strict claims and reports without caller verifier authority", async () => {
    const submitVerifyClaims = queued(id(20)),
      submitVerifyReport = queued(id(21)),
      { execute } = inProcess({ submitVerifyClaims, submitVerifyReport });
    const ref = { artifactId: id(30), digest: `sha256:${"a".repeat(64)}` },
      claims = {
        verificationContractVersion: "verification.v1",
        captureIds: ["capture-1"],
        assertions: ref,
      },
      report = {
        verificationContractVersion: "verification.v1",
        captureIds: ["capture-1"],
        report: ref,
        claimLedger: { artifactId: id(31), digest: `sha256:${"b".repeat(64)}` },
      };
    await execute("verify_citations", { context, request: claims });
    await execute("verify_report", { context, request: report });
    expect(submitVerifyClaims).toHaveBeenCalledWith(claims, bound());
    expect(submitVerifyReport).toHaveBeenCalledWith(report, bound());
    await expect(
      execute("verify_citations", {
        context,
        request: { ...claims, verifierDeploymentId: id(90) },
      }),
    ).rejects.toThrow();
  });
});

describe("audit inspection MCP adapter", () => {
  it("routes only the strict audit reference through in-process admission", async () => {
    const submitInspectAuditBundle = queued(id(40)),
      { execute } = inProcess({ submitInspectAuditBundle }),
      auditRequest = {
        verificationContractVersion: "verification.v1",
        auditBundle: { artifactId: id(41), digest: `sha256:${"c".repeat(64)}` },
      };
    await execute("verify_bundle_inspect", {
      context,
      request: auditRequest,
    });
    expect(submitInspectAuditBundle).toHaveBeenCalledWith(auditRequest, bound());
    await expect(
      execute("verify_bundle_inspect", {
        context,
        request: { ...auditRequest, publicKey: "caller" },
      }),
    ).rejects.toThrow();
  });
});

describe("claims/report read MCP adapter", () => {
  it("uses bearer-bound read authority and strict operation input", async () => {
    const getClaims = vi.fn(async () => ({ useCase: "verifyClaims" })),
      getReport = vi.fn(async () => ({ useCase: "verifyReport" })),
      options = {
        operationService: {} as never,
        apiOrigin: "https://knowledge.example",
        identity: {
          actor,
          grants: [
            {
              tenantId: tenant,
              roles: ["knowledge_operator" as const],
              scopes: [],
            },
          ],
        },
        verificationReads: createVerificationResourceReads({
          claimsReportReads: { getClaims, getReport },
        }),
      };
    const readContext = { tenantId: tenant, correlationId: "mcp-read" };
    await createClaimsReportReadMcpExecutor(options, "claims")({ context: readContext, operationId: id(50) });
    await createClaimsReportReadMcpExecutor(options, "report")({ context: readContext, operationId: id(51) });
    expect(getClaims).toHaveBeenCalledWith({
      tenantId: tenant,
      operationId: id(50),
      actor,
    });
    expect(getReport).toHaveBeenCalledWith({
      tenantId: tenant,
      operationId: id(51),
      actor,
    });
    await expect(
      createClaimsReportReadMcpExecutor(
        options,
        "claims",
      )({ context: readContext, operationId: id(50), rawBundle: true }),
    ).rejects.toThrow();
  });
  it("denies an ungranted tenant before the read", async () => {
    const getClaims = vi.fn(),
      execute = createClaimsReportReadMcpExecutor(
        {
          operationService: {} as never,
          apiOrigin: "https://knowledge.example",
          identity: {
            actor,
            grants: [{ tenantId: id(99), roles: ["knowledge_operator"], scopes: [] }],
          },
          verificationReads: createVerificationResourceReads({
            claimsReportReads: { getClaims, getReport: vi.fn() },
          }),
        },
        "claims",
      );
    await expect(
      execute({
        context: { tenantId: tenant, correlationId: "denied" },
        operationId: id(50),
      }),
    ).resolves.toMatchObject({ isError: true });
    expect(getClaims).not.toHaveBeenCalled();
  });
});
