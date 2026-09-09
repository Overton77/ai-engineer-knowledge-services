import { describe, expect, it } from "vitest";

import { SemanticAssessmentRecordSchema } from "./semantic-policy.js";

const assessment = {
  assertionId: "claim-1",
  verdict: "directly_supported",
  disposition: "admit",
  evidenceSupport: "satisfied",
  worldCorrectness: "unknown",
  attributionFaithfulness: "not_satisfied",
  sourceAuthority: "not_assessed",
  provenanceIntegrity: "satisfied",
  judgeIdentities: [],
  supportingFragmentIds: ["fragment-1"],
  contradictingFragmentIds: [],
  unsupportedFacets: [],
  reasonCodes: [],
  crossFamilySecondJudge: false,
  rawProviderConfidences: [],
} as const;

describe("semantic assessment orthogonal properties", () => {
  it("retains five independently-valued observations without an aggregate substitute", () => {
    const parsed = SemanticAssessmentRecordSchema.parse(assessment);
    expect(parsed).toMatchObject({
      evidenceSupport: "satisfied",
      worldCorrectness: "unknown",
      attributionFaithfulness: "not_satisfied",
      sourceAuthority: "not_assessed",
      provenanceIntegrity: "satisfied",
    });
  });

  it("requires every distinct property and rejects a collapsed replacement field", () => {
    expect(SemanticAssessmentRecordSchema.safeParse({ ...assessment, attributionFaithfulness: undefined }).success).toBe(false);
    expect(SemanticAssessmentRecordSchema.safeParse({ ...assessment, overallScore: 1 }).success).toBe(false);
    expect(SemanticAssessmentRecordSchema.safeParse({ ...assessment, evidenceSupport: assessment.worldCorrectness }).success).toBe(true);
  });
});
