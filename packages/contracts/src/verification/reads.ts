import { z } from "zod";
import { PolicyOutcomeSchema } from "./model.js";
import { IsoDateTimeSchema, NonEmptyStringSchema, Sha256DigestSchema, UuidSchema } from "./index-primitives.js";
import { VerificationContractVersionSchema, VerificationIdSchema } from "./primitives.js";

const PublicStringSchema = NonEmptyStringSchema.max(4_096);
const MediaTypeSchema = NonEmptyStringSchema.max(255);

/** A registered immutable artifact, deliberately excluding its storage locator. */
export const VerificationArtifactReferenceSchema = z.strictObject({
  artifactId: UuidSchema,
  digest: Sha256DigestSchema,
  mediaType: MediaTypeSchema,
  sizeBytes: z.int().nonnegative(),
});
export type VerificationArtifactReference = z.infer<typeof VerificationArtifactReferenceSchema>;

const VerificationPolicyBindingResourceSchema = z.strictObject({
  policyVersion: PublicStringSchema,
  policyArtifact: VerificationArtifactReferenceSchema,
  recordedPolicyInputsArtifact: VerificationArtifactReferenceSchema,
});

const VerificationCallCostSummarySchema = z.strictObject({
  count: z.int().nonnegative(),
  reservedCostMicros: z.int().nonnegative(),
  estimatedCostMicros: z.int().nonnegative(),
  actualCostMicros: z.int().nonnegative(),
  actualCount: z.int().nonnegative(),
  estimatedCount: z.int().nonnegative(),
  reservedCount: z.int().nonnegative(),
  unknownDispatchedCount: z.int().nonnegative(),
});

const VerificationRunLifecycleSchema = z.strictObject({
  policyOutcome: PolicyOutcomeSchema,
  networkPolicy: z.enum(["disabled", "allowlisted", "unrestricted"]),
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
});

const VerificationRunSummaryCoreSchema = z.strictObject({
  verificationContractVersion: VerificationContractVersionSchema,
  tenantId: UuidSchema,
  runId: VerificationIdSchema,
  manifestId: VerificationIdSchema,
  manifestDigest: Sha256DigestSchema,
  resultDigest: Sha256DigestSchema,
  lifecycle: VerificationRunLifecycleSchema,
  policyBinding: VerificationPolicyBindingResourceSchema,
  artifacts: z.strictObject({
    inputCount: z.int().nonnegative(),
    outputCount: z.int().nonnegative(),
  }),
  calls: VerificationCallCostSummarySchema,
});

/** Compact durable run state. It never exposes the audit bundle or result body. */
export const VerificationRunSummaryResourceSchema = VerificationRunSummaryCoreSchema;
export type VerificationRunSummaryResource = z.infer<typeof VerificationRunSummaryResourceSchema>;

const VerificationManifestStageSchema = z.strictObject({
  name: PublicStringSchema,
  status: z.enum(["succeeded", "failed", "skipped"]),
  startedAt: IsoDateTimeSchema,
  endedAt: IsoDateTimeSchema,
});

/**
 * Reproducibility metadata from a sealed manifest. Storage keys, provider
 * configuration, judgments, evidence and seal material remain private.
 */
