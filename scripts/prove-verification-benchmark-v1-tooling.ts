import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonicalizeJson, sha256Digest } from "@aiengineer/knowledge-verification";
import {
  assessVerificationBenchmarkV1Readiness,
  buildVerificationBenchmarkV1CurationQueue,
  importVerificationBenchmarkV1CandidatePool,
  planVerificationBenchmarkV1Splits,
} from "../packages/evaluation/src/verification-benchmark-v1.js";

const proofId = "fc3f6d69-0cf1-4c83-9ae7-681af058de75";
const repositoryRoot = resolve(import.meta.dirname, "..");
const inputPath = resolve(repositoryRoot, "catalog", "verification-benchmarks", "diagnostics-companies-pilot-v4", "benchmark-v1-candidate-pool.json");
const outputPath = resolve(repositoryRoot, "..", "internal", `verification-benchmark-v1-tooling-${proofId}.json`);
const packDirectory = resolve(repositoryRoot, "catalog", "verification-benchmarks", "diagnostics-companies-benchmark-v1-preparation-v3");
const sourcePreparationDirectory = resolve(repositoryRoot, "..", "internal", "verification-offline-source-preparation-9093b465-16c2-4cc1-b7f4-728d3958b0ed");
const sourcePreparationRelativePath = "../../../../internal/verification-offline-source-preparation-9093b465-16c2-4cc1-b7f4-728d3958b0ed";
const encoder = new TextEncoder();

const rawPoolBytes = await readFile(inputPath);
const imported = importVerificationBenchmarkV1CandidatePool(JSON.parse(new TextDecoder().decode(rawPoolBytes)));
const sourcePreparationManifestBytes = await readFile(resolve(sourcePreparationDirectory, "manifest.json"));
const fragmentCandidatesBytes = await readFile(resolve(sourcePreparationDirectory, "fragment-candidates.json"));
if (sha256Digest(sourcePreparationManifestBytes) !== imported.pool.sourcePreparationDigest) throw new Error("BENCHMARK_V1_SOURCE_PREPARATION_DIGEST_INVALID");
const fragmentRegistry = JSON.parse(new TextDecoder().decode(fragmentCandidatesBytes)) as { rows?: unknown[]; sourcePreparationDigest?: string };
if (!Array.isArray(fragmentRegistry.rows) || fragmentRegistry.rows.length !== 1186 || fragmentRegistry.sourcePreparationDigest !== imported.pool.sourcePreparationDigest) throw new Error("BENCHMARK_V1_FRAGMENT_REGISTRY_INVALID");
const sourceBindingKey = (value: any) => canonicalizeJson({ captureId: value.captureId, projectionArtifactId: value.projectionArtifactId, projectionDigest: value.projectionDigest, selector: value.selector, selectedContentDigest: value.selectedContentDigest, sourceClass: value.sourceClass, sourceKey: value.sourceKey });
const fragmentBindings = new Map(fragmentRegistry.rows.map((item) => [sourceBindingKey(item), item]));
for (const candidate of imported.pool.candidates) if (!fragmentBindings.has(sourceBindingKey(candidate))) throw new Error(`BENCHMARK_V1_CANDIDATE_SOURCE_BINDING_INVALID:${candidate.candidateId}`);
const sourceFamilyFor = (sourceKey: string): string => {
  if (sourceKey.startsWith("gl-")) return "company:generation-lab";
  if (sourceKey.startsWith("tru-")) return "company:trudiagnostic";
  return `study:${sourceKey}`;
};
const groupings = imported.pool.candidates.map((candidate) => ({
  candidateId: candidate.candidateId,
  sourceFamily: sourceFamilyFor(candidate.sourceKey),
  entityFamily: sourceFamilyFor(candidate.sourceKey),
  reportCluster: `source:${candidate.sourceKey}`,
  pairCluster: `fragment:${candidate.fragmentId}`,
}));
const splitPlan = planVerificationBenchmarkV1Splits({ imported, groupings, seed: 20260905 });
const curationQueue = buildVerificationBenchmarkV1CurationQueue(imported);
const readiness = assessVerificationBenchmarkV1Readiness({ imported });
if (imported.pool.count !== 180 || curationQueue.length !== 180 || splitPlan.assignments.length !== 180 || readiness.structurallyRunnable || readiness.humanGoldPromotionReady) throw new Error("BENCHMARK_V1_TOOLING_PROOF_INVALID");
for (const sourceFamily of new Set(splitPlan.assignments.map((item) => item.sourceFamily))) {
  if (new Set(splitPlan.assignments.filter((item) => item.sourceFamily === sourceFamily).map((item) => item.partition)).size !== 1) throw new Error(`BENCHMARK_V1_SPLIT_LEAKAGE:${sourceFamily}`);
}

