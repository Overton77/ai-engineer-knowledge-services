import {
  OperationContextSchema,
  RequestAdjudicationRequestSchema,
  VerificationAdjudicationPacketSchema,
  VerificationAdjudicationReviewRequirementsSchema,
  VerificationArtifactHandleSchema,
  VerificationAuditInspectionResultSchema,
  type OperationContext,
  type RequestAdjudicationRequest,
  type VerificationAdjudicationPacket,
  type VerificationAdjudicationRequestErrorCode,
  type VerificationArtifactHandle,
  type VerificationAuditInspectionResult,
} from "@aiengineer/knowledge-contracts";
import { deepFreeze } from "@aiengineer/knowledge-domain";
import { deterministicUuid } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, digestCanonicalJson, type VerificationAuditBundle } from "@aiengineer/knowledge-verification";
import { z } from "zod";

type ReviewRequirements = z.infer<typeof VerificationAdjudicationReviewRequirementsSchema>;

export interface VerificationAdjudicationCanonicalAuditPort {
  /**
   * Server-owned composition of the canonical signed audit inspector and the
   * exact registered audit artifact resolver. Implementations must not accept
   * trust keys or runtime principals from the request.
   */
  inspectAndResolve(input: {
    readonly request: RequestAdjudicationRequest;
    readonly context: OperationContext;
    readonly signal: AbortSignal;
  }): Promise<{
    readonly inspection: VerificationAuditInspectionResult;
    readonly auditBundle: VerificationAuditBundle;
    readonly manifestArtifact: VerificationArtifactHandle;
  }>;
}

export interface PreparedVerificationAdjudicationRequest {
  readonly subjectId: string;
  readonly request: RequestAdjudicationRequest;
  readonly requestDigest: `sha256:${string}`;
  readonly packet: VerificationAdjudicationPacket;
  readonly packetDigest: `sha256:${string}`;
  readonly packetBytes: Uint8Array;
  readonly parentArtifacts: readonly VerificationArtifactHandle[];
}

export interface VerificationAdjudicationCommitLease {
  readonly operationId: string;
  readonly stepId: string;
  readonly inputSha256: string;
  readonly leaseToken: string;
  readonly fencingToken: number;
  readonly holderIdentity: string;
}

export interface VerificationAdjudicationPacketRegistration {
  readonly createdAt: string;
  readonly producerAttemptId: string;
  readonly missionId?: string;
  readonly producerActivityId: string;
  readonly producerVersion: string;
  readonly encryptionClass: string;
  readonly retentionClass: string;
  readonly storageBucket: string;
}

/** Atomic native boundary: packet artifact metadata and pending subject commit together. */
export interface VerificationAdjudicationPendingSubjectCommitPort {
  commitPendingSubject(input: {
    readonly prepared: PreparedVerificationAdjudicationRequest;
    readonly lease: VerificationAdjudicationCommitLease;
    readonly registration: VerificationAdjudicationPacketRegistration;
  }): Promise<{
    readonly subjectId: string;
    readonly packetArtifact: VerificationArtifactHandle;
  }>;
}

export class VerificationAdjudicationRequestError extends Error {
  constructor(readonly code: VerificationAdjudicationRequestErrorCode) {
    super(code);
    this.name = "VerificationAdjudicationRequestError";
  }
}

const fail = (code: VerificationAdjudicationRequestErrorCode): never => {
  throw new VerificationAdjudicationRequestError(code);
};

/** Creates a pending subject packet only. It has no decision or override API. */
export class VerificationAdjudicationRequestApplicationService {
  readonly #requirements: ReviewRequirements;

  constructor(
    private readonly canonicalAudit: VerificationAdjudicationCanonicalAuditPort,
    requirementsValue: unknown,
  ) {
    this.#requirements = deepFreeze(VerificationAdjudicationReviewRequirementsSchema.parse(requirementsValue));
  }

