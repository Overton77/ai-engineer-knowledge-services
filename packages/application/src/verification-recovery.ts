import {
  VerificationFailureSetSchema, VerificationRecoveryBatchSchema, VerificationRecoveryBindingSchema,
  VerificationRecoveryPlanSchema, VerificationRecoveryReceiptSchema,
  VerificationRecoveryObservationSchema,
  VerificationRecoveryVerifiedResultSchema,
  VerificationRecoveryInvalidationSchema, VerificationRecoveryDependencyGraphSchema,
  type VerificationFailureSet, type VerificationRecoveryAction, type VerificationRecoveryBatch,
  type VerificationRecoveryBinding, type VerificationRecoveryItem, type VerificationRecoveryObservation,
  type VerificationRecoveryPlan, type VerificationRecoveryReceipt,
  type VerificationRecoveryInvalidation,
} from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, sha256Digest, type AuditBundleSignatureVerifier, type TrustedArtifactResolver } from "@aiengineer/knowledge-verification";
import { deepFreeze } from "@aiengineer/knowledge-domain";
import { compareVerifiedComponentVersions, type SealedAuditBundleArtifact } from "./verification-component-drift.js";

type Digest = `sha256:${string}`;
type Stage = VerificationRecoveryObservation["earliestStage"];
type Artifact = VerificationRecoveryObservation["diagnosticArtifacts"][number];
type BatchRef = { tenantId: string; batchId: string };
const stages: readonly Stage[] = ["capture", "parser", "selector", "mechanical", "semantic", "policy", "report"];
const passingSemantic = new Set(["directly_supported", "supported_with_qualification", "derived_verified"]);
const same = (left: unknown, right: unknown) => canonicalizeJson(left) === canonicalizeJson(right);
const digest = (value: unknown): Digest => sha256Digest(canonicalizeJson(value));
function fail(reason: string): never { throw new Error(`VERIFICATION_RECOVERY_${reason}`); }
const unique = (values: readonly string[]) => new Set(values).size === values.length;

/** These ports read authenticated immutable records. They never accept producer verdicts as authority. */
export interface VerificationRecoveryAuthority {
  now(): string;
  readBatch(input: BatchRef): Promise<VerificationRecoveryBatch>;
  readPlan(input: { tenantId: string; planDigest: string }): Promise<VerificationRecoveryPlan>;
  readInvalidation(input: { tenantId: string; caseId: string; planDigest: string }): Promise<VerificationRecoveryInvalidation>;
  readResult(input: { tenantId: string; inputDigest: string; operationId?: string }): Promise<VerificationRecoveryVerifiedResult | null>;
  readProbe(input: { tenantId: string; artifact: Artifact }): Promise<{
    tenantId: string; dependencyId: string; originalId: string; inputDigest: string;
    signature: string; passed: boolean; artifactDigest: string;
    operationId: string; calls: number; costMicros: number;
    caseId: string; recoveryPolicyVersion: string;
  }>;
}

export interface VerificationRecoveryVerifiedResult {
  tenantId: string;
  inputDigest: string;
  binding: VerificationRecoveryBinding;
  observation: VerificationRecoveryObservation;
  coveredRequirementIds: readonly string[];
  verifiedStages: readonly Stage[];
  revoked: boolean;
  usage: { calls: number; costMicros: number };
}

function classification(observation: VerificationRecoveryObservation): keyof VerificationFailureSet["counts"] {
  if (observation.execution === "pending") return "pending";
  if (observation.execution === "unknown") return "unknown";
  if (observation.execution === "cancelled") return "cancelled";
  if (observation.mechanical === "review_required" || observation.policy === "review" || observation.semantic === "mixed_or_conflicting") return "held";
  if (observation.mechanical === "passed" && observation.semantic && passingSemantic.has(observation.semantic)
    && (observation.policy === "pass" || observation.policy === "pass_with_warnings")) return "passed";
  return "failed";
}

function sealed<T extends object>(value: T): T & { payloadDigest: Digest } {
  return deepFreeze({ ...value, payloadDigest: digest(value) }) as T & { payloadDigest: Digest };
}

