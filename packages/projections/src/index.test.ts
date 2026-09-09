import { describe, expect, it } from "vitest";
import type { SourceLocator } from "@aiengineer/knowledge-contracts";
import { sha256Digest } from "@aiengineer/knowledge-domain";
import { classifyProjectionSpaces, createProjection, publicProjectionSpaces, validateEvidenceSupport, type ProjectionInput } from "./index.js";

const id = (digit: number) => `00000000-0000-4000-8000-${String(digit).padStart(12, "0")}`;
const quotedText = "The source supports this assertion.";
const locator: SourceLocator = { representationId: id(10), nodeId: id(11), startOffset: 0, endOffset: quotedText.length, quoteDigest: sha256Digest(quotedText) };
const common = { sourceRecordId: id(1), procedureVersionId: id(2), evidence: [{ locatorId: id(3), locator, quotedText }], assertions: [{ id: "a1", statement: "Supported assertion", supportLocatorIds: [id(3)] }] };

const inputs: readonly ProjectionInput[] = [
  { ...common, space: "engineering_claims", claimClass: "verified_fact", attribution: "source", problem: "retrieval", mechanism: "stable evidence", applicability: ["systems"], limitations: ["version scoped"] },
  { ...common, space: "tool_capabilities", toolName: "Tool", capabilities: ["search"], constraints: ["versioned"] },
  { ...common, space: "implementation_examples", objective: "Implement retrieval", language: "TypeScript", commit: "abc", path: "src/index.ts" },
  { ...common, space: "paper_case_study_knowledge", title: "Study", findingClass: "result", derived: true, sectionRole: "result", findings: ["Improved recall"], caveats: ["Small sample"] },
  { ...common, space: "entity_profiles", entityType: "tool", canonicalName: "Tool", aliases: ["T"], profileKind: "identity" },
  { ...common, space: "model_capabilities", modelVersion: "model-v1", capabilities: ["reasoning"], constraints: ["text only"], observedAt: "2026-09-03T12:00:00Z" },
  { ...common, space: "benchmark_intelligence", benchmarkVersion: "bench-v1", metric: "accuracy", protocol: "zero-shot", comparabilityWarnings: [], measuredTask: "reasoning" },
  { sourceRecordId: id(1), procedureVersionId: id(2), evidence: common.evidence, assertions: [], space: "source_native_sections", sectionPath: ["Results"], sourceText: quotedText },
];

describe("domain projections", () => {
  it("builds deterministic contract-valid projections for every space", () => {
    expect(inputs.map((input) => createProjection(input).space)).toEqual([...publicProjectionSpaces, "source_native_sections"]);
    expect(createProjection(inputs[0]!).projectionId).toBe(createProjection(inputs[0]!).projectionId);
  });

  it("rejects unsupported assertions and altered quoted evidence", () => {
    const unsupported: ProjectionInput = { ...inputs[0]!, assertions: [{ id: "bad", statement: "No source", supportLocatorIds: [id(99)] }] };
    expect(validateEvidenceSupport(unsupported).issues).toContain(`bad: unknown support locator ${id(99)}`);
    expect(() => createProjection(unsupported)).toThrow(/evidence validation failed/);
    const altered: ProjectionInput = { ...inputs[0]!, evidence: [{ ...common.evidence[0]!, quotedText: "altered" }] };
    expect(validateEvidenceSupport(altered).issues).toContain(`${id(3)}: quote digest mismatch`);
    const native = inputs[7]!;
    if (native.space !== "source_native_sections") throw new Error("invalid source-native fixture");
    const unfaithful: ProjectionInput = { ...native, sourceText: "rewritten" };
    expect(validateEvidenceSupport(unfaithful).issues).toContain("source-native text does not exactly match ordered evidence text");
  });

  it("validates classification evidence and resolved canonical identities", () => {
    expect(classifyProjectionSpaces({ dispositions: ["engineering_claim", "faithful_source_section"], targetContractVersion: "v1", deduplicationKeys: ["claim:x"], evidenceLocatorIds: [id(3)], unresolvedIdentityQuestions: [] })).toEqual(["engineering_claims", "source_native_sections"]);
    expect(() => classifyProjectionSpaces({ dispositions: ["entity_profile"], targetContractVersion: "v1", deduplicationKeys: ["entity:x"], evidenceLocatorIds: [id(3)], unresolvedIdentityQuestions: ["which Tool?"] })).toThrow(/resolved entity/);
  });
});
