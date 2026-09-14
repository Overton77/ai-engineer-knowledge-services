import { CheckpointScopeSchema, type CheckpointScope, type CheckpointProfilePins } from "@aiengineer/knowledge-contracts";
import type { CheckpointApplicationService, DurableRecoveryCheckpoints } from "@aiengineer/knowledge-application";

export function createDurableRecoveryCheckpoints(input: {
  checkpoints: CheckpointApplicationService;
  profilePins: CheckpointProfilePins;
  scopeForCase(reference: { tenantId: string; caseId: string }): Promise<CheckpointScope>;
}): DurableRecoveryCheckpoints {
  return {
    async verify(reference) {
      const scope = CheckpointScopeSchema.parse(await input.scopeForCase(reference));
      if (scope.tenantId !== reference.tenantId) throw new Error("RECOVERY_CHECKPOINT_TENANT_DENIED");
      const restored = await input.checkpoints.read(reference.tenantId, {
        checkpointId: reference.checkpointId,
        expectedScope: scope,
        expectedProfilePins: input.profilePins,
      });
      // A wait preserves custody even while its external work still needs reconciliation.
      return { checkpointId: restored.receipt.checkpointId, artifact: restored.receipt.manifestArtifact };
    },
  };
}
