import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DiagnosticsBenchmarkExtractionExperimentManifestSchema } from "../packages/contracts/dist/index.js";
import { DIAGNOSTICS_EXTRACTION_OUTPUT_SCHEMA, DIAGNOSTICS_EXTRACTION_OUTPUT_SCHEMA_DIGEST, diagnosticsBenchmarkArms } from "../packages/application/dist/index.js";
import { verificationBenchmarkDigest } from "../packages/evaluation/dist/index.js";
import { gatewaySemanticOutputSchemaDigest } from "../packages/verification/dist/index.js";

type Json = Record<string, any>;
const root = resolve(import.meta.dirname, "..");
const catalog = resolve(root, "catalog/verification-benchmarks/diagnostics-companies-pilot-v4");
const output = resolve(catalog, "experiments/extraction-v1");
const dataset = JSON.parse(await readFile(resolve(catalog, "dataset.json"), "utf8")) as Json;
const grant = JSON.parse(await readFile(resolve(catalog, "derived-input-grant.json"), "utf8")) as Json;
const recoveryReceiptDigest = "sha256:9c08f8c33131e844347bddd5b9711fffc1552d9127ea949e2746d25cf2cdf9b9" as const;
const hash = (bytes: Uint8Array | string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
const stable = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const writeImmutable = async (name: string, value: unknown) => { const path = resolve(output, name), bytes = new TextEncoder().encode(stable(value)); try { const prior = await readFile(path); if (!prior.equals(bytes)) throw new Error(`IMMUTABLE_OUTPUT_CONFLICT:${name}`); } catch (error: any) { if (error?.code !== "ENOENT") throw error; await writeFile(path, bytes, { flag: "wx" }); } return { path, digest: hash(bytes), byteLength: bytes.byteLength }; };
let createdAt: string;
try { createdAt = String((JSON.parse(await readFile(resolve(output, "manifest.json"), "utf8")) as Json).createdAt); } catch (error: any) { if (error?.code !== "ENOENT") throw error; createdAt = new Date().toISOString(); }

const fieldPlan = (caseId: string): { fieldKey: string; description: string; comparison: "exact" | "normalized_text"; required: boolean }[] => {
  const fields = (...items: [string, string, ("exact" | "normalized_text")?][]) => items.map(([fieldKey, description, comparison = "exact"]) => ({ fieldKey, description, comparison, required: true }));
  if (caseId.startsWith("tru-turnaround")) return fields(["turnaround_range", "Reported turnaround range including units."], ["turnaround_start_event", "Event from which the turnaround interval begins.", "normalized_text"]);
  if (caseId.startsWith("tru-sample")) return fields(["collection_sample_type", "Biological sample and collection method.", "normalized_text"]);
  if (caseId.startsWith("tru-sites")) return fields(["methylation_site_count_bound", "Reported DNA methylation site count with any plus or bound marker."]);
  if (caseId.startsWith("tru-biomarkers")) return fields(["biomarker_count_bound", "Reported biomarker count with any plus or bound marker."]);
  if (caseId.startsWith("tru-symphony")) return fields(["algorithm_name", "Named algorithm."], ["organ_system_count", "Reported number of organ systems."]);
  if (caseId.startsWith("tru-omic")) return fields(["algorithm_name", "Named algorithm."], ["method_type", "Stated clock or measurement method.", "normalized_text"]);
  if (caseId.startsWith("tru-pace")) return fields(["algorithm_name", "Named algorithm."], ["stated_function", "What the source says the algorithm tracks.", "normalized_text"]);
  if (caseId.startsWith("gl-systems")) return fields(["biomarker_count", "Reported epigenetic biomarker count."], ["body_system_count", "Reported body-system count."]);
  if (caseId.startsWith("gl-historical-wording") || caseId.startsWith("gl-same-page-footer")) return fields(["body_system_count", "Reported count of systems or organs and systems."]);
  if (caseId.startsWith("gl-triplicate")) return fields(["replicate_sample_scope", "Sample scope used for triplicate testing.", "normalized_text"], ["reported_consistency", "Reported agreement property across runs.", "normalized_text"]);
  if (caseId.startsWith("gl-repeatability")) return fields(["repeat_sample_scope", "Sample scope used for repeatability.", "normalized_text"], ["reported_consistency", "Reported repeated-run result property.", "normalized_text"]);
  if (caseId.startsWith("gl-no-diagnosis")) return fields(["diagnosis_qualification", "Whether the report constitutes diagnosis or treatment.", "normalized_text"]);
  if (caseId.startsWith("gl-consultation")) return fields(["clinician_prerequisite", "Consultation prerequisite before acting on recommendations.", "normalized_text"]);
  if (caseId.startsWith("gl-informational")) return fields(["use_qualification", "Stated permitted purpose of the report.", "normalized_text"], ["warranty_scope", "Stated warranty limitation.", "normalized_text"]);
  if (caseId.startsWith("pace-definition")) return fields(["method_name", "Name of the DNA methylation biomarker."], ["measurement_target", "Quantity the biomarker is stated to measure.", "normalized_text"]);
  if (caseId.startsWith("pace-cohort")) return fields(["cohort_design", "Study cohort and longitudinal design.", "normalized_text"], ["indicator_count", "Number of organ-system indicators."], ["timepoint_count", "Number of measurement time points."], ["study_span", "Reported longitudinal time span.", "normalized_text"]);
  if (caseId.startsWith("noise-method")) return fields(["method_name", "Name assigned to the described measurement."], ["measurement_type", "Whether the method is described as a measurement or prediction.", "normalized_text"]);
  if (caseId.startsWith("gl-interested-comparison")) return fields(["claim_attribution", "Party making the comparison claim.", "normalized_text"], ["comparison_claim", "Exact comparative descriptor used by the source.", "normalized_text"]);
  throw new Error(`EXTRACTION_FIELD_PLAN_MISSING:${caseId}`);
};

const roles = ["luna_extractor", "interfaze_extractor", "haiku_judge"] as const;
const casePlan = dataset.cases.map((testCase: Json) => {
  const granted = testCase.tags.includes("provider_grant_d013"), smoke = testCase.caseId === "tru-turnaround-product-mutated";
  return { caseId: testCase.caseId, caseDigest: testCase.caseDigest, execution: smoke ? "excluded_prior_protocol_smoke" : granted ? "fresh_dispatch" : "local_only", providerRoles: granted && !smoke ? roles : [], fields: granted && !smoke ? fieldPlan(testCase.caseId) : [] };
});
const fresh = casePlan.filter((item: Json) => item.execution === "fresh_dispatch");
if (fresh.length !== 39) throw new Error(`EXTRACTION_FRESH_CASE_COUNT:${fresh.length}`);
const manifestMaterial = {
  schemaVersion: "diagnostics-benchmark-extraction-experiment.v1",
  datasetManifestDigest: dataset.manifestDigest,
  grantDigest: grant.grantDigest,
  outputSchemaDigest: DIAGNOSTICS_EXTRACTION_OUTPUT_SCHEMA_DIGEST,
  runnerVersion: "verification-benchmark-runner.v1+recorded-extraction.v1",
  arms: diagnosticsBenchmarkArms(),
  providerCallPlan: [
    { role: "luna_extractor", provider: "gateway", model: "openai/gpt-5.6-luna", reservationCostMicros: 5_000, maximumOutputTokens: 900, maximumRequestUtf8Bytes: 10_000, outputSchemaDigest: DIAGNOSTICS_EXTRACTION_OUTPUT_SCHEMA_DIGEST, ownerArmId: "baseline", sharedWithArmIds: ["baseline", "consensus-abstention"] },
    { role: "interfaze_extractor", provider: "interfaze", model: "interfaze-beta", reservationCostMicros: 50_000, maximumOutputTokens: 900, maximumRequestUtf8Bytes: 10_000, outputSchemaDigest: DIAGNOSTICS_EXTRACTION_OUTPUT_SCHEMA_DIGEST, ownerArmId: "interfaze", sharedWithArmIds: ["interfaze", "cascade", "consensus-abstention"] },
    { role: "haiku_judge", provider: "gateway", model: "anthropic/claude-haiku-4.5", reservationCostMicros: 20_000, maximumOutputTokens: 900, maximumRequestUtf8Bytes: 10_000, outputSchemaDigest: gatewaySemanticOutputSchemaDigest, ownerArmId: "cascade", sharedWithArmIds: ["cascade", "consensus-abstention"] },
  ],
  casePlan,
  repetitions: 1,
  randomSeed: 207197,
  networkPolicy: "allow_listed_providers",
  concurrency: 1,
  automaticQualityRetries: 0,
  maximumFreshProviderCalls: fresh.length * 3,
  maximumFreshReservationMicros: fresh.length * 75_000,
  budget: { budgetId: "5890d523-561b-55db-a724-890d642885d9", budgetKey: "ws07-pilot-recovery-20260905", ceilingMicros: 17_928_167, carriedLiabilityMicros: 2_071_833, carryForwardReceiptDigest: recoveryReceiptDigest },
  hypothesisFamily: ["interfaze_vs_luna_case_nominal", "interfaze_vs_luna_clustered", "cascade_vs_luna_case_nominal", "cascade_vs_luna_clustered", "consensus_vs_luna_case_nominal", "consensus_vs_luna_clustered"],
  metricDimensions: ["schema", "locator", "field_mechanics", "support", "authority", "world_correctness", "policy", "calibration", "cost", "latency", "failure"],
  limitations: ["All 43 labels are agent engineering expectations; human-gold scoring and calibration promotion are prohibited.", "The prior V3 smoke case is protocol-only and excluded because its support-only schema cannot be relabeled as extraction output.", "Four source-family clusters support exact 16-sign enumeration but very small-cluster uncertainty remains.", "McNemar is nominal and exploratory because source-correlated cases do not meet independence.", "Each provider-produced leaf must map to an exact quote in the granted fragment and pass deterministic extraction verification."],
  createdAt,
};
const manifest = DiagnosticsBenchmarkExtractionExperimentManifestSchema.parse({ ...manifestMaterial, manifestDigest: verificationBenchmarkDigest(manifestMaterial) });
await mkdir(output, { recursive: true });
const schemaFile = await writeImmutable("output-schema.json", DIAGNOSTICS_EXTRACTION_OUTPUT_SCHEMA);
const manifestFile = await writeImmutable("manifest.json", manifest);
process.stdout.write(`${JSON.stringify({ output, manifestDigest: manifest.manifestDigest, manifestFile, outputSchemaDigest: DIAGNOSTICS_EXTRACTION_OUTPUT_SCHEMA_DIGEST, outputSchemaFile: schemaFile, freshCaseCount: fresh.length, maximumFreshProviderCalls: manifest.maximumFreshProviderCalls, maximumFreshReservationMicros: manifest.maximumFreshReservationMicros }, null, 2)}\n`);
