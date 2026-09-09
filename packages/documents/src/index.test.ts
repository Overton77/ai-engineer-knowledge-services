import { describe, expect, it } from "vitest";
import { convertStructuralDocument, reconstructNodeSpan, verifyNodeLocators } from "./index.js";

const id = (digit: number) => `00000000-0000-4000-8000-${String(digit).padStart(12, "0")}`;
const input = {
  tenantId: id(1), representationId: id(2), createdAt: "2026-09-03T12:00:00Z",
  blocks: [
    { localKey: "h", ordinal: 0, kind: "heading" as const, text: "  Retrieval  " },
    { localKey: "p", parentKey: "h", ordinal: 0, kind: "paragraph" as const, text: "Stable   spans.", locator: { page: 1, startOffset: 0, endOffset: 13 } },
  ],
};

describe("structural documents", () => {
  it("produces stable immutable nodes and verified locators", () => {
    const first = convertStructuralDocument(input);
    const second = convertStructuralDocument(input);
    expect(first).toEqual(second);
    expect(first.nodes[1]?.text).toBe("Stable spans.");
    expect(first.nodes[1]?.parentId).toBe(first.nodes[0]?.id);
    expect(verifyNodeLocators(first.nodes)).toEqual([]);
    expect(Object.isFrozen(first.nodes[0])).toBe(true);
    expect(reconstructNodeSpan(first.nodes[1]!, 0, 6)).toBe("Stable");
  });

  it("rejects broken structure and invalid spans", () => {
    expect(() => convertStructuralDocument({ ...input, blocks: [{ ...input.blocks[0]!, parentKey: "missing" }] })).toThrow(/Unknown parent/);
    expect(() => reconstructNodeSpan(convertStructuralDocument(input).nodes[0]!, 0, 100)).toThrow(RangeError);
  });
});
