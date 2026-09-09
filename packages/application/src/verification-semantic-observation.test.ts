import { describe, expect, it } from "vitest";
import { providerDigest } from "@aiengineer/knowledge-verification";
import { SemanticObservationArtifactComposer } from "./verification-semantic-observation.js";

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const handle = (suffix: string, character: string, parents: readonly string[] = []) => ({ artifactId: id(suffix), digest: digest(character), tenantId: id("1"), byteLength: 1, mediaType: "application/json", objectKey: `restricted/${suffix}`, createdAt: "2026-09-07T00:00:00.000Z", producerActivityId: "semantic-worker", producerVersion: "v1", encryptionClass: "managed", retentionClass: "verification-audit", dataClassification: "restricted" as const, parentArtifactIds: [...parents], transformationSignature: digest("f") });
const blinded = handle("3", "c"), request = handle("4", "d", [blinded.artifactId]), raw = handle("5", "e"), envelope = handle("6", "f", [request.artifactId, raw.artifactId]), profile = handle("2", "b");
const body = () => ({ schemaVersion: "verification-semantic-response-observation.v1" as const, verificationContractVersion: "verification.v1" as const, context: { tenantId: id("1"), operationId: id("8"), operationStepId: id("9"), leaseToken: id("10"), fencingToken: 2, holderIdentity: "verification-worker", producerAttemptId: id("12"), providerAttemptId: id("11"), host: { operationKind: "verification_claims" as const, stepKey: "verify_claims_and_register" as const, useCase: "verifyClaims" as const } }, profileArtifact: profile, blindedInputArtifact: blinded, requestArtifact: request, rawResponseArtifact: raw, responseEnvelopeArtifact: envelope, judgeIdentity: { deploymentId: "gateway-luna", provider: "vercel-ai-gateway", family: "openai", model: "openai/gpt-5.6-luna", capability: "llm_evidence_rubric" as const, graderVersion: "evidence-only.v1", promptDigest: digest("2"), outputSchemaDigest: digest("3"), configurationDigest: digest("4") }, inputArtifactDigest: blinded.digest, requestDigest: request.digest, rawResponseDigest: raw.digest, requestedModel: "openai/gpt-5.6-luna", observedModel: "openai/gpt-5.6-luna", modelStatus: "matched" as const, revalidationRequired: false, usage: { totalTokens: 0 }, costStatus: "unknown" as const });

describe("semantic observation artifact composer", () => {
  it("canonicalizes a non-self-referential body and verifies exact registered lineage", async () => {
    const seen: unknown[] = [];
    const composer = new SemanticObservationArtifactComposer({ async registerSemanticObservationArtifact(input) { seen.push(input); return { ...handle("7", "1", input.parentArtifactIds), digest: providerDigest(body()), byteLength: input.bytes.byteLength, mediaType: input.mediaType, transformationSignature: input.transformationSignature }; } }, { storageBucket: "verification-private", producerActivityId: "semantic-worker", producerVersion: "v1", encryptionClass: "managed", retentionClass: "verification-audit", now: () => "2026-09-07T00:00:00.000Z" });
    const observation = await composer.compose(body());
    expect(seen).toHaveLength(1); expect((seen[0] as { producerAttemptId: string }).producerAttemptId).toBe(id("12")); expect(observation.observationArtifact.parentArtifactIds).toEqual([blinded.artifactId, envelope.artifactId, profile.artifactId]);
  });
  it("rejects a registration that changes the body digest or exact parent closure", async () => {
    const composer = new SemanticObservationArtifactComposer({ async registerSemanticObservationArtifact(input) { return { ...handle("7", "1", [profile.artifactId, envelope.artifactId, blinded.artifactId]), digest: digest("1"), byteLength: input.bytes.byteLength, transformationSignature: input.transformationSignature }; } }, { storageBucket: "verification-private", producerActivityId: "semantic-worker", producerVersion: "v1", encryptionClass: "managed", retentionClass: "verification-audit", now: () => "2026-09-07T00:00:00.000Z" });
    await expect(composer.compose(body())).rejects.toThrow("SEMANTIC_OBSERVATION_ARTIFACT_BINDING_MISMATCH");
  });
  it("rejects returned producer and security metadata drift", async () => {
    const composer = new SemanticObservationArtifactComposer({ async registerSemanticObservationArtifact(input) { return { ...handle("7", "1", input.parentArtifactIds), digest: providerDigest(body()), byteLength: input.bytes.byteLength, producerVersion: "forged", transformationSignature: input.transformationSignature }; } }, { storageBucket: "verification-private", producerActivityId: "semantic-worker", producerVersion: "v1", encryptionClass: "managed", retentionClass: "verification-audit", now: () => "2026-09-07T00:00:00.000Z" });
    await expect(composer.compose(body())).rejects.toThrow("SEMANTIC_OBSERVATION_ARTIFACT_BINDING_MISMATCH");
  });
  it("reuses canonical registration with its original creation time on retry", async () => {
    const composer = new SemanticObservationArtifactComposer({ async registerSemanticObservationArtifact(input) { return { ...handle("7", "1", input.parentArtifactIds), digest: providerDigest(body()), byteLength: input.bytes.byteLength, mediaType: input.mediaType, transformationSignature: input.transformationSignature }; } }, { storageBucket: "verification-private", producerActivityId: "semantic-worker", producerVersion: "v1", encryptionClass: "managed", retentionClass: "verification-audit", now: () => "2026-09-07T00:01:00.000Z" });
    expect((await composer.compose(body())).observationArtifact.createdAt).toBe("2026-09-07T00:00:00.000Z");
  });
  it("rejects a future registration timestamp", async () => {
    const composer = new SemanticObservationArtifactComposer({ async registerSemanticObservationArtifact(input) { return { ...handle("7", "1", input.parentArtifactIds), createdAt: "2026-09-07T01:00:00.000Z", digest: providerDigest(body()), byteLength: input.bytes.byteLength, mediaType: input.mediaType, transformationSignature: input.transformationSignature }; } }, { storageBucket: "verification-private", producerActivityId: "semantic-worker", producerVersion: "v1", encryptionClass: "managed", retentionClass: "verification-audit", now: () => "2026-09-07T00:00:00.000Z" });
    await expect(composer.compose(body())).rejects.toThrow("SEMANTIC_OBSERVATION_ARTIFACT_BINDING_MISMATCH");
  });

});
