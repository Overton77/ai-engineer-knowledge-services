import { z } from "zod";

import { NonEmptyStringSchema, Sha256DigestSchema, UuidSchema } from "./index-primitives.js";
import { VerificationContractVersionSchema } from "./primitives.js";

const ArtifactReferenceSchema = z.strictObject({ artifactId: UuidSchema, digest: Sha256DigestSchema });
const PublicCodeSchema = NonEmptyStringSchema.max(256);
const DeterministicSummarySchema = z.strictObject({
  status: z.enum(["passed", "failed", "review_required"]),
  semanticEligibility: z.boolean(),
  capturesTotal: z.int().nonnegative(), capturesPassed: z.int().nonnegative(),
  assertionsTotal: z.int().nonnegative(), assertionsPassed: z.int().nonnegative(),
  metricsTotal: z.int().nonnegative(), metricsPassed: z.int().nonnegative(),
  failedCheckCodes: z.array(PublicCodeSchema).max(1_024),
  reviewReasons: z.array(PublicCodeSchema).max(1_024),
});
const PolicyOutcomeSchema = z.enum(["pass", "pass_with_warnings", "review", "abstain", "fail"]);
/** Deliberately bounded to reason codes emitted by the canonical policy evaluator. */
export const VerificationClaimsReportPolicyReasonCodeSchema = z.enum([
  "MECHANICAL_ASSERTION_FAILURE", "MECHANICAL_BUNDLE_FAILURE", "MECHANICAL_METRIC_FAILURE",
  "SEMANTIC_HARD_FAILURE", "SEMANTIC_DISPOSITION_FAIL", "SEMANTIC_DISPOSITION_ABSTAIN", "SEMANTIC_REVIEW_REQUIRED", "SEMANTIC_SUPPORT_NOT_FULL",
  "UNKNOWN_CRITICAL_FACTS", "MIXED_OR_CONFLICTING_EVIDENCE", "SOURCE_AUTHORITY_WITHHELD", "CROSS_FAMILY_SECOND_JUDGE_MISSING", "QUALIFIED_OR_PARTIAL_SUPPORT",
]);
/** Derived only from the signed policy-decision artifact; unavailable describes an older sealed terminal without that projection. */
const SealPolicySummarySchema = z.discriminatedUnion("availability", [
  z.strictObject({ availability: z.literal("verified"), outcome: PolicyOutcomeSchema, reasonCodes: z.array(VerificationClaimsReportPolicyReasonCodeSchema).max(64) }),
  z.strictObject({ availability: z.literal("unavailable") }),
]);
const SealResourceSchema = z.strictObject({ runId: UuidSchema, manifestDigest: Sha256DigestSchema, manifestArtifact: ArtifactReferenceSchema, policyOutcome: PolicyOutcomeSchema, policy: SealPolicySummarySchema }).superRefine((value, context) => {
  if (value.policy.availability === "verified" && value.policy.outcome !== value.policyOutcome) context.addIssue({ code: "custom", path: ["policy", "outcome"], message: "Verified policy outcome must match sealed policy outcome" });
});
const ClaimsResultResourceSchema = z.strictObject({ mode: z.literal("deterministic_only"), deterministic: DeterministicSummarySchema, assertionsArtifact: ArtifactReferenceSchema });
const ReportWideResourceSchema = z.strictObject({ claimWeightedCitationCompleteness: z.number().min(0).max(1), citationCorrectness: z.number().min(0).max(1).nullable(), validPointerConditionalCitationCorrectness: z.number().min(0).max(1).nullable(), pointerFailureCount: z.int().nonnegative(), misplacedCitationCount: z.int().nonnegative(), duplicateAssertionGroupCount: z.int().nonnegative(), conflictAssertionGroupCount: z.int().nonnegative(), missingQualifierCount: z.int().nonnegative(), consistencyMismatchGroupCount: z.int().nonnegative(), crossSectionMismatchCount: z.int().nonnegative(), independentSourceFamilyCount: z.int().nonnegative(), distinctSourceFamilyCount: z.int().nonnegative(), unsupportedHighSeverityCount: z.int().nonnegative() });
const ReportResultResourceSchema = ClaimsResultResourceSchema.extend({ reportArtifact: ArtifactReferenceSchema, claimLedgerArtifact: ArtifactReferenceSchema, reportWide: ReportWideResourceSchema, coverageScope: z.literal("producer_declared_assertions_only"), reportGateArtifact: ArtifactReferenceSchema });
const TerminalBaseSchema = z.strictObject({ verificationContractVersion: VerificationContractVersionSchema, tenantId: UuidSchema, operationId: UuidSchema, requestDigest: Sha256DigestSchema, resultArtifact: ArtifactReferenceSchema, sealedRun: SealResourceSchema });
export const VerificationClaimsTerminalResourceSchema = TerminalBaseSchema.extend({ useCase: z.literal("verifyClaims"), output: ClaimsResultResourceSchema });
export type VerificationClaimsTerminalResource = z.infer<typeof VerificationClaimsTerminalResourceSchema>;
export const VerificationReportTerminalResourceSchema = TerminalBaseSchema.extend({ useCase: z.literal("verifyReport"), output: ReportResultResourceSchema });
export type VerificationReportTerminalResource = z.infer<typeof VerificationReportTerminalResourceSchema>;
export const VerificationClaimsReportTerminalResourceSchema = z.discriminatedUnion("useCase", [VerificationClaimsTerminalResourceSchema, VerificationReportTerminalResourceSchema]);
export type VerificationClaimsReportTerminalResource = z.infer<typeof VerificationClaimsReportTerminalResourceSchema>;


