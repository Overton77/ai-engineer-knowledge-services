import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Usage: node offline.mjs /absolute/path/to/knowledge-verify/dist/index.js
// The caller supplies a built CLI, never a server URL. All state is disposable.
const cli = process.argv[2];
assert.ok(cli, "Supply the path to the built knowledge-verify CLI JavaScript file.");
const directory = await mkdtemp(join(tmpdir(), "verification-example-"));
const run = "offline-example";
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(VERIFY_|KNOWLEDGE_|POSTGRES_|SUPABASE_|AI_GATEWAY_|FIRECRAWL_)/i.test(key))),
  VERIFY_STORE_DIR: join(directory, "store"),
  VERIFY_GIT_SHA: "offline-example",
};

function command(args, expectedExit = 0) {
  const result = spawnSync(process.execPath, [resolve(cli), ...args], { env, encoding: "utf8", windowsHide: true, timeout: 30_000 });
  assert.ifError(result.error);
  assert.equal(result.status, expectedExit, `${args[0]}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

async function intentFile(name, value) {
  const path = join(directory, `${name}.json`);
  await writeFile(path, JSON.stringify(value));
  return path;
}

try {
  const source = join(directory, "source.txt");
  await writeFile(source, "Panel A has 42 samples.\nPanel B has 42 samples.\nCurrency: USD 12.00\nUnit: kg\nState: ready\nIdentifier: CVE-2026-12345\nChecksum: 9780306406157\nLabel: Alpha   Beta\nRate: 7.50\n");
  command(["capture-file", source, "--capture-id", "panel", "--run", run]);
  const ambiguous = command(["locate", "panel", "42 samples", "--run", run], 1);
  assert.equal(ambiguous.status, "ambiguous");
  const quote = "Panel A has 42 samples.";
  const located = command(["locate", "panel", quote, "--run", run]);
  assert.equal(located.status, "resolved");

  const claims = await intentFile("claims", {
    schemaVersion: "verification-claims-intent.v1", intentId: "panel-count",
    claims: [{ claimId: "panel-count", proposition: quote, evidence: [{ captureId: "panel", quote }] }],
  });
  const mechanical = command(["verify-claims", claims, "--run", run]);
  assert.equal(mechanical.status, "passed");
  // A real policy decision without a semantic provider must remain held.
  const policy = command(["policy", "--run", run], 1);
  assert.ok(["review", "abstain"].includes(policy.outcome));
  assert.equal(policy.semanticCoverage.judged, 0);

  const candidate = { currency: "USD 12.00", unit: "kg", state: "ready", identifier: "CVE-2026-12345", checksum: "9780306406157", label: "Alpha Beta", rate: "7.50" };
  const extractionIntent = {
    schemaVersion: "verification-extraction-intent.v1", intentId: "panel-fields",
    schema: { schemaId: "panel", schemaVersion: "1", jsonSchema: {
      type: "object", description: "Synthetic panel fields", additionalProperties: false,
      required: Object.keys(candidate),
      properties: Object.fromEntries(Object.keys(candidate).map((key) => [key, { type: "string", description: key, maxLength: 100 }])),
    } },
    candidate,
    normalizations: [{ id: "spaces", operation: "ascii_whitespace_collapsed" }],
    fields: [
      { path: "/currency", comparison: "currency", quote: candidate.currency, allowedValues: ["USD"] },
      { path: "/unit", comparison: "unit", quote: candidate.unit, allowedValues: ["kg"] },
      { path: "/state", comparison: "enum", quote: candidate.state, allowedValues: ["ready"] },
      { path: "/identifier", comparison: "identifier", quote: candidate.identifier, identifierKind: "cve" },
      { path: "/checksum", comparison: "checksum", quote: candidate.checksum, checksum: "isbn13" },
      { path: "/label", comparison: "normalized_text", quote: "Alpha   Beta", normalizationId: "spaces" },
      { path: "/rate", comparison: "decimal", quote: candidate.rate, minimum: "7", maximum: "8" },
    ].map((field) => ({ ...field, captureId: "panel" })),
  };
  const extraction = await intentFile("extraction", extractionIntent);
  assert.equal(command(["verify-extraction", extraction, "--run", run]).valid, true);
  const altered = await intentFile("altered", { ...extractionIntent, candidate: { ...candidate, currency: "USD 99.00" } });
  const mismatch = command(["verify-extraction", altered, "--run", run], 1);
  assert.ok(mismatch.failedPaths.includes("/currency"));

  const missingConfiguration = await intentFile("missing-options", {
    ...extractionIntent, fields: extractionIntent.fields.map(({ allowedValues, ...field }) => field),
  });
  assert.equal(command(["verify-extraction", missingConfiguration, "--run", run], 1).valid, false);

  for (const bounds of [{ minimum: "8" }, { maximum: "7" }]) {
    const outsideRange = await intentFile("outside-range", {
      ...extractionIntent,
      fields: extractionIntent.fields.map((field) => field.path === "/rate" ? { ...field, ...bounds } : field),
    });
    assert.ok(command(["verify-extraction", outsideRange, "--run", run], 1).failedPaths.includes("/rate"));
  }

  const unsupported = join(directory, "image.png");
  await writeFile(unsupported, new Uint8Array([137, 80, 78, 71]));
  const rejected = spawnSync(process.execPath, [resolve(cli), "capture-file", unsupported, "--run", run], { env, encoding: "utf8", windowsHide: true, timeout: 30_000 });
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /UNSUPPORTED/);

  const status = command(["status", "--run", run]);
  assert.ok(status.steps.some((step) => step.operation === "verify_claims"));
  console.log(JSON.stringify({
    example: "capture → locate → assert → verify → policy",
    mechanical: mechanical.status, semanticJudged: 0, policy: policy.outcome,
    extraction: "passed", changedValue: "rejected", missingRuleOptions: "rejected", decimalBounds: "enforced",
    ambiguousQuote: "extended and resolved", rawImage: "unsupported",
    providersCalled: 0, receipts: status.steps.length,
  }, null, 2));
} finally {
  // Remove only the directory this invocation created, never an operator store.
  await rm(directory, { recursive: true, force: true });
}
