import { randomUUID } from "node:crypto";
import {
  VerificationArtifactHandleSchema,
  VerificationReportLedgerSchema,
  type VerificationArtifactHandle,
  type VerificationBenchmarkCase,
  type VerificationBundle,
} from "@aiengineer/knowledge-contracts";
import { type VerificationAdmissionService } from "@aiengineer/knowledge-application";
import { type PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { canonicalizeJson, digestCanonicalJson, projectionSelectorResolver, sha256Digest } from "@aiengineer/knowledge-verification";

export type AgentReportFrozenProjection = {
  readonly sourceArtifact: VerificationArtifactHandle;
  readonly projectionArtifact: VerificationArtifactHandle;
  readonly transformationArtifact: VerificationArtifactHandle;
  readonly parserVersion: string;
  readonly imageDigest: `sha256:${string}`;
};
export type AgentReportFrozenRecord = {
  readonly captureId: string;
  readonly projections: readonly AgentReportFrozenProjection[];
};
export type AgentReportAssertionInput = {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** Optional UTF-16 span of an actual citation marker already present in the agent report. */
  readonly citation?: { readonly start: number; readonly end: number };
};
export type VerificationAgentReportFixtureInput = {
  readonly repository: PostgresVerificationRepository;
  readonly admission: VerificationAdmissionService;
  readonly tenantId: string;
  readonly namespace: string;
  readonly missionId: string;
  readonly producerAttemptId: string;
  readonly producerDeploymentId: string;
  readonly producerRunId?: string;
  readonly verifierAttemptId: string;
  readonly verifierDeploymentId: string;
  readonly policyVersion: string;
  readonly frozenRecord: AgentReportFrozenRecord;
  /** Caller obtains this exact v1 case from the trusted frozen-catalog grant. */
  readonly benchmarkCase: VerificationBenchmarkCase;
  /** Actual unmodified Markdown produced by the agent. */
  readonly reportMarkdown: string;
  readonly assertion: AgentReportAssertionInput;
  /** Exact prior registration and producer identity offered for a same-agent/run retry. */
  readonly existingReportRegistration?: {
    readonly artifact: VerificationArtifactHandle;
    readonly producerAgentId: string;
    readonly producerRunId: string;
  };
};

const encoder = new TextEncoder();
const isBoundary = (value: string, offset: number) => {
  const left = offset > 0 ? value.charCodeAt(offset - 1) : undefined;
  const right = offset < value.length ? value.charCodeAt(offset) : undefined;
  return !(left !== undefined && left >= 0xd800 && left <= 0xdbff) && !(right !== undefined && right >= 0xdc00 && right <= 0xdfff);
};
function spanText(value: string, span: { readonly start: number; readonly end: number }, code: string): string {
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > value.length || !isBoundary(value, span.start) || !isBoundary(value, span.end)) throw new Error(code);
  return value.slice(span.start, span.end);
}

/** Validates report text and assertion provenance before any repository/admission call. */
export function validateVerificationAgentReportFixture(input: Pick<VerificationAgentReportFixtureInput, "tenantId" | "missionId" | "producerAttemptId" | "producerDeploymentId" | "verifierAttemptId" | "verifierDeploymentId" | "benchmarkCase" | "frozenRecord" | "reportMarkdown" | "assertion">): void {
  if (!input.reportMarkdown.length || input.reportMarkdown.length > 3_000) throw new Error("AGENT_REPORT_MARKDOWN_BOUND");
  if (!input.tenantId || !input.missionId || !input.producerAttemptId || !input.producerDeploymentId || !input.verifierAttemptId || !input.verifierDeploymentId) throw new Error("AGENT_REPORT_TRUSTED_CONTEXT_INVALID");
  const projection = input.frozenRecord.projections[0], evidence = input.benchmarkCase.evidence[0];
  if (!projection || input.frozenRecord.projections.length !== 1 || !evidence || input.benchmarkCase.evidence.length !== 1 || evidence.captureId !== input.frozenRecord.captureId || evidence.projectionArtifactId !== projection.projectionArtifact.artifactId || evidence.projectionDigest !== projection.projectionArtifact.digest || evidence.transformationArtifactId !== projection.transformationArtifact.artifactId) throw new Error("AGENT_REPORT_FROZEN_CASE_BINDING");
  const selected = spanText(input.reportMarkdown, input.assertion, "AGENT_REPORT_ASSERTION_RANGE_INVALID");
  if (selected !== input.assertion.text) throw new Error("AGENT_REPORT_ASSERTION_RANGE_INVALID");
  if (selected !== input.benchmarkCase.assertion && selected !== evidence.excerpt) throw new Error("AGENT_REPORT_ASSERTION_NOT_AUTHORIZED");
  if (input.assertion.citation) spanText(input.reportMarkdown, input.assertion.citation, "AGENT_REPORT_CITATION_RANGE_INVALID");
}

