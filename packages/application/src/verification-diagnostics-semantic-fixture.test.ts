import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { verificationBenchmarkDigest } from "@aiengineer/knowledge-evaluation";
import { canonicalizeJson, sha256Digest } from "@aiengineer/knowledge-verification";
import { prepareVerificationProviderTransportResponse } from "./verification-provider-transport.js";
import { loadDiagnosticsOfflineCatalog } from "./verification-diagnostics-offline-catalog.js";
import { loadDiagnosticsSemanticReplayFixture } from "./verification-diagnostics-semantic-fixture.js";
import { reAdmitDiagnosticsSemanticFixtureProjection, replayDiagnosticsSemanticFixture } from "./verification-diagnostics-semantic-replay.js";

const root = resolve(import.meta.dirname, "../../..");
const catalog = resolve(root, "catalog/verification-benchmarks/diagnostics-companies-v1");
const signedFixture = resolve(root, "catalog/verification-semantic-fixtures/cedad3b42fc7d04c05cee35fff30bb75521cdf95f9d3280859abfa517956b495");
const signedFixtureDigest = "sha256:cedad3b42fc7d04c05cee35fff30bb75521cdf95f9d3280859abfa517956b495" as const;
const replayFixture = resolve(root, "catalog/verification-semantic-fixtures/c63055da4dee19de98bfdaf8fafa7884fef6ae9f127964041b2dc4d97d561352");
const replayFixtureDigest = "sha256:c63055da4dee19de98bfdaf8fafa7884fef6ae9f127964041b2dc4d97d561352" as const;
const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const encoder = new TextEncoder();
const reseal = (manifest: Record<string, unknown>) => {
  const { fixtureDigest: _ignored, ...material } = manifest;
  return { ...material, fixtureDigest: verificationBenchmarkDigest(material) };
};
const handle = (suffix: string, bytes: Uint8Array, parents: readonly string[] = [], transformationSignature?: `sha256:${string}`) => ({
  artifactId: id(suffix), digest: sha256Digest(bytes), tenantId: id("1"), byteLength: bytes.byteLength,
  mediaType: "application/json", objectKey: `restricted/test/${suffix}`, createdAt: "2026-09-07T00:00:00.000Z",
  producerActivityId: "fixture-test", producerVersion: "v1", encryptionClass: "managed", retentionClass: "verification-audit",
  dataClassification: "restricted" as const, parentArtifactIds: [...parents], ...(transformationSignature ? { transformationSignature } : {}),
});