await mkdir(packDirectory, { recursive: true });
const encode = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
const writeOnce = async (name: string, value: unknown) => {
  const path = resolve(packDirectory, name), bytes = encode(value), digest = sha256Digest(bytes);
  try { await access(path); if (!Buffer.from(await readFile(path)).equals(bytes)) throw new Error(`BENCHMARK_V1_REVIEW_PACK_IMMUTABLE_CONFLICT:${name}`); }
  catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await writeFile(path, bytes, { flag: "wx" }); }
  return { name, digest, byteLength: bytes.byteLength };
};
const queueDocument = { schemaVersion: "verification-benchmark-v1-curation-queue.v1", candidatePoolDigest: imported.candidatePoolDigest, count: curationQueue.length, humanGoldCount: 0, items: curationQueue };
const queueFile = await writeOnce("curation-queue.json", queueDocument);
const splitFile = await writeOnce("split-plan.json", splitPlan);
const manifestMaterial = {
  schemaVersion: "verification-benchmark-v1-human-review-pack.v3",
  status: "awaiting_case_atomization_and_human_review",
  sourceCandidatePool: { relativePath: "../diagnostics-companies-pilot-v4/benchmark-v1-candidate-pool.json", rawFileDigest: sha256Digest(rawPoolBytes), semanticCandidatePoolDigest: imported.candidatePoolDigest, sourcePreparationDigest: imported.pool.sourcePreparationDigest },
  frozenSourcePreparation: { manifestPath: `${sourcePreparationRelativePath}/manifest.json`, manifestDigest: sha256Digest(sourcePreparationManifestBytes), fragmentRegistryPath: `${sourcePreparationRelativePath}/fragment-candidates.json`, fragmentRegistryDigest: sha256Digest(fragmentCandidatesBytes), registryRows: fragmentRegistry.rows.length, matchedCandidates: imported.pool.count },
  files: [queueFile, splitFile],
  counts: { candidates: imported.pool.count, independentObservations: 0, humanGoldCases: 0, sourceKeys: imported.sourceKeyCount, sourceClasses: imported.sourceClassCount, provenanceComponents: splitPlan.componentCount, partitions: splitPlan.counts },
  requiredBeforeFreeze: ["atomize_each_assertion", "review_provenance_grouping", "two_blinded_human_annotations_per_case", "expert_adjudication", "trusted_reviewer_identity_admission", "register_case_and_adjudication_artifacts", "seal_benchmark_v1_dataset"],
  limitations: ["The 180 rows are source-bound fragment candidates, not cases, labels, or independent observations.", "The provisional six-component split is leakage-safe but imbalanced at 90/14/76; human review must accept or revise provenance coverage before freezing."],
};
const reviewPackManifest = { ...manifestMaterial, manifestDigest: sha256Digest(encoder.encode(canonicalizeJson(manifestMaterial))) };
const manifestFile = await writeOnce("manifest.json", reviewPackManifest);

const core = {
  schemaVersion: "verification-benchmark-v1-preparation-proof.v1",
  proofId,
  input: {
    path: inputPath,
    rawFileDigest: sha256Digest(rawPoolBytes),
    semanticCandidatePoolDigest: imported.candidatePoolDigest,
    sourcePreparationDigest: imported.pool.sourcePreparationDigest,
  },
  authenticatedSourcePreparation: { directory: sourcePreparationDirectory, manifestDigest: sha256Digest(sourcePreparationManifestBytes), fragmentRegistryDigest: sha256Digest(fragmentCandidatesBytes), registryRows: fragmentRegistry.rows.length, matchedCandidates: imported.pool.count },
  importSummary: { candidateCount: imported.pool.count, sourceKeyCount: imported.sourceKeyCount, sourceClassCount: imported.sourceClassCount, independentObservationCount: imported.pool.independentObservationCount },
  curationQueue,
  splitPlan,
  readiness,
  humanReviewPack: { directory: packDirectory, manifest: reviewPackManifest, manifestFile },
  limitations: [
    "These are source-bound fragment candidates, not atomic cases, independent observations, or human-gold labels.",
    "The grouping plan keeps each company or publication study provenance component indivisible; its six large components produce intentionally coarse and potentially imbalanced partitions.",
    "Two blinded human annotations, expert adjudication, trusted reviewer identity admission, case artifact registration, dataset freezing, calibration, and locked-test execution remain pending.",
  ],
  providerDispatches: 0,
  databaseWrites: 0,
  storageWrites: 0,
};
const digest = sha256Digest(encoder.encode(canonicalizeJson(core)));
let receipt: unknown;
try {
  await access(outputPath);
  receipt = JSON.parse(await readFile(outputPath, "utf8"));
  if (canonicalizeJson((receipt as { core?: unknown }).core) !== canonicalizeJson(core) || (receipt as { digest?: string }).digest !== digest) throw new Error("BENCHMARK_V1_TOOLING_IMMUTABLE_CONFLICT");
} catch (error: unknown) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  receipt = { core, createdAt: new Date().toISOString(), digest };
  await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
}
process.stdout.write(`${JSON.stringify({ outputPath, digest, candidateCount: imported.pool.count, componentCount: splitPlan.componentCount, splitCounts: splitPlan.counts, humanGoldPromotionReady: readiness.humanGoldPromotionReady }, null, 2)}\n`);
