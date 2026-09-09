import { describe, expect, it } from "vitest";
import { ParseArtifactRequestSchema } from "./parse.js";
import {
  CaptureSourceRequestSchema,
  CompareBenchmarkRunsRequestSchema,
  ExtractStructuredDataRequestSchema,
  GetVerificationCaseRequestSchema,
  GetVerificationEvidenceRequestSchema,
  GetVerificationOperationRequestSchema,
  GetVerificationRunManifestRequestSchema,
  GetVerificationRunRequestSchema,
  InspectAuditBundleRequestSchema,
  ListVerificationRunCasesRequestSchema,
  ReplayRunRequestSchema,
  RequestAdjudicationRequestSchema,
  RunBenchmarkRequestSchema,
  VerificationMutationRequestSchema,
  VerifyClaimsRequestSchema,
  VerifyExtractionRequestSchema,
  VerifyMetricObservationRequestSchema,
  VerifyReportRequestSchema,
} from "./requests.js";

const uuid = "11111111-1111-4111-8111-111111111111";
const uuid2 = "22222222-2222-4222-8222-222222222222";
const digest = `sha256:${"a".repeat(64)}`;
const artifact = { artifactId: uuid, digest };
const version = { verificationContractVersion: "verification.v1" as const };

describe("verification route request contracts", () => {
  it("accepts bounded canonical payloads for all twelve mutations and six readers", () => {
    const mutations = [
      [CaptureSourceRequestSchema, { ...version, source: { mode: "acquire", sourceKind: "web_page", sourceUri: "https://example.test/report" }, requestedProjectionKinds: ["native_text"] }],
      [ParseArtifactRequestSchema, { ...version, captureId: uuid, sourceArtifact: { ...artifact, tenantId: uuid, mediaType: "text/html", byteLength: 4, objectKey: "tenant/object", createdAt: "2026-09-08T00:00:00.000Z", producerActivityId: "capture", producerVersion: "v1", encryptionClass: "managed", retentionClass: "audit", dataClassification: "restricted", parentArtifactIds: [] } }],
      [ExtractStructuredDataRequestSchema, { ...version, captureId: "capture-1", representation: artifact, extractionSchema: artifact, extractionProfile: "registered_default" }],
      [VerifyExtractionRequestSchema, { ...version, captureIds: ["capture-1"], extractionSchema: artifact, extractionOutput: artifact }],
      [VerifyClaimsRequestSchema, { ...version, captureIds: ["capture-1"], assertions: artifact }],
      [VerifyReportRequestSchema, { ...version, report: artifact, claimLedger: artifact, captureIds: ["capture-1"] }],
      [VerifyMetricObservationRequestSchema, { ...version, captureIds: ["capture-1"], observations: artifact }],
      [RunBenchmarkRequestSchema, { ...version, dataset: artifact, experimentDefinition: artifact, executionMode: "offline_recorded" }],
      [CompareBenchmarkRunsRequestSchema, { ...version, baselineRunId: "run-1", candidateRunId: "run-2", comparisonProfile: "paired_default" }],
      [ReplayRunRequestSchema, { ...version, runId: "run-1", replayMode: "deterministic_only" }],
      [RequestAdjudicationRequestSchema, { ...version, target: { kind: "evidence", evidenceId: "evidence-1" }, reason: "ambiguous_evidence", evidencePacket: artifact }],
      [InspectAuditBundleRequestSchema, { ...version, auditBundle: artifact }],
    ] as const;
    for (const [schema, request] of mutations) expect(schema.safeParse(request).success, JSON.stringify(request)).toBe(true);
    const useCases = ["captureSource", "parseArtifact", "extractStructuredData", "verifyExtraction", "verifyClaims", "verifyReport", "verifyMetricObservation", "runBenchmark", "compareBenchmarkRuns", "replayRun", "requestAdjudication", "inspectAuditBundle"];
    expect(VerificationMutationRequestSchema.options.map(option => option.shape.useCase.value).sort()).toEqual([...useCases].sort());
    for (const [index, [, request]] of mutations.entries()) {
      const input = { useCase: useCases[index], request };
      expect(VerificationMutationRequestSchema.safeParse(input).success, input.useCase).toBe(true);
      expect(VerificationMutationRequestSchema.safeParse({ ...input, request: { ...request, verifierDeploymentId: "caller" } }).success, input.useCase).toBe(false);
    }
    for (const [schema, request] of [
      [GetVerificationOperationRequestSchema, { ...version, operationId: uuid }],
      [GetVerificationRunRequestSchema, { ...version, runId: "run-1" }],
      [GetVerificationRunManifestRequestSchema, { ...version, runId: "run-1" }],
      [ListVerificationRunCasesRequestSchema, { ...version, runId: uuid, page: { pageSize: 10 } }],
      [GetVerificationCaseRequestSchema, { ...version, caseRunId: uuid }],
      [GetVerificationEvidenceRequestSchema, { ...version, evidenceId: uuid }],
    ] as const) expect(schema.safeParse(request).success, JSON.stringify(request)).toBe(true);
  });

  it("rejects transport-supplied provider, credentials, grants, findings, and trusted identity", () => {
    const base = { ...version, captureIds: ["capture-1"], assertions: artifact };
    for (const forbidden of [
      { providerEndpoint: "https://provider.example/v1" },
      { credentials: { apiKey: "secret" } },
      { externalProcessingGrant: { allowed: true } },
      { deterministicResult: { semanticEligibility: true } },
      { sourceAuthority: "independent" },
      { verifierDeploymentId: "trusted-verifier" },
      { reviewerIdentity: "expert" },
      { operationContext: { tenantId: uuid } },
    ]) expect(VerifyClaimsRequestSchema.safeParse({ ...base, ...forbidden }).success).toBe(false);
  });

  it("rejects malformed, credentialed, unbounded, and semantically unsafe payloads", () => {
    expect(CaptureSourceRequestSchema.safeParse({ ...version, source: { mode: "acquire", sourceKind: "web_page", sourceUri: "https://name:password@example.test" }, requestedProjectionKinds: ["native_text"] }).success).toBe(false);
    expect(CaptureSourceRequestSchema.safeParse({ ...version, source: { mode: "acquire", sourceKind: "web_page", sourceUri: "ftp://example.test/file" }, requestedProjectionKinds: ["native_text"] }).success).toBe(false);
    expect(() => CaptureSourceRequestSchema.safeParse({ ...version, source: { mode: "acquire", sourceKind: "web_page", sourceUri: "not a URL" }, requestedProjectionKinds: ["native_text"] })).not.toThrow();
    expect(CaptureSourceRequestSchema.safeParse({ ...version, source: { mode: "acquire", sourceKind: "web_page", sourceUri: "not a URL" }, requestedProjectionKinds: ["native_text"] }).success).toBe(false);
    expect(CaptureSourceRequestSchema.safeParse({ ...version, source: { mode: "register", sourceKind: "upload", sourceId: "upload-source-1", contentArtifact: artifact }, requestedProjectionKinds: ["native_text"] }).success).toBe(true);
    expect(VerifyExtractionRequestSchema.safeParse({ ...version, captureIds: Array.from({ length: 101 }, (_, index) => `capture-${index}`), extractionSchema: artifact, extractionOutput: artifact }).success).toBe(false);
    expect(CompareBenchmarkRunsRequestSchema.safeParse({ ...version, baselineRunId: "run-1", candidateRunId: "run-1", comparisonProfile: "paired_default" }).success).toBe(false);
    expect(RequestAdjudicationRequestSchema.safeParse({ ...version, target: { kind: "assertion", assertionId: "assertion-1" }, reason: "appeal", evidencePacket: artifact, promoteEngineeringLabel: true }).success).toBe(false);
    expect(RequestAdjudicationRequestSchema.safeParse({ ...version, target: { kind: "assertion", assertionId: "assertion-1" }, reason: "appeal", evidencePacket: artifact, requesterNote: "x".repeat(1_001) }).success).toBe(false);
    expect(VerificationMutationRequestSchema.safeParse({ useCase: "verifyClaims", request: { ...version, captureIds: ["capture-1"], assertions: artifact }, actor: "forged" }).success).toBe(false);
  });

  it("keeps readers bounded and route-specific", () => {
    expect(ListVerificationRunCasesRequestSchema.safeParse({ ...version, runId: uuid, page: { pageSize: 101 } }).success).toBe(false);
    expect(ListVerificationRunCasesRequestSchema.parse({ ...version, runId: uuid, page: {} }).page?.pageSize).toBe(25);
    expect(ListVerificationRunCasesRequestSchema.safeParse({ ...version, runId: uuid, page: { cursor: "opaque-alias" } }).success).toBe(false);
    expect(GetVerificationCaseRequestSchema.safeParse({ ...version, caseRunId: "evaluation-score-alias" }).success).toBe(false);
    expect(GetVerificationEvidenceRequestSchema.safeParse({ ...version, evidenceId: "judgment-evidence-alias" }).success).toBe(false);
    expect(GetVerificationOperationRequestSchema.safeParse({ ...version, operationId: uuid2, runId: "not-a-route-field" }).success).toBe(false);
  });
});
