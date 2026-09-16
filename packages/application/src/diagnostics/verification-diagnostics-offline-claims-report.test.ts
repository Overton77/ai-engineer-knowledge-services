import {
  VerificationReportLedgerSchema,
  type OperationContext,
  type VerificationArtifactHandle,
  type VerificationBundle,
} from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, sha256Digest, type RuntimePrincipalBinding } from "@aiengineer/knowledge-verification";
import { describe, expect, it } from "vitest";
import type { VerificationClaimsServiceDependencies } from "../verification/operations/verification-claims.js";
import { verifyDiagnosticsOfflineClaimsReportClosure } from "./verification-diagnostics-offline-claims-report.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const context: OperationContext = {
  contractVersion: "v1",
  tenantId,
  operationId: "22222222-2222-4222-8222-222222222222",
  attemptId: "33333333-3333-4333-8333-333333333333",
  correlationId: "offline-claims-report-test",
  actor: { kind: "service", id: "44444444-4444-4444-8444-444444444444", serviceIdentity: "knowledge_worker" },
  capabilityVersion: "verification.v1",
  idempotencyKey: "offline-claims-report-test",
  reason: "frozen diagnostics verification",
};
type PrototypeFixture = { prototypeClaimInput(): { bundle: VerificationBundle; artifacts: readonly { artifactId: string; content: string | Uint8Array }[] }; runtimePrincipals: RuntimePrincipalBinding };
const fixtureUrl = new URL("../../../verification/src/deterministic/testing/prototype-parity.fixture.js", import.meta.url).href;

function handle(id: string, bytes: Uint8Array, mediaType = "application/json"): VerificationArtifactHandle {
  return { artifactId: id, tenantId, digest: sha256Digest(bytes), mediaType, byteLength: bytes.byteLength, objectKey: `offline/${id}`, createdAt: "2026-09-08T00:00:00.000Z", producerActivityId: "diagnostics-offline-test", producerVersion: "1", encryptionClass: "managed", retentionClass: "test", dataClassification: "internal", parentArtifactIds: [] };
}

async function fixture() {
  const { prototypeClaimInput, runtimePrincipals } = await import(fixtureUrl) as PrototypeFixture;
  const prototype = prototypeClaimInput(), sourceBytes = new TextEncoder().encode(String(prototype.artifacts[0]!.content));
  const claimBundle = structuredClone(prototype.bundle);
  const source = claimBundle.captures[0]!.contentArtifact;
  claimBundle.assertions[0] = { ...claimBundle.assertions[0]!, kind: "claim", claimType: "other" };
  const claimBytes = new TextEncoder().encode(canonicalizeJson({ schemaVersion: "verification-claims-artifact.v1", bundle: claimBundle }));
  const claims = handle("66666666-6666-4666-8666-666666666666", claimBytes);

  const reportText = claimBundle.assertions[0]!.proposition;
  if (!reportText) throw new Error("TEST_REPORT_TEXT_REQUIRED");
  const reportBytes = new TextEncoder().encode(reportText);
  const report = handle("77777777-7777-4777-8777-777777777777", reportBytes, "text/markdown");
  const reportBundle = structuredClone(claimBundle);
  reportBundle.assertions[0] = { ...reportBundle.assertions[0]!, kind: "report_assertion", outputArtifactId: report.artifactId, outputRange: { start: 0, end: reportText.length } };
  const ledgerValue = VerificationReportLedgerSchema.parse({ schemaVersion: "verification-report-ledger.v1", reportArtifact: report, bundle: reportBundle,
    assertions: [{ assertion: reportBundle.assertions[0], exactText: reportText, start: 0, end: reportText.length, citationRequired: false, claimWeight: 1, severity: "medium", citations: [], requiredQualifiers: [] }] });
  const ledgerBytes = new TextEncoder().encode(canonicalizeJson(ledgerValue));
  const ledger = handle("88888888-8888-4888-8888-888888888888", ledgerBytes);
  const records = new Map([
    [source.artifactId, { registration: source, bytes: sourceBytes }],
    [claims.artifactId, { registration: claims, bytes: claimBytes }],
    [report.artifactId, { registration: report, bytes: reportBytes }],
    [ledger.artifactId, { registration: ledger, bytes: ledgerBytes }],
  ]);
  const createDependencies = (): VerificationClaimsServiceDependencies => ({
    artifactResolver: {
      async authorizeArtifact({ tenantId: requestedTenant, artifactId, purpose }) {
        const item = records.get(artifactId);
        if (requestedTenant !== tenantId || purpose !== "verification_admission" || !item) throw new Error("OFFLINE_ARTIFACT_NOT_AUTHORIZED");
      },
      async hydrateRegisteredArtifact({ tenantId: requestedTenant, artifactId }) {
        const item = records.get(artifactId);
        if (requestedTenant !== tenantId || !item) throw new Error("OFFLINE_ARTIFACT_MISSING");
        return { registration: structuredClone(item.registration), bytes: item.bytes.slice() };
      },
    },
    captures: { async getRegisteredCapture({ tenantId: requestedTenant, captureId }) {
      if (requestedTenant !== tenantId || captureId !== claimBundle.captures[0]!.captureId) throw new Error("OFFLINE_CAPTURE_MISSING");
      return { source: structuredClone(claimBundle.sources[0]!), capture: structuredClone(claimBundle.captures[0]!) };
    } },
    runtimePrincipals: { async bind() { return { runtimePrincipals, producerAttemptId: claimBundle.producer.attemptId }; } },
  });
  return { createDependencies, claims, report, ledger, claimBundle, reportBundle };
}

