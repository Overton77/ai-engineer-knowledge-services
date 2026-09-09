import { z } from "zod";

import { SemanticJudgeIdentitySchema } from "./semantic-policy.js";
import { NonEmptyStringSchema, Sha256DigestSchema, UuidSchema } from "./index-primitives.js";
import { VerificationArtifactHandleSchema, VerificationContractVersionSchema, VerificationIdSchema } from "./primitives.js";

const ModelSchema = z.string().regex(/^[A-Za-z0-9_./:-]{1,255}$/u);
const FullHandleSchema = VerificationArtifactHandleSchema;

/** Exact, evidence-only bytes sent to a semantic judge; never a display excerpt. */
export const SemanticBlindedInputSchema = z.strictObject({
  rubricVersion: z.literal("evidence-only.v1"),
  assertionId: VerificationIdSchema,
  proposition: NonEmptyStringSchema.max(16_000),
  qualifiers: z.array(NonEmptyStringSchema.max(1_000)).max(64),
  entityBindings: z.array(z.strictObject({ role: NonEmptyStringSchema.max(160), canonicalId: NonEmptyStringSchema.max(255) })).max(128),
  fragments: z.array(z.strictObject({ fragmentId: VerificationIdSchema, exactText: NonEmptyStringSchema.max(16_000) })).min(1).max(16),
}).superRefine((value, context) => {
  if (new Set(value.fragments.map((fragment) => fragment.fragmentId)).size !== value.fragments.length)
    context.addIssue({ code: "custom", path: ["fragments"], message: "fragment IDs must be unique" });
  if (value.fragments.reduce((total, fragment) => total + fragment.exactText.length, 0) > 64_000)
    context.addIssue({ code: "custom", path: ["fragments"], message: "blinded evidence exceeds bounded judge input" });
});
export type SemanticBlindedInput = z.infer<typeof SemanticBlindedInputSchema>;

export const SemanticProviderUsageSchema = z.strictObject({
  promptTokens: z.int().min(0).max(2_000_000).optional(), completionTokens: z.int().min(0).max(2_000_000).optional(),
  totalTokens: z.int().min(0).max(4_000_000).optional(), costMicros: z.int().min(0).max(2_000_000_000).optional(),
}).superRefine((value, context) => {
  if (value.totalTokens !== undefined && value.promptTokens !== undefined && value.completionTokens !== undefined && value.totalTokens < value.promptTokens + value.completionTokens)
    context.addIssue({ code: "custom", path: ["totalTokens"], message: "total tokens must cover prompt plus completion tokens" });
  else if (value.totalTokens !== undefined && value.promptTokens !== undefined && value.totalTokens < value.promptTokens)
    context.addIssue({ code: "custom", path: ["totalTokens"], message: "total tokens must cover prompt tokens" });
  else if (value.totalTokens !== undefined && value.completionTokens !== undefined && value.totalTokens < value.completionTokens)
    context.addIssue({ code: "custom", path: ["totalTokens"], message: "total tokens must cover completion tokens" });
});
export type SemanticProviderUsage = z.infer<typeof SemanticProviderUsageSchema>;

const SemanticHostSchema = z.discriminatedUnion("useCase", [
  z.strictObject({ operationKind: z.literal("verification_claims"), stepKey: z.literal("verify_claims_and_register"), useCase: z.literal("verifyClaims") }),
  z.strictObject({ operationKind: z.literal("verification_report"), stepKey: z.literal("verify_report_and_register"), useCase: z.literal("verifyReport") }),
]);

const SemanticProviderResponseObservationBodyBaseSchema = z.strictObject({
  schemaVersion: z.literal("verification-semantic-response-observation.v1"), verificationContractVersion: VerificationContractVersionSchema,
  context: z.strictObject({ tenantId: UuidSchema, operationId: UuidSchema, operationStepId: UuidSchema, leaseToken: UuidSchema, fencingToken: z.int().positive(), holderIdentity: NonEmptyStringSchema.max(255), producerAttemptId: UuidSchema, providerAttemptId: UuidSchema, host: SemanticHostSchema }),
  profileArtifact: FullHandleSchema, blindedInputArtifact: FullHandleSchema, requestArtifact: FullHandleSchema,
  rawResponseArtifact: FullHandleSchema, responseEnvelopeArtifact: FullHandleSchema,
  judgeIdentity: SemanticJudgeIdentitySchema, inputArtifactDigest: Sha256DigestSchema, requestDigest: Sha256DigestSchema, rawResponseDigest: Sha256DigestSchema,
  requestedModel: ModelSchema, observedModel: ModelSchema.optional(), modelStatus: z.enum(["matched", "missing", "mismatch"]), revalidationRequired: z.boolean(), usage: SemanticProviderUsageSchema, costStatus: z.enum(["reported", "unknown"]),
});

