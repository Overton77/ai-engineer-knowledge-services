import { describe, expect, it, vi } from "vitest";
import { createVerificationAgentReportFixture, validateExistingAgentReportRegistration, validateVerificationAgentReportFixture, type VerificationAgentReportFixtureInput } from "./verification-agent-report-fixture.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const digest = (char: string) => `sha256:${char.repeat(64)}` as const;
const report = "# Agent report\n\nThe frozen assertion is supported. [source]";
const start = report.indexOf("The frozen assertion is supported.");
const existingArtifact = {
  artifactId: id(9), tenantId: id(5), digest: digest("e"), mediaType: "text/markdown", byteLength: new TextEncoder().encode(report).byteLength,
  objectKey: `${id(5)}/ee/${"e".repeat(64)}`, createdAt: "2026-09-08T20:52:19.634Z", producerActivityId: "verification-agent-report-fixture",
  producerVersion: "v1", encryptionClass: "supabase-managed", retentionClass: "verification-audit", dataClassification: "restricted" as const,
  parentArtifactIds: [id(2)], transformationSignature: digest("f"),
};
const existingInput = () => ({
  candidate: { artifact: existingArtifact, producerAgentId: "cursor-agent", producerRunId: "cursor-run" }, hydratedRegistration: existingArtifact,
  hydratedBytes: new TextEncoder().encode(report), tenantId: id(5), projectionArtifactId: id(2), expectedProducerAgentId: "cursor-agent",
  expectedProducerRunId: "cursor-run", reportMarkdown: report,
});
const input = () => ({
  reportMarkdown: report,
  assertion: { text: "The frozen assertion is supported.", start, end: start + "The frozen assertion is supported.".length, citation: { start: report.indexOf("[source]"), end: report.indexOf("[source]") + 8 } },
  benchmarkCase: { assertion: "The frozen assertion is supported.", evidence: [{ captureId: id(1), projectionArtifactId: id(2), projectionDigest: digest("a"), transformationArtifactId: id(3), fragmentId: "fragment-1", excerpt: "Public excerpt.", selectedContentDigest: digest("b") }] },
  frozenRecord: {
    captureId: id(1),
    projections: [{
      sourceArtifact: { artifactId: id(4), digest: digest("c") },
      projectionArtifact: { artifactId: id(2), digest: digest("a") },
      transformationArtifact: { artifactId: id(3), digest: digest("d") },
    }],
  },
  tenantId: id(5), missionId: id(6), producerAttemptId: id(7), producerDeploymentId: "cursor-agent", verifierAttemptId: id(8), verifierDeploymentId: "verification-worker",
}) as unknown as VerificationAgentReportFixtureInput;

describe("verification agent report fixture", () => {
  it("rejects a mismatched UTF-16 assertion range before any repository read or write", async () => {
    const value = input(); value.assertion = { ...value.assertion, end: value.assertion.end - 1 };
    const repository = { getRegisteredCapture: vi.fn(), registerContentAddressedArtifact: vi.fn(), recordAssertion: vi.fn() };
    await expect(createVerificationAgentReportFixture({ ...value, repository } as VerificationAgentReportFixtureInput)).rejects.toThrow("AGENT_REPORT_ASSERTION_RANGE_INVALID");
    expect(repository.getRegisteredCapture).not.toHaveBeenCalled(); expect(repository.registerContentAddressedArtifact).not.toHaveBeenCalled(); expect(repository.recordAssertion).not.toHaveBeenCalled();
  });
  it("rejects an identity not present in the frozen authorized case before any write", async () => {
    const value = input();
    value.reportMarkdown = "# Agent report\n\nInvented conclusion.";
    value.assertion = { text: "Invented conclusion.", start: value.reportMarkdown.indexOf("Invented conclusion."), end: value.reportMarkdown.length };
    const repository = { getRegisteredCapture: vi.fn(), registerContentAddressedArtifact: vi.fn(), recordAssertion: vi.fn() };
    await expect(createVerificationAgentReportFixture({ ...value, repository } as VerificationAgentReportFixtureInput)).rejects.toThrow("AGENT_REPORT_ASSERTION_NOT_AUTHORIZED");
    expect(repository.registerContentAddressedArtifact).not.toHaveBeenCalled(); expect(repository.recordAssertion).not.toHaveBeenCalled();
  });
  it("accepts the exact frozen assertion and actual report span", () => expect(() => validateVerificationAgentReportFixture(input())).not.toThrow());
  it("rejects reuse from a different producer agent", () => expect(() => validateExistingAgentReportRegistration({
    ...existingInput(), candidate: { ...existingInput().candidate, producerAgentId: "different-agent" },
  })).toThrow("AGENT_REPORT_EXISTING_PRODUCER_AGENT_MISMATCH"));
  it("rejects reuse from a different producer run", () => expect(() => validateExistingAgentReportRegistration({
    ...existingInput(), candidate: { ...existingInput().candidate, producerRunId: "different-run" },
  })).toThrow("AGENT_REPORT_EXISTING_PRODUCER_RUN_MISMATCH"));
  it("rejects reuse when the hydrated report bytes differ", () => expect(() => validateExistingAgentReportRegistration({
    ...existingInput(), hydratedBytes: new TextEncoder().encode(`${report} changed`),
  })).toThrow("AGENT_REPORT_EXISTING_ARTIFACT_BYTES_DRIFT"));
});
