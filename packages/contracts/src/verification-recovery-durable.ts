import { z } from "zod";
import { VerificationArtifactHandleSchema } from "./verification/primitives.js";
import { VerificationRecoveryBatchSchema, VerificationRecoveryPlanSchema, VerificationRecoveryReceiptSchema } from "./verification/recovery.js";
import { IsoDateTimeSchema, Sha256DigestSchema, UuidSchema } from "./primitives.js";

const Identity = z.string().min(1).max(256);
export const DurableRecoveryUsageSchema = z.strictObject({ calls: z.number().int().nonnegative(), costMicros: z.number().int().nonnegative() });
export const DurableRecoveryClaimSchema = z.strictObject({
  tenantId: UuidSchema, caseId: Identity, planDigest: Sha256DigestSchema,
  holderIdentity: Identity, token: UuidSchema, fencingToken: z.number().int().positive(),
  expiresAt: IsoDateTimeSchema, keys: z.array(Identity).min(1).max(10000),
});
export const DurableRecoveryExecutionSchema = z.strictObject({
  executionId: UuidSchema, tenantId: UuidSchema, caseId: Identity, originalId: Identity,
  planDigest: Sha256DigestSchema, repairDigest: Sha256DigestSchema, inputDigest: Sha256DigestSchema,
  plannedOperationId: UuidSchema, operationId: UuidSchema.optional(), requestDigest: Sha256DigestSchema.optional(),
  reservation: DurableRecoveryUsageSchema, usage: DurableRecoveryUsageSchema.optional(),
  state: z.enum(["authorized", "linked", "settled"]), authorizationToken: UuidSchema,
  claimToken: UuidSchema, claimFence: z.number().int().positive(),
}).superRefine((value, context) => {
  if ((value.state === "authorized") !== (value.operationId === undefined)
    || (value.operationId === undefined) !== (value.requestDigest === undefined)
    || (value.state === "settled") !== (value.usage !== undefined)
    || (value.operationId !== undefined && value.operationId !== value.plannedOperationId)) {
    context.addIssue({ code: "custom", message: "Execution state must retain its original operation and accounting binding" });
  }
  if (value.usage && (value.usage.calls > value.reservation.calls || value.usage.costMicros > value.reservation.costMicros)) {
    context.addIssue({ code: "custom", message: "Actual execution usage exceeds its durable reservation" });
  }
});
export const DurableRecoveryRevisionSchema = z.strictObject({
  revision: z.number().int().positive(), kind: z.enum(["batch", "notification", "failure_set", "plan", "invalidation", "receipt", "wait", "resume"]),
  idempotencyKey: Identity, artifact: VerificationArtifactHandleSchema, value: z.unknown(),
  checkpointId: UuidSchema.optional(),
});
export const DurableRecoveryCaseSchema = z.strictObject({
  tenantId: UuidSchema, caseId: Identity, revision: z.number().int().positive(),
  state: z.enum(["ready", "active", "waiting", "complete"]),
  initialBatch: VerificationRecoveryBatchSchema, batch: VerificationRecoveryBatchSchema, authorityDigest: Sha256DigestSchema,
  initialAuthorityArtifact: VerificationArtifactHandleSchema,
  revisions: z.array(DurableRecoveryRevisionSchema), executions: z.array(DurableRecoveryExecutionSchema),
  claims: z.array(DurableRecoveryClaimSchema), activePlanDigest: Sha256DigestSchema.optional(),
  spent: DurableRecoveryUsageSchema, reserved: DurableRecoveryUsageSchema,
  latestPlan: VerificationRecoveryPlanSchema.optional(), latestReceipt: VerificationRecoveryReceiptSchema.optional(),
});
export type DurableRecoveryUsage = z.infer<typeof DurableRecoveryUsageSchema>;
export type DurableRecoveryClaim = z.infer<typeof DurableRecoveryClaimSchema>;
export type DurableRecoveryExecution = z.infer<typeof DurableRecoveryExecutionSchema>;
export type DurableRecoveryRevision = z.infer<typeof DurableRecoveryRevisionSchema>;
export type DurableRecoveryCase = z.infer<typeof DurableRecoveryCaseSchema>;
