import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { interpretCapturedGatewaySemanticResponse, GatewaySemanticJudgeAdapter, gatewaySemanticConfigurationDigest, gatewaySemanticOutputSchemaDigest, gatewaySemanticPromptDigest, type GatewaySemanticResponseObservation } from "./gateway.js";

const model = "anthropic/claude-haiku-4.5" as const;
const identity = { deploymentId: "independent-judge", provider: "vercel-ai-gateway", family: "anthropic", model, capability: "llm_evidence_rubric" as const, graderVersion: "evidence-only.v1", promptDigest: gatewaySemanticPromptDigest, outputSchemaDigest: gatewaySemanticOutputSchemaDigest, configurationDigest: gatewaySemanticConfigurationDigest(model) };
const input = { rubricVersion: "evidence-only.v1" as const, assertionId: "claim", proposition: "Fixture assertion", qualifiers: [], entityBindings: [], fragments: [{ fragmentId: "fragment", exactText: "Fixture assertion" }], inputArtifactDigest: `sha256:${"a".repeat(64)}` as const };
const output = { schemaVersion: "verification-semantic-judge.v1", assertionId: "claim", verdict: "directly_supported", nliLabel: "entailed", supportingFragmentIds: ["fragment"], contradictingFragmentIds: [], unsupportedFacets: [], qualifiersPreserved: true, publicRationale: "Exact fixture support." };

describe("Gateway semantic response observations", () => {
  it.each([model, "anthropic/changed-model", undefined])("retains model/accounting evidence before interpreting %s", async observedModel => {
    const events: string[] = [], observations: GatewaySemanticResponseObservation[] = [];
    const adapter = new GatewaySemanticJudgeAdapter({ apiKey: "fixture", model, identity,
      artifactSink: { async assertExternalProcessingAdmission() {}, async persistBeforeDispatch() { events.push("request"); }, async persistAfterResponse() { events.push("raw"); } },
      fetch: async () => new Response(JSON.stringify({ ...(observedModel ? {model: observedModel} : {}), usage: {prompt_tokens: 10, completion_tokens: 5, cost: 0.000012}, choices: [{message: {content: JSON.stringify(output)}}] })),
      async recordObservation(value) { observations.push(value); events.push("observation"); },
    });
    if (observedModel && observedModel !== model) await expect(adapter.judge(input, {})).rejects.toMatchObject({code: "PROVIDER_RESPONSE_INVALID", retryable: false});
    else await expect(adapter.judge(input, {})).resolves.toMatchObject({assertionId: "claim"});
    expect(events).toEqual(["request", "raw", "observation"]);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ requestedModel: model, inputArtifactDigest: input.inputArtifactDigest, modelStatus: observedModel === undefined ? "missing" : observedModel === model ? "matched" : "mismatch", revalidationRequired: observedModel !== model, usage: {costMicros: 12} });
    expect(observations[0]?.rawResponseDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(adapter.identity.model).toBe(model);
  });

  it("fails closed on observation persistence failure after capturing the original response", async () => {
    let captured = false, calls = 0;
    const adapter = new GatewaySemanticJudgeAdapter({ apiKey: "fixture", model, identity,
      artifactSink: { async assertExternalProcessingAdmission() {}, async persistBeforeDispatch() {}, async persistAfterResponse() { captured = true; } },
      fetch: async () => { calls++; return new Response(JSON.stringify({ model, choices: [{message: {content: JSON.stringify(output)}}] })); },
      async recordObservation() { throw new Error("fixture storage failure"); },
    });
    await expect(adapter.judge(input, {})).rejects.toMatchObject({code: "PROVIDER_ARTIFACT_PERSISTENCE_FAILURE", retryable: false});
    expect(captured).toBe(true);
    expect(calls).toBe(1);
  });
});


describe("captured Gateway semantic interpretation", () => {
  const raw = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const payload = { model, usage: { cost: 0.000012 }, choices: [{ message: { content: JSON.stringify(output) } }] };
  const digest = (bytes: Uint8Array): `sha256:${string}` => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const captured = (bytes: Uint8Array) => ({ rawResponseBytes: bytes, rawResponseDigest: digest(bytes), httpStatus: 200, requestDigest: input.inputArtifactDigest, inputArtifactDigest: input.inputArtifactDigest, identity, assertActive() {} });
  it("interprets retained bytes and records original evidence without a transport", async () => {
    const bytes = raw(payload), observations: GatewaySemanticResponseObservation[] = [];
    await expect(interpretCapturedGatewaySemanticResponse({ ...captured(bytes), async recordObservation(o) { observations.push(o); } })).resolves.toEqual(output);
    expect(observations[0]).toMatchObject({ rawResponseDigest: digest(bytes), usage: { costMicros: 12 }, modelStatus: "matched" });
  });
  it("rejects tampered retained bytes before recording evidence", async () => {
    let recorded = false;
    await expect(interpretCapturedGatewaySemanticResponse({ ...captured(raw(payload)), rawResponseBytes: raw({ ...payload, model: "forged" }), async recordObservation() { recorded = true; } })).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_INVALID" });
    expect(recorded).toBe(false);
  });
  it("retains mismatched model evidence but never returns its judgment", async () => {
    const observations: GatewaySemanticResponseObservation[] = [];
    await expect(interpretCapturedGatewaySemanticResponse({ ...captured(raw({ ...payload, model: "forged" })), async recordObservation(o) { observations.push(o); } })).rejects.toMatchObject({ code: "PROVIDER_RESPONSE_INVALID" });
    expect(observations[0]).toMatchObject({ modelStatus: "mismatch", revalidationRequired: true });
  });
  it("preserves captured HTTP failure without interpreting a successful-looking body", async () => {
    await expect(interpretCapturedGatewaySemanticResponse({ ...captured(raw(payload)), httpStatus: 503 })).rejects.toMatchObject({ code: "PROVIDER_HTTP_FAILURE", retryable: true });
  });
});
