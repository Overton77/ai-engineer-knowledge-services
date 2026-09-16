import {
  VerificationClaimsOperationResultSchema, VerificationReportOperationResultSchema,
  VerificationPolicyDefinitionSchema, VerificationPolicyDecisionSchema, VerificationRecoveryVerifiedResultSchema,
  VerificationRecoveryInvalidationSchema,
  type VerificationRecoveryBinding, type VerificationRecoveryObservation, type VerificationArtifactHandle,
} from "@aiengineer/knowledge-contracts";
import type { DurableRecoveryEvidenceAuthority } from "@aiengineer/knowledge-application";
import type { PostgresCanonicalRepository, PostgresClaimsReportReadRepository } from "@aiengineer/knowledge-persistence";
import { canonicalizeJson, digestCanonicalJson, validateRecordedPolicyInputsArtifact, type VerificationAuditBundle } from "@aiengineer/knowledge-verification";
import { evaluateVerificationPolicy } from "@aiengineer/knowledge-policy";
import { assertSameArtifact, validateStoredArtifact, type ArtifactCustody } from "../store-custody.js";

export interface CanonicalRecoveryBinding {
  originalId: string;
  binding: VerificationRecoveryBinding;
  coveredRequirementIds?: readonly string[];
}

const same = (left: unknown, right: unknown) => canonicalizeJson(left) === canonicalizeJson(right);

