import { readFile, writeFile } from "node:fs/promises";
import { createHumanReviewReferenceCases, createHumanReviewSamplePacket, createHumanReviewSubmissionTemplate, GATE5_HUMAN_REVIEW_SAMPLE, type HumanReviewEvidenceItem, type HumanReviewSystemOutput } from "../packages/evaluation/src/index.js";
import { createBroadEvaluationCorpus, runBroadHybridControlOutputs } from "../packages/testkit/src/index.js";

const packetPath = process.argv[2] ?? "catalog/gate5-human-review-sample.packet.json";
const templatePath = process.argv[3] ?? "catalog/gate5-human-review-response.template.json";
const reviewArtifactPath = process.argv[4] ?? "catalog/broad-corpus-review-v4.json";
const reviewArtifact = JSON.parse(await readFile(reviewArtifactPath, "utf8"));
const corpus = await createBroadEvaluationCorpus(reviewArtifact);
const controlOutputs = await runBroadHybridControlOutputs(corpus);
const evidenceByRecordId = new Map<string, HumanReviewEvidenceItem>(corpus.records.map((record) => [record.id, {
  recordId: record.id,
  text: record.text,
  locatorDigests: record.locators.map(({ quoteDigest }) => quoteDigest).filter((value): value is string => Boolean(value)),
}]));
const systemOutputsByCaseId = new Map<string, HumanReviewSystemOutput>(controlOutputs.map(({ output, evidencePacket }) => [output.caseId, {
  caseId: output.caseId,
  systemOutputDigest: evidencePacket.digest,
  abstained: output.abstained,
  requestedSpaces: evidencePacket.plan.spaces,
  appliedFilters: evidencePacket.plan.hardFilters.map(({ field, op, value }) => ({ field, operator: op, value })),
  results: output.items.map((item) => ({ recordId: item.recordId, rank: item.rank, score: item.score, resultType: item.resultType ?? "unknown", locatorDigests: item.locatorDigests ?? [], graphPaths: item.graphPaths ?? [] })),
}]));
const referenceByCaseId = createHumanReviewReferenceCases(corpus.dataset, controlOutputs.map(({ output }) => output));
const packet = createHumanReviewSamplePacket({
  dataset: corpus.dataset,
  evidenceByRecordId,
  systemOutputsByCaseId,
  referenceByCaseId,
  executionInputManifestDigest: corpus.publicRequestManifestDigest,
  ...GATE5_HUMAN_REVIEW_SAMPLE,
});
const template = createHumanReviewSubmissionTemplate(packet);
await writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
await writeFile(templatePath, `${JSON.stringify(template, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, humanReviewStatus: "pending_human_submission", systemUnderReview: "deterministic-hybrid-control", sampleSize: packet.cases.length, datasetManifestDigest: packet.datasetManifestDigest, sampleDigest: packet.sampleDigest, packetDigest: packet.packetDigest, packetPath, templatePath }));
