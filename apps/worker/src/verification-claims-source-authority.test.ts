import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalizeJson, digestCanonicalJson, sha256Digest } from "@aiengineer/knowledge-verification";
import type { VerificationArtifactHandle, VerificationBundle } from "@aiengineer/knowledge-contracts";
import { claimsHostActivation, createClaimsSourceAuthorityStage, sourceAuthorityClaimDigest, SourceAuthorityReceiptSchema } from "./verification-claims-source-authority.js";

async function fixture() {
  const fixtureUrl = new URL("../../../packages/verification/src/deterministic/testing/prototype-parity.fixture.js", import.meta.url).href;
  const { prototypeClaimInput } = await import(fixtureUrl) as { prototypeClaimInput(): { bundle: VerificationBundle } };
  const bundle = structuredClone(prototypeClaimInput().bundle), tenantId = randomUUID();
  const artifacts = new Map<string, { registration: VerificationArtifactHandle; bytes: Uint8Array }>();
  function artifact(value: unknown, mediaType = "application/json", parents: string[] = []) {
    const bytes = new TextEncoder().encode(canonicalizeJson(value));
    const handle: VerificationArtifactHandle = { artifactId: randomUUID(), tenantId, digest: sha256Digest(bytes), byteLength: bytes.byteLength,
      mediaType, objectKey: "fixture", createdAt: "2026-09-14T00:00:00Z", producerActivityId: "independent-host-authority", producerVersion: "v1",
      encryptionClass: "test", retentionClass: "test", dataClassification: "internal", parentArtifactIds: parents,
      ...(parents.length ? { transformationSignature: digestCanonicalJson("independent-host-assessment") } : {}) };
    artifacts.set(handle.artifactId, { registration: handle, bytes }); return handle;
  }
  const content = artifact({ metric: 10, source: "Independent synthetic fixture" });
  bundle.captures[0]!.contentArtifact = content;
  bundle.assertions = [bundle.assertions[0]!];
  bundle.assertions[0]!.evidence = [bundle.assertions[0]!.evidence[0]!];
  bundle.assertions[0]!.evidence[0]!.fragment.representationArtifactId = content.artifactId;
  const claim = bundle.assertions[0]!, edge = claim.evidence[0]!, policyArtifact = artifact({ policy: "unchanged" });
  const receipt = SourceAuthorityReceiptSchema.parse({ schemaVersion: "verification-source-authority-receipt.v1", tenantId,
    policyDigest: policyArtifact.digest, profileDigest: digestCanonicalJson("pinned-semantic-profile"),
    assertions: [{ assertionId: claim.assertionId, claimDigest: sourceAuthorityClaimDigest(claim), sources: [{
      sourceDigest: digestCanonicalJson(bundle.sources[0]), captureDigest: digestCanonicalJson(bundle.captures[0]), contentArtifact: content,
      assessment: { assessmentId: "authority", assertionId: claim.assertionId, fragmentId: edge.fragment.fragmentId,
        sourceFamilyId: "independent-fixture", sourceOrganizationId: "independent-fixture",
        vector: { authority: "primary", independence: "independent", directness: "direct", freshness: "current", applicability: "direct" },
        claimScope: "descriptive_fact", evidenceScope: "single_sample_technical", publicationRelation: "not_publication",
        jurisdictionKnown: true, licenseKnown: true, freshnessKnown: true },
      criticalFacts: ["source_identity", "authority", "independence", "directness", "freshness", "applicability", "jurisdiction", "license"]
        .map(kind => ({ kind, finding: "known", explanation: "Host independently established this synthetic source fact.", evidenceArtifact: content })),
    }] }] });
  let authorized = true;
  const repository = { createTrustedArtifactResolver: () => ({ async authorizeArtifact() {}, async hydrateRegisteredArtifact({ artifactId }: { artifactId: string }) {
    const value = artifacts.get(artifactId); if (!value) throw new Error("MISSING_RETAINED_BYTES"); return value;
  } }) };
  const database = { transaction: async (_tenantId: string, work: (client: unknown) => Promise<unknown>) => work({ query: async () => ({ rows: [{ authorized }] }) }) };
  const stage = (value = receipt) => createClaimsSourceAuthorityStage({ database: database as never, repository,
    pins: [{ tenantId, issuerAttemptId: randomUUID(), artifact: artifact(value, "application/vnd.aiengineer.verification-source-authority-receipt+json",
      [content.artifactId, policyArtifact.artifactId]) }] });
  return { receipt, bundle, content, artifacts, stage, request: { tenantId, bundle, policyArtifact }, denyIssuer() { authorized = false; } };
}

