import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { disposableDatabaseUrl } from "../packages/persistence/test/disposable.mjs";
import { TenantPostgres } from "../packages/persistence/dist/index.js";

const repository = resolve(import.meta.dirname, "..");
const outputDirectory = process.env.KS_SCHEMA_PROOF_OUTPUT;
if (!outputDirectory) throw new Error("KS_SCHEMA_PROOF_OUTPUT_REQUIRED");
if (!process.env.npm_execpath) throw new Error("RUN_WITH_PINNED_PNPM_SCRIPT");
const databaseUrl = disposableDatabaseUrl({ ...process.env, KS_REQUIRE_CURRENT_SCHEMA: "1" });
const manifestPath = resolve(repository, "../ai-engineer-db-contract/workspace/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const output = resolve(outputDirectory);
mkdirSync(output, { recursive: true });
const database = new TenantPostgres({ connectionString: databaseUrl });
let head;
try { head = await database.migrationHead(); } finally { await database.close(); }
if (head !== manifest.build.migration_head) throw new Error("CURRENT_SCHEMA_HEAD_MISMATCH");

const selections = [
  { name: "preparation", package: "@aiengineer/knowledge-persistence", tests: ["src/preparation.test.ts", "src/preparation-vocabulary.test.ts", "test/disposable.test.ts"] },
  { name: "read", package: "@aiengineer/knowledge-db-read", tests: ["src/read-executor.integration.test.ts", "src/snapshot.integration.test.ts", "src/snapshot.test.ts"] },
  { name: "ingestion", package: "@aiengineer/knowledge-ingestion", tests: ["src/executor.integration.test.ts", "test/current-schema.integration.test.ts", "test/temporal.integration.test.ts", "src/plan.test.ts", "src/evidence-admission.test.ts"] },
  { name: "admission", package: "@aiengineer/knowledge-verification-executor", tests: ["src/knowledge/evidence-oracle.test.ts", "src/knowledge/admission.integration.test.ts", "src/serve.test.ts", "src/knowledge/cli.test.ts"] },
];
const results = [];
for (const selection of selections) {
  const reportPath = resolve(output, `${selection.name}.json`);
  const args = [process.env.npm_execpath, "--filter", selection.package, "exec", "vitest", "run", ...selection.tests, "--reporter=json", `--outputFile=${reportPath}`, "--no-file-parallelism"];
  const startedAt = new Date().toISOString();
  const run = spawnSync(process.execPath, args, { cwd: repository, env: { ...process.env, KS_REQUIRE_CURRENT_SCHEMA: "1" }, encoding: "utf8", windowsHide: true, timeout: 180_000 });
  const logPath = resolve(output, `${selection.name}.log`);
  writeFileSync(logPath, `${run.stdout ?? ""}\n${run.stderr ?? ""}`);
  let report;
  try { report = JSON.parse(readFileSync(reportPath, "utf8")); } catch { report = null; }
  const passed = run.status === 0 && report?.success === true && report.numTotalTests > 0
    && report.numPendingTests === 0 && report.numTodoTests === 0
    && selection.tests.every((test) => report.testResults.some((result) => result.name.replaceAll("\\", "/").endsWith(test)));
  results.push({ selection, startedAt, completedAt: new Date().toISOString(), exitCode: run.status, passed, reportPath, logPath,
    tests: report ? { total: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests, skipped: report.numPendingTests, todo: report.numTodoTests } : null });
  console.log(`${selection.name}: ${passed ? "passed" : "failed or incomplete"}`);
  if (!passed) break;
}
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const receipt = { schemaVersion: "ks-schema-compatibility/1", recordedAt: new Date().toISOString(),
  passed: results.length === selections.length && results.every((result) => result.passed),
  environment: { class: "isolated_service", projectDirectory: resolve(process.env.KS_TEST_PROJECT_DIR), host: new URL(databaseUrl).hostname, port: new URL(databaseUrl).port },
  contract: { version: manifest.build.contract_version, migrationHead: head, manifestSha256: hash(manifestPath), catalogVersion: manifest.build.catalog_version, workspaceFingerprint: manifest.build.workspace_fingerprint },
  syntheticEvidence: true, productionAdmissionProof: false, results };
writeFileSync(resolve(output, "compatibility.json"), `${JSON.stringify(receipt, null, 2)}\n`);
process.exitCode = receipt.passed ? 0 : 1;