describe("offline claims/report closure", () => {
  it("runs the native claims and report verifiers twice with exact deterministic replay", async () => {
    const value = await fixture();
    let factories = 0;
    const result = await verifyDiagnosticsOfflineClaimsReportClosure({
      context,
      createDependencies: () => { factories++; return value.createDependencies(); },
      claims: [{ caseId: "claim-case", request: { verificationContractVersion: "verification.v1", captureIds: [value.claimBundle.captures[0]!.captureId], assertions: { artifactId: value.claims.artifactId, digest: value.claims.digest } } }],
      reports: [{ reportId: "company-report", request: { verificationContractVersion: "verification.v1", captureIds: [value.reportBundle.captures[0]!.captureId], report: { artifactId: value.report.artifactId, digest: value.report.digest }, claimLedger: { artifactId: value.ledger.artifactId, digest: value.ledger.digest } } }],
    });
    expect(factories).toBe(2);
    expect(result).toMatchObject({ schemaVersion: "verification-diagnostics-offline-claims-report.v1", externalRequests: 0, replayMatched: true,
      semantic: { status: "unavailable", assessments: [] }, claims: [{ caseId: "claim-case", replayMatched: true }], reports: [{ reportId: "company-report", replayMatched: true, coverageScope: "producer_declared_assertions_only" }] });
    expect(result.claims[0]!.deterministicResult.status).toBe("passed");
    expect(result.claims[0]!.executionDigest).toBe(result.claims[0]!.replayDigest);
    expect(result.reports[0]!.deterministicResult.status).toBe("passed");
    expect(result.reports[0]!.executionDigest).toBe(result.reports[0]!.replayDigest);
    expect(result.reports[0]!.reportArtifact).toEqual(value.report);
    expect(result.reports[0]!.claimLedgerArtifact).toEqual(value.ledger);
    expect(Object.isFrozen(result.reports[0]!.reportWide)).toBe(true);
  });

  it("rejects duplicate logical identities and propagates exact artifact binding failures", async () => {
    const value = await fixture();
    const claim = { caseId: "same", request: { verificationContractVersion: "verification.v1" as const, captureIds: [value.claimBundle.captures[0]!.captureId], assertions: { artifactId: value.claims.artifactId, digest: value.claims.digest } } };
    await expect(verifyDiagnosticsOfflineClaimsReportClosure({ context, createDependencies: value.createDependencies, claims: [claim, claim] })).rejects.toThrow("DIAGNOSTICS_OFFLINE_CASE_ID_DUPLICATE");
    await expect(verifyDiagnosticsOfflineClaimsReportClosure({ context, createDependencies: value.createDependencies, claims: [{ ...claim, request: { ...claim.request, assertions: { ...claim.request.assertions, digest: `sha256:${"a".repeat(64)}` } } }] })).rejects.toThrow("VERIFICATION_CLAIMS_ARTIFACT_REGISTRATION_MISMATCH");
  });
});
