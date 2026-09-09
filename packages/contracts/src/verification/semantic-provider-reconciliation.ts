import { z } from "zod";

import { IsoDateTimeSchema, Sha256DigestSchema, UuidSchema } from "./index-primitives.js";
import { VerificationArtifactHandleSchema } from "./primitives.js";

const CanonicalUtcSchema = IsoDateTimeSchema.refine((value) => {
  try { return new Date(value).toISOString() === value; } catch { return false; }
}, "Canonical UTC timestamp required");
const CanonicalNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u);
const ArtifactHandleSchema = VerificationArtifactHandleSchema;
const CostMicrosSchema = z.int().min(0).max(20_000_000);

/**
 * A server-sealed accounting decision for a terminal claims/report semantic attempt.
 * It does not authorize a redispatch and is deliberately separate from extraction v1.
 */
export const VerificationSemanticProviderReconciliationSchema = z.strictObject({
  schemaVersion: z.literal("verification-semantic-provider-reconciliation.v1"),
  tenantId: UuidSchema,
  operationId: UuidSchema,
  operationStepId: UuidSchema,
  providerAttemptId: UuidSchema,
  budgetId: UuidSchema,
  host: z.enum(["claims", "report"]),
  providerId: z.literal("gateway"),
  model: z.string().min(1).max(255),
  dispatchFence: UuidSchema,
  dispatchLeaseToken: UuidSchema,
  dispatchHolderIdentity: z.string().min(1).max(255),
  dispatchFencingToken: z.int().positive().max(Number.MAX_SAFE_INTEGER),
  requestDigest: Sha256DigestSchema,
  profileArtifact: ArtifactHandleSchema,
  blindedInputArtifact: ArtifactHandleSchema,
  requestArtifact: ArtifactHandleSchema,
  billingEvidenceArtifact: ArtifactHandleSchema,
  capture: z.strictObject({
    transportArtifact: ArtifactHandleSchema,
    responseEnvelopeArtifact: ArtifactHandleSchema,
    rawResponseArtifact: ArtifactHandleSchema,
  }).optional(),
  observationArtifact: ArtifactHandleSchema.optional(),
  originalState: z.enum(["dispatched", "uncertain"]),
  reservationCostMicros: z.int().min(1).max(20_000_000),
  decision: z.strictObject({
    action: z.literal("settle_original_attempt"),
    actualCostMicros: CostMicrosSchema,
    basis: z.enum(["synthetic_fixture", "supplier_statement"]),
    redispatchAuthorized: z.literal(false),
  }),
  operatorId: CanonicalNameSchema,
  ticketId: CanonicalNameSchema,
  issuedAt: CanonicalUtcSchema,
  expiresAt: CanonicalUtcSchema,
  seal: z.strictObject({
    purpose: z.literal("provider_accounting_only"),
    payloadDigest: Sha256DigestSchema,
    signature: z.strictObject({
      algorithm: z.literal("Ed25519"),
      keyId: CanonicalNameSchema,
      signatureBase64: z.string().regex(/^[A-Za-z0-9+/]{86}==$/u),
    }),
  }),
}).superRefine((value, context) => {
  const reject = (path: (string | number)[], message: string) => context.addIssue({ code: "custom", path, message });
  const artifacts = [
    value.profileArtifact,
    value.blindedInputArtifact,
    value.requestArtifact,
    value.billingEvidenceArtifact,
    ...(value.capture ? [value.capture.transportArtifact, value.capture.responseEnvelopeArtifact, value.capture.rawResponseArtifact] : []),
    ...(value.observationArtifact ? [value.observationArtifact] : []),
  ];

  if (artifacts.some((artifact) => artifact.tenantId !== value.tenantId)) reject([], "all artifact handles must bind the reconciliation tenant");
  if (new Set(artifacts.map((artifact) => artifact.artifactId)).size !== artifacts.length) reject([], "artifact roles must be pairwise distinct");
  if (value.requestArtifact.digest !== value.requestDigest) reject(["requestDigest"], "request digest must equal the request artifact digest");
  if (value.observationArtifact !== undefined && value.capture === undefined) reject(["observationArtifact"], "an observation requires a complete response capture");

  const issuedAt = new Date(value.issuedAt).getTime();
  const expiresAt = new Date(value.expiresAt).getTime();
  if (expiresAt <= issuedAt || expiresAt - issuedAt > 86_400_000)
    reject(["expiresAt"], "decision validity must be positive and at most 24 hours");
});

export type VerificationSemanticProviderReconciliation = z.infer<typeof VerificationSemanticProviderReconciliationSchema>;
