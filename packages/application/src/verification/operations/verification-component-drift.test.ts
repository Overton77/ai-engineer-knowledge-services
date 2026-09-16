import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { VerificationArtifactHandle, VerificationRunManifest } from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, digestCanonicalJson, sha256Digest, verifyDeterministicBundle, type TrustedArtifactResolver, type VerificationAuditBundle } from "@aiengineer/knowledge-verification";
import { createEd25519Signer, createEd25519Verifier, sealAuditBundle, verificationManifestDigest } from "@aiengineer/knowledge-verification";
import { compareVerifiedComponentVersions } from "./verification-component-drift.js";

const createdAt = "2026-09-05T02:00:00.000Z";
const policyBytes = new TextEncoder().encode('{"policy":"component drift fixture","version":"verification-policy-0.1.0"}');
const tenantA = "11111111-1111-4111-8111-111111111111";

function auditFixture(overrides: Partial<{ provider: string; model: string; parser: string; grader: string; policy: string; tenantId: string }> = {}) {
  // Frozen test data from the core parity fixture, without importing another package's source tree.
  const input = JSON.parse(readFileSync(new URL("../../fixtures/component-drift-input.json", import.meta.url), "utf8")) as Parameters<typeof verifyDeterministicBundle>[0];
  const tenantId = overrides.tenantId ?? tenantA;
  const source = { ...input.bundle.captures[0]!.contentArtifact, tenantId };
  const bundle = structuredClone(input.bundle);
  bundle.captures[0]!.contentArtifact = source;
  bundle.policyVersion = overrides.policy ?? bundle.policyVersion;
  const deterministicResult = verifyDeterministicBundle({ ...input, bundle });
  const policyArtifact: VerificationArtifactHandle = { artifactId: "44444444-4444-4444-8444-444444444444", tenantId, digest: sha256Digest(policyBytes), mediaType: "application/json", byteLength: policyBytes.byteLength, objectKey: `${tenantId}/policy`, createdAt, producerActivityId: "policy-publisher", producerVersion: "1", encryptionClass: "managed", retentionClass: "audit", dataClassification: "internal", parentArtifactIds: [] };
  const inputsBytes = new TextEncoder().encode(JSON.stringify({ schemaVersion: "verification-policy-inputs.v1", policyVersion: bundle.policyVersion, runId: "run-1", recordedAt: createdAt, deterministicResult, assertions: [{ assertionId: "claim-1", riskClass: "medium", downstreamUse: ["semantic_verification"], claimScope: "source_summary", semantic: { assertionId: "claim-1", verdict: "pending_semantic_review", disposition: "review", evidenceSupport: "not_assessed", worldCorrectness: "not_assessed", attributionFaithfulness: "not_assessed", provenanceIntegrity: "satisfied", sourceAuthority: "not_assessed", judgeIdentities: [], supportingFragmentIds: ["fragment-evidence-1"], contradictingFragmentIds: [], unsupportedFacets: [], reasonCodes: [], crossFamilySecondJudge: false, rawProviderConfidences: [] }, authorityStatus: "unknown", independentCorroboration: false, conflictPresent: false, criticalFactsKnown: true }], metrics: [], sourceAssessments: [] }));
  const inputsArtifact: VerificationArtifactHandle = { ...policyArtifact, artifactId: "55555555-5555-4555-8555-555555555555", digest: sha256Digest(inputsBytes), byteLength: inputsBytes.byteLength, objectKey: `${tenantId}/inputs`, producerActivityId: "policy-input-recorder" };
  const manifest: VerificationRunManifest = { verificationContractVersion: "verification.v1", manifestId: `manifest-${tenantId}`, runId: "run-1", versions: { policy: overrides.policy ?? input.bundle.policyVersion, schema: "verification.v1", normalizer: "text.v1", parser: overrides.parser ?? "parser.v1", grader: overrides.grader ?? "grader.v1" }, code: { gitSha: "fixture-sha", dirty: false }, runtime: { platform: "test", deploymentId: "verification-agent" }, provider: { endpointIdentity: overrides.provider ?? "fixture-provider", model: overrides.model ?? "fixture-model", nativeConfiguration: { tokenUsage: 1, inputTokens: 1, outputTokens: 0 }, pricingSnapshotArtifactId: policyArtifact.artifactId }, inputArtifacts: [source, policyArtifact, inputsArtifact], outputArtifacts: [], stages: [{ name: "deterministic", status: "succeeded", startedAt: createdAt, endedAt: createdAt }], calls: [], toolPolicy: [], networkPolicy: "disabled", deterministicResult, judgments: [], policyOutcome: "pass", resultDigest: digestCanonicalJson(deterministicResult), lineage: [], canonicalization: { algorithm: "RFC8785", implementationVersion: "knowledge-verification.v1", manifestDigest: sha256Digest("") }, startedAt: createdAt, completedAt: createdAt };
  manifest.canonicalization.manifestDigest = verificationManifestDigest(manifest);
  return { input, bundle, manifest, tenantId, policyArtifact, inputsArtifact, inputsBytes };
}

