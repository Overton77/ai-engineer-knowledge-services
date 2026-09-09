import { z } from "zod";
import { PolicyOutcomeSchema } from "./model.js";
import { VerificationArtifactHandleSchema } from "./primitives.js";
import { VerificationArtifactReferenceSchema } from "./reads.js";
import { Sha256DigestSchema, UuidSchema } from "./index-primitives.js";

/** Compact public result: immutable proof references and replay digests only. */
export const VerificationAuditInspectionResultSchema = z.strictObject({
  schemaVersion: z.literal("verification-audit-inspection.v1"),
  verificationContractVersion: z.literal("verification.v1"),
  auditArtifact: VerificationArtifactReferenceSchema,
  run: z.strictObject({
    runId: z.string().trim().min(1).max(255),
    manifestId: z.string().trim().min(1).max(255),
    manifestDigest: Sha256DigestSchema,
    deterministicResultDigest: Sha256DigestSchema,
    policyDecisionDigest: Sha256DigestSchema,
    policyOutcome: PolicyOutcomeSchema,
    startedAt: z.iso.datetime(),
    completedAt: z.iso.datetime(),
  }),
  proof: z.strictObject({
    payloadDigest: Sha256DigestSchema,
    signatureStatus: z.literal("verified"),
    deterministicReplay: z.literal("exact"),
    policyReplay: z.literal("exact"),
    replayedArtifactCount: z.int().nonnegative().max(2_048),
    inputArtifactCount: z.int().nonnegative().max(1_000),
    outputArtifactCount: z.int().nonnegative().max(1_000),
  }),
});
export type VerificationAuditInspectionResult = z.infer<typeof VerificationAuditInspectionResultSchema>;

export const VerificationAuditInspectionOperationResultSchema = z.strictObject({
  schemaVersion: z.literal("verification-operation-result.v1"),
  operationId: UuidSchema,
  useCase: z.literal("inspectAuditBundle"),
  requestDigest: Sha256DigestSchema,
  output: VerificationAuditInspectionResultSchema,
  resultArtifact: VerificationArtifactHandleSchema,
});
export type VerificationAuditInspectionOperationResult = z.infer<typeof VerificationAuditInspectionOperationResultSchema>;

/** Sanitized authenticated read projection; internal Storage coordinates never cross transports. */
export const VerificationAuditInspectionResourceSchema = z.strictObject({
  verificationContractVersion: z.literal("verification.v1"),
  tenantId: UuidSchema,
  operationId: UuidSchema,
  requestDigest: Sha256DigestSchema,
  resultArtifact: VerificationArtifactReferenceSchema.pick({ artifactId: true, digest: true }),
  output: VerificationAuditInspectionResultSchema,
});
export type VerificationAuditInspectionResource = z.infer<typeof VerificationAuditInspectionResourceSchema>;
