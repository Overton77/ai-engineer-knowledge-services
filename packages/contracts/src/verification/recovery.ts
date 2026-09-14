import { z } from "zod";
import { JsonValueSchema, NonEmptyStringSchema, Sha256DigestSchema, UuidSchema } from "./index-primitives.js";
import { PolicyOutcomeSchema, SemanticVerdictSchema } from "./model.js";
import { VerificationArtifactHandleSchema } from "./primitives.js";
import { VerificationSelectorSchema } from "./selectors.js";

const Id = NonEmptyStringSchema.max(256);
const Count = z.int().nonnegative().max(1_000_000);
const Money = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Digests = z.array(Sha256DigestSchema).max(512);
const Ids = z.array(Id).max(512);
const unique = (values: readonly string[]) => new Set(values).size === values.length;

export const VerificationRecoveryStageSchema = z.enum(["capture", "parser", "selector", "mechanical", "semantic", "policy", "report"]);
export const VerificationRecoveryBindingSchema = z.strictObject({
  claim: z.strictObject({ statement: NonEmptyStringSchema.max(8_000), qualifiers: Ids, value: JsonValueSchema.optional() }),
  evidence: z.array(z.strictObject({ representationDigest: Sha256DigestSchema, selector: VerificationSelectorSchema, contextDigest: Sha256DigestSchema })).min(1).max(64),
  captureDigests: Digests,
  policyDigest: Sha256DigestSchema,
  profileDigest: Sha256DigestSchema,
});
export type VerificationRecoveryBinding = z.infer<typeof VerificationRecoveryBindingSchema>;

export const VerificationRecoveryRequirementSchema = z.strictObject({
  requirementId: Id, questionId: Id, description: NonEmptyStringSchema.max(2_000),
  historicalCaptureDigest: Sha256DigestSchema.optional(),
});

export const VerificationRecoveryObservationSchema = z.strictObject({
  operationId: UuidSchema,
  runId: Id.optional(),
  execution: z.enum(["completed", "pending", "unknown", "cancelled"]),
  mechanical: z.enum(["passed", "failed", "review_required"]).optional(),
  semantic: SemanticVerdictSchema.optional(),
  policy: PolicyOutcomeSchema.optional(),
  family: z.enum(["none", "execution", "capture", "parser", "selector", "mechanical", "context", "unsupported", "contradicted", "disputed", "policy", "authorization", "report"]),
  earliestStage: VerificationRecoveryStageSchema,
  signature: Id,
  dependencyIds: Ids,
  diagnosticArtifacts: z.array(VerificationArtifactHandleSchema).max(64),
});
export type VerificationRecoveryObservation = z.infer<typeof VerificationRecoveryObservationSchema>;

/** Authenticated independent read projection; absence of any proof field is not an admission. */
export const VerificationRecoveryVerifiedResultSchema = z.strictObject({
  tenantId: UuidSchema, inputDigest: Sha256DigestSchema,
  binding: VerificationRecoveryBindingSchema, observation: VerificationRecoveryObservationSchema,
  coveredRequirementIds: Ids, verifiedStages: z.array(VerificationRecoveryStageSchema).max(7),
  revoked: z.boolean(), usage: z.strictObject({ calls: Count, costMicros: Money }),
});

export const VerificationRecoveryItemSchema = z.strictObject({
  originalId: Id,
  questionIds: Ids.min(1),
  inputDigest: Sha256DigestSchema,
  binding: VerificationRecoveryBindingSchema,
  observation: VerificationRecoveryObservationSchema,
  usedRounds: Count,
  attemptedInputDigests: Digests,
  attemptedRepairDigests: Digests,
});
export type VerificationRecoveryItem = z.infer<typeof VerificationRecoveryItemSchema>;

