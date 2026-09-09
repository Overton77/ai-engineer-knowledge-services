import { describe, expect, it } from "vitest";
import { VerificationAdjudicationTerminalResourceSchema } from "./adjudication-reads.js";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const digest = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const reference = (value: number) => ({ artifactId: id(value), digest: digest(String(value % 10)) });
function resource() {
  return {
    verificationContractVersion: "verification.v1", tenantId: id(1), operationId: id(2), requestDigest: digest("a"), packetArtifact: reference(3),
    output: {
      subjectId: id(4), status: "pending_human_adjudication",
      target: { kind: "run", runId: id(5), objectDigest: digest("b") }, reason: "policy_review",
      reviewRequirements: { eligibleReviewerRoles: ["verification_expert"], quorumRequired: 2 }, originalPolicyOutcome: "review",
      source: { runKind: "claims", runId: id(5), manifestArtifact: reference(6), manifestDigest: digest("c"), bundleArtifact: reference(7), deterministicResultArtifact: reference(8), policyDecisionArtifact: reference(9) },
      proof: { payloadDigest: digest("d"), signatureStatus: "verified", deterministicReplay: "exact", policyReplay: "exact", terminalFencingToken: 8 },
      humanDecisionRecorded: false, admissionChanged: false,
    },
  };
}

describe("verification adjudication terminal resource", () => {
  it("accepts a compact pending-only claims resource", () => {
    const value = VerificationAdjudicationTerminalResourceSchema.parse(resource());
    expect(value.output).toMatchObject({ status: "pending_human_adjudication", humanDecisionRecorded: false, admissionChanged: false });
    expect(JSON.stringify(value)).not.toContain("objectKey");
  });

  it("requires a report gate and rejects raw/private or decision fields", () => {
    const report = resource();
    report.output.source = { ...report.output.source, runKind: "report", reportGateArtifact: reference(10) } as typeof report.output.source;
    expect(VerificationAdjudicationTerminalResourceSchema.parse(report).output.source).toHaveProperty("reportGateArtifact");
    expect(() => VerificationAdjudicationTerminalResourceSchema.parse({ ...resource(), rawPacket: { secret: true } })).toThrow();
    expect(() => VerificationAdjudicationTerminalResourceSchema.parse({ ...resource(), output: { ...resource().output, humanDecisionRecorded: true } })).toThrow();
    expect(() => VerificationAdjudicationTerminalResourceSchema.parse({ ...resource(), output: { ...resource().output, source: { ...resource().output.source, runKind: "report" } } })).toThrow();
  });
});
