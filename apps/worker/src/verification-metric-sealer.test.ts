import type { OperationContext, VerificationArtifactHandle, VerificationBundle, VerificationPolicyDefinition } from "@aiengineer/knowledge-contracts";
import type { VerificationMetricServiceResult } from "@aiengineer/knowledge-application";
import type { RegisterContentAddressedVerificationArtifactInput } from "@aiengineer/knowledge-persistence";
import { VerificationSealPolicyCatalog } from "@aiengineer/knowledge-application";
import { deterministicUuid } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, sha256Digest, verifyDeterministicBundle, type RuntimePrincipalBinding, type VerificationAuditBundle } from "@aiengineer/knowledge-verification";
import { describe, expect, it } from "vitest";
import { createVerificationMetricAuditSealer, type VerificationMetricAuditSealerRepository } from "./verification-metric-sealer.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const operationId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";
const producerAttemptId = "44444444-4444-4444-8444-444444444444";
const missionId = "55555555-5555-4555-8555-555555555555";
const workItemId = "66666666-6666-4666-8666-666666666666";
const createdAt = "2026-09-05T12:00:00.000Z";
type PrototypeFixture = { prototypeMetricInput(): { bundle: VerificationBundle; artifacts: readonly { artifactId: string; content: string | Uint8Array }[] }; runtimePrincipals: RuntimePrincipalBinding; };
const prototypeFixtureUrl = new URL("../../../packages/verification/src/deterministic/testing/prototype-parity.fixture.js", import.meta.url).href;

function handle(id: string, bytes: Uint8Array, parents: readonly string[] = [], signature?: `sha256:${string}`): VerificationArtifactHandle {
  const digest = sha256Digest(bytes);
  return { artifactId: id, tenantId, digest, mediaType: "application/json", byteLength: bytes.byteLength, objectKey: `${tenantId}/${digest.slice(7, 9)}/${digest.slice(7)}`,
    createdAt, producerActivityId: "fixture", producerVersion: "fixture.v1", encryptionClass: "managed", retentionClass: "test", dataClassification: "restricted",
    parentArtifactIds: [...parents], ...(signature ? { transformationSignature: signature } : {}) };
}

class FakeRepository implements VerificationMetricAuditSealerRepository {
  readonly artifacts = new Map<string, { handle: VerificationArtifactHandle; bytes: Uint8Array }>();
  readonly registrations: RegisterContentAddressedVerificationArtifactInput[] = [];
  readonly records: unknown[] = [];
  recovery: VerificationAuditBundle | undefined;
  add(artifact: VerificationArtifactHandle, bytes: Uint8Array): void { this.artifacts.set(artifact.artifactId, { handle: artifact, bytes }); }
  createTrustedArtifactResolver() {
    let ticket: string | undefined;
    return { authorizeArtifact: async ({ artifactId }: { tenantId: string; artifactId: string }) => { ticket = artifactId; },
      hydrateRegisteredArtifact: async ({ artifactId }: { tenantId: string; artifactId: string }) => {
        if (ticket !== artifactId) throw new Error("UNAUTHORIZED_HYDRATION");
        const item = this.artifacts.get(artifactId); if (!item) throw new Error("ARTIFACT_NOT_FOUND"); ticket = undefined;
        return { registration: item.handle, bytes: Uint8Array.from(item.bytes) };
      } };
  }
  async registerContentAddressedArtifact(input: RegisterContentAddressedVerificationArtifactInput): Promise<VerificationArtifactHandle> {
    this.registrations.push(input);
    const artifactId = deterministicUuid("artifact", `${input.tenantId}:${sha256Digest(input.bytes)}`);
    const current = this.artifacts.get(artifactId); if (current) return current.handle;
    const registration = handle(artifactId, input.bytes, input.parentArtifactIds, input.transformationSignature);
    this.add(registration, Uint8Array.from(input.bytes)); return registration;
  }
  async recordVerificationRun(input: unknown): Promise<void> { this.records.push(input); }
  async loadAuditBundleForOperationRecovery(): Promise<VerificationAuditBundle | undefined> { return this.recovery; }
}

