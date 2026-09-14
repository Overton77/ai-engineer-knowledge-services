import {
  MutationEnvelopeSchema, VerificationRecoveryPlanSchema, type DurableRecoveryExecution, type MutationEnvelope, type OperationKind,
} from "@aiengineer/knowledge-contracts";
import { verificationOwnedOperationKinds, type DurableRecoveryRuntime, type DurableRecoveryStore } from "@aiengineer/knowledge-application";
import { PostgresKnowledgeOperationService, type PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import { canonicalizeJson, digestCanonicalJson } from "@aiengineer/knowledge-verification";

type RepairInput = Parameters<DurableRecoveryRuntime["ensureOperation"]>[0];
type OriginalOperation = Parameters<DurableRecoveryRuntime["reconcile"]>[0];

const authorizationFields = [
  "executionId", "tenantId", "caseId", "originalId", "planDigest", "repairDigest", "inputDigest",
  "plannedOperationId", "reservation", "authorizationToken", "claimToken", "claimFence",
] as const satisfies readonly (keyof DurableRecoveryExecution)[];

function authorizationIdentity(execution: DurableRecoveryExecution): unknown {
  return Object.fromEntries(authorizationFields.map(key => [key, execution[key]]));
}

/** Pure request materialization: the admitted host supplies real authority context and performs no provider work. */
export interface DurableRecoveryRepairMaterializer {
  materialize(input: RepairInput): Promise<{ kind: OperationKind; envelope: MutationEnvelope }>;
}

export function createDurableRecoveryRuntime(input: {
  store: DurableRecoveryStore;
  database: PostgresCanonicalRepository;
  materializer: DurableRecoveryRepairMaterializer;
  admittedOperationKinds: readonly OperationKind[];
  origin: string;
  reconcileOriginalOperation(reference: OriginalOperation): Promise<void>;
}): DurableRecoveryRuntime {
  if (!input.admittedOperationKinds.length || input.admittedOperationKinds.some(kind =>
    !(verificationOwnedOperationKinds as readonly string[]).includes(kind))) {
    throw new Error("RECOVERY_VERIFICATION_CAPABILITY_REQUIRED");
  }
  const operations = new PostgresKnowledgeOperationService(input.database, { admittedOperationKinds: input.admittedOperationKinds });

  return {
    async ensureOperation(request) {
      const execution = request.execution;
      const current = await input.store.read(execution.tenantId, execution.caseId);
      const authorized = current.executions.find(row => row.executionId === execution.executionId);
      if (!authorized || canonicalizeJson(authorizationIdentity(authorized)) !== canonicalizeJson(authorizationIdentity(execution))) {
        throw new Error("RECOVERY_EXECUTION_AUTHORIZATION_MISMATCH");
      }
      const plan = current.revisions.find(row => row.kind === "plan" && row.idempotencyKey === execution.planDigest)?.value;
      const parsedPlan = VerificationRecoveryPlanSchema.parse(plan);
      const { payloadDigest, ...planBody } = parsedPlan;
      const action = parsedPlan.actions.find(row => row.originalId === execution.originalId);
      if (payloadDigest !== execution.planDigest || digestCanonicalJson(planBody) !== payloadDigest
        || !action?.newBinding || canonicalizeJson(action.newBinding) !== canonicalizeJson(request.binding)
        || canonicalizeJson(action.rerunStages) !== canonicalizeJson(request.rerunStages)
        || digestCanonicalJson(request.binding) !== execution.inputDigest
        || digestCanonicalJson({ originalId: execution.originalId, binding: request.binding }) !== execution.repairDigest
        || request.idempotencyKey !== `recovery:${execution.executionId}`) {
        throw new Error("RECOVERY_EXECUTION_REQUEST_MISMATCH");
      }

      const materialized = await input.materializer.materialize(structuredClone(request));
      const envelope = MutationEnvelopeSchema.parse(materialized.envelope);
      if (envelope.context.tenantId !== execution.tenantId
        || envelope.context.operationId !== execution.plannedOperationId
        || envelope.context.idempotencyKey !== request.idempotencyKey) {
        throw new Error("RECOVERY_OPERATION_CONTEXT_MISMATCH");
      }
      try {
        await operations.submit(materialized.kind, envelope, input.origin);
      } catch (error) {
        // Concurrent registration can lose the unique insert race; reconcile the original identity.
        if ((error as { code?: string }).code !== "23505"
          || !await input.database.getOperation(execution.tenantId, execution.plannedOperationId)) throw error;
        await operations.submit(materialized.kind, envelope, input.origin);
      }
      const operation = await input.database.getOperation(execution.tenantId, execution.plannedOperationId);
      if (!operation || operation.idempotencyKey !== request.idempotencyKey
        || (authorized.requestDigest && authorized.requestDigest !== `sha256:${operation.requestSha256}`)) {
        throw new Error("RECOVERY_CANONICAL_OPERATION_MISMATCH");
      }
      return { operationId: operation.id, requestDigest: `sha256:${operation.requestSha256}` };
    },
    async reconcile(reference) {
      const original = await input.database.getOperation(reference.tenantId, reference.operationId);
      if (!original || `sha256:${original.requestSha256}` !== reference.requestDigest
        || !input.admittedOperationKinds.includes(original.operationKind as OperationKind)) {
        throw new Error("RECOVERY_CANONICAL_OPERATION_MISMATCH");
      }
      await input.reconcileOriginalOperation(reference);
      const reconciled = await input.database.getOperation(reference.tenantId, reference.operationId);
      if (!reconciled || reconciled.requestSha256 !== original.requestSha256) {
        throw new Error("RECOVERY_CANONICAL_OPERATION_CHANGED");
      }
    },
  };
}
