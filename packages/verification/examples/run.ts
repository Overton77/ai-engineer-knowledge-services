import assert from "node:assert/strict";
import { resolveExample, selectorExamples } from "./selectors.js";

for (const example of selectorExamples) {
  const result = resolveExample(example);
  assert.equal(result?.resolution.status, "resolved", example.name);
  assert.ok(
    new TextDecoder()
      .decode(result?.selectedContent)
      .includes(example.expectedText),
    example.name,
  );
  console.log(
    JSON.stringify({
      example: example.name,
      status: result.resolution.status,
      ranges: result.resolution.resolvedRanges,
    }),
  );
}

const repeated = {
  name: "ambiguous value",
  content: "Panel A: 42. Panel B: 42.",
  selector: { kind: "text_quote", quote: "42", normalization: "none" } as const,
  expectedText: "42",
};
assert.equal(resolveExample(repeated)?.resolution.status, "ambiguous");
const recovered = resolveExample({
  ...repeated,
  selector: { ...repeated.selector, prefix: "Panel B: " },
});
assert.equal(recovered?.resolution.status, "resolved");
console.log(
  JSON.stringify({
    example: repeated.name,
    initial: "ambiguous",
    withContext: recovered.resolution.status,
  }),
);
