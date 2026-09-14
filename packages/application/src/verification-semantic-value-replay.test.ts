import { describe, expect, it, vi } from "vitest";
import { SemanticAssessmentRecordSchema, type VerificationBundle, type DeterministicVerificationResult } from "@aiengineer/knowledge-contracts";
import { authorizeSemanticCase, digestCanonicalJson, sha256Digest } from "@aiengineer/knowledge-verification";
import { replayCapturedSemanticAssessment } from "./verification-semantic-replay.js";

/** Minimal mechanically authorized synthetic case; these tests stop before artifact hydration. */
function semanticCase(value: string) {
  const digest = sha256Digest("source");
  const bundle = { assertions: [{ assertionId: "claim", atomic: true, proposition: "Source meaning", value, qualifiers: [], entityBindings: [], riskClass: "low", downstreamUse: [], evidence: [{ evidenceId: "edge", role: "supports", origin: "declared", fragment: { fragmentId: "fragment" } }] }] } as unknown as VerificationBundle;
  const result = { status: "passed", semanticEligibility: true, assertions: [{ assertionId: "claim", status: "passed", semanticEligibility: true, evidence: [{ evidenceId: "edge", status: "passed", resolution: { status: "resolved", selectedContentDigest: digest } }] }] } as unknown as DeterministicVerificationResult;
  return authorizeSemanticCase(bundle, result, "claim", [{ evidenceId: "edge", fragmentId: "fragment", exactText: "source", selectedContentDigest: digest }]);
}
const assessment = () => SemanticAssessmentRecordSchema.parse({ assertionId: "claim", verdict: "directly_supported", disposition: "admit", evidenceSupport: "satisfied", worldCorrectness: "not_assessed", attributionFaithfulness: "not_assessed", sourceAuthority: "not_assessed", provenanceIntegrity: "satisfied", judgeIdentities: [], supportingFragmentIds: [], contradictingFragmentIds: [], unsupportedFacets: [], reasonCodes: [], crossFamilySecondJudge: false, rawProviderConfidences: [] });

describe("semantic replay value binding", () => {
  it.each([undefined, digestCanonicalJson("different")])("rejects missing/changed value digest before any artifact reads", async assertionValueDigest => {
    const createResolver = vi.fn();
    await expect(replayCapturedSemanticAssessment({ semanticCase: semanticCase("normalized value"), producerDeploymentId: "producer", expectedAssessment: { ...assessment(), ...(assertionValueDigest ? { assertionValueDigest } : {}) }, judges: [], createResolver })).rejects.toThrow("SEMANTIC_REPLAY_VALUE_BINDING");
    expect(createResolver).not.toHaveBeenCalled();
  });
});
