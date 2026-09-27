import { describe, expect, it } from "vitest";
import { ReportStructureSchema, renderReport } from "./structure.js";

import { reportFixture } from "./test-fixtures.js";

describe("report structure and exact rendition", () => {
  it("preserves decomposed Unicode and binds UTF-16 ranges after generated headings", () => {
    const rendered = renderReport(ReportStructureSchema.parse(reportFixture()));
    const assertion = rendered.assertions[0]!;
    expect(assertion.proposition).toBe("Cafe\u0301");
    expect(rendered.markdown.slice(assertion.start, assertion.end)).toBe(assertion.proposition);
  });
  it("rejects factual statements with no supporting claim binding", () => {
    const report = reportFixture();
    report.sections[0]!.blocks[0]!.assertions[0]!.kind = "reported";
    expect(() => ReportStructureSchema.parse(report)).toThrow(/missing claim binding/);
  });
  it("rejects unknown coverage sections and invalid text ranges", () => {
    const report = reportFixture();
    report.questions[0]!.sectionKeys.push("absent");
    report.sections[0]!.blocks[0]!.assertions[0]!.end = 999;
    expect(() => ReportStructureSchema.parse(report)).toThrow(/unknown answering section/);
    expect(() => ReportStructureSchema.parse(report)).toThrow(/UTF-16/);
  });
});