type ObservationBodyBase = z.infer<typeof SemanticProviderResponseObservationBodyBaseSchema>;
function validateBody(value: ObservationBodyBase, context: z.RefinementCtx): void {
  const fail = (path: (string | number)[], message: string) => context.addIssue({ code: "custom", path, message });
  const handles = [value.profileArtifact, value.blindedInputArtifact, value.requestArtifact, value.rawResponseArtifact, value.responseEnvelopeArtifact];
  if (value.context.producerAttemptId === value.context.providerAttemptId) fail(["context", "producerAttemptId"], "producer and provider attempts must be distinct");
  if (handles.some((handle) => handle.tenantId !== value.context.tenantId)) fail([], "all artifact handles must bind the operation tenant");
  if (new Set(handles.map((handle) => handle.artifactId)).size !== handles.length) fail([], "profile, input, request, raw response, and envelope artifact roles must be distinct");
  if (handles.some((handle) => handle.parentArtifactIds.includes(handle.artifactId))) fail([], "artifact lineage cannot contain a self-parent cycle");
  if (value.inputArtifactDigest !== value.blindedInputArtifact.digest) fail(["inputArtifactDigest"], "blinded input digest must equal its full handle");
  if (value.requestDigest !== value.requestArtifact.digest) fail(["requestDigest"], "request digest must equal its full handle");
  if (value.rawResponseDigest !== value.rawResponseArtifact.digest) fail(["rawResponseDigest"], "raw response digest must equal its full handle");
  if (value.judgeIdentity.model !== value.requestedModel) fail(["requestedModel"], "requested model must equal the server-composed judge identity");
  if (value.requestArtifact.parentArtifactIds.length !== 1 || value.requestArtifact.parentArtifactIds[0] !== value.blindedInputArtifact.artifactId) fail(["requestArtifact", "parentArtifactIds"], "request must have the exact blinded-input parent");
  if (value.rawResponseArtifact.parentArtifactIds.length !== 0) fail(["rawResponseArtifact", "parentArtifactIds"], "raw response must be an unwrapped provider body");
  if (value.responseEnvelopeArtifact.parentArtifactIds.length !== 2 || value.responseEnvelopeArtifact.parentArtifactIds[0] !== value.requestArtifact.artifactId || value.responseEnvelopeArtifact.parentArtifactIds[1] !== value.rawResponseArtifact.artifactId) fail(["responseEnvelopeArtifact", "parentArtifactIds"], "response envelope must have exact request/raw parents");
  if ((value.modelStatus === "matched" && (value.observedModel !== value.requestedModel || value.revalidationRequired)) || (value.modelStatus === "missing" && (value.observedModel !== undefined || !value.revalidationRequired)) || (value.modelStatus === "mismatch" && (value.observedModel === undefined || value.observedModel === value.requestedModel || !value.revalidationRequired))) fail(["modelStatus"], "model status and revalidation must be derived from requested and observed models");
  if ((value.costStatus === "reported") !== (value.usage.costMicros !== undefined)) fail(["costStatus"], "reported cost requires cost micros; unknown cost must remain absent");
}

/** Canonical stored body. It cannot contain its own registered handle or digest. */
export const SemanticProviderResponseObservationBodySchema = SemanticProviderResponseObservationBodyBaseSchema.superRefine(validateBody);
export type SemanticProviderResponseObservationBody = z.infer<typeof SemanticProviderResponseObservationBodySchema>;

/** Server-composed persistence envelope that binds the separately registered body artifact. */
export const SemanticProviderResponseObservationSchema = SemanticProviderResponseObservationBodyBaseSchema.extend({ observationArtifact: FullHandleSchema }).superRefine((value, context) => {
  validateBody(value, context);
  const expectedParents = [value.blindedInputArtifact.artifactId, value.responseEnvelopeArtifact.artifactId, value.profileArtifact.artifactId];
  if (value.observationArtifact.tenantId !== value.context.tenantId) context.addIssue({ code: "custom", path: ["observationArtifact", "tenantId"], message: "observation artifact must bind the operation tenant" });
  if (value.observationArtifact.parentArtifactIds.includes(value.observationArtifact.artifactId)) context.addIssue({ code: "custom", path: ["observationArtifact", "parentArtifactIds"], message: "observation artifact cannot self-parent" });
  const allIds = [value.profileArtifact, value.blindedInputArtifact, value.requestArtifact, value.rawResponseArtifact, value.responseEnvelopeArtifact, value.observationArtifact].map((handle) => handle.artifactId);
  if (new Set(allIds).size !== allIds.length) context.addIssue({ code: "custom", path: ["observationArtifact", "artifactId"], message: "artifact roles must be distinct" });
  if (value.observationArtifact.parentArtifactIds.length !== expectedParents.length || value.observationArtifact.parentArtifactIds.some((id, index) => id !== expectedParents[index])) context.addIssue({ code: "custom", path: ["observationArtifact", "parentArtifactIds"], message: "observation must have exact blinded-input/envelope/profile parents" });
});
export type SemanticProviderResponseObservation = z.infer<typeof SemanticProviderResponseObservationSchema>;