async function signedAudit(overrides: Parameters<typeof auditFixture>[0] = {}, signer = createEd25519Signer(generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString(), "audit-key")) {
  const raw = auditFixture(overrides);
  const audit = await sealAuditBundle({ tenantId: raw.tenantId, verificationBundle: raw.bundle, manifest: raw.manifest, policyBinding: { policyVersion: raw.bundle.policyVersion, policyArtifact: raw.policyArtifact, recordedPolicyInputsArtifact: raw.inputsArtifact }, recordedPolicyInputsBytes: raw.inputsBytes, policyDecision: { outcome: "pass" }, signer }) as unknown as VerificationAuditBundle;
  return { audit, signer };
}

function resolverFor(entries: Map<string, { artifact: VerificationArtifactHandle; bytes: Uint8Array }>): TrustedArtifactResolver {
  const stable = new Map([...entries].map(([key, row]) => [key, { artifact: structuredClone(row.artifact), bytes: row.bytes.slice() }] as const));
  return { async authorizeArtifact(input) { if (!stable.has(input.artifactId)) throw new Error("UNAUTHORIZED_ARTIFACT"); }, async hydrateRegisteredArtifact(input) { const row = stable.get(input.artifactId); if (!row) throw new Error("MISSING_ARTIFACT"); return { registration: row.artifact, bytes: row.bytes.slice() }; } };
}

async function pair() {
  const keys = generateKeyPairSync("ed25519");
  const privatePem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const signer = createEd25519Signer(privatePem, "audit-key");
  const verifier = createEd25519Verifier({ "audit-key": publicPem });
  const baseline = await signedAudit({}, signer);
  const candidate = await signedAudit({ provider: "provider.changed", model: "model.changed", parser: "parser.changed", grader: "grader.changed", policy: "verification-policy.changed" }, signer);
  const make = (audit: VerificationAuditBundle, artifactId: string) => { const bytes = new TextEncoder().encode(canonicalizeJson(audit)); const artifact: VerificationArtifactHandle = { artifactId, tenantId: audit.tenantId, digest: sha256Digest(bytes), mediaType: "application/json", byteLength: bytes.byteLength, objectKey: `${audit.tenantId}/${artifactId}`, createdAt, producerActivityId: "audit-fixture", producerVersion: "1", encryptionClass: "managed", retentionClass: "audit", dataClassification: "internal", parentArtifactIds: [] }; return { artifact, bytes }; };
  const b = make(baseline.audit, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"); const c = make(candidate.audit, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  const entries = new Map([[b.artifact.artifactId, b], [c.artifact.artifactId, c]]);
  return { baseline: b, candidate: c, verifier, resolver: () => resolverFor(entries), signer };
}

describe("verified component drift comparator", () => {
  it("derives all five changed dimensions from two signed manifests", async () => { const v = await pair(); const result = await compareVerifiedComponentVersions({ baseline: { artifact: v.baseline.artifact }, candidate: { artifact: v.candidate.artifact }, createResolver: v.resolver, verifier: v.verifier }); expect(result.changedDimensions).toEqual(["provider", "model", "parser", "grader", "policy"]); expect(result.payloadDigest).toMatch(/^sha256:[0-9a-f]{64}$/); });
  it("returns no changes for equal signed manifests", async () => { const v = await pair(); const result = await compareVerifiedComponentVersions({ baseline: { artifact: v.baseline.artifact }, candidate: { artifact: v.baseline.artifact }, createResolver: v.resolver, verifier: v.verifier }); expect(result.changedDimensions).toEqual([]); });
  it("rejects unsigned, forged and cross-tenant artifact bindings", async () => { const v = await pair(); const unsigned = structuredClone(v.baseline); const unsignedAudit = JSON.parse(new TextDecoder().decode(v.baseline.bytes)); delete unsignedAudit.seal.signatureAlgorithm; delete unsignedAudit.seal.keyId; delete unsignedAudit.seal.signatureBase64; const bytes = new TextEncoder().encode(canonicalizeJson(unsignedAudit)); const unsignedArtifact = { ...v.baseline.artifact, digest: sha256Digest(bytes), byteLength: bytes.byteLength }; const resolver = () => resolverFor(new Map([[unsignedArtifact.artifactId, { artifact: unsignedArtifact, bytes }], [v.candidate.artifact.artifactId, v.candidate]])); await expect(compareVerifiedComponentVersions({ baseline: { artifact: unsignedArtifact }, candidate: { artifact: v.candidate.artifact }, createResolver: resolver, verifier: v.verifier })).rejects.toThrow("COMPONENT_DRIFT_SIGNED_MANIFEST_REQUIRED"); const foreignArtifact = { ...v.candidate.artifact, tenantId: "99999999-9999-4999-8999-999999999999" }; await expect(compareVerifiedComponentVersions({ baseline: { artifact: v.baseline.artifact }, candidate: { artifact: foreignArtifact }, createResolver: () => resolverFor(new Map([[v.baseline.artifact.artifactId, v.baseline], [foreignArtifact.artifactId, { artifact: foreignArtifact, bytes: v.candidate.bytes }]])), verifier: v.verifier })).rejects.toThrow(); });
  it("snapshots caller data before asynchronous resolver work", async () => { const v = await pair(); const input = { baseline: { artifact: v.baseline.artifact }, candidate: { artifact: v.candidate.artifact }, createResolver: v.resolver, verifier: v.verifier }; const pending = compareVerifiedComponentVersions(input); input.candidate.artifact.digest = "sha256:" + "0".repeat(64) as `sha256:${string}`; await expect(pending).resolves.toMatchObject({ changedDimensions: ["provider", "model", "parser", "grader", "policy"] }); });
});
