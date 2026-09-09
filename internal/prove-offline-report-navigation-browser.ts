import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { runDiagnosticsCompaniesDemo } from "../packages/application/src/verification-benchmark.ts";

const ksRoot = resolve(import.meta.dirname, "..");
const root = resolve(ksRoot, "..");
const outputDirectory = resolve(root, "internal", `verification-offline-navigation-browser-${randomUUID()}`);
const require = createRequire(resolve(root, "ai-engineer-mission-control", "apps", "dashboard", "package.json"));
const { chromium } = require("@playwright/test") as typeof import("@playwright/test");
const runId = "11111111-1111-4111-8111-111111111111";
const result = await runDiagnosticsCompaniesDemo({
  catalogDirectory: resolve(root, "ai-engineer-knowledge-services/catalog/verification-benchmarks/diagnostics-companies-pilot-v3"),
  sourcePreparationDirectory: resolve(root, "ai-engineer-knowledge-services/catalog/verification-assets/50a3552cffc639a78d7789865be929baefd64d2342431e2de958e669c21f163e"),
  outputDirectory,
  runId,
  now: () => "2026-09-07T12:00:00.000Z",
});
const requests: string[] = [];
const browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 10_000 });
try {
  const page = await browser.newPage();
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(pathToFileURL(resolve(outputDirectory, "verification-audit.html")).href);
  await page.locator('a[href="evidence-appendix.html#fragment-tru-corrupted-locator"]').click();
  await page.waitForURL(/evidence-appendix\.html#fragment-tru-corrupted-locator$/u);
  const unavailableArticle = page.locator("#fragment-tru-corrupted-locator");
  const unavailableText = await unavailableArticle.textContent();
  if (!unavailableText?.includes("selector_or_digest_mismatch") || unavailableText.includes("Resolved selected fragment")) {
    throw new Error("OFFLINE_NAVIGATION_CORRUPTED_LOCATOR_RENDERING_INVALID");
  }
  await unavailableArticle.locator('a[href="#run-manifest"]').click();
  await page.waitForURL(/evidence-appendix\.html#run-manifest$/u);
  await page.locator('#run-manifest a[href="run-ledger.json"]').click();
  await page.waitForURL(/run-ledger\.json$/u);
  if (!(await page.textContent("body"))?.includes(runId)) throw new Error("OFFLINE_NAVIGATION_RUN_LEDGER_IDENTITY_MISSING");
  if (requests.some((url) => !url.startsWith("file:"))) throw new Error("OFFLINE_NAVIGATION_EXTERNAL_REQUEST");
  const receipt = {
    kind: "offline_report_navigation_browser",
    runId,
    outputDirectory,
    fileManifestDigest: result.fileManifestDigest,
    checks: {
      corruptedLocatorLocalAnchor: true,
      corruptedLocatorUnavailable: true,
      runManifestAnchor: true,
      runLedgerIdentity: true,
      localFileRequestsOnly: true,
    },
    requestSchemes: [...new Set(requests.map((url) => new URL(url).protocol))],
  };
  const receiptJson = JSON.stringify(receipt, null, 2) + "\n";
  const receiptPath = resolve(root, "internal", `verification-offline-navigation-browser-${randomUUID()}.json`);
  await writeFile(receiptPath, receiptJson, { flag: "wx" });
  console.log(JSON.stringify({ receiptPath, receiptSha256: createHash("sha256").update(receiptJson).digest("hex"), outputDirectory }, null, 2));
} finally {
  await browser.close();
}