export const VerificationRecoveryLimitsSchema = z.strictObject({
  maxRoundsPerOriginal: z.int().min(0).max(2),
  maxProbeRounds: z.int().min(0).max(1),
  remainingCalls: Count,
  remainingCostMicros: Money,
  deadline: z.iso.datetime(),
});
export const VerificationRecoveryBatchSchema = z.strictObject({
  tenantId: UuidSchema, callerId: Id, batchId: Id, caseId: Id,
  recoveryPolicyVersion: Id, parentAttemptId: Id,
  capturedAt: z.iso.datetime(), closedAt: z.iso.datetime().optional(),
  questionIds: Ids.min(1),
  requirements: z.array(VerificationRecoveryRequirementSchema).min(1).max(2_048),
  items: z.array(VerificationRecoveryItemSchema).min(1).max(512),
  limits: VerificationRecoveryLimitsSchema,
  allowedActions: z.array(z.enum(["repair", "seek_evidence"])).max(2),
  probeRounds: z.array(z.strictObject({ dependencyId: Id, used: Count, receiptDigests: Digests })).max(512),
}).superRefine((batch, ctx) => {
  const reject = (message: string) => ctx.addIssue({ code: "custom", message });
  if (!unique(batch.questionIds) || !unique(batch.items.map(item => item.originalId)) || !unique(batch.requirements.map(row => row.requirementId))) reject("original items, questions and requirements must be unique");
  if (!unique(batch.probeRounds.map(row => row.dependencyId))) reject("dependency probe counters must be unique");
  if (batch.requirements.some(row => !batch.questionIds.includes(row.questionId)) || batch.questionIds.some(id => !batch.requirements.some(row => row.questionId === id))) reject("requirements must cover exactly the original question set");
  for (const item of batch.items) {
    if (!unique(item.questionIds) || item.questionIds.some(id => !batch.questionIds.includes(id))) reject("item question mapping is invalid");
    if (item.observation.diagnosticArtifacts.some(artifact => artifact.tenantId !== batch.tenantId)) reject("diagnostic artifact tenant mismatch");
    if (item.observation.execution === "completed" && item.observation.diagnosticArtifacts.length === 0) reject("completed observations require authoritative diagnostic artifacts");
    if (!unique(item.observation.dependencyIds)) reject("dependency IDs must be unique");
  }
});
export type VerificationRecoveryBatch = z.infer<typeof VerificationRecoveryBatchSchema>;

export const VerificationFailureSetSchema = z.strictObject({
  schemaVersion: z.literal("verification-failure-set.v1"),
  batch: VerificationRecoveryBatchSchema,
  counts: z.strictObject({ submitted: Count, terminal: Count, passed: Count, failed: Count, held: Count, pending: Count, unknown: Count, cancelled: Count }),
  questionDenominator: Count,
  failureRatio: z.number().min(0).max(1),
  cohortTriage: z.boolean(),
  payloadDigest: Sha256DigestSchema,
}).superRefine((set, ctx) => {
  const c = set.counts;
  if (c.submitted !== set.batch.items.length || c.submitted !== c.passed + c.failed + c.held + c.pending + c.unknown + c.cancelled
    || c.terminal !== c.passed + c.failed + c.held + c.cancelled || set.questionDenominator !== set.batch.questionIds.length
    || set.failureRatio !== (c.terminal === 0 ? 0 : c.failed / c.terminal)) ctx.addIssue({ code: "custom", message: "failure set denominator/count mismatch" });
});
export type VerificationFailureSet = z.infer<typeof VerificationFailureSetSchema>;

export const VerificationRecoveryActionSchema = z.strictObject({
  originalId: Id,
  route: z.enum(["preserve", "reconcile", "adjudicate", "repair", "seek_evidence", "reject", "gap", "operator", "exhausted", "cancelled"]),
  newBinding: VerificationRecoveryBindingSchema.optional(),
  rerunStages: z.array(VerificationRecoveryStageSchema).max(7),
  reason: NonEmptyStringSchema.max(2_000),
  diagnosticArtifactIds: Ids,
  dependencyId: Id.optional(),
});
export type VerificationRecoveryAction = z.infer<typeof VerificationRecoveryActionSchema>;

export const VerificationRecoveryProbeSchema = z.strictObject({
  dependencyId: Id,
  representativeIds: Ids.min(1),
  controlId: Id.optional(),
  receiptArtifacts: z.array(VerificationArtifactHandleSchema).max(64),
});
export const VerificationRecoveryPlanSchema = z.strictObject({
  schemaVersion: z.literal("verification-recovery-plan.v1"),
  tenantId: UuidSchema, caseId: Id, parentAttemptId: Id, recoveryPolicyVersion: Id,
  failureSetDigest: Sha256DigestSchema,
  actions: z.array(VerificationRecoveryActionSchema).min(1).max(512),
  probes: z.array(VerificationRecoveryProbeSchema).max(512),
  reservation: z.strictObject({ calls: Count, costMicros: Money }),
  probeExecutions: z.array(z.strictObject({ operationId: UuidSchema, calls: Count, costMicros: Money, previouslyAccounted: z.boolean() })).max(512),
  leaseKeys: z.array(Id).max(1_024),
  stopRules: z.tuple([z.literal("no_new_information"), z.literal("repeated_input"), z.literal("limits_exhausted")]),
  payloadDigest: Sha256DigestSchema,
}).superRefine((plan, ctx) => {
  if (!unique(plan.actions.map(row => row.originalId)) || !unique(plan.probes.map(row => row.dependencyId))) ctx.addIssue({ code: "custom", message: "plan items and probes must be unique" });
  if (plan.probes.some(probe => probe.receiptArtifacts.some(artifact => artifact.tenantId !== plan.tenantId))) ctx.addIssue({ code: "custom", message: "probe artifact tenant mismatch" });
});
export type VerificationRecoveryPlan = z.infer<typeof VerificationRecoveryPlanSchema>;

