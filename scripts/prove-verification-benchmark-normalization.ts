import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { admitExtractionSchema, canonicalizeJson, sha256Digest, verifyExtractionFields } from "@aiengineer/knowledge-verification";

const proofId = "618673e3-ced6-4cf5-ab58-25d415af1395";
const outputPath = resolve(import.meta.dirname, "..", "..", "internal", `verification-benchmark-normalization-${proofId}.json`);
const encoder = new TextEncoder();
const selectedRawValue = "  normalized\tfield\r\nvalue  ";
const candidateValue = "normalized field value";
const representationBytes = encoder.encode(selectedRawValue);
const representationDigest = sha256Digest(representationBytes);
const schemaAdmission = admitExtractionSchema({
  schemaId: "verification-benchmark-normalization-fixture",
  schemaVersion: "1",
  schema: {
    type: "object",
    description: "A bounded normalization fixture.",
    properties: { value: { type: "string", description: "The extracted source value.", maxLength: 128 } },
    required: ["value"],
    additionalProperties: false,
  },
});
if (!schemaAdmission.admitted || !schemaAdmission.schema) throw new Error("NORMALIZATION_FIXTURE_SCHEMA_NOT_ADMITTED");
const common = {
  schema: schemaAdmission.schema,
  candidate: { value: candidateValue },
  evidence: [{
    path: "/value",
    captureId: "f155c76c-e6e7-47c1-adc7-679324241809",
    representationArtifactId: "640119b7-2e1a-4d0e-9617-d65bdcf6c996",
    representationDigest,
    selector: { kind: "character_position" as const, start: 0, end: selectedRawValue.length, offsetBasis: "utf16_code_units" as const, normalization: "none" as const },
    expectedSelectedContentDigest: representationDigest,
  }],
  representations: [{ captureId: "f155c76c-e6e7-47c1-adc7-679324241809", artifactId: "640119b7-2e1a-4d0e-9617-d65bdcf6c996", digest: representationDigest, content: representationBytes }],
};
const normalized = verifyExtractionFields({ ...common, fields: [{ path: "/value", comparison: "normalized_text", normalizationId: "collapse-source-whitespace" }], normalizations: [{ id: "collapse-source-whitespace", operation: "ascii_whitespace_collapsed" }] });
const exactControl = verifyExtractionFields({ ...common, fields: [{ path: "/value", comparison: "exact" }] });
if (!normalized.valid || exactControl.valid || String(candidateValue) === String(selectedRawValue) || !normalized.checks.some((item) => item.code === "FIELD_NORMALIZED_TEXT_MATCH" && item.status === "passed") || !exactControl.checks.some((item) => item.code === "FIELD_EXACT_MATCH" && item.status === "failed")) throw new Error("NORMALIZATION_FIXTURE_OUTCOME_INVALID");

const result = { schemaValid: true, locatorValid: true, fieldMechanics: normalized.valid, support: "not_applicable", authority: "not_applicable", worldCorrectness: "not_applicable", policy: normalized.valid ? "pass" : "fail", failureClass: normalized.valid ? "none" : "local" } as const;
const checkpointMaterial = { schemaVersion: "verification-benchmark-normalization-checkpoint.v1", proofId, caseId: "normalized-whitespace-fixture", armId: "deterministic-normalization-control", result, normalizedResult: normalized, exactControlResult: exactControl };
const checkpoint = { ...checkpointMaterial, checkpointDigest: sha256Digest(encoder.encode(canonicalizeJson(checkpointMaterial))) };
const core = {
  schemaVersion: "verification-benchmark-normalization-proof.v2",
  proofId,
  providerDispatches: 0,
  networkAccess: 0,
  verifier: "verifyExtractionFields",
  schemaAdmissionDigest: schemaAdmission.schema.schemaDigest,
  representation: { captureId: common.evidence[0].captureId, artifactId: common.evidence[0].representationArtifactId, digest: representationDigest, selectedRawValue, selector: common.evidence[0].selector },
  candidateValue,
  normalization: { id: "collapse-source-whitespace", operation: "ascii_whitespace_collapsed" },
  checkpoint,
};
const digest = sha256Digest(encoder.encode(canonicalizeJson(core)));
let receipt: unknown;
try {
  await access(outputPath);
  receipt = JSON.parse(await readFile(outputPath, "utf8"));
  if (canonicalizeJson((receipt as { core?: unknown }).core) !== canonicalizeJson(core) || (receipt as { digest?: string }).digest !== digest) throw new Error("NORMALIZATION_FIXTURE_IMMUTABLE_CONFLICT");
} catch (error: unknown) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  receipt = { core, createdAt: new Date().toISOString(), digest };
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
}
process.stdout.write(`${JSON.stringify({ outputPath, digest, normalizedValid: normalized.valid, exactControlValid: exactControl.valid }, null, 2)}\n`);
