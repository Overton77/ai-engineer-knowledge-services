import { z } from "zod";
import { Sha256DigestSchema, UuidSchema } from "./index-primitives.js";
import { PolicyOutcomeSchema } from "./model.js";
import { VerificationAdjudicationReviewRequirementsSchema } from "./adjudication.js";
import { VerificationArtifactReferenceSchema } from "./reads.js";
import { RequestAdjudicationRequestSchema } from "./requests.js";

const TargetSchema = z.discriminatedUnion("kind", [
  RequestAdjudicationRequestSchema.shape.target.options[0]!.extend({ objectDigest: Sha256DigestSchema }),
  RequestAdjudicationRequestSchema.shape.target.options[1]!.extend({ objectDigest: Sha256DigestSchema }),
  RequestAdjudicationRequestSchema.shape.target.options[2]!.extend({ objectDigest: Sha256DigestSchema }),
]);

const SourceRunSchema = z.strictObject({
  runKind: z.enum(["claims", "report"]),
  runId: UuidSchema,
  manifestArtifact: VerificationArtifactReferenceSchema.pick({ artifactId: true, digest: true }),
  manifestDigest: Sha256DigestSchema,
  bundleArtifact: VerificationArtifactReferenceSchema.pick({ artifactId: true, digest: true }),
  deterministicResultArtifact: VerificationArtifactReferenceSchema.pick({ artifactId: true, digest: true }),
  policyDecisionArtifact: VerificationArtifactReferenceSchema.pick({ artifactId: true, digest: true }),
  reportGateArtifact: VerificationArtifactReferenceSchema.pick({ artifactId: true, digest: true }).optional(),
}).superRefine((source, context) => {
  if ((source.runKind === "report") !== (source.reportGateArtifact !== undefined)) {
    context.addIssue({ code: "custom", path: ["reportGateArtifact"], message: "report source requires its signed gate reference" });
  }
});

/** Sanitized terminal projection for an immutable pending review request. */
export const VerificationAdjudicationTerminalResourceSchema = z.strictObject({
  verificationContractVersion: z.literal("verification.v1"),
  tenantId: UuidSchema,
  operationId: UuidSchema,
  requestDigest: Sha256DigestSchema,
  packetArtifact: VerificationArtifactReferenceSchema.pick({ artifactId: true, digest: true }),
  output: z.strictObject({
    subjectId: UuidSchema,
    status: z.literal("pending_human_adjudication"),
    target: TargetSchema,
    reason: RequestAdjudicationRequestSchema.shape.reason,
    reviewRequirements: VerificationAdjudicationReviewRequirementsSchema,
    originalPolicyOutcome: PolicyOutcomeSchema,
    source: SourceRunSchema,
    proof: z.strictObject({
      payloadDigest: Sha256DigestSchema,
      signatureStatus: z.literal("verified"),
      deterministicReplay: z.literal("exact"),
      policyReplay: z.literal("exact"),
      terminalFencingToken: z.int().positive(),
    }),
    humanDecisionRecorded: z.literal(false),
    admissionChanged: z.literal(false),
  }),
});
export type VerificationAdjudicationTerminalResource = z.infer<typeof VerificationAdjudicationTerminalResourceSchema>;