  async prepare(requestValue: unknown, contextValue: unknown, signal?: AbortSignal): Promise<PreparedVerificationAdjudicationRequest> {
    const requestResult = RequestAdjudicationRequestSchema.safeParse(requestValue);
    const contextResult = OperationContextSchema.safeParse(contextValue);
    const request = requestResult.success ? requestResult.data : fail("VERIFICATION_ADJUDICATION_INVALID_REQUEST");
    const context = contextResult.success ? contextResult.data : fail("VERIFICATION_ADJUDICATION_INVALID_REQUEST");
    const controller = signal ?? new AbortController().signal;
    assertActive(controller);

    const resolved = await this.canonicalAudit.inspectAndResolve({ request, context, signal: controller }).catch((error): never => {
      if (controller.aborted) fail("VERIFICATION_ADJUDICATION_CANCELLED");
      if (error instanceof VerificationAdjudicationRequestError) throw error;
      return fail("VERIFICATION_ADJUDICATION_RUN_BINDING_MISMATCH");
    });
    assertActive(controller);

    const inspectionResult = VerificationAuditInspectionResultSchema.safeParse(resolved.inspection);
    const manifestResult = VerificationArtifactHandleSchema.safeParse(resolved.manifestArtifact);
    const inspection = inspectionResult.success ? inspectionResult.data : fail("VERIFICATION_ADJUDICATION_RUN_BINDING_MISMATCH");
    const manifestArtifact = manifestResult.success ? manifestResult.data : fail("VERIFICATION_ADJUDICATION_RUN_BINDING_MISMATCH");
    const audit = resolved.auditBundle;
    if (manifestArtifact.tenantId !== context.tenantId
      || manifestArtifact.artifactId !== request.evidencePacket.artifactId
      || manifestArtifact.digest !== request.evidencePacket.digest
      || manifestArtifact.mediaType !== "application/vnd.aiengineer.verification-run-manifest+json"
      || inspection.auditArtifact.artifactId !== manifestArtifact.artifactId
      || inspection.auditArtifact.digest !== manifestArtifact.digest
      || inspection.auditArtifact.sizeBytes !== manifestArtifact.byteLength
      || audit.tenantId !== context.tenantId
      || audit.manifest.runId !== inspection.run.runId
      || audit.manifest.canonicalization.manifestDigest !== inspection.run.manifestDigest
      || audit.deterministicResultDigest !== inspection.run.deterministicResultDigest
      || audit.policyDecisionDigest !== inspection.run.policyDecisionDigest
      || audit.manifest.policyOutcome !== inspection.run.policyOutcome
      || audit.seal.payloadDigest !== inspection.proof.payloadDigest
      || digestCanonicalJson(audit) !== manifestArtifact.digest) {
      fail("VERIFICATION_ADJUDICATION_RUN_BINDING_MISMATCH");
    }

    const runKind = classifyRun(audit);
    const indexed = indexManifestArtifacts(audit);
    const bundleArtifact = uniqueDigest(indexed.output, digestCanonicalJson(audit.verificationBundle), "application/vnd.aiengineer.verification-bundle+json");
    const deterministicResultArtifact = uniqueDigest(indexed.output, audit.deterministicResultDigest, "application/vnd.aiengineer.deterministic-verification-result+json");
    const policyArtifact = uniqueExact(indexed.all, audit.policyBinding.policyArtifact);
    const recordedPolicyInputsArtifact = uniqueExact(indexed.all, audit.policyBinding.recordedPolicyInputsArtifact);
    const policyDecisionArtifact = uniqueDigest(indexed.output, audit.policyDecisionDigest, "application/vnd.aiengineer.verification-policy-decision+json");
    const reportGateArtifact = audit.manifest.gateDigest
      ? uniqueDigest(indexed.output, audit.manifest.gateDigest, "application/vnd.aiengineer.verification-report-result+json")
      : undefined;
    if ((runKind === "report") !== (reportGateArtifact !== undefined)) fail("VERIFICATION_ADJUDICATION_RUN_BINDING_MISMATCH");

    const retainedIds = [...new Set(indexed.all.map((artifact) => artifact.artifactId))];
    if (manifestArtifact.parentArtifactIds.length !== retainedIds.length
      || new Set(manifestArtifact.parentArtifactIds).size !== manifestArtifact.parentArtifactIds.length
      || retainedIds.some((artifactId) => !manifestArtifact.parentArtifactIds.includes(artifactId))) {
      fail("VERIFICATION_ADJUDICATION_RUN_BINDING_MISMATCH");
    }

    const targetObjectDigest = resolveTargetDigest(request, audit);
    const packet = VerificationAdjudicationPacketSchema.parse({
      schemaVersion: "verification-adjudication-packet.v1",
      verificationContractVersion: "verification.v1",
      tenantId: context.tenantId,
      requestBinding: {
        operationId: context.operationId,
        requestDigest: digestCanonicalJson(request),
        requesterActor: { kind: context.actor.kind, id: context.actor.id },
        target: request.target,
        targetObjectDigest,
        reason: request.reason,
        ...(request.requesterNote === undefined ? {} : { requesterNote: request.requesterNote }),
      },
      reviewRequirements: this.#requirements,
      sealedRun: {
        runKind,
        runId: audit.manifest.runId,
        manifestArtifact,
        bundleArtifact,
        deterministicResultArtifact,
        policyArtifact,
        recordedPolicyInputsArtifact,
        policyDecisionArtifact,
        ...(reportGateArtifact ? { reportGateArtifact } : {}),
        originalPolicyOutcome: audit.manifest.policyOutcome,
      },
      auditProof: {
        payloadDigest: inspection.proof.payloadDigest,
        manifestDigest: inspection.run.manifestDigest,
        deterministicResultDigest: inspection.run.deterministicResultDigest,
        policyDecisionDigest: inspection.run.policyDecisionDigest,
        signatureStatus: inspection.proof.signatureStatus,
        deterministicReplay: inspection.proof.deterministicReplay,
        policyReplay: inspection.proof.policyReplay,
      },
    });
    const parentArtifacts = deepFreeze([manifestArtifact, bundleArtifact, deterministicResultArtifact, policyArtifact, recordedPolicyInputsArtifact, policyDecisionArtifact, ...(reportGateArtifact ? [reportGateArtifact] : [])]);
    const frozenPacket = deepFreeze(packet);
    const packetBytes = new TextEncoder().encode(canonicalizeJson(frozenPacket));
    return Object.freeze({
      subjectId: deterministicUuid("verification-adjudication-subject", context.operationId),
      request: deepFreeze(request),
      requestDigest: frozenPacket.requestBinding.requestDigest as `sha256:${string}`,
      packet: frozenPacket,
      packetDigest: digestCanonicalJson(frozenPacket),
      packetBytes,
      parentArtifacts,
    });
  }
}

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) fail("VERIFICATION_ADJUDICATION_CANCELLED");
}

