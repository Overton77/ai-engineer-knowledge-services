import { UuidSchema, VerificationArtifactHandleSchema, VerificationSemanticProviderReconciliationSchema } from "@aiengineer/knowledge-contracts";
import type { SemanticProviderReconciliationAdmission } from "@aiengineer/knowledge-application";
import { deepFreeze } from "@aiengineer/knowledge-domain";
import { canonicalizeJson, type TrustedArtifactResolver } from "@aiengineer/knowledge-verification";
import type { PostgresCanonicalRepository } from "./postgres.js";

export class SemanticProviderReconciliationReadError extends Error {
  constructor(readonly code: "INVALID" | "NOT_FOUND" | "INTEGRITY") { super(`SEMANTIC_PROVIDER_RECONCILIATION_READ_${code}`); }
}

/** Internal read of a settled semantic claims/report attempt. Caller authorization remains outside this repository. */
export class PostgresSemanticProviderReconciliationReadRepository {
  constructor(private readonly database: Pick<PostgresCanonicalRepository, "transaction">, private readonly admission: SemanticProviderReconciliationAdmission, private readonly createResolver: () => TrustedArtifactResolver) {}

  async loadAppliedDecision(tenantId: string, operationId: string, providerAttemptId: string) {
    if (![tenantId, operationId, providerAttemptId].every((value) => UuidSchema.safeParse(value).success)) throw new SemanticProviderReconciliationReadError("INVALID");
    try {
      const snapshot = await this.#snapshot(tenantId, operationId, providerAttemptId);
      const resolver = this.createResolver();
      await resolver.authorizeArtifact({ tenantId, artifactId: snapshot.artifactId, purpose: "verification_replay" });
      const artifact = VerificationArtifactHandleSchema.parse((await resolver.hydrateRegisteredArtifact({ tenantId, artifactId: snapshot.artifactId })).registration);
      if (artifact.tenantId !== tenantId || artifact.artifactId !== snapshot.artifactId || artifact.digest !== snapshot.digest) throw new Error("ARTIFACT_IDENTITY");
      const verified = await this.admission.verifyEvidenceAt({ tenantId, artifact, appliedAt: snapshot.appliedAt });
      if (canonicalizeJson(verified.receipt) !== canonicalizeJson(snapshot.receipt) || canonicalizeJson(await this.#snapshot(tenantId, operationId, providerAttemptId)) !== canonicalizeJson(snapshot)) throw new Error("LEDGER_DRIFT");
      return deepFreeze({ tenantId, operationId, providerAttemptId, artifact: { artifactId: artifact.artifactId, digest: artifact.digest }, actualCostMicros: verified.receipt.decision.actualCostMicros, releasedReservationCostMicros: verified.receipt.reservationCostMicros, appliedAt: snapshot.appliedAt, redispatchAuthorized: false as const });
    } catch (error) { if (error instanceof SemanticProviderReconciliationReadError) throw error; throw new SemanticProviderReconciliationReadError("INTEGRITY"); }
  }

  async #snapshot(tenantId: string, operationId: string, providerAttemptId: string) {
    return this.database.transaction(tenantId, async (client) => {
      const rows = (await client.query(`select r.*, p.state, p.actual_cost_micros, p.reconciled_at, o.operation_kind
        from orchestration.verification_provider_reconciliation r
        join knowledge_service.operation o on o.tenant_id=r.tenant_id and o.id=r.operation_id
        join orchestration.verification_provider_attempt p on p.tenant_id=r.tenant_id and p.id=r.provider_attempt_id and p.operation_id=r.operation_id
        where r.tenant_id=$1 and r.operation_id=$2 and r.provider_attempt_id=$3
          and o.operation_kind in ('verification_claims','verification_report') and o.status in ('succeeded','failed','cancelled')`, [tenantId, operationId, providerAttemptId])).rows;
      if (rows.length === 0) throw new SemanticProviderReconciliationReadError("NOT_FOUND");
      if (rows.length !== 1) throw new Error("LEDGER_COUNT");
      const row = rows[0]!, receipt = VerificationSemanticProviderReconciliationSchema.parse(row.body), appliedAt = new Date(row.applied_at as Date | string).toISOString();
      const expectedKind = receipt.host === "claims" ? "verification_claims" : "verification_report";
      if (receipt.tenantId !== tenantId || receipt.operationId !== operationId || receipt.providerAttemptId !== providerAttemptId || row.operation_kind !== expectedKind || row.state !== "settled" || row.actual_cost_micros === null || row.actual_cost_micros === undefined || Number(row.actual_cost_micros) !== receipt.decision.actualCostMicros || new Date(row.reconciled_at as Date | string).toISOString() !== appliedAt) throw new Error("LEDGER_BINDING");
      return deepFreeze({ receipt, artifactId: UuidSchema.parse(row.artifact_id), digest: `sha256:${row.artifact_sha256}`, appliedAt });
    });
  }
}