async function writeFixture(directory: string) {
  const frozen = await loadDiagnosticsOfflineCatalog("diagnostics-companies-v1", catalog);
  const testCase = frozen.dataset.cases[0]!;
  const profileBytes = encoder.encode("profile"), blindedBytes = encoder.encode("blinded"), requestBytes = encoder.encode("request"), rawBytes = encoder.encode("raw");
  const profile = handle("2", profileBytes), blinded = handle("3", blindedBytes), request = handle("4", requestBytes, [blinded.artifactId]), raw = handle("5", rawBytes);
  const envelopeBytes = encoder.encode("envelope"), envelope = handle("6", envelopeBytes, [request.artifactId, raw.artifactId]);
  const identity = { deploymentId: "fixture-judge", provider: "vercel-ai-gateway", family: "openai", model: "openai/gpt-5.6-luna", capability: "llm_evidence_rubric" as const, graderVersion: "evidence-only.v1", promptDigest: sha256Digest("prompt"), outputSchemaDigest: sha256Digest("schema"), configurationDigest: sha256Digest("config") };
  const binding = { tenantId: id("1"), operationId: id("8"), operationStepId: id("9"), providerAttemptId: id("11"), profileArtifactId: profile.artifactId, profileDigest: profile.digest, dispatchFencingToken: 2 };
  const prepared = prepareVerificationProviderTransportResponse({ binding, httpStatus: 200, requestDigest: request.digest, responseEnvelope: envelope, rawResponse: raw });
  const transport = handle("7", prepared.bytes, prepared.parentArtifactIds, prepared.transformationSignature);
  const body = { schemaVersion: "verification-semantic-response-observation.v1" as const, verificationContractVersion: "verification.v1" as const, context: { tenantId: binding.tenantId, operationId: binding.operationId, operationStepId: binding.operationStepId, providerAttemptId: binding.providerAttemptId, leaseToken: id("10"), fencingToken: 2, holderIdentity: "fixture-worker", producerAttemptId: id("12"), host: { operationKind: "verification_claims" as const, stepKey: "verify_claims_and_register" as const, useCase: "verifyClaims" as const } }, profileArtifact: profile, blindedInputArtifact: blinded, requestArtifact: request, rawResponseArtifact: raw, responseEnvelopeArtifact: envelope, judgeIdentity: identity, inputArtifactDigest: blinded.digest, requestDigest: request.digest, rawResponseDigest: raw.digest, requestedModel: identity.model, observedModel: identity.model, modelStatus: "matched" as const, revalidationRequired: false, usage: { totalTokens: 0 }, costStatus: "unknown" as const };
  const bodyBytes = encoder.encode(canonicalizeJson(body)), observation = handle("13", bodyBytes, [blinded.artifactId, envelope.artifactId, profile.artifactId]);
  const bundleBytes = encoder.encode("signed-bundle"), bundle = handle("14", bundleBytes);
  const resultBytes = encoder.encode("deterministic-result"), result = handle("15", resultBytes, [bundle.artifactId]);
  const items = [["profile.json", profile, profileBytes], ["blinded.json", blinded, blindedBytes], ["request.json", request, requestBytes], ["raw.json", raw, rawBytes], ["envelope.json", envelope, envelopeBytes], ["transport.json", transport, prepared.bytes], ["observation.json", observation, bodyBytes], ["bundle.json", bundle, bundleBytes], ["result.json", result, resultBytes]] as const;
  for (const [file, _handle, bytes] of items) await writeFile(resolve(directory, file), bytes);
  const entry = { caseId: testCase.caseId, caseDigest: testCase.caseDigest, inputManifestArtifactId: testCase.inputManifestArtifactId, verificationBundleArtifact: bundle, deterministicResultArtifact: result, producerDeploymentId: "fixture-producer", expectedAssessment: { assertionId: "fixture-assertion", verdict: "insufficient_evidence" as const, disposition: "abstain" as const, evidenceSupport: "unknown" as const, worldCorrectness: "unknown" as const, attributionFaithfulness: "unknown" as const, sourceAuthority: "unknown" as const, provenanceIntegrity: "unknown" as const, judgeIdentities: [identity], supportingFragmentIds: [], contradictingFragmentIds: [], unsupportedFacets: [], reasonCodes: ["FIXTURE_ONLY"], crossFamilySecondJudge: false, rawProviderConfidences: [] }, judges: [{ identity, profileArtifact: profile, observationArtifact: observation, capture: { ...binding, httpStatus: 200, responseEnvelopeArtifactId: envelope.artifactId, transportArtifactId: transport.artifactId, transportDigest: transport.digest, capturedAt: "2026-09-07T00:00:00.000Z" } }] };
  const material = { schemaVersion: "diagnostics-offline-semantic-replay-fixture.v1" as const, datasetManifestDigest: frozen.datasetManifestDigest, entries: [entry], artifacts: items.map(([file, itemHandle]) => ({ file, handle: itemHandle })) };
  const fixtureDigest = verificationBenchmarkDigest(material);
  await writeFile(resolve(directory, "manifest.json"), `${canonicalizeJson({ ...material, fixtureDigest })}\n`);
  return { fixtureDigest, observationId: observation.artifactId };
}

