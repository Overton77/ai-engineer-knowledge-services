import type { OperationContext, VerificationArtifactHandle, VerificationAuditInspectionResult, VerificationRunManifest } from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, digestCanonicalJson, sha256Digest, type RuntimePrincipalBinding, type VerificationAuditBundle } from "@aiengineer/knowledge-verification";
import { describe, expect, it, vi } from "vitest";
import { VerificationAdjudicationRequestApplicationService } from "./verification-adjudication.js";

const tenantId = "11111111-1111-4111-8111-111111111111", runId = "22222222-2222-4222-8222-222222222222", createdAt = "2026-09-07T00:00:00.000Z";
const context: OperationContext = { contractVersion: "v1", tenantId, operationId: "33333333-3333-4333-8333-333333333333", attemptId: "44444444-4444-4444-8444-444444444444", correlationId: "synthetic-adjudication-test", actor: { kind: "service", id: "55555555-5555-4555-8555-555555555555", serviceIdentity: "knowledge_worker" }, capabilityVersion: "verification-adjudication.v1", idempotencyKey: "synthetic-adjudication-test", reason: "unit test only" };
type PrototypeFixture = { prototypeClaimInput(): { bundle: VerificationAuditBundle["verificationBundle"] }; runtimePrincipals: RuntimePrincipalBinding };
const fixtureUrl = new URL("../../../../verification/src/deterministic/testing/prototype-parity.fixture.js", import.meta.url).href;

function handle(artifactId: string, digest: `sha256:${string}`, mediaType: string, parents: readonly string[] = []): VerificationArtifactHandle {
  return { artifactId, tenantId, digest, mediaType, byteLength: 2, objectKey: `${tenantId}/${digest.slice(7, 9)}/${digest.slice(7)}`, createdAt, producerActivityId: "synthetic-test-fixture", producerVersion: "test.v1", encryptionClass: "managed", retentionClass: "audit", dataClassification: "restricted", parentArtifactIds: [...parents] };
}