/** Freezes the complete authoritative batch, including unsuccessful and unfinished originals. */
export async function composeVerificationFailureSet(input: BatchRef & { authority: VerificationRecoveryAuthority }): Promise<VerificationFailureSet> {
  const reference = { tenantId: input.tenantId, batchId: input.batchId }, authority = input.authority;
  const batch = VerificationRecoveryBatchSchema.parse(structuredClone(await authority.readBatch(reference)));
  if (batch.tenantId !== reference.tenantId || batch.batchId !== reference.batchId) fail("BATCH_BINDING_MISMATCH");
  const counts = { submitted: batch.items.length, terminal: 0, passed: 0, failed: 0, held: 0, pending: 0, unknown: 0, cancelled: 0 };
  const dependencyFailures = new Map<string, number>();
  for (const item of batch.items) {
    if (digest(item.binding) !== item.inputDigest) fail("INPUT_BINDING_MISMATCH");
    const state = classification(item.observation);
    counts[state]++;
    if (state === "failed") for (const dependency of item.observation.dependencyIds) dependencyFailures.set(dependency, (dependencyFailures.get(dependency) ?? 0) + 1);
  }
  counts.terminal = counts.passed + counts.failed + counts.held + counts.cancelled;
  const failureRatio = counts.terminal ? counts.failed / counts.terminal : 0;
  const cohortTriage = (batch.closedAt !== undefined && counts.failed >= 5 && failureRatio >= 0.3)
    || [...dependencyFailures.values()].some(count => count >= 3)
    || batch.items.some(item => item.observation.family === "capture" || item.observation.family === "authorization");
  return deepFreeze(VerificationFailureSetSchema.parse(sealed({ schemaVersion: "verification-failure-set.v1" as const, batch, counts, questionDenominator: batch.questionIds.length, failureRatio, cohortTriage }))) as VerificationFailureSet;
}

async function authoritativeSet(set: VerificationFailureSet, authority: VerificationRecoveryAuthority): Promise<VerificationFailureSet> {
  const snapshot = VerificationFailureSetSchema.parse(structuredClone(set));
  const actual = await composeVerificationFailureSet({ tenantId: snapshot.batch.tenantId, batchId: snapshot.batch.batchId, authority });
  if (!same(snapshot, actual)) fail("FAILURE_SET_CHANGED");
  return actual;
}

function route(item: VerificationRecoveryItem, batch: VerificationRecoveryBatch, now: string): VerificationRecoveryAction["route"] {
  const state = classification(item.observation);
  if (state === "unknown" || state === "pending") return "reconcile";
  if (state === "cancelled") return "cancelled";
  if (state === "held") return "adjudicate";
  if (state === "passed") return "preserve";
  if (item.observation.family === "authorization" || item.observation.family === "policy" || item.observation.family === "execution") return "operator";
  if (item.observation.family === "contradicted") return "reject";
  if (item.observation.family === "disputed") return "adjudicate";
  if (item.usedRounds >= batch.limits.maxRoundsPerOriginal || Date.parse(now) >= Date.parse(batch.limits.deadline)
    || batch.limits.remainingCalls === 0 || batch.limits.remainingCostMicros === 0) return "exhausted";
  if (item.observation.family === "unsupported") return "gap";
  return "repair";
}

function requiredStages(item: VerificationRecoveryItem, binding: VerificationRecoveryBinding): Stage[] {
  let index = stages.indexOf(item.observation.earliestStage);
  if (!same(binding.captureDigests, item.binding.captureDigests)) index = 0;
  else if (!same(binding.evidence, item.binding.evidence)) index = Math.min(index, 2);
  if (!same(binding.claim, item.binding.claim)) index = Math.min(index, 4);
  return stages.slice(index);
}