export function validateExistingAgentReportRegistration(input: {
  readonly candidate: NonNullable<VerificationAgentReportFixtureInput["existingReportRegistration"]>;
  readonly hydratedRegistration: VerificationArtifactHandle;
  readonly hydratedBytes: Uint8Array;
  readonly tenantId: string;
  readonly projectionArtifactId: string;
  readonly expectedProducerAgentId: string;
  readonly expectedProducerRunId: string;
  readonly reportMarkdown: string;
}): VerificationArtifactHandle {
  if (input.candidate.producerAgentId !== input.expectedProducerAgentId) throw new Error("AGENT_REPORT_EXISTING_PRODUCER_AGENT_MISMATCH");
  if (input.candidate.producerRunId !== input.expectedProducerRunId) throw new Error("AGENT_REPORT_EXISTING_PRODUCER_RUN_MISMATCH");
  const candidate = VerificationArtifactHandleSchema.parse(input.candidate.artifact);
  const hydrated = VerificationArtifactHandleSchema.parse(input.hydratedRegistration);
  if (canonicalizeJson(candidate) !== canonicalizeJson(hydrated)) throw new Error("AGENT_REPORT_EXISTING_ARTIFACT_HANDLE_DRIFT");
  if (hydrated.tenantId !== input.tenantId || hydrated.mediaType !== "text/markdown" || !hydrated.parentArtifactIds.includes(input.projectionArtifactId)) throw new Error("AGENT_REPORT_EXISTING_ARTIFACT_INVALID");
  if (new TextDecoder("utf-8", { fatal: true }).decode(input.hydratedBytes) !== input.reportMarkdown) throw new Error("AGENT_REPORT_EXISTING_ARTIFACT_BYTES_DRIFT");
  return hydrated;
}

/**
 * Registers an actual agent-authored report and its single bounded assertion against one
 * pre-admitted frozen v1 projection. It does not create contexts, parse content, or call providers.
 */