/** Native terminal ownership/signature checks remain in the canonical read repository. */
export function createCanonicalRecoveryResultReader(input: {
  tenantId: string;
  database: Pick<PostgresCanonicalRepository, "transaction">;
  reads: Pick<PostgresClaimsReportReadRepository, "loadVerifiedClaimsReport">;
  custody: ArtifactCustody;
  binding(reference: { operationId: string; inputDigest: string; originalId?: string }): Promise<CanonicalRecoveryBinding | null>;
}): DurableRecoveryEvidenceAuthority["readResult"] {
  async function hydrate(handle: VerificationArtifactHandle) {
    const value = await input.custody.resolve(handle.artifactId);
    if (!value) throw new Error("RECOVERY_NATIVE_ARTIFACT_UNAVAILABLE");
    assertSameArtifact(handle, validateStoredArtifact(input.tenantId, value.handle, value.bytes));
    return { bytes: value.bytes, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(value.bytes)) as unknown };
  }
  return async request => {
    if (request.tenantId !== input.tenantId) throw new Error("RECOVERY_NATIVE_TENANT_DENIED");
    if (!request.operationId) return null;
    const original = await input.binding({ operationId: request.operationId, inputDigest: request.inputDigest, originalId: request.originalId });
    if (!original) return null;
    if (request.originalId !== undefined && original.originalId !== request.originalId) throw new Error("RECOVERY_NATIVE_ORIGINAL_MISMATCH");
    if (digestCanonicalJson(original.binding) !== request.inputDigest) throw new Error("RECOVERY_NATIVE_INPUT_MISMATCH");
    const terminal = await input.reads.loadVerifiedClaimsReport(input.tenantId, request.operationId);
    if (terminal.state !== "succeeded") return null;
    const result = VerificationClaimsOperationResultSchema.or(VerificationReportOperationResultSchema).parse(terminal.result);
    if (result.operationId !== request.operationId) throw new Error("RECOVERY_NATIVE_OPERATION_MISMATCH");
    const audit = (await hydrate(result.output.sealedRun.manifestArtifact)).value as VerificationAuditBundle;
    const bundle = audit.verificationBundle;
    const deterministic = result.output.verified.deterministicResult;
    const policy = VerificationPolicyDefinitionSchema.parse((await hydrate(audit.policyBinding.policyArtifact)).value);
    const recordedBytes = await hydrate(audit.policyBinding.recordedPolicyInputsArtifact);
    const recorded = validateRecordedPolicyInputsArtifact({ handle: audit.policyBinding.recordedPolicyInputsArtifact,
      bytes: recordedBytes.bytes, bundle, deterministicResult: deterministic,
      runId: result.output.sealedRun.runId, policyVersion: policy.policyVersion });
    const decisions = audit.manifest.outputArtifacts.filter(handle => handle.digest === audit.policyDecisionDigest);
    if (decisions.length !== 1) throw new Error("RECOVERY_NATIVE_POLICY_DECISION_REQUIRED");
    const decisionArtifact = decisions[0]!;
    const decision = VerificationPolicyDecisionSchema.parse((await hydrate(decisionArtifact)).value);
    if (audit.policyBinding.policyArtifact.digest !== original.binding.policyDigest || decision.overrideApplied
      || !same(evaluateVerificationPolicy(policy, recorded), decision)) throw new Error("RECOVERY_NATIVE_POLICY_MISMATCH");
    const claim = bundle.assertions.find(row => row.assertionId === original.originalId);
    const mechanical = deterministic.assertions.find(row => row.assertionId === original.originalId);
    const judgment = recorded.assertions.find(row => row.assertionId === original.originalId)?.semantic;
    const outcome = decision.assertionOutcomes.find(row => row.assertionId === original.originalId);
    if (!claim || !mechanical || !judgment || !outcome) throw new Error("RECOVERY_NATIVE_MEMBER_MISSING");
    const expected = { claim: { statement: claim.proposition, qualifiers: claim.qualifiers,
      ...(claim.value !== undefined ? { value: claim.value } : {}) },
      evidence: claim.evidence.map(edge => {
        const capture = bundle.captures.find(row => row.captureId === edge.fragment.captureId);
        if (!capture || capture.contentArtifact.artifactId !== edge.fragment.representationArtifactId) throw new Error("RECOVERY_NATIVE_CAPTURE_MISMATCH");
        return { representationDigest: capture.contentArtifact.digest, selector: edge.fragment.selector };
      }) };
    if (!same(expected, { claim: original.binding.claim,
      evidence: original.binding.evidence.map(({ representationDigest, selector }) => ({ representationDigest, selector })) })) {
      throw new Error("RECOVERY_NATIVE_INPUT_MISMATCH");
    }
    if (judgment.judgeIdentities.length) {
      const profiles = audit.manifest.inputArtifacts.filter(artifact => artifact.digest === original.binding.profileDigest);
      if (profiles.length !== 1) throw new Error("RECOVERY_NATIVE_PROFILE_REQUIRED");
      const profile = (await hydrate(profiles[0]!)).value as { schemaVersion?: unknown; identity?: unknown };
      if (profile.schemaVersion !== "verification-semantic-judge-profile.v1" || judgment.judgeIdentities.length !== 1
        || !same(profile.identity, judgment.judgeIdentities[0])) throw new Error("RECOVERY_NATIVE_PROFILE_MISMATCH");
    }
    const usage = await canonicalUsage(input.database, input.tenantId, request.operationId,
      recorded.assertions.some(row => row.semantic.judgeIdentities.length > 0));
    if (!usage) return null;
    const unresolved = mechanical.evidence.filter(edge => edge.status !== "passed");
    const family = recoveryFamily(mechanical.status, judgment.verdict, outcome.outcome,
      unresolved.some(edge => edge.resolution.status !== "resolved"));
    let reportAbsence = false;
    try { await assertCanonicalUnadmitted(input.database, input.tenantId, [request.operationId]); reportAbsence = true; }
    catch (error) { if (!(error instanceof Error) || error.message !== "RECOVERY_HOST_DEPENDENCY_CLOSURE_REQUIRED") throw error; }
    return VerificationRecoveryVerifiedResultSchema.parse({ tenantId: input.tenantId,
      inputDigest: request.inputDigest, binding: original.binding,
      observation: { operationId: request.operationId, runId: result.output.sealedRun.runId, execution: "completed",
        mechanical: mechanical.status, semantic: judgment.verdict, policy: outcome.outcome, family,
        earliestStage: family === "selector" ? "selector" : family === "mechanical" ? "mechanical" : family === "policy" ? "policy" : "semantic",
        signature: digestCanonicalJson({ family, checks: mechanical.checks.filter(check => check.status !== "passed").map(check => check.code).sort(),
          resolutions: unresolved.map(edge => edge.resolution.status).sort(), reasons: [...outcome.reasonCodes].sort() }),
        dependencyIds: [...new Set(original.binding.evidence.map(edge => `representation:${edge.representationDigest}`))],
        diagnosticArtifacts: [result.resultArtifact, result.output.sealedRun.manifestArtifact,
          audit.policyBinding.policyArtifact, audit.policyBinding.recordedPolicyInputsArtifact, decisionArtifact] },
      coveredRequirementIds: mechanical.status === "passed" && ["directly_supported", "supported_with_qualification"].includes(judgment.verdict)
        && ["pass", "pass_with_warnings"].includes(outcome.outcome) ? [...(original.coveredRequirementIds ?? [])] : [],
      verifiedStages: ["selector", "mechanical", "policy",
        ...(judgment.judgeIdentities.length ? ["semantic"] : []), ...(reportAbsence ? ["report"] : [])],
      revoked: false, usage });
  };
}

/** A dispatched or uncertain provider attempt never becomes zero-cost evidence. */
export async function canonicalUsage(database: Pick<PostgresCanonicalRepository, "transaction">,
  tenantId: string, operationId: string, hasSemanticJudges: boolean) {
  const rows = await database.transaction(tenantId, async client => (await client.query<{
    state: string; actual_cost_micros: string | number | null;
  }>("select state,actual_cost_micros from orchestration.verification_provider_attempt where tenant_id=$1 and operation_id=$2 order by id limit 10001",
  [tenantId, operationId])).rows);
  if (rows.length > 10000 || rows.some(row => row.state !== "settled" || row.actual_cost_micros === null)) return null;
  // The native worker reserves before every provider dispatch. An authenticated deterministic-only
  // terminal with no provider attempts is the only absence that establishes zero calls.
  if (!rows.length && hasSemanticJudges) return null;
  const costs = rows.map(row => Number(row.actual_cost_micros));
  if (costs.some(cost => !Number.isSafeInteger(cost) || cost < 0)) throw new Error("RECOVERY_NATIVE_USAGE_INVALID");
  const costMicros = costs.reduce((sum, cost) => sum + cost, 0);
  if (!Number.isSafeInteger(costMicros) || costMicros < 0) throw new Error("RECOVERY_NATIVE_USAGE_INVALID");
  return { calls: rows.length, costMicros };
}

