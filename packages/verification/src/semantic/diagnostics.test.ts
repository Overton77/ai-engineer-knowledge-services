import { describe, expect, it, vi } from "vitest";
import type { VerificationSourceAssessment } from "@aiengineer/knowledge-contracts";
import { assessSourceAuthority } from "../authority/index.js";
import { acceptClaimDecomposition, evaluateDecompositionProposal } from "../claims/decomposition.js";
import { verifyReportWide } from "../claims/report.js";
import { sha256Digest } from "../deterministic/index.js";
import { summarizeAttributionPerturbations } from "./attribution.js";
import { proposeUncitedEvidenceRescue } from "./rescue.js";

const report = "Generation Lab reports 19 systems. Another section reports 21 systems. Turnaround is 2–4 weeks for one context and 3–4 weeks for another.";

function source(overrides: Partial<VerificationSourceAssessment> = {}): VerificationSourceAssessment {
  return {
    assessmentId: "assessment-1", assertionId: "claim-1", fragmentId: "fragment-1",
    sourceFamilyId: "company-family", sourceOrganizationId: "company-org",
    vector: { authority: "promotional", independence: "self_reported", directness: "direct", freshness: "current", applicability: "direct" },
    claimScope: "descriptive_fact", evidenceScope: "company_statement", publicationRelation: "not_publication",
    jurisdictionKnown: true, licenseKnown: true, freshnessKnown: true, ...overrides,
  };
}

