import { readFile, writeFile } from "node:fs/promises";
import { assertCanonicalGate5HumanReviewPacket, bindHumanReviewReferences, createHumanReviewReferenceCases, createHumanReviewSamplePacket, GATE5_HUMAN_REVIEW_SAMPLE, validateHumanReviewSubmission, type HumanReviewEvidenceItem, type HumanReviewSamplePacket, type HumanReviewSystemOutput } from "../packages/evaluation/src/index.js";
import { sha256Digest } from "../packages/domain/src/index.js";
import { createBroadEvaluationCorpus, runBroadHybridControlOutputs } from "../packages/testkit/src/index.js";

const argumentsWithoutSeparator = process.argv.slice(2).filter((value, index) => !(index === 0 && value === "--"));
const [packetPath, submissionPath, receiptPath = "catalog/gate5-human-review-receipt.json", ...flags] = argumentsWithoutSeparator;
if (!packetPath || !submissionPath) throw new Error("USAGE: pnpm validate:gate5-human -- <packet.json> <human-submission.json> [receipt.json] --verified-reviewer <stable-human-identity>");
const verifiedReviewerIdentities: string[] = [];
for (let index = 0; index < flags.length; index += 1) {
  if (flags[index] !== "--verified-reviewer") throw new Error(`UNKNOWN_ARGUMENT:${flags[index]}`);
  const identity = flags[index + 1]?.trim();
  if (!identity) throw new Error("VERIFIED_REVIEWER_IDENTITY_REQUIRED");
  verifiedReviewerIdentities.push(identity); index += 1;
}
const packet = JSON.parse(await readFile(packetPath, "utf8")) as HumanReviewSamplePacket;
assertCanonicalGate5HumanReviewPacket(packet);
const submission: unknown = JSON.parse(await readFile(submissionPath, "utf8"));
const reviewArtifact = JSON.parse(await readFile("catalog/broad-corpus-review-v4.json", "utf8"));
const corpus = await createBroadEvaluationCorpus(reviewArtifact);
if (corpus.dataset.manifestDigest !== packet.datasetManifestDigest) throw new Error("HUMAN_REVIEW_DATASET_MANIFEST_MISMATCH");
const controlOutputs = await runBroadHybridControlOutputs(corpus);
const referenceByCaseId = createHumanReviewReferenceCases(corpus.dataset, controlOutputs.map(({ output }) => output));
const evidenceByRecordId = new Map<string, HumanReviewEvidenceItem>(corpus.records.map((record) => [record.id, { recordId: record.id, text: record.text, locatorDigests: record.locators.map(({ quoteDigest }) => quoteDigest).filter((value): value is string => Boolean(value)) }]));
const systemOutputsByCaseId = new Map<string, HumanReviewSystemOutput>(controlOutputs.map(({ output, evidencePacket }) => [output.caseId, { caseId: output.caseId, systemOutputDigest: evidencePacket.digest, abstained: output.abstained, requestedSpaces: evidencePacket.plan.spaces, appliedFilters: evidencePacket.plan.hardFilters.map(({ field, op, value }) => ({ field, operator: op, value })), results: output.items.map((item) => ({ recordId: item.recordId, rank: item.rank, score: item.score, resultType: item.resultType ?? "unknown", locatorDigests: item.locatorDigests ?? [], graphPaths: item.graphPaths ?? [] })) }]));
const rebuiltPacket = createHumanReviewSamplePacket({ dataset: corpus.dataset, evidenceByRecordId, systemOutputsByCaseId, referenceByCaseId, executionInputManifestDigest: corpus.publicRequestManifestDigest, ...GATE5_HUMAN_REVIEW_SAMPLE });
if (sha256Digest(rebuiltPacket) !== sha256Digest(packet)) throw new Error("HUMAN_REVIEW_SYSTEM_OUTPUT_BINDING_INVALID");
const boundReferences = bindHumanReviewReferences(GATE5_HUMAN_REVIEW_SAMPLE.sampleId, GATE5_HUMAN_REVIEW_SAMPLE.sampleSeed, referenceByCaseId);
const receipt = validateHumanReviewSubmission(packet, submission, { verifiedReviewerIdentities, referenceByCaseId: boundReferences });
await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, humanReviewStatus: receipt.status, publicationAuthorityGranted: receipt.publicationAuthorityGranted, reviewerIdentityVerified: receipt.reviewerIdentityVerified, metrics: receipt.metrics, receiptDigest: receipt.receiptDigest, receiptPath }));
