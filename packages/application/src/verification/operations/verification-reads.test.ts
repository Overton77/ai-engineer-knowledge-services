import type { VerificationArtifactHandle, VerificationRunManifest } from "@aiengineer/knowledge-contracts";
import { digestCanonicalJson, sha256Digest, type VerificationAuditBundle, verifyDeterministicBundle } from "@aiengineer/knowledge-verification";
import { describe, expect, it, vi } from "vitest";
import { VerificationCaseReadService, VerificationRunReadError, VerificationRunReadService, type VerificationRunAuditBundlePort } from "./verification-reads.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const createdAt = "2026-09-05T02:00:00.000Z";
type PrototypeFixture = { prototypeClaimInput(): Parameters<typeof verifyDeterministicBundle>[0] };
const prototypeFixtureUrl = new URL("../../../../verification/src/deterministic/testing/prototype-parity.fixture.js", import.meta.url).href;

function handle(artifactId: string, digest: `sha256:${string}`, mediaType = "application/json"): VerificationArtifactHandle {
  return {
    artifactId,
    tenantId,
    digest,
    mediaType,
    byteLength: 42,
    objectKey: `private-storage/${artifactId}`,
    createdAt,
    producerActivityId: "fixture",
    producerVersion: "1",
    encryptionClass: "managed",
    retentionClass: "audit",
    dataClassification: "restricted",
    parentArtifactIds: [],
  };
}

async function fixture(): Promise<VerificationAuditBundle> {
  const { prototypeClaimInput } = await import(prototypeFixtureUrl) as PrototypeFixture;
  const input = prototypeClaimInput();
  const deterministicResult = verifyDeterministicBundle(input);
  const resultDigest = digestCanonicalJson(deterministicResult);
  const policyArtifact = handle("33333333-3333-4333-8333-333333333333", sha256Digest("policy"));
  const policyInputsArtifact = handle("44444444-4444-4444-8444-444444444444", sha256Digest("policy-inputs"));
  const resultArtifact = handle("55555555-5555-4555-8555-555555555555", resultDigest);
  const manifest: VerificationRunManifest = {
    verificationContractVersion: "verification.v1",
    manifestId: "manifest-fixture",
    runId,
    versions: { policy: input.bundle.policyVersion, schema: "verification.v1", normalizer: "text.v1" },
    code: { gitSha: "fixture-sha", dirty: false, dirtyStateArtifactId: "66666666-6666-4666-8666-666666666666" },
    runtime: { platform: "test", deploymentId: "test-deployment" },
    provider: {
      endpointIdentity: "fixture-provider",
      model: "fixture-model",
      nativeConfiguration: { requestBody: "RAW_PROVIDER_BODY_MUST_NOT_LEAK", apiKey: "SECRET_MUST_NOT_LEAK" },
      pricingSnapshotArtifactId: policyArtifact.artifactId,
    },
    inputArtifacts: [policyArtifact, policyInputsArtifact],
    outputArtifacts: [resultArtifact],
    stages: [{ name: "deterministic", status: "succeeded", startedAt: createdAt, endedAt: createdAt }],
    calls: [{ requestDigest: sha256Digest("request"), retries: 1, reservationCostMicros: 50, costState: "actual", actualCostMicros: 40 }],
    toolPolicy: ["fixture-tool-policy"],
    networkPolicy: "disabled",
    deterministicResult,
    judgments: [],
    policyOutcome: "pass",
    resultDigest,
    lineage: [],
    canonicalization: { algorithm: "RFC8785", implementationVersion: "knowledge-verification.v1", manifestDigest: sha256Digest("manifest") },
    startedAt: createdAt,
    completedAt: createdAt,
  };
  return {
    verificationContractVersion: "verification.v1",
    tenantId,
    verificationBundle: { ...input.bundle, sourceBytes: "SOURCE_BYTES_MUST_NOT_LEAK" } as unknown as VerificationAuditBundle["verificationBundle"],
    manifest,
    policyBinding: { policyVersion: input.bundle.policyVersion, policyArtifact, recordedPolicyInputsArtifact: policyInputsArtifact },
    deterministicResultDigest: resultDigest,
    policyDecisionDigest: sha256Digest("policy-decision"),
    seal: { payloadDigest: sha256Digest("detached-seal") },
  };
}

function service(bundle: VerificationAuditBundle): { read: VerificationRunReadService; port: VerificationRunAuditBundlePort } {
  const port: VerificationRunAuditBundlePort = { loadAuditBundle: vi.fn(async () => structuredClone(bundle)) };
  return { read: new VerificationRunReadService(port), port };
}

