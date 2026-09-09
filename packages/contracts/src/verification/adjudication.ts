import { z } from "zod";
import { NonEmptyStringSchema, Sha256DigestSchema, UuidSchema } from "./index-primitives.js";
import { PolicyOutcomeSchema } from "./model.js";
import { VerificationArtifactHandleSchema } from "./primitives.js";
import { VerificationArtifactReferenceSchema } from "./reads.js";
import { RequestAdjudicationRequestSchema } from "./requests.js";

const ReviewerRoleSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const AdjudicationTargetSchema = RequestAdjudicationRequestSchema.shape.target;

export const VerificationAdjudicationRequestBindingSchema = z.strictObject({
  operationId: UuidSchema,
  requestDigest: Sha256DigestSchema,
  requesterActor: z.strictObject({
    kind: z.enum(["human", "service", "model"]),
    id: UuidSchema,
  }),
  target: AdjudicationTargetSchema,
  targetObjectDigest: Sha256DigestSchema,
  reason: RequestAdjudicationRequestSchema.shape.reason,
  requesterNote: RequestAdjudicationRequestSchema.shape.requesterNote,
});

export const VerificationAdjudicationReviewRequirementsSchema = z.strictObject({
  eligibleReviewerRoles: z.array(ReviewerRoleSchema).min(1).max(16).superRefine((roles, context) => {
    if (new Set(roles).size !== roles.length) context.addIssue({ code: "custom", message: "eligible reviewer roles must be unique" });
  }),
  quorumRequired: z.int().min(1).max(16),
  expiresAt: z.iso.datetime().optional(),
});

export const VerificationAdjudicationSealedRunBindingSchema = z.strictObject({
  runKind: z.enum(["claims", "report"]),
  runId: UuidSchema,
  manifestArtifact: VerificationArtifactHandleSchema,
  bundleArtifact: VerificationArtifactHandleSchema,
  deterministicResultArtifact: VerificationArtifactHandleSchema,
  policyArtifact: VerificationArtifactHandleSchema,
  recordedPolicyInputsArtifact: VerificationArtifactHandleSchema,
  policyDecisionArtifact: VerificationArtifactHandleSchema,
  reportGateArtifact: VerificationArtifactHandleSchema.optional(),
  originalPolicyOutcome: PolicyOutcomeSchema,
});

export const VerificationAdjudicationAuditProofSchema = z.strictObject({
  payloadDigest: Sha256DigestSchema,
  manifestDigest: Sha256DigestSchema,
  deterministicResultDigest: Sha256DigestSchema,
  policyDecisionDigest: Sha256DigestSchema,
  signatureStatus: z.literal("verified"),
  deterministicReplay: z.literal("exact"),
  policyReplay: z.literal("exact"),
});

/**
 * Server-composed immutable packet. It contains proof references and digests,
 * never caller-provided reviewer authority, decision fields, or evidence bytes.
 */
export const VerificationAdjudicationPacketSchema = z.strictObject({
  schemaVersion: z.literal("verification-adjudication-packet.v1"),
  verificationContractVersion: z.literal("verification.v1"),
  tenantId: UuidSchema,
  requestBinding: VerificationAdjudicationRequestBindingSchema,
  reviewRequirements: VerificationAdjudicationReviewRequirementsSchema,
  sealedRun: VerificationAdjudicationSealedRunBindingSchema,
  auditProof: VerificationAdjudicationAuditProofSchema,
}).superRefine((packet, context) => {
  const handles = [
    packet.sealedRun.manifestArtifact,
    packet.sealedRun.bundleArtifact,
    packet.sealedRun.deterministicResultArtifact,
    packet.sealedRun.policyArtifact,
    packet.sealedRun.recordedPolicyInputsArtifact,
    packet.sealedRun.policyDecisionArtifact,
    ...(packet.sealedRun.reportGateArtifact ? [packet.sealedRun.reportGateArtifact] : []),
  ];
  if (handles.some((handle) => handle.tenantId !== packet.tenantId)) {
    context.addIssue({ code: "custom", path: ["sealedRun"], message: "all sealed run artifacts must belong to the packet tenant" });
  }
  if (new Set(handles.map((handle) => handle.artifactId)).size !== handles.length) {
    context.addIssue({ code: "custom", path: ["sealedRun"], message: "sealed run artifact roles must be distinct" });
  }
  if ((packet.sealedRun.runKind === "report") !== (packet.sealedRun.reportGateArtifact !== undefined)) {
    context.addIssue({ code: "custom", path: ["sealedRun", "reportGateArtifact"], message: "report runs require exactly one report gate and claims runs forbid it" });
  }
  if (packet.sealedRun.deterministicResultArtifact.digest !== packet.auditProof.deterministicResultDigest) {
    context.addIssue({ code: "custom", path: ["auditProof", "deterministicResultDigest"], message: "deterministic result digest must match its artifact" });
  }
  if (packet.sealedRun.policyDecisionArtifact.digest !== packet.auditProof.policyDecisionDigest) {
    context.addIssue({ code: "custom", path: ["auditProof", "policyDecisionDigest"], message: "policy decision digest must match its artifact" });
  }
  if (packet.requestBinding.target.kind === "run" && packet.requestBinding.target.runId !== packet.sealedRun.runId) {
    context.addIssue({ code: "custom", path: ["requestBinding", "target", "runId"], message: "run target must match the sealed run" });
  }
});
export type VerificationAdjudicationPacket = z.infer<typeof VerificationAdjudicationPacketSchema>;