async function fixture() {
  const prototype = await import(fixtureUrl) as PrototypeFixture;
  const verificationBundle = prototype.prototypeClaimInput().bundle;
  const source = verificationBundle.captures[0]!.contentArtifact;
  const bundleArtifact = handle("66666666-6666-4666-8666-666666666666", digestCanonicalJson(verificationBundle), "application/vnd.aiengineer.verification-bundle+json", [source.artifactId]);
  const deterministicResultArtifact = handle("77777777-7777-4777-8777-777777777777", sha256Digest("deterministic"), "application/vnd.aiengineer.deterministic-verification-result+json", [bundleArtifact.artifactId]);
  const policyArtifact = handle("88888888-8888-4888-8888-888888888888", sha256Digest("policy"), "application/vnd.aiengineer.verification-policy+json");
  const policyInputsArtifact = handle("99999999-9999-4999-8999-999999999999", sha256Digest("policy-inputs"), "application/vnd.aiengineer.verification-policy-inputs+json", [deterministicResultArtifact.artifactId]);
  const policyDecisionArtifact = handle("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sha256Digest("policy-decision"), "application/vnd.aiengineer.verification-policy-decision+json", [deterministicResultArtifact.artifactId, policyArtifact.artifactId, policyInputsArtifact.artifactId]);
  const manifest: VerificationRunManifest = { verificationContractVersion: "verification.v1", manifestId: "synthetic-adjudication-manifest", runId, versions: { policy: verificationBundle.policyVersion, schema: "verification.v1", normalizer: "test.v1" }, code: { gitSha: "synthetic", dirty: true }, runtime: { platform: "test", deploymentId: verificationBundle.verifier.deploymentId }, inputArtifacts: [source, policyArtifact, policyInputsArtifact], outputArtifacts: [bundleArtifact, deterministicResultArtifact, policyDecisionArtifact], stages: [{ name: "test", status: "succeeded", startedAt: createdAt, endedAt: createdAt }], calls: [], toolPolicy: [], networkPolicy: "disabled", deterministicResult: { status: "failed" } as never, judgments: [], policyOutcome: "review", resultDigest: deterministicResultArtifact.digest, lineage: [], canonicalization: { algorithm: "RFC8785", implementationVersion: "test.v1", manifestDigest: sha256Digest("manifest") }, startedAt: createdAt, completedAt: createdAt };
  const audit: VerificationAuditBundle = { verificationContractVersion: "verification.v1", tenantId, verificationBundle, manifest, policyBinding: { policyVersion: verificationBundle.policyVersion, policyArtifact, recordedPolicyInputsArtifact: policyInputsArtifact }, deterministicResultDigest: deterministicResultArtifact.digest as `sha256:${string}`, policyDecisionDigest: policyDecisionArtifact.digest as `sha256:${string}`, seal: { payloadDigest: sha256Digest("payload"), signatureAlgorithm: "Ed25519", keyId: "server-key", signatureBase64: "signed" } };
  const retained = [...manifest.inputArtifacts, ...manifest.outputArtifacts];
  const manifestArtifact = handle("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", digestCanonicalJson(audit), "application/vnd.aiengineer.verification-run-manifest+json", retained.map((artifact) => artifact.artifactId));
  const inspection: VerificationAuditInspectionResult = { schemaVersion: "verification-audit-inspection.v1", verificationContractVersion: "verification.v1", auditArtifact: { artifactId: manifestArtifact.artifactId, digest: manifestArtifact.digest, mediaType: manifestArtifact.mediaType, sizeBytes: manifestArtifact.byteLength }, run: { runId, manifestId: manifest.manifestId, manifestDigest: manifest.canonicalization.manifestDigest, deterministicResultDigest: audit.deterministicResultDigest, policyDecisionDigest: audit.policyDecisionDigest, policyOutcome: manifest.policyOutcome, startedAt: createdAt, completedAt: createdAt }, proof: { payloadDigest: audit.seal.payloadDigest, signatureStatus: "verified", deterministicReplay: "exact", policyReplay: "exact", replayedArtifactCount: 6, inputArtifactCount: 3, outputArtifactCount: 3 } };
  return { auditBundle: audit, manifestArtifact, inspection };
}

describe("verification adjudication request application", () => {
  it("builds an immutable pending packet from canonical signed replay without asserting a human decision", async () => {
    const value = await fixture(), inspectAndResolve = vi.fn(async () => value);
    const service = new VerificationAdjudicationRequestApplicationService({ inspectAndResolve }, { eligibleReviewerRoles: ["verification_expert"], quorumRequired: 2 });
    const request = { verificationContractVersion: "verification.v1" as const, target: { kind: "run" as const, runId }, reason: "policy_review" as const, evidencePacket: { artifactId: value.manifestArtifact.artifactId, digest: value.manifestArtifact.digest }, requesterNote: "Please review the retained policy outcome." };
    const prepared = await service.prepare(request, context);
    expect(prepared.packet.requestBinding.requesterActor).toEqual({ kind: "service", id: context.actor.id });
    expect(prepared.packet.sealedRun).toMatchObject({ runKind: "claims", originalPolicyOutcome: "review", policyDecisionArtifact: { digest: value.auditBundle.policyDecisionDigest } });
    expect(prepared.packet.reviewRequirements).toEqual({ eligibleReviewerRoles: ["verification_expert"], quorumRequired: 2 });
    expect(prepared.parentArtifacts).toHaveLength(6);
    expect(new TextDecoder().decode(prepared.packetBytes)).toBe(canonicalizeJson(prepared.packet));
    expect(prepared.packetDigest).toBe(sha256Digest(prepared.packetBytes));
    expect(canonicalizeJson(prepared.packet)).not.toContain("humanDecisionRecorded");
    expect(inspectAndResolve).toHaveBeenCalledWith(expect.objectContaining({ context, request }));
  });

  it("rejects an absent target without creating a packet", async () => {
    const value = await fixture(), inspectAndResolve = vi.fn(async () => value);
    const service = new VerificationAdjudicationRequestApplicationService({ inspectAndResolve }, { eligibleReviewerRoles: ["verification_expert"], quorumRequired: 1 });
    await expect(service.prepare({ verificationContractVersion: "verification.v1", target: { kind: "assertion", assertionId: "missing" }, reason: "quality_failure", evidencePacket: { artifactId: value.manifestArtifact.artifactId, digest: value.manifestArtifact.digest } }, context)).rejects.toThrow("VERIFICATION_ADJUDICATION_TARGET_NOT_FOUND");
  });

  it("rejects manifest, policy-decision, and registered parent drift", async () => {
    const value = await fixture();
    const request = { verificationContractVersion: "verification.v1" as const, target: { kind: "run" as const, runId }, reason: "appeal" as const, evidencePacket: { artifactId: value.manifestArtifact.artifactId, digest: value.manifestArtifact.digest } };
    const service = (resolved: typeof value) => new VerificationAdjudicationRequestApplicationService({ inspectAndResolve: async () => resolved }, { eligibleReviewerRoles: ["verification_expert"], quorumRequired: 1 });
    await expect(service({ ...value, manifestArtifact: { ...value.manifestArtifact, digest: sha256Digest("drift") } }).prepare(request, context)).rejects.toThrow("VERIFICATION_ADJUDICATION_RUN_BINDING_MISMATCH");
    await expect(service({ ...value, inspection: { ...value.inspection, run: { ...value.inspection.run, policyDecisionDigest: sha256Digest("drift") } } }).prepare(request, context)).rejects.toThrow("VERIFICATION_ADJUDICATION_RUN_BINDING_MISMATCH");
    await expect(service({ ...value, manifestArtifact: { ...value.manifestArtifact, parentArtifactIds: value.manifestArtifact.parentArtifactIds.slice(1) } }).prepare(request, context)).rejects.toThrow("VERIFICATION_ADJUDICATION_RUN_BINDING_MISMATCH");
  });

  it("propagates bounded cancellation through canonical inspection", async () => {
    const controller = new AbortController();
    const started = Promise.withResolvers<void>();
    const service = new VerificationAdjudicationRequestApplicationService({ inspectAndResolve: async ({ signal }) => { started.resolve(); return new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })); } }, { eligibleReviewerRoles: ["verification_expert"], quorumRequired: 1 });
    const pending = service.prepare({ verificationContractVersion: "verification.v1", target: { kind: "run", runId }, reason: "appeal", evidencePacket: { artifactId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", digest: sha256Digest("audit") } }, context, controller.signal);
    await started.promise; controller.abort();
    await expect(pending).rejects.toThrow("VERIFICATION_ADJUDICATION_CANCELLED");
  });
});
