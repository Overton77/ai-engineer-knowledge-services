import { describe, expect, it } from "vitest";

import { SemanticBlindedInputSchema, SemanticProviderResponseObservationSchema } from "./semantic-observation.js";

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const digest = (character: string) => `sha256:${character.repeat(64)}`;
const handle = (suffix: string, character: string, parents: readonly string[] = []) => ({ artifactId: id(suffix), digest: digest(character), tenantId: id("1"), byteLength: 1, mediaType: "application/json", objectKey: `restricted/${suffix}`, createdAt: "2026-09-07T00:00:00.000Z", producerActivityId: "semantic-worker", producerVersion: "v1", encryptionClass: "managed", retentionClass: "verification-audit", dataClassification: "restricted" as const, parentArtifactIds: [...parents], transformationSignature: digest("f") });

const blinded = handle("3", "c");
const request = handle("4", "d", [blinded.artifactId]);
const raw = handle("5", "e");
const envelope = handle("6", "f", [request.artifactId, raw.artifactId]);
const profile = handle("2", "b");
const observation = handle("7", "1", [blinded.artifactId, envelope.artifactId, profile.artifactId]);
const fixture = () => ({ schemaVersion: "verification-semantic-response-observation.v1" as const, verificationContractVersion: "verification.v1" as const, context: { tenantId: id("1"), operationId: id("8"), operationStepId: id("9"), leaseToken: id("10"), fencingToken: 2, holderIdentity: "verification-worker", producerAttemptId: id("12"), providerAttemptId: id("11"), host: { operationKind: "verification_claims" as const, stepKey: "verify_claims_and_register" as const, useCase: "verifyClaims" as const } }, profileArtifact: profile, blindedInputArtifact: blinded, requestArtifact: request, rawResponseArtifact: raw, responseEnvelopeArtifact: envelope, observationArtifact: observation, judgeIdentity: { deploymentId: "gateway-luna", provider: "vercel-ai-gateway", family: "openai", model: "openai/gpt-5.6-luna", capability: "llm_evidence_rubric" as const, graderVersion: "evidence-only.v1", promptDigest: digest("2"), outputSchemaDigest: digest("3"), configurationDigest: digest("4") }, inputArtifactDigest: blinded.digest, requestDigest: request.digest, rawResponseDigest: raw.digest, requestedModel: "openai/gpt-5.6-luna", observedModel: "openai/gpt-5.6-luna", modelStatus: "matched" as const, revalidationRequired: false, usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6, costMicros: 7 }, costStatus: "reported" as const });

describe("semantic observation contracts", () => {
  it("requires a bounded blinded input with unique authorized fragment IDs", () => {
    expect(SemanticBlindedInputSchema.safeParse({ rubricVersion: "evidence-only.v1", assertionId: "a", proposition: "p", qualifiers: [], entityBindings: [], fragments: [{ fragmentId: "f", exactText: "x" }] }).success).toBe(true);
    expect(SemanticBlindedInputSchema.safeParse({ rubricVersion: "evidence-only.v1", assertionId: "a", proposition: "p", qualifiers: [], entityBindings: [], fragments: [{ fragmentId: "f", exactText: "x" }, { fragmentId: "f", exactText: "y" }] }).success).toBe(false);
  });
  it("binds every full handle and accepts a server-composed matched observation", () => {
    expect(SemanticProviderResponseObservationSchema.safeParse(fixture()).success).toBe(true);
  });
  it("rejects forged model/cost state and lineage drift", () => {
    expect(SemanticProviderResponseObservationSchema.safeParse({ ...fixture(), observedModel: "anthropic/claude-haiku-4.5", modelStatus: "matched" }).success).toBe(false);
    expect(SemanticProviderResponseObservationSchema.safeParse({ ...fixture(), costStatus: "unknown" }).success).toBe(false);
    expect(SemanticProviderResponseObservationSchema.safeParse({ ...fixture(), responseEnvelopeArtifact: { ...envelope, parentArtifactIds: [raw.artifactId, request.artifactId] } }).success).toBe(false);
    expect(SemanticProviderResponseObservationSchema.safeParse({ ...fixture(), profileArtifact: { ...profile, artifactId: blinded.artifactId } }).success).toBe(false);
    expect(SemanticProviderResponseObservationSchema.safeParse({ ...fixture(), profileArtifact: { ...profile, parentArtifactIds: [profile.artifactId] } }).success).toBe(false);
    expect(SemanticProviderResponseObservationSchema.safeParse({ ...fixture(), usage: { promptTokens: 4, completionTokens: 3, totalTokens: 6, costMicros: 7 } }).success).toBe(false);
  });
  it("requires missing/mismatch observations to demand revalidation", () => {
    expect(SemanticProviderResponseObservationSchema.safeParse({ ...fixture(), observedModel: undefined, modelStatus: "missing", revalidationRequired: true, usage: {}, costStatus: "unknown" }).success).toBe(true);
    expect(SemanticProviderResponseObservationSchema.safeParse({ ...fixture(), observedModel: undefined, modelStatus: "missing", revalidationRequired: false, usage: {}, costStatus: "unknown" }).success).toBe(false);
  });
});