function validateAction(input: { action: VerificationRecoveryAction; item: VerificationRecoveryItem; batch: VerificationRecoveryBatch; now: string }): void {
  const { action, item, batch, now } = input;
  const expected = route(item, batch, now);
  const changed = action.route === "repair" || action.route === "seek_evidence";
  const allowedAlternative = (expected === "repair" || expected === "gap") && ["repair", "seek_evidence", "gap", "operator"].includes(action.route);
  if (action.route !== expected && !allowedAlternative) fail("UNSAFE_ROUTE");
  if (!unique(action.rerunStages) || !unique(action.diagnosticArtifactIds)) fail("DUPLICATE_DIAGNOSTICS_OR_STAGES");
  const knownArtifacts = item.observation.diagnosticArtifacts.map(artifact => artifact.artifactId);
  if (action.diagnosticArtifactIds.some(id => !knownArtifacts.includes(id))) fail("DIAGNOSTIC_BINDING_MISMATCH");
  if (!changed) {
    if (action.newBinding || action.rerunStages.length) fail("NON_REPAIR_MUTATION");
    return;
  }
  if (!batch.allowedActions.includes(action.route as "repair" | "seek_evidence")) fail("CAPABILITY_REQUIRED");
  if (!action.newBinding || action.diagnosticArtifactIds.length === 0) fail("REPAIR_EVIDENCE_REQUIRED");
  if (action.newBinding.policyDigest !== item.binding.policyDigest || action.newBinding.profileDigest !== item.binding.profileDigest) fail("POLICY_OR_PROFILE_CHANGE");
  const newDigest = digest(action.newBinding);
  if (!unique(action.newBinding.captureDigests) || !unique(action.newBinding.claim.qualifiers)) fail("DUPLICATE_BINDING_MEMBER");
  const unchanged = same(action.newBinding.claim, item.binding.claim) && same(action.newBinding.evidence, item.binding.evidence)
    && same([...action.newBinding.captureDigests].sort(), [...item.binding.captureDigests].sort());
  if (unchanged) fail("NO_OP_OR_REPEATED_INPUT");
  if (newDigest === item.inputDigest || item.attemptedInputDigests.includes(newDigest)) fail("NO_OP_OR_REPEATED_INPUT");
  const repairDigest = digest({ originalId: item.originalId, binding: action.newBinding });
  if (item.attemptedRepairDigests.includes(repairDigest)) fail("REPEATED_REPAIR");
  if (!same(action.rerunStages, requiredStages(item, action.newBinding))) fail("DEPENDENT_STAGES_REQUIRED");
}

async function validateProbes(input: { actions: VerificationRecoveryAction[]; probes: VerificationRecoveryPlan["probes"]; set: VerificationFailureSet; authority: VerificationRecoveryAuthority }): Promise<VerificationRecoveryPlan["probeExecutions"]> {
  const { actions, probes, set, authority } = input;
  const executions: VerificationRecoveryPlan["probeExecutions"] = [];
  for (const probe of probes) {
    const group = set.batch.items.filter(item => item.observation.dependencyIds.includes(probe.dependencyId) && classification(item.observation) === "failed");
    if (!group.length || !unique(probe.representativeIds) || probe.representativeIds.some(id => !group.some(item => item.originalId === id))) fail("PROBE_GROUP_MISMATCH");
    const signatures = new Set(group.map(item => item.observation.signature));
    const representatives = group.filter(item => probe.representativeIds.includes(item.originalId));
    if ([...signatures].some(signature => !representatives.some(item => item.observation.signature === signature))) fail("PROBE_SIGNATURE_MISSING");
    const control = set.batch.items.find(item => classification(item.observation) === "passed" && !item.observation.dependencyIds.includes(probe.dependencyId));
    const selectedControl = set.batch.items.find(item => item.originalId === probe.controlId);
    if (control && (!selectedControl || classification(selectedControl.observation) !== "passed" || selectedControl.observation.dependencyIds.includes(probe.dependencyId))) fail("PROBE_CONTROL_REQUIRED");
    if (set.batch.limits.maxProbeRounds < 1 || (set.batch.probeRounds.find(row => row.dependencyId === probe.dependencyId)?.used ?? 0) > set.batch.limits.maxProbeRounds) fail("PROBE_LIMIT");
    const expectedIds = [...probe.representativeIds, ...(selectedControl ? [selectedControl.originalId] : [])];
    const prior = set.batch.probeRounds.find(row => row.dependencyId === probe.dependencyId);
    if (prior && prior.used > 0 && !same([...prior.receiptDigests].sort(), probe.receiptArtifacts.map(artifact => artifact.digest).sort())) fail("PROBE_ROUND_RESET");
    const seen = new Set<string>();
    for (const artifact of probe.receiptArtifacts) {
      const receipt = structuredClone(await authority.readProbe({ tenantId: set.batch.tenantId, artifact }));
      const item = set.batch.items.find(row => row.originalId === receipt.originalId);
      const action = actions.find(row => row.originalId === receipt.originalId);
      const expectedDigest = action?.newBinding ? digest(action.newBinding) : item?.inputDigest;
      if (!item || !expectedIds.includes(item.originalId) || seen.has(item.originalId) || receipt.tenantId !== set.batch.tenantId
        || receipt.dependencyId !== probe.dependencyId || receipt.artifactDigest !== artifact.digest || receipt.inputDigest !== expectedDigest
        || receipt.signature !== item.observation.signature || !receipt.passed) fail("PROBE_NOT_VERIFIED");
      if (receipt.caseId !== set.batch.caseId || receipt.recoveryPolicyVersion !== set.batch.recoveryPolicyVersion) fail("PROBE_AUTHORITY_MISMATCH");
      executions.push({ operationId: receipt.operationId, calls: receipt.calls, costMicros: receipt.costMicros, previouslyAccounted: (prior?.used ?? 0) > 0 });
      seen.add(item.originalId);
    }
    if (seen.size !== expectedIds.length) fail("PROBE_RECEIPT_MISSING");
  }
  for (const action of actions.filter(row => row.newBinding)) {
    const item = set.batch.items.find(row => row.originalId === action.originalId)!;
    const shared = item.observation.dependencyIds.filter(id => set.batch.items.filter(row => row.observation.dependencyIds.includes(id) && classification(row.observation) === "failed").length >= 3);
    if (shared.some(id => !probes.some(probe => probe.dependencyId === id))) fail("SHARED_PROBE_REQUIRED");
    if (action.dependencyId && !item.observation.dependencyIds.includes(action.dependencyId)) fail("DEPENDENCY_BINDING_MISMATCH");
  }
  return executions;
}

