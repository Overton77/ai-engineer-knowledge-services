import { describe, expect, it } from "vitest";
import { ExtractionFieldIntentSchema } from "./intents.js";

const field = { path: "/currency", comparison: "currency", captureId: "invoice", quote: "USD 12.00" };

describe("extraction intent rule configuration", () => {
  it("retains explicit allowed values instead of stripping the verifier configuration", () => {
    expect(ExtractionFieldIntentSchema.parse({ ...field, allowedValues: ["USD"] }).allowedValues).toEqual(["USD"]);
  });

  it.each([
    { name: "empty list", values: [] },
    { name: "empty token", values: [""] },
    { name: "duplicate tokens", values: ["USD", "USD"] },
    { name: "oversized token", values: ["x".repeat(129)] },
    { name: "too many tokens", values: Array.from({ length: 129 }, (_, index) => String(index)) },
  ])("rejects $name at the intent boundary", ({ values }) => {
    expect(ExtractionFieldIntentSchema.safeParse({ ...field, allowedValues: values }).success).toBe(false);
  });
});
