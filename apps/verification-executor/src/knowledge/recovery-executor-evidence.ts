import {
  DeterministicVerificationResultSchema, VerificationBundleSchema, VerificationPolicyDecisionSchema,
  VerificationPolicyDefinitionSchema, VerificationRecoveryVerifiedResultSchema,
  type VerificationArtifactHandle, type VerificationRecoveryBinding, type VerificationRecoveryObservation,
} from "@aiengineer/knowledge-contracts";
import type { DurableRecoveryEvidenceAuthority } from "@aiengineer/knowledge-application";
import { evaluateVerificationPolicy } from "@aiengineer/knowledge-policy";
import { canonicalizeJson, digestCanonicalJson, validateRecordedPolicyInputsArtifact } from "@aiengineer/knowledge-verification";
import { validateStoredArtifact, type ArtifactCustody } from "../store-custody.js";

/** A canonical operation receipt supplies these immutable IDs; mutable run state is not a receipt. */
export interface RecoveryExecutorOperation {
  tenantId: string; operationId: string; runId: string; originalId: string; binding: VerificationRecoveryBinding;
  artifacts: { bundle: string; result: string; policy: string; inputs: string; decision: string };
  usage: { calls: number; costMicros: number } | null;
}

const equal = (left: unknown, right: unknown) => canonicalizeJson(left) === canonicalizeJson(right);
const supported = new Set(["directly_supported", "supported_with_qualification", "derived_verified"]);