async function caseFixture() {
  const bundle = await fixture();
  const caseRunId = "77777777-7777-4777-8777-777777777777";
  const evidenceId = "88888888-8888-4888-8888-888888888888";
  const compact = (value: VerificationArtifactHandle) => ({ artifactId: value.artifactId, digest: value.digest, mediaType: value.mediaType, sizeBytes: value.byteLength });
  const summary = { verificationContractVersion: "verification.v1", tenantId, runId, caseRunId, caseKey: "authored-case", inputArtifact: compact(bundle.manifest.inputArtifacts[0]!), resultArtifact: compact(bundle.manifest.outputArtifacts[0]!), createdAt };
  const evidence = { verificationContractVersion: "verification.v1", tenantId, runId, caseRunId, evidenceId, evidenceKey: "authored-evidence", kind: "artifact", ordinal: 0, artifact: summary.inputArtifact, createdAt };
  const row = { ...summary, evidence: [evidence] };
  const page = { verificationContractVersion: "verification.v1", tenantId, runId, cases: [summary] };
  const port = {
    loadAuditBundle: vi.fn(async () => bundle),
    listVerificationRunCases: vi.fn(async (): Promise<unknown> => page),
    getVerificationCase: vi.fn(async (): Promise<unknown | undefined> => row),
    getVerificationEvidence: vi.fn(async (): Promise<unknown | undefined> => evidence),
  };
  return { read: new VerificationCaseReadService(port), port, row, page, evidence, caseRunId, evidenceId };
}