function recoveryFamily(mechanical: string, semantic: string, policy: string, selectorFailed: boolean): VerificationRecoveryObservation["family"] {
  if (selectorFailed) return "selector";
  if (mechanical === "failed") return "mechanical";
  if (semantic === "contradicted") return "contradicted";
  if (semantic === "mixed_or_conflicting") return "disputed";
  if (semantic === "pending_semantic_review") return "policy";
  if (["not_supported", "insufficient_evidence", "unverifiable", "context_only", "partially_supported"].includes(semantic)) return "unsupported";
  return policy === "pass" || policy === "pass_with_warnings" ? "none" : "policy";
}

/** Conservative pre-admission closure only. Admitted claims or downstream content require the full P5 graph owner. */
export async function canonicalUnadmittedClosure(input: { database: Pick<PostgresCanonicalRepository, "transaction">;
  tenantId: string; caseId: string; planDigest: string; operationIds: readonly string[] }) {
  await assertCanonicalUnadmitted(input.database, input.tenantId, input.operationIds);
  const body = { schemaVersion: "verification-recovery-invalidation.v1" as const, tenantId: input.tenantId,
    caseId: input.caseId, planDigest: input.planDigest, complete: true as const, evaluations: [],
    invalidatedOutputIds: [], revalidatedOutputIds: [], blockedOutputIds: [] };
  return VerificationRecoveryInvalidationSchema.parse({ ...body, payloadDigest: digestCanonicalJson(body) });
}

async function assertCanonicalUnadmitted(database: Pick<PostgresCanonicalRepository, "transaction">,
  tenantId: string, operationIds: readonly string[]) {
  if (!operationIds.length || operationIds.length > 1536) throw new Error("RECOVERY_HOST_DEPENDENCY_SCOPE_INVALID");
  const requested = [...new Set(operationIds)];
  const result = await database.transaction(tenantId, async client => (await client.query<{ dependent: boolean; known_operations: number }>(
    `with recursive runs as (
      select id,run_manifest_artifact_id,bundle_artifact_id,deterministic_result_artifact_id
      from evidence.verification_run where tenant_id=$1 and operation_id=any($2::uuid[])
    ), roots as (
      select unnest(array[run_manifest_artifact_id,bundle_artifact_id,deterministic_result_artifact_id]) id from runs
    ), descendants(id) as (
      select id from roots where id is not null
      union select e.from_artifact_id from orchestration.artifact_lineage e join descendants d on e.to_artifact_id=d.id where e.tenant_id=$1
    ) select (
      exists(select 1 from evidence.claim_evidence_assessment a join runs r on r.id=a.run_id where a.tenant_id=$1)
      or exists(select 1 from evidence.verification_finding f join runs r on r.id=f.run_id where f.tenant_id=$1 and f.claim_id is not null)
      or exists(select 1 from research.report_assessment a join runs r on r.id=a.verification_run_id where a.tenant_id=$1)
      or exists(select 1 from research.report_assertion_claim a where a.tenant_id=$1 and
        (a.run_id in (select id::text from runs) or a.evidence_manifest_artifact_id in (select id from descendants)))
      or exists(select 1 from research.report_artifact a where a.tenant_id=$1 and a.artifact_id in (select id from descendants))
      or exists(select 1 from descendants d join orchestration.artifact a on a.id=d.id and a.tenant_id=$1
        left join orchestration.verification_artifact_metadata m on m.tenant_id=a.tenant_id and m.artifact_id=a.id
        where a.artifact_type not in ('verification_bundle','deterministic_verification_result','verification_policy_inputs','verification_policy_decision','verification_run_manifest')
        and coalesce(m.producer_activity_id,'') not like 'knowledge:verification-recovery:%')
    ) dependent, (select count(*)::int from knowledge_service.operation
      where tenant_id=$1 and id=any($2::uuid[]) and operation_kind in ('verification_claims','verification_report')) known_operations`,
    [tenantId, requested])).rows[0]);
  if (!result || result.known_operations !== requested.length) throw new Error("RECOVERY_HOST_OPERATION_AUTHORITY_REQUIRED");
  if (!result || result.dependent !== false) throw new Error("RECOVERY_HOST_DEPENDENCY_CLOSURE_REQUIRED");
}