export async function admitVerificationRecoveryPlan(input: {
  failureSet: VerificationFailureSet;
  actions: VerificationRecoveryAction[];
  probes: VerificationRecoveryPlan["probes"];
  reservation: VerificationRecoveryPlan["reservation"];
  authority: VerificationRecoveryAuthority;
}): Promise<VerificationRecoveryPlan> {
  const proposal = structuredClone({ failureSet: input.failureSet, actions: input.actions, probes: input.probes, reservation: input.reservation });
  const authority = input.authority;
  const set = await authoritativeSet(proposal.failureSet, authority), batch = set.batch;
  const plan = VerificationRecoveryPlanSchema.parse(sealed({
    schemaVersion: "verification-recovery-plan.v1" as const, tenantId: batch.tenantId, caseId: batch.caseId,
    parentAttemptId: batch.parentAttemptId, recoveryPolicyVersion: batch.recoveryPolicyVersion,
    failureSetDigest: set.payloadDigest, actions: proposal.actions, probes: proposal.probes, reservation: proposal.reservation, probeExecutions: [],
    leaseKeys: [...batch.items.map(item => `${batch.tenantId}:${item.inputDigest}:${batch.recoveryPolicyVersion}`), ...proposal.probes.map(probe => `${batch.tenantId}:dependency:${probe.dependencyId}:${batch.recoveryPolicyVersion}`)],
    stopRules: ["no_new_information", "repeated_input", "limits_exhausted"] as const,
  }));
  if (plan.actions.length !== batch.items.length || plan.actions.some(action => !batch.items.some(item => item.originalId === action.originalId))) fail("ORIGINAL_ITEMS_REQUIRED");
  const now = authority.now();
  if (!Number.isFinite(Date.parse(now))) fail("CLOCK_INVALID");
  for (const action of plan.actions) validateAction({ action, item: batch.items.find(item => item.originalId === action.originalId)!, batch, now });
  const repairCount = plan.actions.filter(action => action.newBinding).length;
  if (plan.reservation.calls > batch.limits.remainingCalls || plan.reservation.costMicros > batch.limits.remainingCostMicros || plan.reservation.calls < repairCount) fail("BUDGET_EXCEEDED");
  const probeExecutions = await validateProbes({ actions: plan.actions, probes: plan.probes, set, authority });
  const probeCalls = new Map(probeExecutions.filter(row => !row.previouslyAccounted).map(row => [row.operationId, row]));
  if ([...probeCalls.values()].reduce((sum, row) => sum + row.calls, 0) > plan.reservation.calls
    || [...probeCalls.values()].reduce((sum, row) => sum + row.costMicros, 0) > plan.reservation.costMicros) fail("PROBE_BUDGET_EXCEEDED");
  const { payloadDigest: _initialDigest, ...unsigned } = plan;
  return deepFreeze(VerificationRecoveryPlanSchema.parse(sealed({ ...unsigned, probeExecutions }))) as VerificationRecoveryPlan;
}