function context(id = operationId): OperationContext { return { contractVersion: "v1", tenantId, operationId: id, missionId, workItemId, attemptId, correlationId: "metric-seal-test",
  actor: { kind: "service", id: "77777777-7777-4777-8777-777777777777", serviceIdentity: "knowledge_worker" }, capabilityVersion: "verification.v1",
  idempotencyKey: "metric-seal-test", reason: "focused worker sealing fixture" }; }

async function fixture() {
  const { prototypeMetricInput, runtimePrincipals } = await import(prototypeFixtureUrl) as PrototypeFixture;
  const prototype = prototypeMetricInput(); const bundle = structuredClone(prototype.bundle) as VerificationBundle;
  const sourceBytes = new TextEncoder().encode(String(prototype.artifacts[0]!.content));
  const source = handle("88888888-8888-4888-8888-888888888888", sourceBytes); bundle.captures[0]!.contentArtifact = source;
  const deterministicResult = verifyDeterministicBundle({ bundle, artifacts: [{ artifactId: source.artifactId, content: sourceBytes }], runtimePrincipals });
  const observationsBytes = new TextEncoder().encode(canonicalizeJson(bundle));
  const observations = handle("99999999-9999-4999-8999-999999999999", observationsBytes);
  const profileBytes = new TextEncoder().encode(canonicalizeJson({ schemaVersion: "verification-metric-profile.v1", profileId: "fixture",
    observations:{artifactId:observations.artifactId,digest:observations.digest},captureIds:bundle.captures.map(item=>item.captureId),projectionAdmissions:[] }));
  const profile = handle("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", profileBytes);
  const definition: VerificationPolicyDefinition = { schemaVersion: "verification-policy.v1", policyVersion: bundle.policyVersion, definitionId: "metric-policy-fixture",
    criticalDownstreamUses: ["verification"], requireCrossFamilyForRisk: [], requireIndependentAuthorityForScopes: [], mixedEvidenceOutcome: "review", unknownCriticalOutcome: "review", authorityWithheldOutcome: "review", reviewAvailable: true };
  const policyBytes = new TextEncoder().encode(canonicalizeJson(definition)); const policy = handle("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", policyBytes);
  const repository = new FakeRepository(); for (const [artifact, bytes] of [[source, sourceBytes], [observations, observationsBytes], [profile, profileBytes], [policy, policyBytes]] as const) repository.add(artifact, bytes);
  const policyCatalog = new VerificationSealPolicyCatalog([{ tenantId, policyVersion: bundle.policyVersion, policyArtifact: { artifactId: policy.artifactId, digest: policy.digest } }]);
  const verified: VerificationMetricServiceResult = { admissionState: "mechanical_only", deterministicResult, observationsArtifact: observations, profileArtifact: profile, producerAttemptId, hydratedCaptureArtifactIds: [source.artifactId] };
  const sealer = createVerificationMetricAuditSealer({ repository, policyCatalog, storageBucket: "test-bucket", runtime: { code: { gitSha: "fixture-sha", dirty: false, normalizerVersion: "knowledge-verification.rfc8785.v1" }, platform: "test", deploymentId: bundle.verifier.deploymentId }, now: () => "2026-09-05T12:00:02.000Z" });
  return { bundle, repository, verified, sealer };
}
const lease = { stepId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", leaseToken: "lease-token", fencingToken: 7, holderIdentity: "metric-worker" };

describe("VerificationMetricAuditSealer", () => {
  it("retains profile envelope references and their registered parents", async () => {
    const test=await fixture();
    const parentBytes=new TextEncoder().encode("registered envelope dependency");
    const parent=handle("12345678-1234-4234-8234-123456789012",parentBytes);
    const envelopeBytes=new TextEncoder().encode("registered transformation envelope");
    const envelope=handle("12345678-1234-4234-8234-123456789013",envelopeBytes,[parent.artifactId],sha256Digest("transform"));
    test.repository.add(parent,parentBytes);test.repository.add(envelope,envelopeBytes);
    const original=test.repository.artifacts.get(test.verified.profileArtifact.artifactId)!;
    const profile=JSON.parse(new TextDecoder().decode(original.bytes));
    profile.projectionAdmissions=[{captureId:test.bundle.captures[0]!.captureId,projectionArtifactId:test.bundle.captures[0]!.contentArtifact.artifactId,transformationArtifactId:envelope.artifactId}];
    const bytes=new TextEncoder().encode(canonicalizeJson(profile));
    const replacement=handle(original.handle.artifactId,bytes);test.repository.add(replacement,bytes);
    await test.sealer.seal({verified:{...test.verified,profileArtifact:replacement},context:context(),lease,startedAt:createdAt});
    const audit=JSON.parse(new TextDecoder().decode(test.repository.registrations.find(item=>item.artifactType==="verification_run_manifest")!.bytes)) as VerificationAuditBundle;
    expect(audit.manifest.inputArtifacts.map(item=>item.artifactId)).toEqual(expect.arrayContaining([envelope.artifactId,parent.artifactId]));
    expect(audit.manifest.lineage).toEqual(expect.arrayContaining([expect.objectContaining({fromArtifactId:envelope.artifactId,toArtifactId:parent.artifactId,activityId:"fixture"})]));
  });
  it("fails before writing a seal when a registered provenance parent is unavailable", async () => {
    const test=await fixture();
    const policy=[...test.repository.artifacts.values()].find(item=>item.handle.artifactId==="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!;
    policy.handle.parentArtifactIds.push("12345678-1234-4234-8234-123456789014");
    await expect(test.sealer.seal({verified:test.verified,context:context(),lease,startedAt:createdAt})).rejects.toThrow("ARTIFACT_NOT_FOUND");
    expect(test.repository.registrations).toHaveLength(0);
  });
  it("bounds provenance traversal before recording any output", async () => {
    const test=await fixture();
    const policy=test.repository.artifacts.get("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!;
    for(let i=0;i<257;i++){
      const bytes=new TextEncoder().encode(`parent-${i}`);
      const parent=handle(deterministicUuid("bounded-parent",String(i)),bytes);
      test.repository.add(parent,bytes);policy.handle.parentArtifactIds.push(parent.artifactId);
    }
    await expect(test.sealer.seal({verified:test.verified,context:context(),lease,startedAt:createdAt})).rejects.toThrow("PROVENANCE_LIMIT");
    expect(test.repository.registrations).toHaveLength(0);
  });
  it("seals conservative metric policy inputs and binds the run to the lease", async () => {
    const test = await fixture(); const result = await test.sealer.seal({ verified: test.verified, context: context(), lease, startedAt: "2026-09-05T12:00:01.000Z" });
    // A conservative metric path cannot pass. This fixture's mechanical
    // evidence may itself fail, which is a stricter allowed disposition.
    expect(["review", "fail"]).toContain(result.policyOutcome);
    expect(test.repository.registrations.map((item) => item.artifactType)).toEqual(["deterministic_verification_result", "verification_policy_inputs", "verification_policy_decision", "verification_run_manifest"]);
    expect(test.repository.records[0]).toMatchObject({ operationId, missionId, workItemId, producerAttemptId, verifierAttemptId: attemptId, lease, status: result.policyOutcome === "fail" ? "failed" : "review" });
    const policyInputs = test.repository.registrations.find((item) => item.artifactType === "verification_policy_inputs")!;
    expect(JSON.parse(new TextDecoder().decode(policyInputs.bytes))).toMatchObject({ metrics: expect.arrayContaining([expect.objectContaining({ riskClass: "critical", downstreamUse: ["verification"], criticalFactsKnown: false, conflictPresent: false })]) });
    const audit = JSON.parse(new TextDecoder().decode(test.repository.registrations.find((item) => item.artifactType === "verification_run_manifest")!.bytes)) as VerificationAuditBundle;
    expect(audit.manifest.policyOutcome).toBe(result.policyOutcome); expect(audit.manifest.networkPolicy).toBe("allowlisted"); expect(result.manifestDigest).toBe(audit.manifest.canonicalization.manifestDigest);
  });
  it("reuses an exact internal recovery audit without changing artifacts or timing", async () => {
    const test = await fixture(); const first = await test.sealer.seal({ verified: test.verified, context: context(), lease, startedAt: "2026-09-05T12:00:01.000Z" });
    test.repository.recovery = JSON.parse(new TextDecoder().decode(test.repository.registrations.find((item) => item.artifactType === "verification_run_manifest")!.bytes)) as VerificationAuditBundle;
    const registrations = test.repository.registrations.length; const records = test.repository.records.length;
    await expect(test.sealer.seal({ verified: test.verified, context: context(), lease, startedAt: "2026-09-05T12:01:01.000Z" })).resolves.toEqual(first);
    expect(test.repository.registrations).toHaveLength(registrations); expect(test.repository.records).toHaveLength(records);
  });
  it("does not recover a seal under a different profile grant", async () => {
    const test = await fixture(); await test.sealer.seal({ verified: test.verified, context: context(), lease, startedAt: "2026-09-05T12:00:01.000Z" });
    test.repository.recovery = JSON.parse(new TextDecoder().decode(test.repository.registrations.find((item) => item.artifactType === "verification_run_manifest")!.bytes)) as VerificationAuditBundle;
    const replacementBytes = new TextEncoder().encode(canonicalizeJson({ schemaVersion: "verification-metric-profile.v1", profile: "replacement" }));
    const replacement = handle("dddddddd-dddd-4ddd-8ddd-dddddddddddd", replacementBytes); test.repository.add(replacement, replacementBytes);
    await expect(test.sealer.seal({ verified: { ...test.verified, profileArtifact: replacement }, context: context(), lease, startedAt: "2026-09-05T12:00:01.000Z" })).rejects.toThrow("VERIFICATION_METRIC_SEAL_RECOVERY_DRIFT");
  });
  it("rejects recovery that omits a required provenance input", async () => {
    const test=await fixture();await test.sealer.seal({verified:test.verified,context:context(),lease,startedAt:createdAt});
    const audit=JSON.parse(new TextDecoder().decode(test.repository.registrations.find(item=>item.artifactType==="verification_run_manifest")!.bytes)) as VerificationAuditBundle;
    audit.manifest.inputArtifacts=audit.manifest.inputArtifacts.filter(item=>item.artifactId!==test.bundle.captures[0]!.contentArtifact.artifactId);
    test.repository.recovery=audit;
    await expect(test.sealer.seal({verified:test.verified,context:context(),lease,startedAt:createdAt})).rejects.toThrow("RECOVERY_PROVENANCE_INCOMPLETE");
  });
  it("reuses the mechanical result CAS across different operations without operation-bound metadata", async () => {
    const test = await fixture(); await test.sealer.seal({ verified: test.verified, context: context(), lease, startedAt: "2026-09-05T12:00:01.000Z" });
    await test.sealer.seal({ verified: test.verified, context: context("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"), lease, startedAt: "2026-09-05T12:00:01.000Z" });
    const records = test.repository.records as Array<{ resultArtifact: VerificationArtifactHandle; runId: string }>;
    expect(records).toHaveLength(2); expect(records[1]!.resultArtifact.artifactId).toBe(records[0]!.resultArtifact.artifactId); expect(records[1]!.runId).not.toBe(records[0]!.runId);
  });
  it("rejects an empty metric set before policy evaluation can turn it into a pass", async () => {
    const test = await fixture(); const bytes = new TextEncoder().encode(canonicalizeJson({ ...test.bundle, metricObservations: [] }));
    const observations = handle(test.verified.observationsArtifact.artifactId, bytes); test.repository.add(observations, bytes);
    await expect(test.sealer.seal({ verified: { ...test.verified, observationsArtifact: observations }, context: context(), lease, startedAt: "2026-09-05T12:00:01.000Z" })).rejects.toThrow("VERIFICATION_METRIC_SEAL_METRICS_REQUIRED");
    expect(test.repository.registrations).toHaveLength(0);
  });
  it("does not seal a result whose runtime deployment separation failed", async () => {
    const test = await fixture(); const deterministicResult = structuredClone(test.verified.deterministicResult); deterministicResult.deploymentSeparation.status = "not_established";
    await expect(test.sealer.seal({ verified: { ...test.verified, deterministicResult }, context: context(), lease, startedAt: "2026-09-05T12:00:01.000Z" })).rejects.toThrow("VERIFICATION_METRIC_SEALING_INELIGIBLE_DEPLOYMENT");
    expect(test.repository.registrations).toHaveLength(0);
  });
});
