import type { OperationContext, VerificationArtifactHandle, VerificationBundle } from "@aiengineer/knowledge-contracts";
import { sha256Digest, type RuntimePrincipalBinding } from "@aiengineer/knowledge-verification";
import { describe, expect, it, vi } from "vitest";
import {
  VerificationMetricApplicationService,
  VerificationMetricProfileCatalog,
  type VerificationMetricCapturePort,
  type VerificationMetricRuntimePrincipalPort,
} from "./verification-metrics.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const profileId = "33333333-3333-4333-8333-333333333333";
const observationsId = "44444444-4444-4444-8444-444444444444";
type PrototypeFixture = {
  prototypeMetricInput(): { bundle: VerificationBundle; artifacts: readonly { artifactId: string; content: string | Uint8Array }[] };
  runtimePrincipals: RuntimePrincipalBinding;
};
const prototypeFixtureUrl = new URL("../../verification/src/deterministic/testing/prototype-parity.fixture.js", import.meta.url).href;
const context = (): OperationContext => ({
  contractVersion: "v1", tenantId, operationId: "55555555-5555-4555-8555-555555555555",
  attemptId: "88888888-8888-4888-8888-888888888888", correlationId: "metric-verify-test",
  actor: { kind: "service", id: "99999999-9999-4999-8999-999999999999", serviceIdentity: "knowledge_worker" },
  capabilityVersion: "verification.v1", idempotencyKey: "metric-verify-test-key", reason: "bounded metric verification fixture",
});

function handle(id: string, content: Uint8Array, parentArtifactIds: string[] = []): VerificationArtifactHandle & { digest: `sha256:${string}` } {
  return {
    artifactId: id, tenantId, digest: sha256Digest(content) as `sha256:${string}`, mediaType: "application/json", byteLength: content.byteLength,
    objectKey: `verification/${id}`, createdAt: "2026-09-05T12:00:00.000Z", producerActivityId: "metric-test",
    producerVersion: "1", encryptionClass: "managed", retentionClass: "test", dataClassification: "internal", parentArtifactIds,
  };
}

async function fixture(duplicateCapture = false) {
  const { prototypeMetricInput, runtimePrincipals } = await import(prototypeFixtureUrl) as PrototypeFixture;
  const input = prototypeMetricInput();
  const bundle = structuredClone(input.bundle) as VerificationBundle;
  const capture = bundle.captures[0]!;
  const sourceBytes = new TextEncoder().encode(String(input.artifacts[0]!.content));
  const sourceHandle = handle(capture.contentArtifact.artifactId, sourceBytes);
  capture.contentArtifact = sourceHandle;
  if (duplicateCapture) {
    bundle.sources.push({ ...bundle.sources[0]!, sourceId: "source-2", logicalIdentity: "second registered observation of the same source bytes" });
    bundle.captures.push({ ...capture, captureId: "capture-2", sourceId: "source-2" });
  }
  const bundleBytes = new TextEncoder().encode(JSON.stringify(bundle));
  const observationsHandle = handle(observationsId, bundleBytes);
  const profile = {
    schemaVersion: "verification-metric-profile.v1" as const,
    profileId: "metric-profile-test",
    observations: { artifactId: observationsHandle.artifactId, digest: observationsHandle.digest },
    captureIds: bundle.captures.map((item) => item.captureId), projectionAdmissions: [],
  };
  const profileBytes = new TextEncoder().encode(JSON.stringify(profile));
  const profileHandle = handle(profileId, profileBytes);
  const records = new Map<string, { registration: VerificationArtifactHandle; bytes: Uint8Array }>([
    [sourceHandle.artifactId, { registration: sourceHandle, bytes: sourceBytes }],
    [observationsHandle.artifactId, { registration: observationsHandle, bytes: bundleBytes }],
    [profileHandle.artifactId, { registration: profileHandle, bytes: profileBytes }],
  ]);
  const catalog = new VerificationMetricProfileCatalog([{
    profileArtifact: { artifactId: profileHandle.artifactId, digest: profileHandle.digest },
    observations: { artifactId: observationsHandle.artifactId, digest: observationsHandle.digest },
  }]);
  const captures: VerificationMetricCapturePort = { async getRegisteredCapture({ captureId }) {
    const registeredCapture = bundle.captures.find((item) => item.captureId === captureId);
    if (!registeredCapture) throw new Error("CAPTURE_NOT_FOUND");
    return { source: bundle.sources.find((item) => item.sourceId === registeredCapture.sourceId)!, capture: registeredCapture };
  } };
  const producerAttemptId = "11111111-1111-4111-8111-111111111111";
  const runtime: VerificationMetricRuntimePrincipalPort = { async bind() { return { runtimePrincipals, producerAttemptId }; } };
  const authorizeArtifact = vi.fn(async () => undefined);
  const service = new VerificationMetricApplicationService({
    artifactResolver: {
      authorizeArtifact,
      async hydrateRegisteredArtifact({ artifactId }) {
        const item = records.get(artifactId);
        if (!item) throw new Error("ARTIFACT_NOT_FOUND");
        return item;
      },
    },
    captures, profiles: catalog, runtimePrincipals: runtime,
  });
  return { bundle, sourceBytes, observationsHandle, profileHandle, records, catalog, captures, runtime, runtimePrincipals, producerAttemptId, authorizeArtifact, service };
}

function request(observations: VerificationArtifactHandle, captureIds: readonly string[] = ["capture-1"]) {
  return { verificationContractVersion: "verification.v1" as const, captureIds: [...captureIds], observations: { artifactId: observations.artifactId, digest: observations.digest } };
}

