import { randomUUID } from "node:crypto";
import {
  VerificationClaimsArtifactSchema,
  VerificationReportLedgerSchema,
  type VerificationArtifactHandle,
  type VerificationBundle,
  type VerificationBenchmarkCase,
} from "@aiengineer/knowledge-contracts";
import { type VerificationAdmissionService } from "@aiengineer/knowledge-application";
import { type PostgresCanonicalRepository, type PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { canonicalizeJson, digestCanonicalJson, projectionSelectorResolver, sha256Digest } from "@aiengineer/knowledge-verification";

type FrozenProjection = {
  readonly sourceArtifact: VerificationArtifactHandle;
  readonly projectionArtifact: VerificationArtifactHandle;
  readonly transformationArtifact: VerificationArtifactHandle;
  readonly parserVersion: string;
  readonly imageDigest: `sha256:${string}`;
};
export type FrozenSemanticMissionRecord = { readonly captureId: string; readonly projections: readonly FrozenProjection[] };
export type SemanticMissionFixtureInput = {
  readonly database: PostgresCanonicalRepository;
  readonly repository: PostgresVerificationRepository;
  readonly admission: VerificationAdmissionService;
  readonly tenantId: string;
  readonly namespace: string;
  readonly missionId: string;
  readonly producerAttemptId: string;
  readonly producerDeploymentId: string;
  readonly verifierDeploymentId: string;
  readonly kind: "claims" | "report";
  readonly verifierAttemptId: string;
  readonly policyVersion: string;
  /** Caller supplies the frozen `gl-comparison` record selected from the retained registry. */
  readonly frozenRecord: FrozenSemanticMissionRecord;
  /** Exact frozen benchmark proposition and selector; caller authenticates the catalog. */
  readonly benchmarkCase?: VerificationBenchmarkCase;
};

/**
 * Builds one admitted-projection claims/report fixture under caller-owned existing mission and attempts.
 * It never creates orchestration rows or invokes a parser/provider; the caller owns all durable execution.
 */
export async function createVerificationSemanticMissionFixture(input: SemanticMissionFixtureInput) {
  const projection = input.frozenRecord.projections[0];
  if (!projection) throw new Error("SEMANTIC_MISSION_FROZEN_PROJECTION_REQUIRED");
  const registered = await input.repository.getRegisteredCapture({ tenantId: input.tenantId, captureId: input.frozenRecord.captureId });
  if (canonicalizeJson(registered.capture.contentArtifact) !== canonicalizeJson(projection.sourceArtifact)) throw new Error("SEMANTIC_MISSION_FROZEN_CAPTURE_DRIFT");
  const admitted = await input.admission.hydrateAdmittedProjection({ tenantId: input.tenantId, captureId: input.frozenRecord.captureId, expectedSourceArtifact: { artifactId: projection.sourceArtifact.artifactId, digest: projection.sourceArtifact.digest as `sha256:${string}` }, transformationArtifactId: projection.transformationArtifact.artifactId, projectionArtifactId: projection.projectionArtifact.artifactId });
  if (canonicalizeJson(admitted.receipt.projectionArtifact) !== canonicalizeJson(projection.projectionArtifact)) throw new Error("SEMANTIC_MISSION_FROZEN_PROJECTION_DRIFT");
  const benchmark = input.benchmarkCase, benchmarkEvidence = benchmark?.evidence[0];
  if (benchmark && (benchmark.evidence.length !== 1 || !benchmarkEvidence || benchmarkEvidence.captureId !== input.frozenRecord.captureId || benchmarkEvidence.projectionArtifactId !== projection.projectionArtifact.artifactId || benchmarkEvidence.projectionDigest !== projection.projectionArtifact.digest || benchmarkEvidence.transformationArtifactId !== projection.transformationArtifact.artifactId)) throw new Error("SEMANTIC_MISSION_BENCHMARK_BINDING");
  const selector = benchmarkEvidence?.selector ?? { kind: "html" as const, domPath: "1/5/2/0/0/1/0/0" };
  const selected = projectionSelectorResolver.resolve({ captureId: input.frozenRecord.captureId, representationArtifactId: admitted.receipt.projectionArtifact.artifactId, representationDigest: admitted.receipt.projectionArtifact.digest, selector, content: admitted.content });
  if (selected.resolution.status !== "resolved") throw new Error("SEMANTIC_MISSION_SELECTOR_UNRESOLVED");
  const evidenceText = new TextDecoder("utf-8", { fatal: true }).decode(selected.selectedContent);
  const expectedTitle = "Best Biological Age Test: SystemAge vs. Function Health & TruDiagnostic Comparison";
  if (benchmarkEvidence ? evidenceText !== benchmarkEvidence.excerpt || sha256Digest(selected.selectedContent) !== benchmarkEvidence.selectedContentDigest : evidenceText !== expectedTitle) throw new Error("SEMANTIC_MISSION_SELECTOR_TEXT_DRIFT");
  const proposition = benchmark?.assertion ?? evidenceText;

  const register = async (value: unknown, artifactType: string, label: string, parents: readonly string[] = [], mediaType = "application/json") => input.repository.registerContentAddressedArtifact({ tenantId: input.tenantId, producerAttemptId: input.producerAttemptId, missionId: input.missionId, artifactType, bytes: new TextEncoder().encode(typeof value === "string" ? value : canonicalizeJson(value)), createdAt: new Date().toISOString(), parentArtifactIds: [...parents], ...(parents.length ? { transformationSignature: digestCanonicalJson({ namespace: input.namespace, label, parents }) } : {}), producerActivityId: "verification-semantic-mission-fixture", producerVersion: "v1", mediaType, encryptionClass: "supabase-managed", retentionClass: "verification-audit", dataClassification: "restricted", bucketClass: "ledger", storageBucket: "ai-engineer-cloud-bucket" });
  const assertionId = randomUUID(), evidenceId = randomUUID(), fragmentId = benchmarkEvidence?.fragmentId ?? randomUUID(), intentId = randomUUID();
  const reportText = input.kind === "report" ? `# Semantic mission fixture ${input.namespace}\n\n${proposition}\n` : undefined;
  const start = reportText?.indexOf(proposition);
  const reportArtifact = reportText === undefined ? undefined : await register(reportText, "report_markdown", "report", [admitted.receipt.projectionArtifact.artifactId], "text/markdown");
  const assertion = { assertionId, kind: input.kind === "report" ? "report_assertion" as const : "claim" as const, claimType: benchmark ? "attribute" as const : "comparative" as const, proposition, producer: { deploymentId: input.producerDeploymentId, attemptId: input.producerAttemptId, capabilityVersion: "verification-semantic-mission-fixture.v1" }, ...(reportArtifact ? { outputArtifactId: reportArtifact.artifactId, outputRange: { start: start!, end: start! + proposition.length } } : {}), qualifiers: [], entityBindings: [], derivation: "direct" as const, evidence: [{ evidenceId, fragment: { fragmentId, captureId: input.frozenRecord.captureId, representationArtifactId: admitted.receipt.projectionArtifact.artifactId, selector }, role: "supports" as const, origin: "declared" as const, expectedSelectedContentDigest: sha256Digest(selected.selectedContent), authority: { authority: "primary" as const, independence: "interested_party" as const, directness: "direct" as const, freshness: "current" as const, applicability: "direct" as const }, parserLineageArtifactIds: [admitted.receipt.transformationArtifact.artifactId] }], intent: { intentId, operation: input.kind === "report" ? "verify_report_coverage" as const : "verify_claim_support" as const, subject: assertionId, expectedResult: "The registered projection resolves the exact selected text.", method: "Replay the native projection selector and compare its digest.", acceptanceCriteria: ["native projection envelope is admitted", "selector resolves exactly"], abstainWhen: ["projection custody is unavailable"] }, riskClass: "medium" as const, downstreamUse: ["semantic_verification"], atomic: true };
  const bundle: VerificationBundle = { verificationContractVersion: "verification.v1", bundleId: randomUUID(), policyVersion: input.policyVersion, producer: assertion.producer, verifier: { deploymentId: input.verifierDeploymentId, attemptId: input.verifierAttemptId, capabilityVersion: "verification.v1" }, sources: [registered.source], captures: [{ ...registered.capture, canonicalProjectionArtifact: admitted.receipt.projectionArtifact }], assertions: [assertion], metricObservations: [], lineage: [] };
  let assertionsArtifact: VerificationArtifactHandle;
  let request: Record<string, unknown>;
  if (input.kind === "claims") {
    const claims = VerificationClaimsArtifactSchema.parse({ schemaVersion: "verification-claims-artifact.v1", bundle });
    assertionsArtifact = await register(claims, "verification_claims_artifact", "claims", [admitted.receipt.transformationArtifact.artifactId]);
    request = { verificationContractVersion: "verification.v1", captureIds: [input.frozenRecord.captureId], assertions: { artifactId: assertionsArtifact.artifactId, digest: assertionsArtifact.digest } };
  } else {
    if (!reportArtifact || start === undefined || start < 0) throw new Error("SEMANTIC_MISSION_REPORT_ARTIFACT_REQUIRED");
    const ledger = VerificationReportLedgerSchema.parse({ schemaVersion: "verification-report-ledger.v1", reportArtifact, bundle, assertions: [{ assertion, exactText: proposition, start, end: start + proposition.length, citationRequired: true, claimWeight: 1, severity: "medium", citations: [{ citationId: randomUUID(), evidenceId }], requiredQualifiers: [] }] });
    assertionsArtifact = await register(ledger, "verification_report_ledger", "report-ledger", [reportArtifact.artifactId, admitted.receipt.transformationArtifact.artifactId]);
    request = { verificationContractVersion: "verification.v1", captureIds: [input.frozenRecord.captureId], report: { artifactId: reportArtifact.artifactId, digest: reportArtifact.digest }, claimLedger: { artifactId: assertionsArtifact.artifactId, digest: assertionsArtifact.digest } };
  }
  await input.repository.recordAssertion({ tenantId: input.tenantId, assertion, producerAttemptId: input.producerAttemptId });
  return { request, assertionsArtifact, projectionGrant: { tenantId: input.tenantId, assertions: { artifactId: assertionsArtifact.artifactId, digest: assertionsArtifact.digest }, admissions: [{ captureId: input.frozenRecord.captureId, projectionArtifactId: admitted.receipt.projectionArtifact.artifactId, transformationArtifactId: admitted.receipt.transformationArtifact.artifactId }] }, evidenceText, bundle };
}