function validateResult(input: { result: VerificationRecoveryVerifiedResult; tenantId: string; binding: VerificationRecoveryBinding; operationId?: string }): void {
  const { result, tenantId, binding, operationId } = input;
  VerificationRecoveryVerifiedResultSchema.parse(result);
  const parsedBinding = VerificationRecoveryBindingSchema.parse(result.binding);
  VerificationRecoveryObservationSchema.parse(result.observation);
  if (result.tenantId !== tenantId || !same(parsedBinding, binding) || result.inputDigest !== digest(binding)
    || (operationId && result.observation.operationId !== operationId)
    || result.observation.diagnosticArtifacts.some(artifact => artifact.tenantId !== tenantId)) fail("RESULT_BINDING_MISMATCH");
  if (result.observation.execution === "completed" && (!result.observation.runId || !result.observation.diagnosticArtifacts.length)) fail("RESULT_PROOF_REQUIRED");
  if (classification(result.observation) === "passed" && ["mechanical", "semantic", "policy"].some(stage => !result.verifiedStages.includes(stage as Stage))) fail("RESULT_PROOF_REQUIRED");
  if (!unique(result.coveredRequirementIds) || !unique(result.verifiedStages)
    || !Number.isSafeInteger(result.usage.calls) || result.usage.calls < 0 || !Number.isSafeInteger(result.usage.costMicros) || result.usage.costMicros < 0) fail("RESULT_ACCOUNTING_INVALID");
}

function coveredRequirements(input: { result: VerificationRecoveryVerifiedResult | null; item: VerificationRecoveryItem; batch: VerificationRecoveryBatch }): string[] {
  const { result, item, batch } = input;
  if (!result || result.revoked || classification(result.observation) !== "passed") return [];
  return batch.requirements.filter(requirement => item.questionIds.includes(requirement.questionId)
    && result.coveredRequirementIds.includes(requirement.requirementId)
    && (!requirement.historicalCaptureDigest || result.binding.captureDigests.includes(requirement.historicalCaptureDigest))).map(row => row.requirementId);
}

function questionCoverage(batch: VerificationRecoveryBatch, requirements: readonly string[]): string[] {
  return batch.questionIds.filter(id => batch.requirements.filter(row => row.questionId === id).every(row => requirements.includes(row.requirementId)));
}

function resultOutcome(input: { action: VerificationRecoveryAction; result: VerificationRecoveryVerifiedResult | null; covered: string[]; required: string[]; limitReached: boolean }): VerificationRecoveryReceipt["results"][number]["outcome"] {
  const { action, result, covered, required, limitReached } = input;
  if (action.route === "adjudicate") return "review_required";
  if (action.route === "reject") return "resolved_rejected";
  if (action.route === "cancelled") return "cancelled";
  if (action.route === "exhausted") return "exhausted";
  if (action.route === "gap") return "unresolved_gap";
  if (action.route === "operator") return "operator_required";
  if (!result) return "reconciliation_unresolved";
  const state = classification(result.observation);
  if (state === "cancelled") return "cancelled";
  if (state === "held") return "review_required";
  if (state === "pending" || state === "unknown") return "reconciliation_unresolved";
  if (result.revoked) return "operator_required";
  if (state === "failed") {
    if (result.observation.family === "contradicted") return "resolved_rejected";
    if (["authorization", "policy", "execution"].includes(result.observation.family)) return "operator_required";
    return limitReached ? "exhausted" : "unresolved_gap";
  }
  if (required.some(id => !covered.includes(id))) return "partial_support";
  return action.newBinding ? "recovered_admitted" : "preserved_admitted";
}