export async function createVerificationAgentReportFixture(input: VerificationAgentReportFixtureInput) {
  validateVerificationAgentReportFixture(input);
  const tenantId = input.tenantId;
  const projection = input.frozenRecord.projections[0]!;
  const evidence = input.benchmarkCase.evidence[0]!;
  const registered = await input.repository.getRegisteredCapture({ tenantId, captureId: input.frozenRecord.captureId });
  if (canonicalizeJson(registered.capture.contentArtifact) !== canonicalizeJson(projection.sourceArtifact)) throw new Error("AGENT_REPORT_FROZEN_CAPTURE_DRIFT");
  const admitted = await input.admission.hydrateAdmittedProjection({ tenantId, captureId: input.frozenRecord.captureId, expectedSourceArtifact: { artifactId: projection.sourceArtifact.artifactId, digest: projection.sourceArtifact.digest as `sha256:${string}` }, transformationArtifactId: projection.transformationArtifact.artifactId, projectionArtifactId: projection.projectionArtifact.artifactId });
  if (canonicalizeJson(admitted.receipt.projectionArtifact) !== canonicalizeJson(projection.projectionArtifact)) throw new Error("AGENT_REPORT_FROZEN_PROJECTION_DRIFT");
  const selected = projectionSelectorResolver.resolve({ captureId: input.frozenRecord.captureId, representationArtifactId: admitted.receipt.projectionArtifact.artifactId, representationDigest: admitted.receipt.projectionArtifact.digest, selector: evidence.selector, content: admitted.content });
  if (selected.resolution.status !== "resolved" || new TextDecoder("utf-8", { fatal: true }).decode(selected.selectedContent) !== evidence.excerpt || sha256Digest(selected.selectedContent) !== evidence.selectedContentDigest) throw new Error("AGENT_REPORT_SOURCE_FRAGMENT_DRIFT");

  const register = async (value: unknown, artifactType: "report_markdown" | "verification_report_ledger", label: string, parents: readonly string[], mediaType = "application/json") => input.repository.registerContentAddressedArtifact({ tenantId, producerAttemptId: input.producerAttemptId, missionId: input.missionId, artifactType, bytes: encoder.encode(typeof value === "string" ? value : canonicalizeJson(value)), createdAt: new Date().toISOString(), parentArtifactIds: [...parents], transformationSignature: digestCanonicalJson({ namespace: input.namespace, label, parents }), producerActivityId: "verification-agent-report-fixture", producerVersion: "v1", mediaType, encryptionClass: "supabase-managed", retentionClass: "verification-audit", dataClassification: "restricted", bucketClass: "ledger", storageBucket: "ai-engineer-cloud-bucket" });
  let reportArtifact: VerificationArtifactHandle;
  if (input.existingReportRegistration) {
    if (!input.producerRunId) throw new Error("AGENT_REPORT_EXISTING_PRODUCER_RUN_REQUIRED");
    const resolver = input.repository.createTrustedArtifactResolver();
    await resolver.authorizeArtifact({ tenantId, artifactId: input.existingReportRegistration.artifact.artifactId, purpose: "verification_replay" });
    const hydrated = await resolver.hydrateRegisteredArtifact({ tenantId, artifactId: input.existingReportRegistration.artifact.artifactId });
    reportArtifact = validateExistingAgentReportRegistration({ candidate: input.existingReportRegistration, hydratedRegistration: hydrated.registration,
      hydratedBytes: hydrated.bytes, tenantId, projectionArtifactId: admitted.receipt.projectionArtifact.artifactId,
      expectedProducerAgentId: input.producerDeploymentId, expectedProducerRunId: input.producerRunId, reportMarkdown: input.reportMarkdown });
  } else reportArtifact = await register(input.reportMarkdown, "report_markdown", "agent-report", [admitted.receipt.projectionArtifact.artifactId], "text/markdown");
  const assertionId = randomUUID(), evidenceId = randomUUID();
  const assertion = { assertionId, kind: "report_assertion" as const, claimType: "attribute" as const, proposition: input.assertion.text, producer: { deploymentId: input.producerDeploymentId, attemptId: input.producerAttemptId, capabilityVersion: "verification-agent-report-fixture.v1" }, outputArtifactId: reportArtifact.artifactId, outputRange: { start: input.assertion.start, end: input.assertion.end }, qualifiers: [], entityBindings: [], derivation: "direct" as const, evidence: [{ evidenceId, fragment: { fragmentId: evidence.fragmentId, captureId: input.frozenRecord.captureId, representationArtifactId: admitted.receipt.projectionArtifact.artifactId, selector: evidence.selector }, role: "supports" as const, origin: "declared" as const, expectedSelectedContentDigest: sha256Digest(selected.selectedContent), authority: { authority: "primary" as const, independence: "interested_party" as const, directness: "direct" as const, freshness: "current" as const, applicability: "direct" as const }, parserLineageArtifactIds: [admitted.receipt.transformationArtifact.artifactId] }], intent: { intentId: randomUUID(), operation: "verify_report_coverage" as const, subject: assertionId, expectedResult: "The registered projection resolves the exact selected text.", method: "Replay the native projection selector and compare its digest.", acceptanceCriteria: ["native projection envelope is admitted", "selector resolves exactly"], abstainWhen: ["projection custody is unavailable"] }, riskClass: "medium" as const, downstreamUse: ["semantic_verification"], atomic: true };
  const bundle: VerificationBundle = { verificationContractVersion: "verification.v1", bundleId: randomUUID(), policyVersion: input.policyVersion, producer: assertion.producer, verifier: { deploymentId: input.verifierDeploymentId, attemptId: input.verifierAttemptId, capabilityVersion: "verification.v1" }, sources: [registered.source], captures: [{ ...registered.capture, canonicalProjectionArtifact: admitted.receipt.projectionArtifact }], assertions: [assertion], metricObservations: [], lineage: [] };
  const ledger = VerificationReportLedgerSchema.parse({ schemaVersion: "verification-report-ledger.v1", reportArtifact, bundle, assertions: [{ assertion, exactText: input.assertion.text, start: input.assertion.start, end: input.assertion.end, citationRequired: input.assertion.citation !== undefined, claimWeight: 1, severity: "medium", citations: input.assertion.citation ? [{ citationId: randomUUID(), evidenceId }] : [], requiredQualifiers: [] }] });
  const ledgerArtifact = await register(ledger, "verification_report_ledger", "agent-report-ledger", [reportArtifact.artifactId, admitted.receipt.transformationArtifact.artifactId]);
  await input.repository.recordAssertion({ tenantId, assertion, producerAttemptId: input.producerAttemptId });
  return { request: { verificationContractVersion: "verification.v1" as const, captureIds: [input.frozenRecord.captureId], report: { artifactId: reportArtifact.artifactId, digest: reportArtifact.digest }, claimLedger: { artifactId: ledgerArtifact.artifactId, digest: ledgerArtifact.digest } }, projectionGrant: { tenantId, assertions: { artifactId: ledgerArtifact.artifactId, digest: ledgerArtifact.digest }, admissions: [{ captureId: input.frozenRecord.captureId, projectionArtifactId: admitted.receipt.projectionArtifact.artifactId, transformationArtifactId: admitted.receipt.transformationArtifact.artifactId }] }, reportArtifact, assertionsArtifact: ledgerArtifact, evidenceText: evidence.excerpt, bundle };
}
