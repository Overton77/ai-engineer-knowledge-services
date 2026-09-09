import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runDiagnosticsCompaniesDemo } from "../packages/application/dist/index.js";

const root = resolve(import.meta.dirname, "..");
const id = randomUUID();
const outputDirectory = resolve(root, `../internal/verification-diagnostics-demo-${id}`);
await mkdir(outputDirectory, { recursive: false });
const result = await runDiagnosticsCompaniesDemo({
  catalogDirectory: resolve(root, "catalog/verification-benchmarks/diagnostics-companies-pilot-v3"),
  sourcePreparationDirectory: resolve(root, "../internal/verification-offline-source-preparation-9093b465-16c2-4cc1-b7f4-728d3958b0ed"),
  outputDirectory,
  runId: randomUUID(),
  now: () => new Date().toISOString(),
});
const receipt = { schemaVersion: "verification-benchmark-offline-proof.v1", proofId: id, outputDirectory, datasetManifestDigest: result.run.datasetManifestDigest, runManifestDigest: result.run.manifestDigest, fileManifestDigest: result.fileManifestDigest, resultCount: result.run.results.length, providerDispatches: 0, networkPolicy: result.run.networkPolicy, files: result.files };
const body = `${JSON.stringify(receipt, null, 2)}\n`;
const receiptPath = resolve(root, `../internal/verification-benchmark-offline-proof-${id}.json`);
await writeFile(receiptPath, body, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ ...receipt, receiptPath, receiptDigest: `sha256:${createHash("sha256").update(body).digest("hex")}` }, null, 2)}\n`);
