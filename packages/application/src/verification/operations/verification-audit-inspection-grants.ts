import { InspectAuditBundleRequestSchema, Sha256DigestSchema, UuidSchema, type InspectAuditBundleRequest } from "@aiengineer/knowledge-contracts";
import { z } from "zod";

const grantSchema = z.strictObject({
  tenantId: UuidSchema,
  auditArtifact: z.strictObject({ artifactId: UuidSchema, digest: Sha256DigestSchema }),
  /** Current native replay composition is deliberately bounded to these two run families. */
  runKind: z.enum(["claims", "report"]),
});
const grantsSchema = z.array(grantSchema).min(1).max(256);
export type VerificationAuditInspectionGrant = z.infer<typeof grantSchema>;

const key = (tenantId: string, artifactId: string, digest: string) => `${tenantId}:${artifactId}:${digest}`;

/** Server-owned allowlist for exact signed audit artifacts. */
export class VerificationAuditInspectionGrantCatalog {
  readonly #grants: ReadonlyMap<string, VerificationAuditInspectionGrant>;

  constructor(value: unknown) {
    const grants = grantsSchema.parse(value);
    const indexed = new Map<string, VerificationAuditInspectionGrant>();
    for (const grant of grants) {
      const grantKey = key(grant.tenantId, grant.auditArtifact.artifactId, grant.auditArtifact.digest);
      if (indexed.has(grantKey)) throw new Error("VERIFICATION_AUDIT_INSPECTION_DUPLICATE_GRANT");
      indexed.set(grantKey, Object.freeze(grant));
    }
    this.#grants = indexed;
  }

  resolve(tenantIdValue: unknown, requestValue: unknown): VerificationAuditInspectionGrant {
    const tenantId = UuidSchema.parse(tenantIdValue);
    const request: InspectAuditBundleRequest = InspectAuditBundleRequestSchema.parse(requestValue);
    const grant = this.#grants.get(key(tenantId, request.auditBundle.artifactId, request.auditBundle.digest));
    if (!grant) throw new Error("VERIFICATION_AUDIT_INSPECTION_GRANT_REQUIRED");
    return grant;
  }

  admits(tenantId: unknown, request: unknown): boolean {
    try { this.resolve(tenantId, request); return true; }
    catch (error) {
      if (error instanceof Error && error.message === "VERIFICATION_AUDIT_INSPECTION_GRANT_REQUIRED") return false;
      throw error;
    }
  }
}