const ComponentsSchema = z.strictObject({ provider: Id, model: Id, parser: Id, grader: Id, policy: Id });
const AuditBindingSchema = z.strictObject({ runId: Id, auditBundleArtifact: z.strictObject({ artifactId: UuidSchema, digest: Sha256DigestSchema }) });
export const VerificationRecoveryDependencyGraphSchema = z.strictObject({
  tenantId: UuidSchema, caseId: Id, planDigest: Sha256DigestSchema, baselineAuditDigest: Sha256DigestSchema,
  rootIds: Ids.min(1),
  nodes: z.array(z.strictObject({
    id: Id, dependencyIds: Ids, admissionAuditDigest: Sha256DigestSchema, revoked: z.boolean(),
    revalidatedStages: z.array(VerificationRecoveryStageSchema).max(7),
  })).min(1).max(2_048),
});
export const VerificationRecoveryInvalidationSchema = z.strictObject({
  schemaVersion: z.literal("verification-recovery-invalidation.v1"),
  tenantId: UuidSchema, caseId: Id, planDigest: Sha256DigestSchema,
  complete: z.literal(true),
  evaluations: z.array(z.strictObject({
    observation: z.strictObject({
      schemaVersion: z.literal("verification-component-drift-observation.v1"), tenantId: UuidSchema,
      baseline: AuditBindingSchema, candidate: AuditBindingSchema,
      baselineComponents: ComponentsSchema, candidateComponents: ComponentsSchema,
      changedDimensions: z.array(z.enum(["provider", "model", "parser", "grader", "policy"])).max(5),
      payloadDigest: Sha256DigestSchema,
    }),
    graph: VerificationRecoveryDependencyGraphSchema,
  })).max(512),
  invalidatedOutputIds: Ids, revalidatedOutputIds: Ids, blockedOutputIds: Ids,
  payloadDigest: Sha256DigestSchema,
});
export type VerificationRecoveryInvalidation = z.infer<typeof VerificationRecoveryInvalidationSchema>;

export const VerificationRecoveryReceiptSchema = z.strictObject({
  schemaVersion: z.literal("verification-recovery-receipt.v1"),
  tenantId: UuidSchema, caseId: Id,
  failureSetDigest: Sha256DigestSchema, planDigest: Sha256DigestSchema,
  questionIds: Ids.min(1), questionDenominator: Count,
  results: z.array(z.strictObject({
    originalId: Id, originalInputDigest: Sha256DigestSchema, outputInputDigest: Sha256DigestSchema.optional(),
    outcome: z.enum(["preserved_admitted", "recovered_admitted", "partial_support", "resolved_rejected", "review_required", "operator_required", "exhausted", "cancelled", "reconciliation_unresolved", "unresolved_gap"]),
    questionIds: Ids.min(1), coveredRequirementIds: Ids, gapRequirementIds: Ids,
    artifacts: z.array(VerificationArtifactHandleSchema).max(64),
    usedRounds: Count, attemptedInputDigests: Digests, attemptedRepairDigests: Digests,
    pendingReference: Id.optional(),
  })).min(1).max(512),
  coveredQuestionIdsBefore: Ids, coveredQuestionIdsAfter: Ids,
  remainingQuestionIds: Ids,
  invalidatedOutputIds: Ids, revalidatedOutputIds: Ids,
  invalidationDigest: Sha256DigestSchema, invalidationObservationDigests: Digests,
  usage: z.strictObject({ calls: Count, costMicros: Money }),
  retainedReservation: z.strictObject({ calls: Count, costMicros: Money }),
  remainingLimits: VerificationRecoveryLimitsSchema,
  checkpointReferences: Ids,
  probeRounds: z.array(z.strictObject({ dependencyId: Id, used: Count, receiptDigests: Digests })).max(512),
  payloadDigest: Sha256DigestSchema,
}).superRefine((receipt, ctx) => {
  if (!unique(receipt.results.map(row => row.originalId)) || !unique(receipt.questionIds) || receipt.questionDenominator !== receipt.questionIds.length) ctx.addIssue({ code: "custom", message: "receipt originals and denominator must be retained" });
  if (receipt.results.some(row => row.artifacts.some(artifact => artifact.tenantId !== receipt.tenantId))) ctx.addIssue({ code: "custom", message: "receipt artifact tenant mismatch" });
});
export type VerificationRecoveryReceipt = z.infer<typeof VerificationRecoveryReceiptSchema>;
