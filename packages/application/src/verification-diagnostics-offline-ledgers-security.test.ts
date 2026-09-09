import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { VerificationArtifactHandle, VerificationBenchmarkDataset, VerificationSource, VerificationSourceCapture } from "@aiengineer/knowledge-contracts";
import { sha256Digest } from "@aiengineer/knowledge-verification";
import { loadDiagnosticsOfflineCatalog } from "./verification-diagnostics-offline-catalog.js";
import type { DiagnosticsReportCoverage, DiagnosticsReportCoverageBlock } from "./verification-diagnostics-report-coverage.js";
import { buildDiagnosticsOfflineLedgers } from "./verification-diagnostics-offline-ledgers.js";

const repository = resolve(import.meta.dirname, "../../..");
const catalogDirectory = resolve(repository, "catalog/verification-benchmarks/diagnostics-companies-v1");
const preparationDirectory = resolve(repository, "catalog/verification-assets/50a3552cffc639a78d7789865be929baefd64d2342431e2de958e669c21f163e");
const otherTenantId = "11111111-1111-4111-8111-111111111111";

type Input = Parameters<typeof buildDiagnosticsOfflineLedgers>[0];
type Preparation = {
  artifacts: { file: string; handle: VerificationArtifactHandle }[];
  captures: { sourceKey: string; source: VerificationSource; capture: VerificationSourceCapture }[];
};

let fixture: Input;

beforeAll(async () => {
  const [{ dataset }, preparationText] = await Promise.all([
    loadDiagnosticsOfflineCatalog("diagnostics-companies-v1", catalogDirectory),
    readFile(resolve(preparationDirectory, "manifest.json"), "utf8"),
  ]);
  const preparation = JSON.parse(preparationText) as Preparation;
  const firstCase = dataset.cases.find((item) => item.evidence.length > 0)!;
  const secondCase = dataset.cases.find((item) => item.evidence.length > 0 && item.evidence[0]!.captureId !== firstCase.evidence[0]!.captureId)!;
  const selectedCases = [firstCase, secondCase];
  const captureIds = new Set(selectedCases.flatMap((item) => item.evidence.map((evidence) => evidence.captureId)));
  const selectedCaptures = preparation.captures.filter((item) => captureIds.has(item.capture.captureId));
  const artifactIds = new Set([
    ...selectedCaptures.map((item) => item.capture.contentArtifact.artifactId),
    ...selectedCases.flatMap((item) => item.evidence.flatMap((evidence) => [evidence.projectionArtifactId, evidence.transformationArtifactId])),
  ]);
  const selectedArtifacts = preparation.artifacts.filter((item) => artifactIds.has(item.handle.artifactId));
  fixture = {
    dataset: { ...structuredClone(dataset), cases: structuredClone(selectedCases) },
    reports: [],
    captures: structuredClone(selectedCaptures),
    artifacts: await Promise.all(selectedArtifacts.map(async (item) => ({
      registration: structuredClone(item.handle),
      bytes: new Uint8Array(await readFile(resolve(preparationDirectory, item.file))),
    }))),
  };
});

describe("diagnostics offline ledger input isolation", () => {
  it("rejects registered artifact bytes changed after the frozen preparation", () => {
    const input = structuredClone(fixture);
    input.artifacts[0]!.bytes[0] = (input.artifacts[0]!.bytes[0] ?? 0) ^ 1;
    expect(() => buildDiagnosticsOfflineLedgers(input)).toThrow("DIAGNOSTICS_OFFLINE_LEDGER_INPUT_INTEGRITY");
  });

  it("rejects cross-tenant and duplicate capture inputs", () => {
    const crossTenant = structuredClone(fixture);
    crossTenant.captures[1]!.capture.contentArtifact.tenantId = otherTenantId;
    expect(() => buildDiagnosticsOfflineLedgers(crossTenant)).toThrow("DIAGNOSTICS_OFFLINE_LEDGER_CAPTURE_BINDING");

    const duplicated = { ...structuredClone(fixture), captures: [...structuredClone(fixture.captures), structuredClone(fixture.captures[0]!)] };
    expect(() => buildDiagnosticsOfflineLedgers(duplicated)).toThrow("DIAGNOSTICS_OFFLINE_LEDGER_DUPLICATE_INPUT");
  });

  it("keeps resolver grants and captures private from returned-value mutation", async () => {
    const built = buildDiagnosticsOfflineLedgers(structuredClone(fixture));
    const originalGrant = structuredClone(built.projectionGrants[0]!);
    const originalCapture = structuredClone(built.captures[0]!);
    (built.projectionGrants as typeof built.projectionGrants[number][])[0]!.tenantId = otherTenantId;
    (built.captures as typeof built.captures[number][])[0]!.capture.captureId = "mutated-capture";

    const dependencies = built.createDependencies(undefined);
    expect(dependencies.projectionGrants!.resolve(originalGrant.tenantId, originalGrant.assertions)).toEqual(originalGrant);
    await expect(dependencies.captures.getRegisteredCapture({ tenantId: originalGrant.tenantId, captureId: originalCapture.capture.captureId })).resolves.toEqual(originalCapture);
    expect(() => dependencies.projectionGrants!.resolve(otherTenantId, originalGrant.assertions)).toThrow("VERIFICATION_CLAIMS_PROJECTION_GRANT_REQUIRED");
    await expect(dependencies.captures.getRegisteredCapture({ tenantId: originalGrant.tenantId, captureId: "mutated-capture" })).rejects.toThrow("DIAGNOSTICS_OFFLINE_LEDGER_CAPTURE_DENIED");
  });

  it("rejects a report that binds two projections to one capture", () => {
    const input = structuredClone(fixture);
    const first = input.dataset.cases[0]!, second = input.dataset.cases[1]!;
    const firstEvidence = first.evidence[0]!, secondEvidence = second.evidence[0]!;
    secondEvidence.captureId = firstEvidence.captureId;
    const renderedMarkdown = `${first.assertion}\n${second.assertion}`;
    const block = (ordinal: number, startUtf16: number, assertionText: string, caseId: string): DiagnosticsReportCoverageBlock => ({
      ordinal, kind: "assertion", startUtf16, endUtf16: startUtf16 + assertionText.length,
      textDigest: sha256Digest(assertionText), caseId, assertionText,
    });
    const report: DiagnosticsReportCoverage = {
      schemaVersion: "diagnostics-report-coverage.v1", reportId: "conflicting-projection-report",
      datasetManifestDigest: input.dataset.manifestDigest as `sha256:${string}`, runManifestDigest: sha256Digest("offline-run"),
      appendixAnchor: "evidence-appendix.html#run-manifest", runManifestTarget: "run-ledger.json",
      authoredBlocks: [{ kind: "assertion", caseId: first.caseId }, { kind: "assertion", caseId: second.caseId }],
      renderedMarkdown,
      blocks: [block(0, 0, first.assertion, first.caseId), block(1, first.assertion.length + 1, second.assertion, second.caseId)],
      coverage: { datasetCases: 2, factualBlocks: 2, contextBlocks: 0, mechanicallyResolved: 0, unresolved: 2, unmappedCaseIds: [] },
      reportDigest: sha256Digest(renderedMarkdown),
    };
    expect(() => buildDiagnosticsOfflineLedgers({ ...input, reports: [report] })).toThrow("DIAGNOSTICS_OFFLINE_LEDGER_MULTIPLE_PROJECTIONS");
  });
});