/** Reconciles actual independent receipts; producer-proposed success/coverage fields are not accepted. */
export async function reconcileVerificationRecoveryReceipt(input: { failureSet: VerificationFailureSet; plan: VerificationRecoveryPlan; authority: VerificationRecoveryAuthority }): Promise<VerificationRecoveryReceipt> {
  const snapshot = structuredClone({ failureSet: input.failureSet, plan: input.plan }), authority = input.authority;
  const set = await authoritativeSet(snapshot.failureSet, authority);
  const plan = VerificationRecoveryPlanSchema.parse(structuredClone(await authority.readPlan({ tenantId: set.batch.tenantId, planDigest: snapshot.plan.payloadDigest })));
  const { payloadDigest: planDigest, ...planBody } = plan;
  if (!same(plan, snapshot.plan) || digest(planBody) !== planDigest || plan.failureSetDigest !== set.payloadDigest
    || plan.tenantId !== set.batch.tenantId || plan.caseId !== set.batch.caseId) fail("PLAN_BINDING_MISMATCH");
  const invalidation = validateInvalidation(structuredClone(await authority.readInvalidation({ tenantId: plan.tenantId, caseId: plan.caseId, planDigest })));
  if (invalidation.tenantId !== plan.tenantId || invalidation.caseId !== plan.caseId || invalidation.planDigest !== planDigest) fail("INVALIDATION_BINDING_MISMATCH");
  const batch = set.batch, results: VerificationRecoveryReceipt["results"] = [], previousCoverage: string[] = [];
  const charged = new Map(plan.probeExecutions.filter(row => !row.previouslyAccounted).map(row => [row.operationId, { calls: row.calls, costMicros: row.costMicros }]));
  for (const item of batch.items) {
    const action = plan.actions.find(row => row.originalId === item.originalId)!;
    const original = await authority.readResult({ tenantId: batch.tenantId, inputDigest: item.inputDigest, operationId: item.observation.operationId });
    const before = original ? structuredClone(original) : null;
    if (before) validateResult({ result: before, tenantId: batch.tenantId, binding: item.binding, operationId: item.observation.operationId });
    if (classification(item.observation) === "passed") previousCoverage.push(...coveredRequirements({ result: before, item, batch }));
    const loaded = action.newBinding ? await authority.readResult({ tenantId: batch.tenantId, inputDigest: digest(action.newBinding) }) : before;
    const result = loaded ? structuredClone(loaded) : null;
    if (result) {
      validateResult({ result, tenantId: batch.tenantId, binding: action.newBinding ?? item.binding });
      if (action.newBinding && action.rerunStages.some(stage => !result.verifiedStages.includes(stage))) fail("INDEPENDENT_REVERIFICATION_REQUIRED");
      if (action.newBinding && result.observation.operationId === item.observation.operationId) fail("CHANGED_INPUT_OPERATION_REUSED");
      if (action.newBinding) {
        const existing = charged.get(result.observation.operationId);
        if (existing && !same(existing, result.usage)) fail("USAGE_RECEIPT_CONFLICT");
        charged.set(result.observation.operationId, result.usage);
      }
    }
    const required = batch.requirements.filter(row => item.questionIds.includes(row.questionId)).map(row => row.requirementId);
    const canCredit = ["preserve", "reconcile", "repair", "seek_evidence"].includes(action.route);
    const covered = canCredit ? coveredRequirements({ result, item, batch }) : [];
    const changedDigest = action.newBinding ? digest(action.newBinding) : undefined;
    const limitReached = item.usedRounds + (changedDigest ? 1 : 0) >= batch.limits.maxRoundsPerOriginal
      || Date.parse(authority.now()) >= Date.parse(batch.limits.deadline);
    const outcome = resultOutcome({ action, result, covered, required, limitReached });
    results.push({
      originalId: item.originalId, originalInputDigest: item.inputDigest,
      ...(result ? { outputInputDigest: result.inputDigest } : {}),
      outcome, questionIds: item.questionIds,
      coveredRequirementIds: covered, gapRequirementIds: required.filter(id => !covered.includes(id)),
      artifacts: result?.observation.diagnosticArtifacts ?? item.observation.diagnosticArtifacts,
      usedRounds: item.usedRounds + (changedDigest ? 1 : 0),
      attemptedInputDigests: [...item.attemptedInputDigests, ...(changedDigest ? [changedDigest] : [])],
      attemptedRepairDigests: [...item.attemptedRepairDigests, ...(action.newBinding ? [digest({ originalId: item.originalId, binding: action.newBinding })] : [])],
      ...(["review_required", "operator_required", "reconciliation_unresolved"].includes(outcome) ? { pendingReference: result?.observation.operationId ?? item.observation.operationId } : {}),
    });
  }
  const usage = [...charged.values()].reduce((sum, row) => ({ calls: sum.calls + row.calls, costMicros: sum.costMicros + row.costMicros }), { calls: 0, costMicros: 0 });
  if (usage.calls > plan.reservation.calls || usage.costMicros > plan.reservation.costMicros) fail("ACTUAL_USAGE_EXCEEDED");
  const unresolvedRepair = results.some(row => row.outcome === "reconciliation_unresolved" && plan.actions.find(action => action.originalId === row.originalId)?.newBinding);
  const retainedReservation = unresolvedRepair ? { calls: plan.reservation.calls - usage.calls, costMicros: plan.reservation.costMicros - usage.costMicros } : { calls: 0, costMicros: 0 };
  const coveredQuestionIdsAfter = questionCoverage(batch, results.flatMap(row => row.coveredRequirementIds));
  const receipt = VerificationRecoveryReceiptSchema.parse(sealed({
    schemaVersion: "verification-recovery-receipt.v1" as const, tenantId: batch.tenantId, caseId: batch.caseId,
    failureSetDigest: set.payloadDigest, planDigest: plan.payloadDigest,
    questionIds: batch.questionIds, questionDenominator: batch.questionIds.length, results,
    coveredQuestionIdsBefore: questionCoverage(batch, previousCoverage), coveredQuestionIdsAfter,
    remainingQuestionIds: batch.questionIds.filter(id => !coveredQuestionIdsAfter.includes(id)),
    invalidatedOutputIds: invalidation.invalidatedOutputIds, revalidatedOutputIds: invalidation.revalidatedOutputIds,
    invalidationDigest: invalidation.payloadDigest, invalidationObservationDigests: invalidation.evaluations.map(row => row.observation.payloadDigest), usage, retainedReservation,
    remainingLimits: { ...batch.limits, remainingCalls: batch.limits.remainingCalls - usage.calls - retainedReservation.calls, remainingCostMicros: batch.limits.remainingCostMicros - usage.costMicros - retainedReservation.costMicros },
    checkpointReferences: results.flatMap(row => row.pendingReference ? [row.pendingReference] : []),
    probeRounds: [...batch.probeRounds.filter(row => !plan.probes.some(probe => probe.dependencyId === row.dependencyId)), ...plan.probes.map(probe => ({ dependencyId: probe.dependencyId, used: Math.max(1, batch.probeRounds.find(row => row.dependencyId === probe.dependencyId)?.used ?? 0), receiptDigests: probe.receiptArtifacts.map(artifact => artifact.digest) }))],
  }));
  return deepFreeze(receipt) as VerificationRecoveryReceipt;
}

