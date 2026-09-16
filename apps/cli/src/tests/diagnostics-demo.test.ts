import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseDiagnosticsDemoArgs,
  runLocalDiagnosticsDemo,
} from "../diagnostics-demo.js";

const cli = resolve(import.meta.dirname, "../dist/index.js");
const assets = resolve(import.meta.dirname, "../dist/demo-assets");
const args = (output: string) => [
  "demo",
  "diagnostics-companies",
  "--dataset",
  "diagnostics-companies-v1",
  "--output",
  output,
];
const absent = async (path: string) => {
  await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
};
async function clean(path: string) {
  if ((await realpath(path)) === resolve(path))
    await rm(path, { recursive: true, force: true });
}

describe("offline diagnostics command", () => {
  it.each(
    [
      ["demo", "diagnostics-companies"],
      [...args("out"), "--output", "other"],
      [...args("out"), "--open", "--open"],
      [...args("out"), "--unknown"],
      [
        "demo",
        "diagnostics-companies",
        "--dataset",
        "../other",
        "--output",
        "out",
      ],
    ].map((value) => ({ value })),
  )("rejects ambiguous or unsupported options: %j", ({ value }) =>
    expect(() => parseDiagnosticsDemoArgs(value)).toThrow(),
  );

  it("runs the built CLI away from the repository with no API credentials and fetch disabled", async () => {
    const directory = await mkdtemp(
      resolve(tmpdir(), "diagnostics-installed-"),
    );
    try {
      const guard = resolve(directory, "no-network.mjs");
      await writeFile(
        guard,
        'globalThis.fetch = () => { throw new Error("NETWORK_FORBIDDEN"); };',
      );
      const output = resolve(directory, "reports");
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([name]) =>
          ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC"].includes(
            name.toUpperCase(),
          ),
        ),
      );
      // Includes fresh native report verification and 67 captured semantic replays.
      const child = spawnSync(
        process.execPath,
        ["--import", pathToFileURL(guard).href, cli, ...args(output), "--open"],
        {
          cwd: directory,
          env,
          encoding: "utf8",
          windowsHide: true,
          timeout: 120_000,
        },
      );
      expect(child.error).toBeUndefined();
      expect(child.status, child.stderr).toBe(2);
      const result = JSON.parse(child.stdout);
      expect(result).toMatchObject({
        dataset: "diagnostics-companies-v1",
        status: "verification_incomplete",
        opened: false,
        providerDispatches: 0,
        humanGoldScoringEligible: false,
        qualityGate: {
          outcome: "unavailable",
          exitCode: 2,
          admissionChanged: false,
        },
      });
      expect(result.qualityGate.gates).toContainEqual(
        expect.objectContaining({
          gateId: "semantic_claim_report_coverage",
          outcome: "unavailable",
        }),
      );
      expect(result.files.map((file: { name: string }) => file.name)).toEqual(
        expect.arrayContaining([
          "quality-gates.json",
          "adversarial-checks.json",
        ]),
      );
      expect(result.semanticReplay).toMatchObject({
        fixtureDigest:
          "sha256:7067f432979212167ca1d7b797e37e6d0b5f5b180dc5919a210010017860c82c",
        externalRequests: 0,
      });
      expect(result.semanticReplay.results).toHaveLength(40);
      expect(
        new Set(
          result.semanticReplay.results.map(
            (item: { caseId: string }) => item.caseId,
          ),
        ).size,
      ).toBe(40);
      expect(
        result.semanticReplay.results.find(
          (item: { caseId: string }) =>
            item.caseId === "gl-interested-comparison-mutated",
        ).assessment,
      ).toMatchObject({
        verdict: "partially_supported",
        disposition: "review",
      });
      expect(
        result.semanticReplay.results.find(
          (item: { caseId: string }) =>
            item.caseId === "gl-repeatability-mutated",
        ).assessment,
      ).toMatchObject({ verdict: "not_supported", disposition: "review" });
      expect(
        result.semanticReplay.results.every(
          (item: {
            externalRequests: number;
            replayedArtifactIds: readonly string[];
          }) =>
            item.externalRequests === 0 && item.replayedArtifactIds.length > 0,
        ),
      ).toBe(true);
      for (const name of [
        "semantic-replay.json",
        "evidence-appendix.html",
        "evidence-appendix.json",
        "trudiagnostic-research-report.html",
        "generation-lab-research-report.html",
        "diagnostics-comparison-report.html",
        "verification-audit.html",
        "claim-ledger.json",
        "field-ledger.json",
        "verification-bundle.json",
      ])
        expect(
          result.files.some((file: { name: string }) => file.name === name),
        ).toBe(true);
      for (const file of result.files) {
        const bytes = await readFile(resolve(output, file.name));
        expect(bytes.byteLength).toBe(file.bytes);
        expect(
          `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        ).toBe(file.digest);
      }
      expect(result.files).toHaveLength(33);
      expect(result.generatedReportSemanticReplay).toMatchObject({
        externalRequests: 0,
        diagnosticOnly: true,
      });
      expect(result.generatedReportSemanticReplay.results).toHaveLength(29);
      const reportReplay = JSON.parse(
        await readFile(resolve(output, "report-semantic-replay.json"), "utf8"),
      );
      expect(reportReplay.currentRunManifestDigest).toBe(
        result.runManifestDigest,
      );
      expect(reportReplay.sourceRunManifestDigest).not.toBe(
        result.runManifestDigest,
      );
      expect(reportReplay.reportAdmissionChanged).toBe(false);
      const auditMarkdown = await readFile(
        resolve(output, "verification-audit.md"),
        "utf8",
      );
      expect(auditMarkdown).toContain(
        "Captured missing-qualifier assessment: partially_supported; disposition review",
      );
      expect(auditMarkdown).toContain(
        "Captured adversarial negation: contradicted; disposition fail",
      );
      const appendix = await readFile(
        resolve(output, "evidence-appendix.html"),
        "utf8",
      );
      expect(appendix).toContain("Captured report assertion diagnostics");
      expect(appendix).toContain('href="report-semantic-replay.json"');
      const companyFields = JSON.parse(
        await readFile(resolve(output, "company-fields.json"), "utf8"),
      );
      expect(companyFields.replayMatched).toBe(true);
      expect(companyFields.executionDigest).toBe(companyFields.replayDigest);
      expect(companyFields.companies).toHaveLength(2);
      const leaves = companyFields.companies.flatMap(
        (company: { plan: { slots: { leaves: unknown[] }[] } }) =>
          company.plan.slots.flatMap((slot) => slot.leaves),
      );
      expect(leaves).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            asStated: "75+",
            normalized: expect.objectContaining({
              value: 75,
              qualifier: "at_least",
              unit: "biomarker",
            }),
          }),
          expect.objectContaining({
            asStated: "2\u20134 weeks",
            conflictSetId: expect.stringMatching(/^sha256:/),
          }),
          expect.objectContaining({
            asStated: "3\u20134 weeks",
            conflictSetId: expect.stringMatching(/^sha256:/),
          }),
        ]),
      );
      const fieldHtml = await readFile(
        resolve(output, "company-fields.html"),
        "utf8",
      );
      expect(fieldHtml).toContain(
        'href="evidence-appendix.html#fragment-tru-biomarkers-source"',
      );
      expect(fieldHtml).not.toContain("[object Object]");
      const policyReplay = JSON.parse(
        await readFile(resolve(output, "policy-replay.json"), "utf8"),
      );
      expect(policyReplay.policy.authority).toBe("engineering_replay_policy");
      expect(policyReplay.cases).toHaveLength(40);
      for (const item of policyReplay.cases) {
        expect(item.decision).toEqual(item.replayDecision);
        expect(item.decision.outcome).not.toBe("pass");
        expect(
          JSON.parse(item.policyInputsJson).assertions[0].semantic.assertionId,
        ).toBe(item.assertionId);
        expect(
          `sha256:${createHash("sha256").update(item.policyInputsJson).digest("hex")}`,
        ).toBe(item.policyInputsDigest);
      }
      const native = JSON.parse(
        await readFile(resolve(output, "native-verification.json"), "utf8"),
      );
      expect(native.claims).toHaveLength(40);
      expect(
        native.claims.every(
          (item: { deterministicResult: { status: string } }) =>
            item.deterministicResult.status === "passed",
        ),
      ).toBe(true);
      expect(native.reports).toHaveLength(3);
      expect(
        native.reports.every(
          (item: {
            deterministicResult: {
              status: string;
              summary: { failedCheckCodes: string[] };
            };
          }) =>
            item.deterministicResult.status === "failed" &&
            item.deterministicResult.summary.failedCheckCodes.includes(
              "REPORT_INTERNAL_CONTRADICTION_FREE",
            ),
        ),
      ).toBe(true);
      expect(native.replayMatched).toBe(true);
      const audit = JSON.parse(
        await readFile(resolve(output, "verification-audit.json"), "utf8"),
      );
      expect(audit.semanticPairResults).toHaveLength(20);
      expect(
        audit.semanticPairResults
          .filter((pair: { mutated: unknown }) => pair.mutated === null)
          .map((pair: { mutatedCaseId: string }) => pair.mutatedCaseId)
          .sort(),
      ).toEqual([]);
      await absent(`${output}.lock`);
      await expect(
        runLocalDiagnosticsDemo(args(output), { assetDirectory: assets }),
      ).rejects.toThrow("DEMO_OUTPUT_EXISTS");
      expect(
        JSON.parse(await readFile(resolve(output, "manifest.json"), "utf8"))
          .fileManifestDigest,
      ).toBe(result.fileManifestDigest);
    } finally {
      await clean(directory);
    }
  }, 130_000);

  it("rejects tampered catalog bytes without publishing a partial output", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "diagnostics-tamper-"));
    try {
      const catalog = resolve(
          directory,
          "assets/catalog/diagnostics-companies-v1",
        ),
        output = resolve(directory, "reports");
      await cp(resolve(assets, "catalog/diagnostics-companies-v1"), catalog, {
        recursive: true,
      });
      await writeFile(resolve(catalog, "source-ledger.json"), "{}");
      await expect(
        runLocalDiagnosticsDemo(args(output), {
          assetDirectory: resolve(directory, "assets"),
        }),
      ).rejects.toThrow("DIAGNOSTICS_OFFLINE_CATALOG_FILE_DIGEST_MISMATCH");
      await absent(output);
      await absent(`${output}.lock`);
    } finally {
      await clean(directory);
    }
  });
});