export const VerificationRunManifestResourceSchema = VerificationRunSummaryCoreSchema.extend({
  datasetId: VerificationIdSchema.optional(),
  datasetVersionDigest: Sha256DigestSchema.optional(),
  experimentDefinitionDigest: Sha256DigestSchema.optional(),
  variantId: VerificationIdSchema.optional(),
  versions: z.strictObject({
    policy: PublicStringSchema,
    schema: PublicStringSchema,
    grader: PublicStringSchema.optional(),
    parser: PublicStringSchema.optional(),
    normalizer: PublicStringSchema,
    extractor: PublicStringSchema.optional(),
    prompt: Sha256DigestSchema.optional(),
  }),
  code: z.strictObject({
    gitSha: PublicStringSchema,
    dirty: z.boolean(),
  }),
  runtime: z.strictObject({
    container: PublicStringSchema.optional(),
    platform: PublicStringSchema,
    deploymentId: VerificationIdSchema,
  }),
  provider: z.strictObject({
    endpointIdentity: PublicStringSchema,
    model: PublicStringSchema,
    pricingSnapshotArtifact: VerificationArtifactReferenceSchema,
  }).optional(),
  inputArtifacts: z.array(VerificationArtifactReferenceSchema).max(1_000),
  outputArtifacts: z.array(VerificationArtifactReferenceSchema).max(1_000),
  stages: z.array(VerificationManifestStageSchema).max(256),
  randomSeed: z.int().optional(),
  toolPolicy: z.array(PublicStringSchema).max(256),
  gateDigest: Sha256DigestSchema.optional(),
  replayOfRunId: VerificationIdSchema.optional(),
  canonicalization: z.strictObject({
    algorithm: z.literal("RFC8785"),
    implementationVersion: PublicStringSchema,
    manifestDigest: Sha256DigestSchema,
  }),
});
export type VerificationRunManifestResource = z.infer<typeof VerificationRunManifestResourceSchema>;

/** Authored case identity; evaluation score IDs are never implicit aliases. */
export const VerificationCaseSummaryResourceSchema = z.strictObject({
  verificationContractVersion: VerificationContractVersionSchema,
  tenantId: UuidSchema,
  runId: UuidSchema,
  caseRunId: UuidSchema,
  caseKey: NonEmptyStringSchema.max(255),
  inputArtifact: VerificationArtifactReferenceSchema,
  resultArtifact: VerificationArtifactReferenceSchema,
  createdAt: IsoDateTimeSchema,
});
export type VerificationCaseSummaryResource = z.infer<typeof VerificationCaseSummaryResourceSchema>;

/** An explicit artifact-backed evidence resource, excluding artifact bytes. */
export const VerificationEvidenceResourceSchema = z.strictObject({
  verificationContractVersion: VerificationContractVersionSchema,
  tenantId: UuidSchema,
  runId: UuidSchema,
  caseRunId: UuidSchema,
  evidenceId: UuidSchema,
  evidenceKey: NonEmptyStringSchema.max(255),
  kind: z.literal("artifact"),
  ordinal: z.int().min(0).max(255),
  artifact: VerificationArtifactReferenceSchema,
  createdAt: IsoDateTimeSchema,
});
export type VerificationEvidenceResource = z.infer<typeof VerificationEvidenceResourceSchema>;

export const VerificationCaseResourceSchema = VerificationCaseSummaryResourceSchema.extend({
  evidence: z.array(VerificationEvidenceResourceSchema).max(256),
}).superRefine((value, context) => {
  const ids = new Set<string>();
  const keys = new Set<string>();
  let priorOrdinal = -1;
  for (const evidence of value.evidence) {
    if (evidence.tenantId !== value.tenantId || evidence.runId !== value.runId || evidence.caseRunId !== value.caseRunId
      || ids.has(evidence.evidenceId) || keys.has(evidence.evidenceKey) || evidence.ordinal <= priorOrdinal) {
      context.addIssue({ code: "custom", path: ["evidence"], message: "Evidence must be uniquely ordered and bound to this case" });
    }
    ids.add(evidence.evidenceId);
    keys.add(evidence.evidenceKey);
    priorOrdinal = evidence.ordinal;
  }
});
export type VerificationCaseResource = z.infer<typeof VerificationCaseResourceSchema>;

export const VerificationRunCasesResourceSchema = z.strictObject({
  verificationContractVersion: VerificationContractVersionSchema,
  tenantId: UuidSchema,
  runId: UuidSchema,
  cases: z.array(VerificationCaseSummaryResourceSchema).max(100),
  nextCursor: UuidSchema.optional(),
}).superRefine((value, context) => {
  const ids = new Set<string>();
  for (const item of value.cases) {
    if (item.tenantId !== value.tenantId || item.runId !== value.runId || ids.has(item.caseRunId)) {
      context.addIssue({ code: "custom", path: ["cases"], message: "Cases must be unique and bound to this run" });
    }
    ids.add(item.caseRunId);
  }
});
export type VerificationRunCasesResource = z.infer<typeof VerificationRunCasesResourceSchema>;