describe("diagnostics semantic replay fixture", () => {
  it("loads the retained signed exact-v1 semantic closure without network", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("NETWORK_FORBIDDEN"); }) as typeof fetch;
    try {
      const loaded = await loadDiagnosticsSemanticReplayFixture({ directory: signedFixture, catalogDirectory: catalog, expectedFixtureDigest: signedFixtureDigest });
      expect(loaded.entries).toHaveLength(1);
      expect(loaded.entries[0]!.caseId).toBe("tru-symphony-source");
      expect(loaded.entries[0]!.verificationBundleArtifact.artifactId).not.toBe(loaded.entries[0]!.deterministicResultArtifact.artifactId);
    } finally { globalThis.fetch = original; }
  });

  it("re-admits the retained projection without parser or network access", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("NETWORK_FORBIDDEN"); }) as typeof fetch;
    try {
      const replay = await reAdmitDiagnosticsSemanticFixtureProjection({ directory: signedFixture, catalogDirectory: catalog, expectedFixtureDigest: signedFixtureDigest, caseId: "tru-symphony-source" });
      expect(replay.receipt.captureId).toBe("67b3c277-5c66-5ef5-ace8-66aff1d3e736");
      expect(replay.receipt.projectionArtifact.artifactId).toBe("b4573767-03c2-55e9-a771-0385eeff5aa5");
    } finally { globalThis.fetch = original; }
  });

  it("replays the signed exact-v1 semantic observation with no provider request", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("NETWORK_FORBIDDEN"); }) as typeof fetch;
    try {
      const replay = await replayDiagnosticsSemanticFixture({ directory: replayFixture, catalogDirectory: catalog, expectedFixtureDigest: replayFixtureDigest });
      expect(replay.externalRequests).toBe(0);
      expect(replay.results).toHaveLength(1);
      expect(replay.results[0]).toMatchObject({ caseId: "tru-symphony-source", externalRequests: 0, assessment: { disposition: "admit", verdict: "directly_supported" } });
    } finally { globalThis.fetch = original; }
  });

  it("requires the caller-pinned seal and returns defensive replay-only hydration", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "semantic-fixture-"));
    try {
      const fixture = await writeFixture(directory);
      const loaded = await loadDiagnosticsSemanticReplayFixture({ directory, catalogDirectory: catalog, expectedFixtureDigest: fixture.fixtureDigest });
      expect(loaded.entries).toHaveLength(1);
      expect(() => (loaded.entries[0] as { judges: unknown[] }).judges.push({})).toThrow();
      const first = await loaded.createResolver().hydrateRegisteredArtifact({ tenantId: id("1"), artifactId: fixture.observationId });
      first.bytes[0] = 0;
      const again = await loaded.createResolver().hydrateRegisteredArtifact({ tenantId: id("1"), artifactId: fixture.observationId });
      expect(again.bytes[0]).not.toBe(0);
      await expect(loaded.createResolver().authorizeArtifact({ tenantId: id("1"), artifactId: fixture.observationId, purpose: "verification_replay" })).rejects.toThrow("HYDRATION_DENIED");
      await expect(loadDiagnosticsSemanticReplayFixture({ directory, catalogDirectory: catalog, expectedFixtureDigest: sha256Digest("resealed-forgery") })).rejects.toThrow("SEAL_MISMATCH");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("rejects a resealed traversal manifest and an altered closure artifact", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "semantic-fixture-"));
    try {
      const fixture = await writeFixture(directory);
      const manifestPath = resolve(directory, "manifest.json"), manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      manifest.artifacts[0].file = "../profile.json";
      Object.assign(manifest, reseal(manifest));
      await writeFile(manifestPath, canonicalizeJson(manifest));
      await expect(loadDiagnosticsSemanticReplayFixture({ directory, catalogDirectory: catalog, expectedFixtureDigest: manifest.fixtureDigest })).rejects.toThrow("ARTIFACT_IDENTITY");
      await writeFixture(directory);
      await writeFile(resolve(directory, "raw.json"), "tampered");
      await expect(loadDiagnosticsSemanticReplayFixture({ directory, catalogDirectory: catalog, expectedFixtureDigest: fixture.fixtureDigest })).rejects.toThrow("ARTIFACT_DIGEST_MISMATCH");
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.each(["case", "file", "judge"] as const)("rejects a caller-pinned duplicate %s", async (kind) => {
    const directory = await mkdtemp(resolve(tmpdir(), "semantic-fixture-"));
    try {
      await writeFixture(directory);
      const manifestPath = resolve(directory, "manifest.json"), manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (kind === "case") manifest.entries.push(structuredClone(manifest.entries[0]));
      if (kind === "file") manifest.artifacts.push({ ...structuredClone(manifest.artifacts[0]), handle: { ...manifest.artifacts[0].handle, artifactId: id("99") } });
      if (kind === "judge") manifest.entries[0].judges.push(structuredClone(manifest.entries[0].judges[0]));
      const resealed = reseal(manifest);
      await writeFile(manifestPath, canonicalizeJson(resealed));
      await expect(loadDiagnosticsSemanticReplayFixture({ directory, catalogDirectory: catalog, expectedFixtureDigest: resealed.fixtureDigest })).rejects.toThrow(
        kind === "case" ? "CASE_BINDING" : kind === "file" ? "ARTIFACT_IDENTITY" : "JUDGE_DUPLICATE",
      );
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
