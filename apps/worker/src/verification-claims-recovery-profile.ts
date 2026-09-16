import { SemanticJudgeProfileCatalog } from "@aiengineer/knowledge-application";
import { VerificationRecoveryBatchSchema, VerificationRecoveryPlanSchema, VerificationArtifactHandleSchema } from "@aiengineer/knowledge-contracts";
import type { PostgresCanonicalRepository, PostgresVerificationRepository } from "@aiengineer/knowledge-persistence";
import { canonicalizeJson, digestCanonicalJson, sha256Digest } from "@aiengineer/knowledge-verification";
import { z } from "zod";

const authoritySchema = z.object({ schemaVersion: z.literal("verification-recovery-native-authorization.v1"),
  claimsArtifactDigest: z.string(), batch: VerificationRecoveryBatchSchema });
const equal = (left: unknown, right: unknown) => canonicalizeJson(left) === canonicalizeJson(right);

/** A repair inherits only the exact profile already authorized by the host for its original operation. */
export async function recoverySemanticProfiles(input: {
  database: Pick<PostgresCanonicalRepository, "transaction" | "getOperationRecord">;
  repository: Pick<PostgresVerificationRepository, "createTrustedArtifactResolver">;
  profiles: SemanticJudgeProfileCatalog; tenantId: string; operationId: string; host: "claims" | "report";
}): Promise<SemanticJudgeProfileCatalog> {
  try { input.profiles.resolve(input.tenantId, input.operationId, input.host); return input.profiles; }
  catch (error) { if (!(error instanceof Error) || error.message !== "SEMANTIC_PROFILE_GRANT_REQUIRED") throw error; }
  const rows = await input.database.transaction(input.tenantId, async client => (await client.query<{
    execution_id: string; original_id: string; case_id: string; input_digest: string; plan_digest: string;
    request_digest: string | null; state: string; case_state: string; authority_handle: unknown;
    plan_value: unknown; plan_artifact: unknown;
  }>(`select e.execution_id,e.original_id,e.case_id,e.input_digest,e.plan_digest,e.request_digest,e.state,
    c.state case_state,c.authority_handle,r.payload plan_value,r.artifact_handle plan_artifact
    from knowledge_service.recovery_execution e join knowledge_service.recovery_case c on c.tenant_id=e.tenant_id and c.case_id=e.case_id
    join knowledge_service.recovery_revision r on r.tenant_id=e.tenant_id and r.case_id=e.case_id and r.kind='plan' and r.idempotency_key=e.plan_digest
    where e.tenant_id=$1 and e.planned_operation_id=$2 limit 2`, [input.tenantId, input.operationId])).rows);
  if (rows.length !== 1) throw new Error("SEMANTIC_RECOVERY_EXECUTION_REQUIRED");
  const row = rows[0]!;
  if (row.state === "authorized") throw new Error("VERIFICATION_CLAIMS_INFRASTRUCTURE_FAILURE");
  if (row.state !== "linked" || row.case_state !== "active") throw new Error("SEMANTIC_RECOVERY_EXECUTION_INACTIVE");
  async function retained(value: unknown) {
    const handle = VerificationArtifactHandleSchema.parse(value), resolver = input.repository.createTrustedArtifactResolver();
    if (handle.tenantId !== input.tenantId) throw new Error("SEMANTIC_RECOVERY_ARTIFACT_TENANT");
    await resolver.authorizeArtifact({ tenantId: input.tenantId, artifactId: handle.artifactId, purpose: "verification_admission" });
    const loaded = await resolver.hydrateRegisteredArtifact({ tenantId: input.tenantId, artifactId: handle.artifactId });
    if (!equal(loaded.registration, handle) || loaded.bytes.byteLength !== handle.byteLength || sha256Digest(loaded.bytes) !== handle.digest) {
      throw new Error("SEMANTIC_RECOVERY_ARTIFACT_DRIFT");
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(loaded.bytes)) as unknown;
  }
  const authority = authoritySchema.parse(await retained(row.authority_handle));
  const plan = VerificationRecoveryPlanSchema.parse(await retained(row.plan_artifact));
  const { payloadDigest, ...planBody } = plan;
  if (!equal(plan, row.plan_value) || digestCanonicalJson(planBody) !== payloadDigest || payloadDigest !== row.plan_digest
    || plan.tenantId !== input.tenantId || plan.caseId !== row.case_id || authority.batch.tenantId !== input.tenantId
    || authority.batch.caseId !== row.case_id || Date.parse(authority.batch.limits.deadline) <= Date.now()) {
    throw new Error("SEMANTIC_RECOVERY_PLAN_AUTHORITY");
  }
  const original = authority.batch.items.find(item => item.originalId === row.original_id);
  const action = plan.actions.find(item => item.originalId === row.original_id);
  const withoutSelectors = (binding: NonNullable<typeof action>["newBinding"]) => binding && ({ ...binding,
    evidence: binding.evidence.map(({ selector: _, ...evidence }) => evidence) });
  if (!original || !action?.newBinding || action.route !== "repair" || digestCanonicalJson(action.newBinding) !== row.input_digest
    || digestCanonicalJson(original.binding) !== original.inputDigest || !equal(withoutSelectors(action.newBinding), withoutSelectors(original.binding))
    || action.newBinding.profileDigest !== original.binding.profileDigest || action.newBinding.policyDigest !== original.binding.policyDigest) {
    throw new Error("SEMANTIC_RECOVERY_PROFILE_CHANGED");
  }
  const operation = await input.database.getOperationRecord(input.tenantId, input.operationId);
  const originalOperation = await input.database.getOperationRecord(input.tenantId, original.observation.operationId);
  if (!operation || !originalOperation || operation.operationKind !== "verification_claims" || input.host !== "claims"
    || originalOperation.operationKind !== operation.operationKind || operation.idempotencyKey !== `recovery:${row.execution_id}`
    || row.request_digest !== `sha256:${operation.requestSha256}` || digestCanonicalJson(operation.request) !== row.request_digest) {
    throw new Error("SEMANTIC_RECOVERY_OPERATION_BINDING");
  }
  const originalRequest = z.object({ input: z.object({ request: z.object({ assertions: z.object({ digest: z.string() }) }) }) }).parse(originalOperation.request);
  if (originalRequest.input.request.assertions.digest !== authority.claimsArtifactDigest
    || digestCanonicalJson(originalOperation.request) !== `sha256:${originalOperation.requestSha256}`) throw new Error("SEMANTIC_RECOVERY_ORIGINAL_BINDING");
  const grants = input.profiles.resolve(input.tenantId, original.observation.operationId, input.host);
  if (grants.length !== 1 || grants[0]!.profileArtifact.digest !== original.binding.profileDigest) throw new Error("SEMANTIC_RECOVERY_PROFILE_CHANGED");
  return new SemanticJudgeProfileCatalog(grants.map(grant => ({ ...grant, operationId: input.operationId })));
}
