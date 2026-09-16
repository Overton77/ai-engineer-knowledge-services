import type {
  DurableRecoveryCase, DurableRecoveryClaim, DurableRecoveryExecution, DurableRecoveryRevision, DurableRecoveryUsage,
  VerificationArtifactHandle, VerificationRecoveryBatch, VerificationRecoveryBinding, VerificationRecoveryPlan,
  VerificationRecoveryReceipt,
} from "@aiengineer/knowledge-contracts";
import type { VerificationRecoveryAuthority } from "./verification-recovery.js";

export interface DurableRecoveryEvidenceAuthority extends Pick<VerificationRecoveryAuthority, "now" | "readResult" | "readProbe" | "readInvalidation"> {
  readInitialBatch(input: { tenantId: string; batchId: string }): Promise<{ batch: VerificationRecoveryBatch; authorityArtifact: VerificationArtifactHandle }>;
  authorizeResume(input: { tenantId: string; caseId: string; authorityArtifact: VerificationArtifactHandle }): Promise<{
    kind: "evidence" | "review" | "policy"; priorAuthorityDigest: string; nextAuthorityDigest: string; artifact: VerificationArtifactHandle;
  }>;
}
export interface DurableRecoveryCustody {
  register(input: { tenantId: string; kind: DurableRecoveryRevision["kind"]; value: unknown; parentArtifactIds: readonly string[]; identity: string }): Promise<VerificationArtifactHandle>;
  read(input: { tenantId: string; artifact: VerificationArtifactHandle }): Promise<unknown>;
}
export interface DurableRecoveryRuntime {
  ensureOperation(input: {
    execution: DurableRecoveryExecution; binding: VerificationRecoveryBinding;
    rerunStages: VerificationRecoveryPlan["actions"][number]["rerunStages"]; idempotencyKey: string;
  }): Promise<{ operationId: string; requestDigest: string }>;
  reconcile(input: { tenantId: string; operationId: string; requestDigest: string }): Promise<void>;
}
export interface DurableRecoveryCheckpoints {
  verify(input: { tenantId: string; checkpointId: string; caseId: string }): Promise<{ checkpointId: string; artifact: VerificationArtifactHandle }>;
}
export type RecoveryRevisionInput = Omit<DurableRecoveryRevision, "revision">;
export interface DurableRecoveryStore {
  open(input: { tenantId: string; batch: VerificationRecoveryBatch; authorityArtifact: VerificationArtifactHandle; batchArtifact: VerificationArtifactHandle; notificationId: string }): Promise<DurableRecoveryCase>;
  read(tenantId: string, caseId: string): Promise<DurableRecoveryCase>;
  append(input: { tenantId: string; caseId: string; expectedRevision: number; entries: readonly RecoveryRevisionInput[];
    state?: DurableRecoveryCase["state"]; activePlanDigest?: string | null; authorityDigest?: string; releaseClaims?: boolean }): Promise<DurableRecoveryCase>;
  claim(input: { tenantId: string; caseId: string; planDigest: string; holderIdentity: string; leaseMs: number; keys: readonly string[] }): Promise<DurableRecoveryClaim>;
  reserve(input: { claim: DurableRecoveryClaim; execution: DurableRecoveryExecution }): Promise<DurableRecoveryExecution>;
  link(input: { tenantId: string; executionId: string; operationId: string; requestDigest: string }): Promise<DurableRecoveryExecution>;
  settle(input: { tenantId: string; caseId: string; planDigest: string; receipt: VerificationRecoveryReceipt;
    entries: readonly RecoveryRevisionInput[]; expectedRevision: number; settlements: readonly { executionId: string; usage: DurableRecoveryUsage }[] }): Promise<DurableRecoveryCase>;
}