describe("independent host source authority", () => {
  it("derives complete authority from pinned receipts and ignores caller authority labels", async () => {
    const f = await fixture();
    f.bundle.assertions[0]!.evidence[0]!.authority.authority = "promotional";
    const result = await f.stage().assess(f.request);
    expect(result.assertions.get(f.bundle.assertions[0]!.assertionId)).toEqual({ authorityStatus: "sufficient",
      independentCorroboration: true, conflictPresent: false, criticalFactsKnown: true });
    expect(result.sourceAssessments).toHaveLength(1);
    expect(result.semanticProfileDigests.get(f.bundle.assertions[0]!.assertionId)).toBe(f.receipt.profileDigest);
  });

  it.each(["tenant", "policy", "claim", "source", "capture", "missing", "census", "fact"])("rejects %s receipt drift", async kind => {
    const f = await fixture(), changed = structuredClone(f.receipt);
    if (kind === "tenant") changed.tenantId = randomUUID();
    if (kind === "policy") changed.policyDigest = digestCanonicalJson("different-policy");
    if (kind === "claim") changed.assertions[0]!.claimDigest = digestCanonicalJson("different-claim");
    if (kind === "source") changed.assertions[0]!.sources[0]!.sourceDigest = digestCanonicalJson("different-source");
    if (kind === "capture") changed.assertions[0]!.sources[0]!.captureDigest = digestCanonicalJson("different-capture");
    if (kind === "missing") changed.assertions[0]!.sources = [];
    if (kind === "census") changed.assertions[0]!.sources[0]!.criticalFacts.pop();
    if (kind === "fact") changed.assertions[0]!.sources[0]!.criticalFacts[0]!.finding = "unknown";
    await expect(f.stage(changed).assess(f.request)).rejects.toThrow();
  });

  it("rejects changed retained bytes and producer-authored receipts", async () => {
    const f = await fixture();
    f.artifacts.get(f.content.artifactId)!.bytes[0] = 0;
    await expect(f.stage().assess(f.request)).rejects.toThrow("SOURCE_AUTHORITY_ARTIFACT_DRIFT");
    const independent = await fixture(); independent.denyIssuer();
    await expect(independent.stage().assess(independent.request)).rejects.toThrow("SOURCE_AUTHORITY_INDEPENDENT_ISSUER_REQUIRED");
  });

  it("keeps unknown source facts unknown despite valid custody", async () => {
    const f = await fixture(), changed = structuredClone(f.receipt), source = changed.assertions[0]!.sources[0]!;
    source.assessment.vector.authority = "unknown";
    source.criticalFacts.find(item => item.kind === "authority")!.finding = "unknown";
    const result = await f.stage(changed).assess(f.request);
    expect(result.assertions.get(f.bundle.assertions[0]!.assertionId)).toMatchObject({ authorityStatus: "unknown", criticalFactsKnown: false });
  });
});

it("requires signed native policy configuration for explicitly enabled direct-selector claims", () => {
  const input = { mode: "1", projectionConfigured: false, sourceAuthorityConfigured: false, policyConfigured: true, signerConfigured: true, nativePersistence: true };
  expect(claimsHostActivation(input)).toBe(true);
  for (const change of [{ mode: "yes" }, { signerConfigured: false }, { policyConfigured: false }, { nativePersistence: false }, { mode: "0", sourceAuthorityConfigured: true }])
    expect(() => claimsHostActivation({ ...input, ...change })).toThrow();
  expect(claimsHostActivation({ ...input, mode: undefined })).toBe(false);
});