describe("verification metric application service", () => {
  it("hydrates granted registered bytes and preserves selector and arithmetic mechanics", async () => {
    const test = await fixture();
    const result = await test.service.verify(request(test.observationsHandle), context());
    expect(result).toMatchObject({ admissionState: "mechanical_only", deterministicResult: { status: "passed" }, producerAttemptId: test.producerAttemptId });
    expect(result.deterministicResult.metrics.find((metric) => metric.observationId === "npm-downloads-30d")?.replayedValue).toBe("25");
    expect(test.authorizeArtifact).toHaveBeenCalledWith(expect.objectContaining({ artifactId: test.observationsHandle.artifactId, purpose: "verification_admission" }));
    expect(test.authorizeArtifact).toHaveBeenCalledWith(expect.objectContaining({ artifactId: test.bundle.captures[0]!.contentArtifact.artifactId, purpose: "verification_admission" }));
  });

  it("does not accept caller-supplied trust findings or a self-declared verifier", async () => {
    const test = await fixture();
    await expect(test.service.verify({ ...request(test.observationsHandle), grant: { independent: true } }, context())).rejects.toThrow();
    await expect(test.service.verify({ ...request(test.observationsHandle), producerAttemptId: "22222222-2222-4222-8222-222222222222" }, context())).rejects.toThrow();
    const selfBound: VerificationMetricRuntimePrincipalPort = { async bind() {
      return { producerAttemptId: test.producerAttemptId, runtimePrincipals: { ...test.runtimePrincipals, verifierDeploymentId: test.runtimePrincipals.producerDeploymentId, verifierPrincipalDigest: test.runtimePrincipals.producerPrincipalDigest } };
    } };
    const service = new VerificationMetricApplicationService({
      artifactResolver: {
        authorizeArtifact: async () => undefined,
        async hydrateRegisteredArtifact({ artifactId }) { return test.records.get(artifactId)!; },
      },
      captures: test.captures, profiles: test.catalog, runtimePrincipals: selfBound,
    });
    const result = await service.verify(request(test.observationsHandle), context());
    expect(result.deterministicResult.summary.failedCheckCodes).toContain("PRODUCER_VERIFIER_INDEPENDENT");
    expect(result.deterministicResult.deploymentSeparation.status).toBe("not_established");
  });

  it("deduplicates shared registered capture bytes after checking every capture binding", async () => {
    const test = await fixture(true);
    const result = await test.service.verify(request(test.observationsHandle, ["capture-1", "capture-2"]), context());
    expect(result.deterministicResult.status).toBe("passed");
    expect(result.hydratedCaptureArtifactIds).toEqual([test.bundle.captures[0]!.contentArtifact.artifactId]);
  });

  it("passes only an exact envelope-admitted parentless native projection to the trusted engine bridge", async () => {
    const test = await fixture();
    const projectionId = "66666666-6666-4666-8666-666666666666";
    const envelopeId = "77777777-7777-4777-8777-777777777777";
    const projectionBytes = new TextEncoder().encode(JSON.stringify({ records: [] }));
    const projection = handle(projectionId, projectionBytes); // Deliberately parentless native-CAS representation.
    test.bundle.captures[0]!.canonicalProjectionArtifact = projection;
    const changedBundleBytes = new TextEncoder().encode(JSON.stringify(test.bundle));
    const changedObservations = handle(observationsId, changedBundleBytes);
    const profile = {
      schemaVersion: "verification-metric-profile.v1", profileId: "metric-profile-test",
      observations: { artifactId: changedObservations.artifactId, digest: changedObservations.digest }, captureIds: ["capture-1"],
      projectionAdmissions: [{ captureId: "capture-1", projectionArtifactId: projectionId, transformationArtifactId: envelopeId }],
    } as const;
    const profileBytes = new TextEncoder().encode(JSON.stringify(profile));
    const changedProfile = handle(profileId, profileBytes);
    test.records.set(projectionId, { registration: projection, bytes: projectionBytes });
    test.records.set(observationsId, { registration: changedObservations, bytes: changedBundleBytes });
    test.records.set(profileId, { registration: changedProfile, bytes: profileBytes });
    const nativeProjectionAdmission = { hydrateAdmittedProjection: vi.fn(async () => ({
      receipt: { captureId: "capture-1", sourceArtifact: test.bundle.captures[0]!.contentArtifact, projectionArtifact: projection },
    })) };
    const service = new VerificationMetricApplicationService({
      artifactResolver: { authorizeArtifact: async () => undefined, async hydrateRegisteredArtifact({ artifactId }) { return test.records.get(artifactId)!; } },
      captures: { async getRegisteredCapture() {
        const { canonicalProjectionArtifact: _projection, ...storedCapture } = test.bundle.captures[0]!;
        return { source: test.bundle.sources[0]!, capture: storedCapture };
      } },
      profiles: new VerificationMetricProfileCatalog([{ profileArtifact: { artifactId: profileId, digest: changedProfile.digest }, observations: { artifactId: observationsId, digest: changedObservations.digest } }]),
      runtimePrincipals: test.runtime, nativeProjectionAdmission,
    });
    const result = await service.verify(request(changedObservations), context());
    expect(result.deterministicResult.status).toBe("passed");
    expect(result.deterministicResult.summary.failedCheckCodes).toEqual([]);
    expect(nativeProjectionAdmission.hydrateAdmittedProjection).toHaveBeenCalledWith(expect.objectContaining({ captureId: "capture-1", projectionArtifactId: projectionId, transformationArtifactId: envelopeId }));
    expect(projection.parentArtifactIds).toEqual([]);
  });
});
