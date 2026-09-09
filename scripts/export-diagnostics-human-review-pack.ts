import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { exportHumanReviewPack, renderHumanReviewHtml } from "../packages/evaluation/src/verification-human-review.js";

const root = new URL("../", import.meta.url);
const json = async (path: string) => JSON.parse(await readFile(new URL(path, root), "utf8"));
const queue = await json("catalog/verification-benchmarks/diagnostics-companies-benchmark-v1-preparation-v3/curation-queue.json");
const pool = await json("catalog/verification-benchmarks/diagnostics-companies-pilot-v4/benchmark-v1-candidate-pool.json");
const registry = await json("../internal/verification-offline-source-preparation-9093b465-16c2-4cc1-b7f4-728d3958b0ed/fragment-candidates.json");
const pack = exportHumanReviewPack({ sourcePreparationManifestDigest: "sha256:50a3552cffc639a78d7789865be929baefd64d2342431e2de958e669c21f163e", candidatePoolDigest: queue.candidatePoolDigest, candidates: pool.candidates, fragments: registry.rows });
const output = new URL("catalog/verification-benchmarks/diagnostics-companies-benchmark-v1-human-review-v3/", root);
try { await access(output); throw new Error("HUMAN_REVIEW_V3_ALREADY_EXISTS"); } catch (error) { if (!(error instanceof Error) || !error.message.includes("ENOENT")) throw error; }
const staging = new URL(`catalog/verification-benchmarks/.human-review-v3-${process.pid}-${Date.now()}/`, root);
await mkdir(staging, { recursive: false });
try {
await writeFile(new URL("pack.json", staging), `${JSON.stringify(pack, null, 2)}\n`, { flag: "wx" });
await writeFile(new URL("review.html", staging), renderHumanReviewHtml(pack), { flag: "wx" });
await writeFile(new URL("submission.template.json", staging), `${JSON.stringify({ schemaVersion: pack.schemaVersion, packDigest: pack.packDigest, annotatorIdentity: "", annotatorQualification: "", annotatorCount: 1, provenance: "human_single_annotator", submittedAt: "", labels: [] }, null, 2)}\n`, { flag: "wx" });
await rename(staging, output);
} catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
console.log(JSON.stringify({ output: output.pathname, packDigest: pack.packDigest, candidateCount: pack.candidateCount, html: "review.html", template: "submission.template.json" }));
