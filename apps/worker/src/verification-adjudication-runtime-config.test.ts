import { describe, expect, it } from "vitest";
import { parseVerificationAdjudicationDecisionRuntimeConfiguration, parseVerificationAdjudicationRuntimeConfiguration } from "./index.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const digest = `sha256:${"a".repeat(64)}`;
const complete = {
  VERIFICATION_ADJUDICATION_GRANTS_JSON: JSON.stringify([{ tenantId: id(1), auditArtifact: { artifactId: id(2), digest }, runKind: "claims" }]),
  VERIFICATION_ADJUDICATION_REVIEW_REQUIREMENTS_JSON: JSON.stringify({ eligibleReviewerRoles: ["verification_expert"], quorumRequired: 1 }),
  VERIFICATION_ADJUDICATION_PUBLIC_KEYS_JSON: JSON.stringify([{ keyId: "adjudication-test", publicKeyPem: "x".repeat(64) }]),
};

describe("adjudication worker trust configuration", () => {
  it("is disabled when all three independent values are absent and rejects partial configuration", () => {
    expect(parseVerificationAdjudicationRuntimeConfiguration({})).toBeUndefined();
    expect(() => parseVerificationAdjudicationRuntimeConfiguration({ VERIFICATION_ADJUDICATION_GRANTS_JSON: complete.VERIFICATION_ADJUDICATION_GRANTS_JSON }))
      .toThrow("VERIFICATION_ADJUDICATION_RUNTIME_CONFIGURATION_REQUIRED");
  });

  it("accepts only a complete bounded server-owned trust set", () => {
    const configuration = parseVerificationAdjudicationRuntimeConfiguration(complete);
    expect(configuration?.auditGrants.admits(id(1), { verificationContractVersion: "verification.v1", auditBundle: { artifactId: id(2), digest } })).toBe(true);
    expect(configuration?.reviewRequirements).toEqual({ eligibleReviewerRoles: ["verification_expert"], quorumRequired: 1 });
    expect(configuration?.trustedPublicKeys).toHaveProperty("adjudication-test");
    expect(() => parseVerificationAdjudicationRuntimeConfiguration({ ...complete, VERIFICATION_ADJUDICATION_REVIEW_REQUIREMENTS_JSON: JSON.stringify({ eligibleReviewerRoles: [], quorumRequired: 0 }) }))
      .toThrow("VERIFICATION_ADJUDICATION_RUNTIME_CONFIGURATION_INVALID");
  });
});

describe("adjudication decision worker configuration", () => {
  it("is fail-closed unless the explicit decision switch is enabled", () => {
    expect(parseVerificationAdjudicationDecisionRuntimeConfiguration({})).toBeUndefined();
    expect(parseVerificationAdjudicationDecisionRuntimeConfiguration({ VERIFICATION_ADJUDICATION_DECISIONS_ENABLED: "0" })).toBeUndefined();
    expect(() => parseVerificationAdjudicationDecisionRuntimeConfiguration({
      VERIFICATION_ADJUDICATION_SYNTHETIC_REVIEWER_GRANTS_JSON: JSON.stringify([{ tenantId: id(1), actorId: id(2), role: "verification_expert" }]),
    })).toThrow("VERIFICATION_ADJUDICATION_DECISION_RUNTIME_CONFIGURATION_REQUIRED");
    expect(() => parseVerificationAdjudicationDecisionRuntimeConfiguration({ VERIFICATION_ADJUDICATION_DECISIONS_ENABLED: "true" }))
      .toThrow("INVALID_VERIFICATION_ADJUDICATION_DECISIONS_ENABLED");
  });

  it("accepts a bounded exact synthetic allowlist only when opted in", () => {
    const configuration = parseVerificationAdjudicationDecisionRuntimeConfiguration({
      VERIFICATION_ADJUDICATION_DECISIONS_ENABLED: "1",
      VERIFICATION_ADJUDICATION_SYNTHETIC_REVIEWER_GRANTS_JSON: JSON.stringify([{ tenantId: id(1), actorId: id(2), role: "verification_expert" }]),
    });
    expect(configuration?.syntheticReviewerGrants).toEqual([{ tenantId: id(1), actorId: id(2), role: "verification_expert" }]);
    expect(parseVerificationAdjudicationDecisionRuntimeConfiguration({ VERIFICATION_ADJUDICATION_DECISIONS_ENABLED: "1" })?.syntheticReviewerGrants).toEqual([]);
    expect(() => parseVerificationAdjudicationDecisionRuntimeConfiguration({
      VERIFICATION_ADJUDICATION_DECISIONS_ENABLED: "1",
      VERIFICATION_ADJUDICATION_SYNTHETIC_REVIEWER_GRANTS_JSON: JSON.stringify([{ tenantId: id(1), actorId: id(2), role: " bad role " }]),
    })).toThrow("VERIFICATION_ADJUDICATION_SYNTHETIC_REVIEWER_GRANTS_INVALID");
  });
});