function classifyRun(audit: VerificationAuditBundle): "claims" | "report" {
  if (audit.verificationBundle.assertions.length < 1 || audit.verificationBundle.metricObservations.length !== 0) {
    return fail("VERIFICATION_ADJUDICATION_UNSUPPORTED_RUN");
  }
  if (audit.verificationBundle.assertions.every((assertion) => assertion.kind === "claim")) return "claims";
  if (audit.verificationBundle.assertions.every((assertion) => assertion.kind === "report_assertion")) return "report";
  return fail("VERIFICATION_ADJUDICATION_UNSUPPORTED_RUN");
}

function indexManifestArtifacts(audit: VerificationAuditBundle) {
  const input = audit.manifest.inputArtifacts.map((artifact) => VerificationArtifactHandleSchema.parse(artifact));
  const output = audit.manifest.outputArtifacts.map((artifact) => VerificationArtifactHandleSchema.parse(artifact));
  const all = [...input, ...output];
  const identities = new Map<string, string>();
  for (const artifact of all) {
    if (artifact.tenantId !== audit.tenantId) fail("VERIFICATION_ADJUDICATION_RUN_BINDING_MISMATCH");
    const identity = canonicalizeJson(artifact);
    const prior = identities.get(artifact.artifactId);
    if (prior !== undefined && prior !== identity) fail("VERIFICATION_ADJUDICATION_RUN_BINDING_MISMATCH");
    identities.set(artifact.artifactId, identity);
  }
  return { input, output, all };
}

function uniqueDigest(artifacts: readonly VerificationArtifactHandle[], digest: string, mediaType: string): VerificationArtifactHandle {
  const matches = artifacts.filter((artifact) => artifact.digest === digest && artifact.mediaType === mediaType);
  if (matches.length !== 1) return fail("VERIFICATION_ADJUDICATION_RUN_BINDING_MISMATCH");
  return matches[0]!;
}

function uniqueExact(artifacts: readonly VerificationArtifactHandle[], expectedValue: unknown): VerificationArtifactHandle {
  const expected = VerificationArtifactHandleSchema.safeParse(expectedValue);
  if (!expected.success) return fail("VERIFICATION_ADJUDICATION_RUN_BINDING_MISMATCH");
  const expectedIdentity = canonicalizeJson(expected.data);
  const matches = artifacts.filter((artifact) => canonicalizeJson(artifact) === expectedIdentity);
  if (matches.length !== 1) return fail("VERIFICATION_ADJUDICATION_RUN_BINDING_MISMATCH");
  return matches[0]!;
}

function resolveTargetDigest(request: RequestAdjudicationRequest, audit: VerificationAuditBundle): `sha256:${string}` {
  if (request.target.kind === "run") {
    if (request.target.runId !== audit.manifest.runId) return fail("VERIFICATION_ADJUDICATION_TARGET_NOT_FOUND");
    return digestCanonicalJson({ runId: audit.manifest.runId, manifestDigest: audit.manifest.canonicalization.manifestDigest });
  }
  if (request.target.kind === "assertion") {
    const assertionId = request.target.assertionId;
    const matches = audit.verificationBundle.assertions.filter((assertion) => assertion.assertionId === assertionId);
    if (matches.length === 0) return fail("VERIFICATION_ADJUDICATION_TARGET_NOT_FOUND");
    if (matches.length !== 1) return fail("VERIFICATION_ADJUDICATION_TARGET_AMBIGUOUS");
    return digestCanonicalJson(matches[0]);
  }
  const evidenceId = request.target.evidenceId;
  const matches = audit.verificationBundle.assertions.flatMap((assertion) => assertion.evidence.filter((edge) => edge.evidenceId === evidenceId));
  if (matches.length === 0) return fail("VERIFICATION_ADJUDICATION_TARGET_NOT_FOUND");
  const identities = [...new Set(matches.map((edge) => canonicalizeJson(edge)))];
  if (identities.length !== 1) return fail("VERIFICATION_ADJUDICATION_TARGET_AMBIGUOUS");
  return digestCanonicalJson(matches[0]);
}
