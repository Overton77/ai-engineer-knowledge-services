import {
  UuidSchema,
  VerificationAuditInspectionOperationResultSchema,
  VerificationAuditInspectionResourceSchema,
  type VerificationAuditInspectionResource,
} from "@aiengineer/knowledge-contracts";
import { deepFreeze } from "@aiengineer/knowledge-domain";

export type VerificationAuditInspectionReadState = "pending" | "failed" | "cancelled" | "succeeded";
export interface VerifiedAuditInspectionReadPort {
  loadVerifiedInspection(tenantId: string, operationId: string): Promise<{
    readonly state: VerificationAuditInspectionReadState;
    readonly result?: unknown;
  }>;
}
export type VerificationAuditInspectionReadErrorCode = "INVALID" | "NOT_FOUND" | "PENDING" | "FAILED" | "CANCELLED" | "INTEGRITY";
export class VerificationAuditInspectionReadError extends Error {
  constructor(readonly code: VerificationAuditInspectionReadErrorCode, cause?: unknown) { super(`VERIFICATION_AUDIT_INSPECTION_READ_${code}`, cause === undefined ? undefined : { cause }); }
}

/** Returns only the compact inspection result and immutable result-artifact reference. */
export class VerificationAuditInspectionReadService {
  constructor(private readonly repository: VerifiedAuditInspectionReadPort) {}

  async getInspection(input: { tenantId: unknown; operationId: unknown }): Promise<VerificationAuditInspectionResource> {
    const tenant = UuidSchema.safeParse(input.tenantId), operation = UuidSchema.safeParse(input.operationId);
    if (!tenant.success || !operation.success) throw new VerificationAuditInspectionReadError("INVALID");
    const snapshot = await this.repository.loadVerifiedInspection(tenant.data, operation.data);
    if (snapshot.state !== "succeeded") throw new VerificationAuditInspectionReadError(snapshot.state === "pending" ? "PENDING" : snapshot.state === "cancelled" ? "CANCELLED" : "FAILED");
    try {
      const result = VerificationAuditInspectionOperationResultSchema.parse(snapshot.result);
      if (result.operationId !== operation.data || result.resultArtifact.tenantId !== tenant.data) throw new Error("BINDING");
      return deepFreeze(VerificationAuditInspectionResourceSchema.parse({
        verificationContractVersion: "verification.v1",
        tenantId: tenant.data,
        operationId: operation.data,
        requestDigest: result.requestDigest,
        resultArtifact: { artifactId: result.resultArtifact.artifactId, digest: result.resultArtifact.digest },
        output: result.output,
      }));
    } catch (error) {
      if (error instanceof VerificationAuditInspectionReadError) throw error;
      throw new VerificationAuditInspectionReadError("INTEGRITY", error);
    }
  }
}
