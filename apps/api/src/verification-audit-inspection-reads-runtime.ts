import { VerificationAuditInspectionReadService } from "@aiengineer/knowledge-application";
import { PostgresAuditInspectionReadRepository, PostgresVerificationRepository, type PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { UuidSchema, type Actor } from "@aiengineer/knowledge-contracts";
import { createVerificationOperationReadAuthorizer } from "./verification-ownership.js";

export function createVerificationAuditInspectionReads(database: PostgresCanonicalRepository | undefined, environment: Readonly<Record<string, string | undefined>>) {
  const enabled = environment.VERIFICATION_AUDIT_INSPECTION_READS_ENABLED?.trim();
  if (!enabled || enabled === "0") return undefined;
  if (enabled !== "1") throw new Error("VERIFICATION_AUDIT_INSPECTION_READS_ENABLED_INVALID");
  const projectUrl = environment.SUPABASE_URL?.trim(), serviceRoleKey = environment.SUPABASE_SECRET_KEY?.trim(), grants = environment.VERIFICATION_SERVICE_OWNERSHIP_GRANTS_JSON?.trim();
  if (!database || !projectUrl || !serviceRoleKey || !grants) throw new Error("AUDIT_INSPECTION_READS_STORAGE_AND_OWNERSHIP_REQUIRED");
  const authorize = createVerificationOperationReadAuthorizer(database, grants, ["verification_audit_bundle"]);
  const store = new SupabaseArtifactStore({ projectUrl, serviceRoleKey, bucket: environment.VERIFICATION_STORAGE_BUCKET?.trim() || "ai-engineer-cloud-bucket", maximumBytes: 1_000_000 });
  return { async getInspection(input: { tenantId: string; operationId: string; actor: Actor }) {
    const scoped = { tenantId: UuidSchema.parse(input.tenantId), operationId: UuidSchema.parse(input.operationId), actor: structuredClone(input.actor) };
    if (!await authorize(scoped)) throw Object.assign(new Error("AUDIT_INSPECTION_NOT_FOUND"), { code: "NOT_FOUND" });
    const repository = new PostgresVerificationRepository(database, store, { async authorize(request) {
      if (request.tenantId !== scoped.tenantId || request.purpose !== "verification_replay") throw new Error("AUDIT_INSPECTION_READ_DENIED");
    } });
    return new VerificationAuditInspectionReadService(new PostgresAuditInspectionReadRepository(database, () => repository.createTrustedArtifactResolver())).getInspection(scoped);
  } };
}