/** A packet-bound review record. It records review only and cannot alter policy admission. */
export const VerificationAdjudicationDecisionRequestSchema = z.strictObject({
  verificationContractVersion: z.literal("verification.v1"),
  subjectId: UuidSchema,
  packetArtifact: VerificationArtifactReferenceSchema.pick({ artifactId: true, digest: true }),
  decision: z.enum(["affirm", "reject", "defer"]),
  rationale: NonEmptyStringSchema.max(8_000),
});
export type VerificationAdjudicationDecisionRequest = z.infer<typeof VerificationAdjudicationDecisionRequestSchema>;

export const VerificationAdjudicationDecisionProvenanceSchema = z.enum(["human_origin", "synthetic_engineering"]);
export const VerificationAdjudicationDecisionResultSchema = z.strictObject({
  schemaVersion: z.literal("verification-adjudication-decision-result.v1"),
  subjectId: UuidSchema,
  packetArtifact: VerificationArtifactReferenceSchema.pick({ artifactId: true, digest: true }),
  decisionArtifact: VerificationArtifactReferenceSchema.pick({ artifactId: true, digest: true }),
  decision: z.enum(["affirm", "reject", "defer"]),
  reviewerProvenance: VerificationAdjudicationDecisionProvenanceSchema,
  /** Only distinct `human_origin` `affirm` decisions count. Reject and defer never satisfy quorum. */
  quorum: z.strictObject({
    required: z.int().min(1).max(16),
    humanAffirmRecorded: z.int().min(0),
    humanRejectRecorded: z.int().min(0),
    humanDeferRecorded: z.int().min(0),
    syntheticAffirmRecorded: z.int().min(0),
    reached: z.boolean(),
  }).superRefine((quorum, context) => {
    if (quorum.reached && (quorum.humanAffirmRecorded < quorum.required || quorum.humanRejectRecorded > 0)) {
      context.addIssue({code: "custom", path: ["reached"], message: "human quorum requires enough affirmations and no rejection"});
    }
  }),
  admissionChanged: z.literal(false),
  humanGoldScoringEligible: z.literal(false),
});
export type VerificationAdjudicationDecisionResult = z.infer<typeof VerificationAdjudicationDecisionResultSchema>;

/** Quorum is the snapshot recorded by this operation, not a current review tally. */
export const VerificationAdjudicationDecisionTerminalResourceSchema = z.strictObject({
  verificationContractVersion: z.literal("verification.v1"), tenantId: UuidSchema, operationId: UuidSchema,
  requestDigest: Sha256DigestSchema, output: VerificationAdjudicationDecisionResultSchema,
  terminalFencingToken: z.int().positive(),
});
export type VerificationAdjudicationDecisionTerminalResource = z.infer<typeof VerificationAdjudicationDecisionTerminalResourceSchema>;

export const VerificationAdjudicationPendingSubjectSchema = z.strictObject({
  subjectId: UuidSchema,
  status: z.literal("pending_human_adjudication"),
  packetArtifact: VerificationArtifactReferenceSchema.pick({ artifactId: true, digest: true }),
  originalPolicyOutcome: PolicyOutcomeSchema,
  humanDecisionRecorded: z.literal(false),
  admissionChanged: z.literal(false),
});
export type VerificationAdjudicationPendingSubject = z.infer<typeof VerificationAdjudicationPendingSubjectSchema>;

export const VerificationAdjudicationOperationResultSchema = z.strictObject({
  schemaVersion: z.literal("verification-operation-result.v1"),
  operationId: UuidSchema,
  useCase: z.literal("requestAdjudication"),
  requestDigest: Sha256DigestSchema,
  output: VerificationAdjudicationPendingSubjectSchema,
  resultArtifact: VerificationArtifactHandleSchema,
}).superRefine((value, context) => {
  if (value.resultArtifact.artifactId !== value.output.packetArtifact.artifactId
    || value.resultArtifact.digest !== value.output.packetArtifact.digest) {
    context.addIssue({ code: "custom", path: ["resultArtifact"], message: "the operation result artifact must be the immutable adjudication packet" });
  }
});
export type VerificationAdjudicationOperationResult = z.infer<typeof VerificationAdjudicationOperationResultSchema>;

/** Stable safe failure taxonomy for request creation; no reviewer or storage detail is exposed. */
export const VerificationAdjudicationRequestErrorCodeSchema = z.enum([
  "VERIFICATION_ADJUDICATION_INVALID_REQUEST",
  "VERIFICATION_ADJUDICATION_UNSUPPORTED_RUN",
  "VERIFICATION_ADJUDICATION_TARGET_NOT_FOUND",
  "VERIFICATION_ADJUDICATION_TARGET_AMBIGUOUS",
  "VERIFICATION_ADJUDICATION_RUN_BINDING_MISMATCH",
  "VERIFICATION_ADJUDICATION_CANCELLED",
  "VERIFICATION_ADJUDICATION_INFRASTRUCTURE_FAILURE",
]);
export type VerificationAdjudicationRequestErrorCode = z.infer<typeof VerificationAdjudicationRequestErrorCodeSchema>;

export const VerificationAdjudicationCapabilityStateSchema = z.strictObject({
  requestSubjectsEnabled: z.boolean(),
  humanDecisionsEnabled: z.literal(false),
  policyOverridesEnabled: z.literal(false),
  explanation: NonEmptyStringSchema,
});
