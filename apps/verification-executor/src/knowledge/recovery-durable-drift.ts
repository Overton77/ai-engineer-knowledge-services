import type { DurableVerificationRecoveryService } from "@aiengineer/knowledge-application";
import { PostgresVerificationDriftRevalidationOutbox } from "@aiengineer/knowledge-persistence";
import { digestCanonicalJson } from "@aiengineer/knowledge-verification";
import { validateStoredArtifact, type ArtifactCustody } from "../store-custody.js";

/** Acknowledge the existing drift outbox only after the affected recovery cases retain its observation. */
export async function ingestDurableRecoveryDrift(input: {
  tenantId: string;
  holderIdentity: string;
  limit: number;
  visibilityTimeoutMs: number;
  outbox: PostgresVerificationDriftRevalidationOutbox;
  custody: ArtifactCustody;
  recovery: Pick<DurableVerificationRecoveryService, "ingestDrift">;
  caseIdsForObservation(reference: {
    tenantId: string; outboxId: string; sourceOperationId: string; observationArtifactId: string;
  }): Promise<readonly string[]>;
}): Promise<{ acknowledged: number; unmapped: number }> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error("RECOVERY_DRIFT_LIMIT_INVALID");
  if (!Number.isSafeInteger(input.visibilityTimeoutMs) || input.visibilityTimeoutMs < 1_000
    || input.visibilityTimeoutMs > 300_000) throw new Error("RECOVERY_DRIFT_VISIBILITY_INVALID");
  const claims = await input.outbox.claim(input.tenantId, input.holderIdentity, input.limit, input.visibilityTimeoutMs);
  let acknowledged = 0;
  let unmapped = 0;
  for (const claim of claims) {
    const caseIds = [...new Set(await input.caseIdsForObservation({
      tenantId: input.tenantId, outboxId: claim.id, sourceOperationId: claim.sourceOperationId,
      observationArtifactId: claim.observationArtifactId,
    }))].sort();
    if (caseIds.length > 512 || caseIds.some(id => !id.trim() || id.length > 256)) throw new Error("RECOVERY_DRIFT_CASE_BINDING_INVALID");
    if (!caseIds.length) { unmapped++; continue; }
    const observed = await input.custody.resolve(claim.observationArtifactId);
    if (!observed) throw new Error("RECOVERY_DRIFT_OBSERVATION_UNAVAILABLE");
    if (observed.handle.artifactId !== claim.observationArtifactId) throw new Error("RECOVERY_DRIFT_OBSERVATION_IDENTITY_MISMATCH");
    validateStoredArtifact(input.tenantId, observed.handle, observed.bytes);
    for (const caseId of caseIds) {
      await input.recovery.ingestDrift(input.tenantId, {
        caseId, notificationId: `drift:${claim.id}:${digestCanonicalJson(caseId)}`, artifact: observed.handle,
      });
    }
    await input.outbox.ack(input.tenantId, claim.id, input.holderIdentity, claim.claimToken);
    acknowledged++;
  }
  return { acknowledged, unmapped };
}