describe("declared synthetic diagnostics truth cases", () => {
  it("accepts only exact full reconstruction with preserved qualifiers and leaves synthetic annotation unscored", () => {
    const split = report.indexOf(" Another") + 1;
    const proposal = { schemaVersion: "verification-claim-decomposition.v1" as const, annotationVersion: "declared-synthetic.v1", offsetUnit: "utf16_code_unit" as const, reportDigest: sha256Digest(report), segments: [
      { segmentId: "claim-a", start: 0, end: split, exactText: report.slice(0, split), classification: "externally_verifiable_fact" as const, atomizationBasis: "semantic_proposition" as const, atomic: true, qualifiers: ["19 systems"] },
      { segmentId: "claim-b", start: split, end: report.length, exactText: report.slice(split), classification: "externally_verifiable_fact" as const, atomizationBasis: "semantic_proposition" as const, atomic: true, qualifiers: ["2–4 weeks", "3–4 weeks"] },
    ] };
    const accepted = acceptClaimDecomposition(report, proposal);
    expect(accepted.reconstructedReport).toBe(report);
    expect(evaluateDecompositionProposal(accepted, { caseId: "diagnostic-synthetic", reportDigest: sha256Digest(report), expectedClaimRanges: [], provenance: "declared_synthetic" })).toEqual({ status: "pending_human_gold" });
    expect(() => acceptClaimDecomposition(report, { ...proposal, segments: [{ ...proposal.segments[0]!, qualifiers: ["missing qualifier"] }, proposal.segments[1]!] })).toThrow("DECOMPOSITION_QUALIFIER_NOT_PRESERVED");
  });

  it("reports citation completeness separately from correctness, placement, conflicts, duplicates and qualifiers", () => {
    const a = "Generation Lab reports 19 systems.";
    const b = "Another section reports 21 systems.";
    const c = "Turnaround is 2–4 weeks for one context and 3–4 weeks for another.";
    const items = [
      { assertionId: "count-19", exactText: a, start: report.indexOf(a), end: report.indexOf(a) + a.length, citationRequired: true, claimWeight: 2, severity: "medium" as const, citations: [{ citationId: "c1", fragmentId: "f1", pointerStatus: "valid" as const, semanticVerdict: "directly_supported" as const, sourceFamilyId: "company", sourceIndependence: "not_independent" as const }], requiredQualifiers: [], consistencyKey: "system-count", consistencyFacet: "number" as const, normalizedValue: "19" },
      { assertionId: "count-21", exactText: b, start: report.indexOf(b), end: report.indexOf(b) + b.length, citationRequired: true, claimWeight: 2, severity: "high" as const, citations: [{ citationId: "c2", fragmentId: "f2", pointerStatus: "valid" as const, semanticVerdict: "contradicted" as const, sourceFamilyId: "company", sourceIndependence: "not_independent" as const }], requiredQualifiers: [], consistencyKey: "system-count", consistencyFacet: "number" as const, normalizedValue: "21" },
      { assertionId: "turnaround", exactText: c, start: report.indexOf(c), end: report.indexOf(c) + c.length, citationRequired: true, claimWeight: 1, severity: "high" as const, citations: [{ citationId: "c3", fragmentId: "f3", pointerStatus: "misplaced" as const, semanticVerdict: "directly_supported" as const, sourceFamilyId: "company", sourceIndependence: "not_independent" as const }], requiredQualifiers: ["one context", "another"], consistencyKey: "turnaround", normalizedValue: "context-separated" },
      { assertionId: "duplicate-turnaround", exactText: c, start: report.indexOf(c), end: report.indexOf(c) + c.length, citationRequired: false, claimWeight: 1, severity: "low" as const, citations: [], requiredQualifiers: [] },
    ];
    const summary = verifyReportWide(report, items);
    expect(summary.claimWeightedCitationCompleteness).toBe(0.8);
    expect(summary.citationCorrectness).toBeCloseTo(1 / 3);
    expect(summary.validPointerConditionalCitationCorrectness).toBe(0.5);
    expect(summary.misplacedCitationIds).toEqual(["c3"]);
    expect(summary.conflictAssertionGroups).toEqual([["count-19", "count-21"]]);
    expect(summary.crossSectionMismatches).toEqual([{ facet: "number", assertionIds: ["count-19", "count-21"] }]);
    expect(summary.duplicateAssertionGroups).toEqual([["turnaround", "duplicate-turnaround"]]);
    expect(summary.independentSourceFamilyCount).toBe(0);
    expect(summary.distinctSourceFamilyCount).toBe(1);
    expect(summary.unsupportedHighSeverityAssertionIds).toEqual(["count-21", "turnaround"]);
  });

  it("keeps 2–4 and 3–4 week statements separate by context while finding entity and date drift within a context", () => {
    const text = "Product page: 2–4 weeks. FAQ: 3–4 weeks. Section A: TruDiagnostic in 2025. Section B: Generation Lab in 2026.";
    const assertion = (assertionId: string, exactText: string, consistencyKey: string, consistencyFacet: "entity" | "date" | "number" | "other", normalizedValue: string, contextKey: string) => ({
      assertionId, exactText, start: text.indexOf(exactText), end: text.indexOf(exactText) + exactText.length, citationRequired: false, claimWeight: 1,
      severity: "medium" as const, citations: [], requiredQualifiers: [], consistencyKey, consistencyFacet, normalizedValue, contextKey,
    });
    const summary = verifyReportWide(text, [
      assertion("turnaround-product", "2–4 weeks", "turnaround", "number", "2-4", "product-page"),
      assertion("turnaround-faq", "3–4 weeks", "turnaround", "number", "3-4", "faq"),
      assertion("entity-a", "TruDiagnostic", "company", "entity", "trudiagnostic", "comparison"),
      assertion("entity-b", "Generation Lab", "company", "entity", "generation-lab", "comparison"),
      assertion("date-a", "2025", "capture-date", "date", "2025", "comparison"),
      assertion("date-b", "2026", "capture-date", "date", "2026", "comparison"),
    ]);
    expect(summary.conflictAssertionGroups.flat()).not.toContain("turnaround-product");
    expect(summary.crossSectionMismatches).toEqual([
      { facet: "entity", assertionIds: ["entity-a", "entity-b"] },
      { facet: "date", assertionIds: ["date-a", "date-b"] },
    ]);
  });

  it("rejects report collections before unbounded grouping or flattening", () => {
    expect(() => verifyReportWide("x", Array.from({ length: 513 }, (_, index) => ({ assertionId: `a-${index}`, exactText: "x", start: 0, end: 1, citationRequired: false, claimWeight: 1, severity: "low" as const, citations: [], requiredQualifiers: [] })))).toThrow("REPORT_CAPACITY_EXCEEDED");
  });

  it("withholds authority for promotional clinical accuracy, triplicate overreach and publication-to-product overextension", () => {
    expect(assessSourceAuthority("claim-1", [source({ claimScope: "clinical_utility" })])).toMatchObject({ status: "withheld", independentCorroboration: false });
    expect(assessSourceAuthority("claim-1", [source({ claimScope: "population_accuracy", evidenceScope: "single_sample_technical" })]).reasonCodes).toContain("SINGLE_SAMPLE_TECHNICAL_RESULT_NOT_POPULATION_ACCURACY");
    expect(assessSourceAuthority("claim-1", [source({ claimScope: "product_validation", evidenceScope: "antecedent_method", publicationRelation: "validates_antecedent_method" })]).reasonCodes).toContain("PUBLICATION_DOES_NOT_VALIDATE_PRODUCT");
    const independent = source({ assessmentId: "assessment-2", fragmentId: "fragment-2", sourceFamilyId: "paper-family", sourceOrganizationId: "university", vector: { authority: "primary", independence: "independent", directness: "direct", freshness: "current", applicability: "direct" }, claimScope: "method_validation", evidenceScope: "population", publicationRelation: "validates_antecedent_method" });
    expect(assessSourceAuthority("claim-1", [independent])).toMatchObject({ status: "sufficient", independentCorroboration: true });
  });

  it("requires population and product applicability on the same qualifying independent source", () => {
    const independentPopulationMiss = source({
      assessmentId: "assessment-independent-population-miss", fragmentId: "fragment-independent-population-miss",
      sourceFamilyId: "paper-family", sourceOrganizationId: "university", claimScope: "population_accuracy",
      evidenceScope: "single_sample_technical", publicationRelation: "validates_antecedent_method",
      vector: { authority: "primary", independence: "independent", directness: "direct", freshness: "current", applicability: "direct" },
    });
    const interestedPopulationClaim = source({
      assessmentId: "assessment-interested-population", fragmentId: "fragment-interested-population",
      claimScope: "population_accuracy", evidenceScope: "population",
    });
    expect(assessSourceAuthority("claim-1", [independentPopulationMiss, interestedPopulationClaim])).toMatchObject({
      status: "withheld", independentCorroboration: true,
      reasonCodes: expect.arrayContaining(["SINGLE_SAMPLE_TECHNICAL_RESULT_NOT_POPULATION_ACCURACY"]),
    });

    const independentProductMiss = { ...independentPopulationMiss, assessmentId: "assessment-independent-product-miss", fragmentId: "fragment-independent-product-miss", claimScope: "product_validation" as const };
    const interestedProductClaim = source({
      assessmentId: "assessment-interested-product", fragmentId: "fragment-interested-product",
      claimScope: "product_validation", evidenceScope: "commercial_product", publicationRelation: "validates_product",
    });
    expect(assessSourceAuthority("claim-1", [independentProductMiss, interestedProductClaim])).toMatchObject({
      status: "withheld", independentCorroboration: true,
      reasonCodes: expect.arrayContaining(["PUBLICATION_DOES_NOT_VALIDATE_PRODUCT"]),
    });
  });

  it("keeps uncited rescue bounded and pending mechanical admission", async () => {
    const search = vi.fn(async () => [{ candidateId: "r1", sourceUri: "https://example.test/source", exactText: "uncited alternative", sourceFamilyId: "independent-1" }]);
    await expect(proposeUncitedEvidenceRescue("diagnostic claim", { maximumCalls: 1, maximumFragments: 2, maximumCharacters: 100 }, { search })).resolves.toMatchObject({ status: "pending_mechanical_admission", callsUsed: 1 });
    expect(search).toHaveBeenCalledWith({ query: "diagnostic claim", maximumFragments: 2, maximumCharacters: 100 });
  });

  it("labels perturbation evidence as an audit metric rather than causal proof", () => {
    expect(summarizeAttributionPerturbations([{ assertionId: "a", baselineVerdict: "supported", deletionVerdict: "unsupported", replacementVerdict: "contradicted", reorderedVerdict: "supported" }])).toEqual({ status: "audit_metric_only", sampleSize: 1, claimSurvivalRate: 0, flipRate: 1, evidenceSensitivityRate: 1, causalProof: false });
  });
});