describe("verification authored case reads (unit-only)", () => {
  it("returns only compact artifacts retained by the authorized sealed parent", async () => {
    const value = await caseFixture();
    expect(await value.read.listRunCases({ tenantId, runId })).toEqual(value.page);
    expect(await value.read.getCase({ tenantId, caseRunId: value.caseRunId })).toEqual(value.row);
    expect(await value.read.getEvidence({ tenantId, evidenceId: value.evidenceId })).toEqual(value.evidence);
    expect(JSON.stringify(value.row)).not.toContain("private-storage");
  });

  it("rejects foreign identities, parent drift and artifacts absent from the seal", async () => {
    const value = await caseFixture();
    value.port.getVerificationCase.mockResolvedValueOnce({ ...value.row, tenantId: value.evidenceId });
    await expect(value.read.getCase({ tenantId, caseRunId: value.caseRunId })).rejects.toMatchObject({ code: "INTEGRITY" });
    expect(value.port.loadAuditBundle).not.toHaveBeenCalled();
    value.port.getVerificationCase.mockResolvedValueOnce({ ...value.row, evidence: [{ ...value.evidence, runId: value.evidenceId }] });
    await expect(value.read.getCase({ tenantId, caseRunId: value.caseRunId })).rejects.toMatchObject({ code: "INTEGRITY" });
    value.port.getVerificationEvidence.mockResolvedValueOnce({ ...value.evidence, artifact: { ...value.evidence.artifact, artifactId: value.evidenceId } });
    await expect(value.read.getEvidence({ tenantId, evidenceId: value.evidenceId })).rejects.toMatchObject({ code: "INTEGRITY" });
  });

  it("rejects unordered or duplicated evidence and private extra properties", async () => {
    const value = await caseFixture();
    for (const row of [{ ...value.row, evidence: [value.evidence, value.evidence] }, { ...value.row, rawInput: "private" }]) {
      value.port.getVerificationCase.mockResolvedValueOnce(row);
      await expect(value.read.getCase({ tenantId, caseRunId: value.caseRunId })).rejects.toMatchObject({ code: "INTEGRITY" });
    }
  });

  it("does not expose a case while its parent operation is incomplete", async () => {
    const value = await caseFixture();
    value.port.loadAuditBundle.mockRejectedValue(new Error("OPERATION_NOT_COMPLETED private storage detail"));
    await expect(value.read.getCase({ tenantId, caseRunId: value.caseRunId })).rejects.toMatchObject({ code: "INTEGRITY", message: "VERIFICATION_RUN_READ_INTEGRITY" });
    await expect(value.read.listRunCases({ tenantId, runId })).rejects.toMatchObject({ code: "INTEGRITY" });
    expect(value.port.listVerificationRunCases).not.toHaveBeenCalled();
  });

  it("rejects invalid paging before I/O and maps absent authored identities to not found", async () => {
    const value = await caseFixture();
    await expect(value.read.listRunCases({ tenantId, runId, pageSize: 101 })).rejects.toMatchObject({ code: "INVALID" });
    await expect(value.read.listRunCases({ tenantId, runId, cursor: "locator-alias" })).rejects.toMatchObject({ code: "INVALID" });
    expect(value.port.loadAuditBundle).not.toHaveBeenCalled();
    value.port.getVerificationEvidence.mockResolvedValueOnce(undefined);
    await expect(value.read.getEvidence({ tenantId, evidenceId: value.evidenceId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("verification sealed run reads (unit-only)", () => {
  it("returns compact summary and reproducibility manifest without bundle bodies, storage locators, or seal material", async () => {
    const { read } = service(await fixture());

    const summary = await read.getRun({ tenantId, runId });
    const manifest = await read.getRunManifest({ tenantId, runId });

    expect(summary).toMatchObject({ tenantId, runId, artifacts: { inputCount: 2, outputCount: 1 }, calls: { actualCostMicros: 40, actualCount: 1, estimatedCount: 0, reservedCount: 0 } });
    expect(manifest.inputArtifacts[0]).toMatchObject({ artifactId: "33333333-3333-4333-8333-333333333333", sizeBytes: 42 });
    expect(manifest.canonicalization).toMatchObject({ algorithm: "RFC8785" });
    const publicPayload = JSON.stringify({ summary, manifest });
    for (const omitted of ["objectKey", "private-storage", "verificationBundle", "SOURCE_BYTES_MUST_NOT_LEAK", "RAW_PROVIDER_BODY_MUST_NOT_LEAK", "SECRET_MUST_NOT_LEAK", "nativeConfiguration", "signature", "payloadDigest", "judgments", "publicRationale"]) {
      expect(publicPayload).not.toContain(omitted);
    }
  });

  it("rejects a returned tenant or run binding mismatch without exposing repository detail", async () => {
    const tenantMismatch = await fixture();
    (tenantMismatch as { tenantId: string }).tenantId = "77777777-7777-4777-8777-777777777777";
    const runMismatch = await fixture();
    (runMismatch.manifest as { runId: string }).runId = "88888888-8888-4888-8888-888888888888";

    for (const bundle of [tenantMismatch, runMismatch]) {
      await expect(service(bundle).read.getRun({ tenantId, runId })).rejects.toMatchObject({ code: "INTEGRITY", message: "VERIFICATION_RUN_READ_INTEGRITY" });
    }
  });

  it("separates invalid requests and a missing run from an integrity failure", async () => {
    const absent: VerificationRunAuditBundlePort = { loadAuditBundle: vi.fn(async () => { throw new Error("VERIFICATION_RUN_NOT_FOUND"); }) };
    const read = new VerificationRunReadService(absent);

    await expect(read.getRun({ tenantId: "not-a-uuid", runId })).rejects.toEqual(expect.objectContaining<Partial<VerificationRunReadError>>({ code: "INVALID" }));
    await expect(read.getRun({ tenantId, runId })).rejects.toEqual(expect.objectContaining<Partial<VerificationRunReadError>>({ code: "NOT_FOUND" }));
    expect(absent.loadAuditBundle).toHaveBeenCalledTimes(1);
  });

  it("retains explicit call-state counts and rejects unsafe aggregate totals", async () => {
    const mixed = await fixture();
    (mixed.manifest as { calls: VerificationRunManifest["calls"] }).calls = [
      { requestDigest: sha256Digest("actual"), retries: 0, reservationCostMicros: 50, costState: "actual", actualCostMicros: 40 },
      { requestDigest: sha256Digest("estimated"), retries: 0, reservationCostMicros: 30, costState: "estimated", estimatedCostMicros: 20 },
      { requestDigest: sha256Digest("reserved"), retries: 0, reservationCostMicros: 10, costState: "reserved" },
      { requestDigest: sha256Digest("unknown"), retries: 0, reservationCostMicros: 5, costState: "unknown_dispatched" },
    ];
    await expect(service(mixed).read.getRun({ tenantId, runId })).resolves.toMatchObject({
      calls: { count: 4, reservedCostMicros: 95, estimatedCostMicros: 20, actualCostMicros: 40, actualCount: 1, estimatedCount: 1, reservedCount: 1, unknownDispatchedCount: 1 },
    });

    const overflowing = await fixture();
    (overflowing.manifest as { calls: VerificationRunManifest["calls"] }).calls = [
      { requestDigest: sha256Digest("large"), retries: 0, reservationCostMicros: Number.MAX_SAFE_INTEGER, costState: "reserved" },
      { requestDigest: sha256Digest("one"), retries: 0, reservationCostMicros: 1, costState: "reserved" },
    ];
    await expect(service(overflowing).read.getRun({ tenantId, runId })).rejects.toMatchObject({ code: "INTEGRITY" });
  });

  it("rejects overlong public manifest strings and media types at the projection boundary", async () => {
    const longCode = await fixture();
    (longCode.manifest.code as { gitSha: string }).gitSha = "g".repeat(4_097);
    await expect(service(longCode).read.getRunManifest({ tenantId, runId })).rejects.toMatchObject({ code: "INTEGRITY" });

    const longMediaType = await fixture();
    (longMediaType.manifest.inputArtifacts[0] as { mediaType: string }).mediaType = "a".repeat(256);
    await expect(service(longMediaType).read.getRun({ tenantId, runId })).rejects.toMatchObject({ code: "INTEGRITY" });
  });
});
