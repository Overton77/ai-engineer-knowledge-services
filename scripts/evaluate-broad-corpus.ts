import { readFile, writeFile } from "node:fs/promises";
import type { EvaluationReviewArtifact } from "../packages/evaluation/src/index.js";
import {
  BROAD_DOMAINS,
  BROAD_QUERY_CLASSES,
  createBroadEvaluationCorpus,
  runBroadEvaluation,
} from "../packages/testkit/src/index.js";

const reviewArtifactPath =
  process.argv[2] ?? "catalog/broad-corpus-review-v4.json";
const outputPath = process.argv[3] ?? "catalog/broad-heldout-evaluation.json";
const reviewArtifact = JSON.parse(
  await readFile(reviewArtifactPath, "utf8"),
) as EvaluationReviewArtifact;
const corpus = await createBroadEvaluationCorpus(reviewArtifact);
const started = performance.now();
const result = await runBroadEvaluation(corpus);
const totalWallMs = Number((performance.now() - started).toFixed(3));
const countBy = <T extends string>(values: readonly T[]) =>
  Object.fromEntries(
    [...new Set(values)]
      .sort()
      .map((value) => [value, values.filter((item) => item === value).length]),
  );
const receipt = {
  storeClass: "internal_exploratory",
  runKind: "deterministic_broad_evaluation",
  corpusVersion: "broad-heldout-v3.0.0",
  dataset: {
    id: corpus.dataset.id,
    version: corpus.dataset.version,
    manifestDigest: corpus.dataset.manifestDigest,
    publicRequestManifestDigest: corpus.publicRequestManifestDigest,
    candidateManifestDigest:
      corpus.dataset.reviewArtifact?.candidateManifestDigest,
    reviewArtifactDigest: corpus.dataset.reviewArtifact?.digest,
    reviewerIdentity: corpus.dataset.reviewArtifact?.reviewerIdentity,
    caseCount: corpus.dataset.cases.length,
    recordCount: corpus.records.length,
  },
  coverage: {
    partitions: result.partitionAudit.counts,
    partitionLeakageValid: result.partitionAudit.valid,
    partitionLeakageViolations: result.partitionAudit.violations,
    domains: countBy(corpus.dataset.cases.map(({ domain }) => domain)),
    queryClasses: countBy(
      corpus.dataset.cases.map(({ queryClass }) => queryClass),
    ),
    fixtureKinds: countBy(
      corpus.dataset.cases.map(({ fixtureKind }) => fixtureKind),
    ),
    sourceFamilyCount: new Set(
      corpus.dataset.cases.map(({ sourceFamily }) => sourceFamily),
    ).size,
    entityFamilyCount: new Set(
      corpus.dataset.cases.map(({ entityFamily }) => entityFamily),
    ).size,
    everyRequiredDomainPresent: BROAD_DOMAINS.every((domain) =>
      corpus.dataset.cases.some((item) => item.domain === domain),
    ),
    everyRequiredQueryClassPresent: BROAD_QUERY_CLASSES.every((queryClass) =>
      corpus.dataset.cases.some((item) => item.queryClass === queryClass),
    ),
  },
  experiment: {
    digest: result.experiment.digest,
    arms: result.experiment.arms.map(({ arm, report }) => ({
      id: arm.id,
      control: arm.control,
      configuration: arm.configuration,
      metrics: report.overall,
      outputManifestDigest: report.outputManifestDigest,
    })),
  },
  gates: {
    control: result.controlGate,
    regression: result.regressionGate,
    rollback: result.rollbackProof,
  },
  falseAcceptanceAnalysis: {
    count: result.falseAcceptanceCases.length,
    caseIds: result.falseAcceptanceCases,
  },
  telemetry: { deterministicEmbeddingCostMicros: 0, totalWallMs },
};
await writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify({
    ok:
      result.controlGate.passed &&
      result.regressionGate.passed &&
      result.rollbackProof.passed,
    cases: corpus.dataset.cases.length,
    partitions: result.partitionAudit.counts,
    control: result.experiment.arms.find(({ arm }) => arm.control)?.report
      .overall,
    falseAcceptances: result.falseAcceptanceCases.length,
    totalWallMs,
    outputPath,
  }),
);