/** Reconstructs failure causes from executor-owned bytes; callers cannot submit verdicts or spending. */
export function createExecutorRecoveryResultReader(input: {
  tenantId: string; custody: ArtifactCustody;
  lookupOperation(reference: { tenantId: string; operationId: string; inputDigest: string; originalId?: string }): Promise<RecoveryExecutorOperation | null>;
}): DurableRecoveryEvidenceAuthority["readResult"] {
  async function artifact(id: string, activity: string) {
    const resolved = await input.custody.resolve(id);
    if (!resolved || resolved.handle.artifactId !== id) throw new Error("RECOVERY_EXECUTOR_ARTIFACT_UNAVAILABLE");
    const handle = validateStoredArtifact(input.tenantId, resolved.handle, resolved.bytes);
    if (handle.producerActivityId !== `verification-executor:${activity}` || handle.producerVersion !== "knowledge-verification-executor.v1") {
      throw new Error("RECOVERY_EXECUTOR_PRODUCER_MISMATCH");
    }
    return { handle, bytes: resolved.bytes, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(resolved.bytes)) as unknown };
  }
  return async request => {
    if (request.tenantId !== input.tenantId) throw new Error("RECOVERY_EXECUTOR_TENANT_DENIED");
    if (!request.operationId) return null;
    const operation = await input.lookupOperation({ ...request, operationId: request.operationId });
    if (!operation) return null;
    if (request.originalId !== undefined && operation.originalId !== request.originalId) throw new Error("RECOVERY_EXECUTOR_ORIGINAL_MISMATCH");
    if (operation.tenantId !== request.tenantId || operation.operationId !== request.operationId || digestCanonicalJson(operation.binding) !== request.inputDigest) throw new Error("RECOVERY_EXECUTOR_OPERATION_MISMATCH");
    // Unknown paid usage remains unresolved and cannot be converted to zero during reconciliation.
    if (!operation.usage) return null;
    const [bundleArtifact, resultArtifact, policyArtifact, inputsArtifact, decisionArtifact] = await Promise.all([
      artifact(operation.artifacts.bundle, "compile_claims"), artifact(operation.artifacts.result, "verify_claims"),
      artifact(operation.artifacts.policy, "policy_definition"), artifact(operation.artifacts.inputs, "policy_inputs"),
      artifact(operation.artifacts.decision, "evaluate_policy"),
    ]);
    const bundle = VerificationBundleSchema.parse(bundleArtifact.value);
    const result = DeterministicVerificationResultSchema.parse(resultArtifact.value);
    const policy = VerificationPolicyDefinitionSchema.parse(policyArtifact.value);
    const recorded = validateRecordedPolicyInputsArtifact({ handle: inputsArtifact.handle, bytes: inputsArtifact.bytes,
      bundle, deterministicResult: result, runId: operation.runId, policyVersion: policy.policyVersion });
    const decision = VerificationPolicyDecisionSchema.parse(decisionArtifact.value);
    const hasParents = (handle: VerificationArtifactHandle, parents: VerificationArtifactHandle[]) => parents.every(parent => handle.parentArtifactIds.includes(parent.artifactId));
    if (policyArtifact.handle.digest !== operation.binding.policyDigest || recorded.runId !== operation.runId
      || recorded.policyVersion !== policy.policyVersion || bundle.policyVersion !== policy.policyVersion
      || !equal(recorded.deterministicResult, result) || !equal(evaluateVerificationPolicy(policy, recorded), decision)
      || decision.overrideApplied || !hasParents(resultArtifact.handle, [bundleArtifact.handle])
      || !hasParents(inputsArtifact.handle, [resultArtifact.handle])
      || !hasParents(decisionArtifact.handle, [resultArtifact.handle, policyArtifact.handle, inputsArtifact.handle])) {
      throw new Error("RECOVERY_EXECUTOR_LINEAGE_MISMATCH");
    }
    const assertion = bundle.assertions.filter(row => row.assertionId === operation.originalId);
    const mechanical = result.assertions.filter(row => row.assertionId === operation.originalId);
    const semantic = recorded.assertions.filter(row => row.assertionId === operation.originalId);
    const outcomes = decision.assertionOutcomes.filter(row => row.assertionId === operation.originalId);
    if ([assertion, mechanical, semantic, outcomes].some(rows => rows.length !== 1)) throw new Error("RECOVERY_EXECUTOR_MEMBER_MISSING");
    const claim = assertion[0]!;
    if (!equal(operation.binding.claim, { statement: claim.proposition, qualifiers: claim.qualifiers, ...(claim.value !== undefined ? { value: claim.value } : {}) })
      || claim.evidence.length !== operation.binding.evidence.length) throw new Error("RECOVERY_EXECUTOR_INPUT_MISMATCH");
    for (const [index, edge] of claim.evidence.entries()) {
      const captured = bundle.captures.find(row => row.captureId === edge.fragment.captureId);
      const bound = operation.binding.evidence[index]!;
      if (!captured || captured.contentArtifact.artifactId !== edge.fragment.representationArtifactId || captured.contentArtifact.digest !== bound.representationDigest
        || !equal(edge.fragment.selector, bound.selector)) throw new Error("RECOVERY_EXECUTOR_INPUT_MISMATCH");
    }
    const judgment = semantic[0]!.semantic;
    if (judgment.judgeIdentities.length > 0) {
      const semanticParents = inputsArtifact.handle.parentArtifactIds.filter(id => id !== resultArtifact.handle.artifactId);
      if (semanticParents.length !== 1) throw new Error("RECOVERY_EXECUTOR_SEMANTIC_ARTIFACT_REQUIRED");
      const source = await artifact(semanticParents[0]!, "judge_semantics");
      const body = source.value as { schemaVersion?: unknown; runId?: unknown; assessments?: unknown };
      if (body.schemaVersion !== "verification-semantic-assessments.v1" || body.runId !== operation.runId
        || !source.handle.parentArtifactIds.includes(resultArtifact.handle.artifactId) || !Array.isArray(body.assessments)) {
        throw new Error("RECOVERY_EXECUTOR_SEMANTIC_LINEAGE_MISMATCH");
      }
      const matching = body.assessments.filter((assessment: unknown) => typeof assessment === "object" && assessment !== null
        && "assertionId" in assessment && assessment.assertionId === operation.originalId);
      if (matching.length !== 1 || !equal(matching[0], judgment)) throw new Error("RECOVERY_EXECUTOR_SEMANTIC_RECORD_MISMATCH");
    }
    if (supported.has(judgment.verdict) && (judgment.judgeIdentities.length === 0 || judgment.disposition !== "admit"
      || (claim.value !== undefined && judgment.assertionValueDigest !== digestCanonicalJson(claim.value)))) {
      throw new Error("RECOVERY_EXECUTOR_SEMANTIC_AUTHORITY_MISSING");
    }
    const checks = mechanical[0]!.checks.filter(check => check.status !== "passed").map(check => check.code);
    const unresolved = mechanical[0]!.evidence.filter(edge => edge.status !== "passed");
    const family = failureFamily({ mechanical: mechanical[0]!.status, semantic: judgment.verdict, policy: outcomes[0]!.outcome,
      selectorFailed: unresolved.some(edge => edge.resolution.status !== "resolved") });
    const earliestStage = family === "selector" ? "selector" : family === "mechanical" ? "mechanical" : family === "policy" ? "policy" : "semantic";
    return VerificationRecoveryVerifiedResultSchema.parse({ tenantId: request.tenantId, inputDigest: request.inputDigest, binding: operation.binding,
      observation: { operationId: operation.operationId, runId: operation.runId, execution: "completed", mechanical: mechanical[0]!.status,
        semantic: judgment.verdict, policy: outcomes[0]!.outcome, family, earliestStage,
        signature: digestCanonicalJson({ family, checks: checks.sort(), resolutions: unresolved.map(edge => edge.resolution.status).sort(), reasons: [...outcomes[0]!.reasonCodes].sort() }),
        dependencyIds: [...new Set(operation.binding.evidence.map(edge => `representation:${edge.representationDigest}`))],
        diagnosticArtifacts: [bundleArtifact.handle, resultArtifact.handle, policyArtifact.handle, inputsArtifact.handle, decisionArtifact.handle] },
      // Successful claim checks alone do not establish original-question scope coverage.
      coveredRequirementIds: [], verifiedStages: ["mechanical", "policy", ...(judgment.judgeIdentities.length ? ["semantic"] : [])],
      revoked: false, usage: operation.usage,
    });
  };
}

function failureFamily(input: { mechanical: string; semantic: string; policy: string; selectorFailed: boolean }): VerificationRecoveryObservation["family"] {
  if (input.selectorFailed) return "selector";
  if (input.mechanical === "failed") return "mechanical";
  if (input.semantic === "contradicted") return "contradicted";
  if (input.semantic === "mixed_or_conflicting") return "disputed";
  if (input.semantic === "pending_semantic_review") return "policy";
  if (["not_supported", "insufficient_evidence", "unverifiable", "context_only", "partially_supported"].includes(input.semantic)) return "unsupported";
  if (input.policy !== "pass" && input.policy !== "pass_with_warnings") return "policy";
  return "none";
}
