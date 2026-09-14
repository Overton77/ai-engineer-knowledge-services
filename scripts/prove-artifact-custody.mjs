import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { disposableDatabaseUrl, disposableStorageConfig } from "../packages/persistence/test/disposable.mjs";

const repository = resolve(import.meta.dirname, "..");
if (!process.env.KS_CUSTODY_PROOF_OUTPUT || !process.env.npm_execpath) throw new Error("CUSTODY_PROOF_OUTPUT_AND_PNPM_REQUIRED");
const databaseUrl = disposableDatabaseUrl({ ...process.env, KS_REQUIRE_CURRENT_SCHEMA: "1" });
const storage = disposableStorageConfig({ ...process.env, KS_REQUIRE_CURRENT_SCHEMA: "1" });
const output = resolve(process.env.KS_CUSTODY_PROOF_OUTPUT); mkdirSync(output, { recursive: true });
const selections = [
  { name: "runtime", package: "@aiengineer/knowledge-runtime", tests: ["src/runtime.test.ts", "src/artifacts-missing-object.test.ts"] },
  { name: "registration", package: "@aiengineer/knowledge-persistence", tests: ["src/verification-artifact-registration.test.ts", "src/verification-fenced-artifact.test.ts"] },
  { name: "executor", package: "@aiengineer/knowledge-verification-executor", tests: ["src/store-custody.test.ts", "src/store-custody.integration.test.ts", "src/serve.test.ts", "src/knowledge/evidence-oracle.test.ts"] },
];
const results = [];
for (const selection of selections) {
  const reportPath = resolve(output, `${selection.name}.json`), logPath = resolve(output, `${selection.name}.log`);
  const startedAt = new Date().toISOString();
  const run = spawnSync(process.execPath, [process.env.npm_execpath, "--filter", selection.package, "exec", "vitest", "run", ...selection.tests,
    "--reporter=json", `--outputFile=${reportPath}`, "--no-file-parallelism"],
    { cwd: repository, env: { ...process.env, KS_REQUIRE_CURRENT_SCHEMA: "1" }, encoding: "utf8", windowsHide: true, timeout: 180_000 });
  writeFileSync(logPath, `${run.stdout ?? ""}\n${run.stderr ?? ""}`);
  let report; try { report = JSON.parse(readFileSync(reportPath, "utf8")); } catch { report = undefined; }
  const passed = run.status === 0 && report?.success && report.numTotalTests > 0 && report.numPendingTests === 0 && report.numTodoTests === 0
    && selection.tests.every((test) => report.testResults.some((result) => result.name.replaceAll("\\", "/").endsWith(test)));
  results.push({ selection, startedAt, completedAt: new Date().toISOString(), exitCode: run.status, passed: Boolean(passed), reportPath, logPath,
    tests: report ? { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests, skipped: report.numPendingTests } : null });
  console.log(`${selection.name}: ${passed ? "passed" : "failed or incomplete"}`);
  if (!passed) break;
}
const manifestPath = resolve(repository, "../ai-engineer-db-contract/workspace/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const receipt = { schemaVersion: "ks-artifact-custody-proof.v1", recordedAt: new Date().toISOString(),
  passed: results.length === selections.length && results.every((result) => result.passed),
  environment: { class: "isolated_service", projectDirectory: resolve(process.env.KS_TEST_PROJECT_DIR), databasePort: new URL(databaseUrl).port, storagePort: new URL(storage.projectUrl).port },
  contract: { version: manifest.build.contract_version, migrationHead: manifest.build.migration_head, manifestSha256: createHash("sha256").update(readFileSync(manifestPath)).digest("hex") },
  results, checkpointProcessLossProof: false };
writeFileSync(resolve(output, "custody.json"), `${JSON.stringify(receipt, null, 2)}\n`);
process.exitCode = receipt.passed ? 0 : 1;
