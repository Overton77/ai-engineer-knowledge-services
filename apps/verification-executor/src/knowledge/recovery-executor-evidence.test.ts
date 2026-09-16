import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { digestCanonicalJson } from "@aiengineer/knowledge-verification";
import { VerificationExecutor, loadExecutorConfig } from "../executor.js";
import { createExecutorRecoveryResultReader, type RecoveryExecutorOperation } from "./recovery-executor-evidence.js";
import { recoveryFixture } from "./recovery-test-fixtures.js";
import type { VerificationRecordedPolicyInputs, VerificationPolicyDefinition } from "@aiengineer/knowledge-contracts";
import { evaluateVerificationPolicy } from "@aiengineer/knowledge-policy";

it("derives selector failure from actual verification artifacts and preserves unknown usage", async () => {
  const fixture = await recoveryFixture();
  try {
    const executor = await VerificationExecutor.create(loadExecutorConfig({ VERIFY_STORE_DIR: fixture.store.rootDir, VERIFY_TENANT_ID: fixture.tenantId, VERIFY_GIT_SHA: "test" }));
    await executor.store.writeCapture({ captureId: "source", sourceId: "source", requestedUrl: "https://example.com", finalUrl: "https://example.com",
      capturedAt: new Date().toISOString(), captureMethod: "fixture", captureMethodVersion: "1", contentArtifact: fixture.source,
      characters: fixture.source.byteLength, sourceKind: "api", logicalIdentity: "source" });
    const intent = structuredClone(fixture.intent);
    for (const claim of intent.claims) claim.evidence[0]!.quote = "not present";
    await executor.verifyClaims({ runId: fixture.runId, intent });
    await executor.evaluatePolicy({ runId: fixture.runId });
    const state = await executor.store.readRun(fixture.runId);
    const policy = await executor.store.resolveHandle({ artifactId: state.policyArtifactId! });
    const binding = { ...fixture.batch.items[0]!.binding, policyDigest: policy.digest,
      evidence: [{ ...fixture.batch.items[0]!.binding.evidence[0]!, selector: { kind: "text_quote" as const, quote: "not present", normalization: "none" as const } }] };
    const operation: RecoveryExecutorOperation = { tenantId: fixture.tenantId, operationId: randomUUID(), originalId: "claim-1", runId: fixture.runId,
      binding, usage: { calls: 0, costMicros: 0 }, artifacts: { bundle: state.bundleArtifactId!, result: state.resultArtifactId!, policy: state.policyArtifactId!, inputs: state.policyInputsArtifactId!, decision: state.decisionArtifactId! } };
    const custody = {
      lookup: (artifactId: string) => executor.store.resolveHandle({ artifactId }),
      async register() { throw new Error("TEST_READER_READ_ONLY"); },
      async resolve(artifactId: string) { const handle = await executor.store.resolveHandle({ artifactId }); return { handle, bytes: await executor.store.bytes(handle) }; },
    };
    const reader = createExecutorRecoveryResultReader({ tenantId: fixture.tenantId, custody, async lookupOperation() { return operation; } });
    const request = { tenantId: fixture.tenantId, operationId: operation.operationId, inputDigest: digestCanonicalJson(binding) };
    await expect(reader({ ...request, originalId: "different-original" })).rejects.toThrow("RECOVERY_EXECUTOR_ORIGINAL_MISMATCH");
    expect(await reader(request)).toMatchObject({ observation: { family: "selector", mechanical: "failed" }, coveredRequirementIds: [], usage: { calls: 0, costMicros: 0 } });
    operation.usage = null;
    expect(await reader(request)).toBeNull();
    operation.usage = { calls: 0, costMicros: 0 };
    const original = await executor.store.resolveHandle({ artifactId: operation.artifacts.decision });
    const forged = await executor.store.putJson(await executor.store.json(original), { mediaType: original.mediaType, producerActivityId: "model-authored-decision", producerVersion: "1" });
    operation.artifacts.decision = forged.handle.artifactId;
    await expect(reader(request)).rejects.toThrow("RECOVERY_EXECUTOR_PRODUCER_MISMATCH");
    operation.artifacts.decision = original.artifactId;
    const originalInputs = await executor.store.resolveHandle({ artifactId: operation.artifacts.inputs });
    const recorded = await executor.store.json<VerificationRecordedPolicyInputs>(originalInputs);
    recorded.assertions[0]!.semantic.supportingFragmentIds = ["unknown-fragment"];
    const unbound = await executor.store.putJson(recorded, { mediaType: originalInputs.mediaType, producerActivityId: originalInputs.producerActivityId,
      producerVersion: originalInputs.producerVersion, parentArtifactIds: originalInputs.parentArtifactIds, transformation: { kind: "test-corrupt-inputs" } });
    operation.artifacts.inputs = unbound.handle.artifactId;
    await expect(reader(request)).rejects.toThrow("POLICY_INPUT_SEMANTIC_FRAGMENT_UNKNOWN");
    recorded.assertions[0]!.semantic.supportingFragmentIds = [];
    const digest = digestCanonicalJson("synthetic-independent-judge");
    recorded.assertions[0]!.semantic.judgeIdentities = [{ deploymentId: "independent-test-verifier", provider: "test", family: "test", model: "fixture",
      capability: "llm_evidence_rubric", graderVersion: "test.v1", promptDigest: digest, outputSchemaDigest: digest, configurationDigest: digest }];
    const unsupported = await executor.store.putJson(recorded, { mediaType: originalInputs.mediaType, producerActivityId: originalInputs.producerActivityId,
      producerVersion: originalInputs.producerVersion, parentArtifactIds: originalInputs.parentArtifactIds, transformation: { kind: "test-missing-semantic-source" } });
    operation.artifacts.inputs = unsupported.handle.artifactId;
    const definition = await executor.store.json<VerificationPolicyDefinition>(policy);
    const replayed = await executor.store.putJson(evaluateVerificationPolicy(definition, recorded), { mediaType: original.mediaType,
      producerActivityId: original.producerActivityId, producerVersion: original.producerVersion,
      parentArtifactIds: [state.resultArtifactId!, policy.artifactId, unsupported.handle.artifactId], transformation: { kind: "test-policy-replay" } });
    operation.artifacts.decision = replayed.handle.artifactId;
    await expect(reader(request)).rejects.toThrow("RECOVERY_EXECUTOR_SEMANTIC_ARTIFACT_REQUIRED");
  } finally { await fixture.close(); }
});