export interface VerificationRecoveryDependencyGraph {
  tenantId: string; caseId: string; planDigest: string; baselineAuditDigest: string;
  nodes: readonly { id: string; dependencyIds: readonly string[]; admissionAuditDigest: string; revoked: boolean; revalidatedStages: readonly Stage[] }[];
  rootIds: readonly string[];
}

function invalidationClosure(evaluation: VerificationRecoveryInvalidation["evaluations"][number]) {
  const { observation, graph } = evaluation;
  if (graph.tenantId !== observation.tenantId || graph.baselineAuditDigest !== observation.baseline.auditBundleArtifact.digest || !unique(graph.nodes.map(row => row.id))) fail("DEPENDENCY_GRAPH_BINDING");
  const { payloadDigest: observationDigest, ...observationBody } = observation;
  const dimensions = ["provider", "model", "parser", "grader", "policy"] as const;
  if (digest(observationBody) !== observationDigest || !same(observation.changedDimensions, dimensions.filter(key => observation.baselineComponents[key] !== observation.candidateComponents[key]))) fail("DRIFT_OBSERVATION_BINDING");
  const ids = new Set(graph.nodes.map(node => node.id));
  if (graph.rootIds.some(id => !ids.has(id)) || graph.nodes.some(node => node.dependencyIds.some(id => !ids.has(id)))) fail("DEPENDENCY_GRAPH_INCOMPLETE");
  const affected = new Set<string>(graph.nodes.filter(node => node.revoked).map(node => node.id));
  if (observation.changedDimensions.length) for (const id of graph.rootIds) affected.add(id);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of graph.nodes) if (!affected.has(node.id) && node.dependencyIds.some(id => affected.has(id))) { affected.add(node.id); grew = true; }
  }
  const earliest = observation.changedDimensions.includes("parser") ? "parser" : observation.changedDimensions.some(key => ["provider", "model", "grader"].includes(key)) ? "semantic" : "policy";
  const required = stages.slice(stages.indexOf(earliest));
  const blocked = new Set(graph.nodes.filter(node => affected.has(node.id) && (node.revoked || node.admissionAuditDigest !== observation.candidate.auditBundleArtifact.digest || required.some(stage => !node.revalidatedStages.includes(stage)))).map(node => node.id));
  grew = true;
  while (grew) {
    grew = false;
    for (const node of graph.nodes) if (!blocked.has(node.id) && node.dependencyIds.some(id => blocked.has(id))) { blocked.add(node.id); grew = true; }
  }
  return { invalidatedOutputIds: [...affected], revalidatedOutputIds: [...affected].filter(id => !blocked.has(id)), blockedOutputIds: [...blocked] };
}

