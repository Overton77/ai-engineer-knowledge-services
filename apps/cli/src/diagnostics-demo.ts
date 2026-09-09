import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

export function parseDiagnosticsDemoArgs(args: readonly string[]): { dataset: "diagnostics-companies-v1"; outputDirectory: string; open: boolean } {
  if (args[0] !== "demo" || args[1] !== "diagnostics-companies") throw new Error("DEMO_COMMAND_INVALID");
  const values = new Map<string, string>(); let open = false;
  for (let i = 2; i < args.length; i++) {
    const name = args[i]!;
    if (name === "--open" && !open) { open = true; continue; }
    if (!["--dataset", "--output"].includes(name) || values.has(name) || !args[i + 1] || args[i + 1]!.startsWith("--")) throw new Error("DEMO_OPTION_INVALID");
    values.set(name, args[++i]!);
  }
  const dataset = values.get("--dataset"), output = values.get("--output");
  if (dataset !== "diagnostics-companies-v1" || !output?.trim()) throw new Error("DEMO_DATASET_OR_OUTPUT_REQUIRED");
  return { dataset, outputDirectory: resolve(output), open };
}

/** Local frozen-input execution; no HTTP client, access token, or provider authority. */
export async function runLocalDiagnosticsDemo(args: readonly string[], options: { assetDirectory?: string; interactive?: boolean } = {}) {
  const parsed = parseDiagnosticsDemoArgs(args);
  const assets = options.assetDirectory ?? fileURLToPath(new URL("./demo-assets/", import.meta.url));
  const catalogDirectory = join(assets, "catalog", parsed.dataset);
  const manifest = JSON.parse(await readFile(join(catalogDirectory, "manifest.json"), "utf8")) as { sourcePreparationDigest?: string };
  if (!/^sha256:[a-f0-9]{64}$/u.test(manifest.sourcePreparationDigest ?? "")) throw new Error("DEMO_PREPARATION_DIGEST_INVALID");
  const sourcePreparationDirectory = join(assets, "preparations", manifest.sourcePreparationDigest!.slice(7));
  const output = parsed.outputDirectory, parent = dirname(output), owner = randomUUID();
  if (output === parent) throw new Error("DEMO_OUTPUT_ROOT_DENIED");
  await mkdir(parent, { recursive: true });
  const lock = `${output}.lock`, staging = `${output}.pending-${owner}`;
  await writeFile(lock, owner, { flag: "wx" });
  let staged = false;
  try {
    try { await lstat(output); throw new Error("DEMO_OUTPUT_EXISTS"); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    await mkdir(staging); staged = true;
    const { runDiagnosticsCompaniesDemo } = await import("@aiengineer/knowledge-application");
    const result = await runDiagnosticsCompaniesDemo({ catalogName: parsed.dataset, catalogDirectory, semanticFixture: { directory: join(assets, "semantic/7067f432979212167ca1d7b797e37e6d0b5f5b180dc5919a210010017860c82c"), expectedFixtureDigest: "sha256:7067f432979212167ca1d7b797e37e6d0b5f5b180dc5919a210010017860c82c" }, generatedReportSemanticFixture: { directory: join(assets, "report-semantic/e54beb937d9deb3f66e0facb2f7066d623a22077d045e1635297a616b9064b5d"), expectedFixtureDigest: "sha256:e54beb937d9deb3f66e0facb2f7066d623a22077d045e1635297a616b9064b5d" }, sourcePreparationDirectory, outputDirectory: staging, runId: owner, now: () => new Date().toISOString() });
    await rename(staging, output); staged = false;
    const auditPath = join(output, "verification-audit.html");
    const opened = parsed.open && (options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY));
    if (opened) await openAudit(auditPath);
    return { status: result.qualityGate.outcome === "unavailable" ? "verification_incomplete" : result.qualityGate.outcome === "fail" ? "quality_gate_failed" : "quality_gate_passed", dataset: parsed.dataset, outputDirectory: output, auditPath, opened,
      runManifestDigest: result.run.manifestDigest, fileManifestDigest: result.fileManifestDigest, files: result.files,
      semanticReplay: result.semanticReplay, generatedReportSemanticReplay: result.generatedReportSemanticReplay, qualityGate: result.qualityGate, providerDispatches: 0, providerStagesReplayed: false, humanGoldScoringEligible: false, exitCode: result.qualityGate.exitCode };
  } finally {
    if (staged && await realpath(staging) === resolve(staging)) await rm(staging, { recursive: true, force: true });
    if (await readFile(lock, "utf8") === owner) await rm(lock);
  }
}

async function openAudit(path: string) {
  const executable = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(executable, [path], { windowsHide: true, stdio: "ignore" });
    child.once("error", reject); child.once("spawn", () => { child.unref(); resolvePromise(); });
  });
}