function combineInvalidations(evaluations: VerificationRecoveryInvalidation["evaluations"]) {
  const closures = evaluations.map(invalidationClosure);
  const all = (key: keyof ReturnType<typeof invalidationClosure>) => [...new Set(closures.flatMap(closure => closure[key]))].sort();
  const blockedOutputIds = all("blockedOutputIds");
  return { invalidatedOutputIds: all("invalidatedOutputIds"), revalidatedOutputIds: all("revalidatedOutputIds").filter(id => !blockedOutputIds.includes(id)), blockedOutputIds };
}

function validateInvalidation(value: VerificationRecoveryInvalidation): VerificationRecoveryInvalidation {
  const record = VerificationRecoveryInvalidationSchema.parse(value);
  const { payloadDigest, ...body } = record;
  if (digest(body) !== payloadDigest || record.evaluations.some(row => row.observation.tenantId !== record.tenantId
    || row.graph.caseId !== record.caseId || row.graph.planDigest !== record.planDigest)) fail("INVALIDATION_BINDING_MISMATCH");
  const expected = combineInvalidations(record.evaluations);
  if (!same(expected.invalidatedOutputIds, record.invalidatedOutputIds) || !same(expected.revalidatedOutputIds, record.revalidatedOutputIds)
    || !same(expected.blockedOutputIds, record.blockedOutputIds)) fail("INVALIDATION_CLOSURE_MISMATCH");
  return record;
}

/** Registration-ready trusted closure. Receipt composition consumes it; publication adapters enforce its gate. */
export async function evaluateVerificationRecoveryInvalidation(input: {
  caseId: string; planDigest: string;
  baseline: SealedAuditBundleArtifact; candidate: SealedAuditBundleArtifact;
  createResolver: () => TrustedArtifactResolver; verifier: AuditBundleSignatureVerifier;
  readDependencyGraph: (input: { tenantId: string; caseId: string; planDigest: string; baselineAuditDigest: string }) => Promise<VerificationRecoveryDependencyGraph>;
}): Promise<VerificationRecoveryInvalidation> {
  const snapshot = structuredClone({ baseline: input.baseline, candidate: input.candidate, caseId: input.caseId, planDigest: input.planDigest });
  const readGraph = input.readDependencyGraph;
  const observation = await compareVerifiedComponentVersions({ baseline: snapshot.baseline, candidate: snapshot.candidate, createResolver: input.createResolver, verifier: input.verifier });
  const graph = VerificationRecoveryDependencyGraphSchema.parse(structuredClone(await readGraph({ tenantId: observation.tenantId, caseId: snapshot.caseId, planDigest: snapshot.planDigest, baselineAuditDigest: observation.baseline.auditBundleArtifact.digest })));
  const evaluations = VerificationRecoveryInvalidationSchema.shape.evaluations.parse([{ observation: structuredClone(observation), graph }]);
  const record = sealed({ schemaVersion: "verification-recovery-invalidation.v1" as const, tenantId: observation.tenantId,
    caseId: snapshot.caseId, planDigest: snapshot.planDigest, complete: true as const, evaluations, ...combineInvalidations(evaluations) });
  return deepFreeze(validateInvalidation(record)) as VerificationRecoveryInvalidation;
}
