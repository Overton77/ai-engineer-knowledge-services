import {
  DurableRecoveryClaimSchema, DurableRecoveryExecutionSchema, DurableRecoveryUsageSchema,
  VerificationRecoveryBatchSchema, VerificationRecoveryReceiptSchema, VerificationRecoveryPlanSchema, VerificationRecoveryVerifiedResultSchema, VerificationFailureSetSchema,
  type DurableRecoveryCase, type DurableRecoveryClaim, type DurableRecoveryExecution, type DurableRecoveryRevision,
  type DurableRecoveryUsage, type VerificationArtifactHandle, type VerificationFailureSet, type VerificationRecoveryAction,
  type VerificationRecoveryPlan,
} from "@aiengineer/knowledge-contracts";
import { canonicalizeJson, digestCanonicalJson } from "@aiengineer/knowledge-verification";
import { deterministicUuid } from "@aiengineer/knowledge-runtime";
import { composeVerificationFailureSet, admitVerificationRecoveryPlan, reconcileVerificationRecoveryReceipt,
  type VerificationRecoveryAuthority } from "./verification-recovery.js";
import type { DurableRecoveryCheckpoints, DurableRecoveryCustody, DurableRecoveryEvidenceAuthority,
  DurableRecoveryRuntime, DurableRecoveryStore, RecoveryRevisionInput } from "./verification-recovery-durable-ports.js";

function equal(left: unknown, right: unknown, reason: string): void {
  if (canonicalizeJson(left) !== canonicalizeJson(right)) throw new Error(reason);
}

/** Durable admission and accounting around P1.4. This service never calls a semantic provider. */
export class DurableVerificationRecoveryService {
  constructor(private readonly store: DurableRecoveryStore, private readonly evidence: DurableRecoveryEvidenceAuthority,
    private readonly custody: DurableRecoveryCustody, private readonly runtime: DurableRecoveryRuntime,
    private readonly checkpoints: DurableRecoveryCheckpoints) {}

  async open(tenantId: string, request: { batchId: string; notificationId: string }): Promise<DurableRecoveryCase> {
    const initial = await this.evidence.readInitialBatch({ tenantId, batchId: request.batchId });
    const batch = VerificationRecoveryBatchSchema.parse(initial.batch);
    if (batch.tenantId !== tenantId || batch.batchId !== request.batchId || !batch.items.length) throw new Error("RECOVERY_INITIAL_AUTHORITY_BINDING");
    await this.custody.read({ tenantId, artifact: initial.authorityArtifact });
    const artifact = await this.persist(tenantId, "batch", batch, [initial.authorityArtifact, ...batch.items.flatMap(item => item.observation.diagnosticArtifacts)], batch.caseId);
    await this.store.open({ tenantId, batch, authorityArtifact: initial.authorityArtifact, batchArtifact: artifact, notificationId: request.notificationId });
    return this.ingestDrift(tenantId, { caseId: batch.caseId, notificationId: request.notificationId, artifact });
  }

  async read(tenantId: string, caseId: string): Promise<DurableRecoveryCase> {
    const current = await this.store.read(tenantId, caseId);
    await this.custody.read({ tenantId, artifact: current.initialAuthorityArtifact });
    for (const revision of current.revisions) {
      equal(await this.custody.read({ tenantId, artifact: revision.artifact }), revision.value, "RECOVERY_REVISION_CUSTODY_MISMATCH");
    }
    return current;
  }

  async ingestDrift(tenantId: string, request: { caseId: string; notificationId: string; artifact: VerificationArtifactHandle }): Promise<DurableRecoveryCase> {
    const current = await this.read(tenantId, request.caseId);
    const value = await this.custody.read({ tenantId, artifact: request.artifact });
    const entry = await this.entry(tenantId, "notification", value, [request.artifact], request.notificationId);
    return this.store.append({ tenantId, caseId: request.caseId, expectedRevision: current.revision, entries: [entry] });
  }

  async plan(tenantId: string, request: { caseId: string; expectedRevision: number; actions: VerificationRecoveryAction[];
    probes: VerificationRecoveryPlan["probes"]; reservation: DurableRecoveryUsage }): Promise<DurableRecoveryCase> {
    const current = await this.read(tenantId, request.caseId);
    if (current.revision !== request.expectedRevision || current.state !== "ready") throw new Error("RECOVERY_PLAN_STATE_CONFLICT");
    await this.projectLatestCandidates(current);
    const lastPlanRevision = current.revisions.filter(row => row.kind === "plan").at(-1)?.revision ?? 0;
    if (current.revisions.some(row => row.kind === "resume" && row.revision > lastPlanRevision)) {
      for (const original of current.batch.items) {
        const initial = current.initialBatch.items.find(item => item.originalId === original.originalId)!;
        if (original.inputDigest !== initial.inputDigest) continue;
        const observed = await this.evidence.readResult({ tenantId, inputDigest: original.inputDigest, operationId: original.observation.operationId });
        if (!observed) continue;
        if (observed.tenantId !== tenantId || observed.inputDigest !== original.inputDigest || observed.observation.operationId !== original.observation.operationId) throw new Error("RECOVERY_RESUME_RESULT_BINDING");
        equal(observed.binding, original.binding, "RECOVERY_RESUME_RESULT_BINDING");
        original.observation = observed.observation;
      }
    }
    const authority = this.authority(current);
    const failureSet = await composeVerificationFailureSet({ tenantId, batchId: current.batch.batchId, authority });
    const plan = await admitVerificationRecoveryPlan({ failureSet, actions: request.actions, probes: request.probes, reservation: request.reservation, authority });
    const parent = current.revisions.at(-1)!.artifact;
    const failure = await this.entry(tenantId, "failure_set", failureSet, [parent, ...failureSet.batch.items.flatMap(item => item.observation.diagnosticArtifacts)], failureSet.payloadDigest);
    const planned = await this.entry(tenantId, "plan", plan, [failure.artifact, ...plan.probes.flatMap(probe => probe.receiptArtifacts)], plan.payloadDigest);
    return this.store.append({ tenantId, caseId: request.caseId, expectedRevision: request.expectedRevision,
      entries: [failure, planned], state: "active", activePlanDigest: plan.payloadDigest });
  }

  async claim(tenantId: string, request: { caseId: string; planDigest: string; holderIdentity: string; leaseMs: number }): Promise<DurableRecoveryClaim> {
    const current = await this.read(tenantId, request.caseId);
    if (current.state !== "active" || current.activePlanDigest !== request.planDigest || !current.latestPlan) throw new Error("RECOVERY_PLAN_NOT_ACTIVE");
    const retainedFailureSet = current.revisions.find(row => row.kind === "failure_set" && row.idempotencyKey === current.latestPlan!.failureSetDigest);
    const failureSet = VerificationFailureSetSchema.parse(retainedFailureSet?.value);
    if (failureSet.payloadDigest !== current.latestPlan.failureSetDigest) throw new Error("RECOVERY_FAILURE_SET_BINDING");
    const keys = [...new Set([
      ...current.initialBatch.items.map(item => `original:${digestCanonicalJson({ operationId: item.observation.operationId, inputDigest: item.inputDigest })}`),
      ...[...current.initialBatch.items, ...failureSet.batch.items].flatMap(item => item.observation.dependencyIds.map(id => `dependency:${digestCanonicalJson(id)}`)),
    ])].sort();
    return this.store.claim({ tenantId, ...request, keys });
  }

  async execute(tenantId: string, request: { claim: DurableRecoveryClaim; originalId: string; reservation: DurableRecoveryUsage }): Promise<DurableRecoveryExecution> {
    const claim = DurableRecoveryClaimSchema.parse(request.claim);
    if (claim.tenantId !== tenantId) throw new Error("RECOVERY_TENANT_MISMATCH");
    const current = await this.read(tenantId, claim.caseId);
    const plan = current.latestPlan;
    const action = plan?.actions.find(row => row.originalId === request.originalId);
    if (!plan || plan.payloadDigest !== claim.planDigest || !action?.newBinding) throw new Error("RECOVERY_EXECUTION_NOT_ADMITTED");
    const repairDigest = digestCanonicalJson({ originalId: request.originalId, binding: action.newBinding });
    const identity = `${tenantId}:${claim.caseId}:${request.originalId}:${repairDigest}`;
    const execution = DurableRecoveryExecutionSchema.parse({
      executionId: deterministicUuid("recovery-execution.v1", identity), tenantId, caseId: claim.caseId,
      originalId: request.originalId, planDigest: claim.planDigest, repairDigest, inputDigest: digestCanonicalJson(action.newBinding),
      plannedOperationId: deterministicUuid("recovery-operation.v1", identity), reservation: DurableRecoveryUsageSchema.parse(request.reservation),
      state: "authorized", authorizationToken: deterministicUuid("recovery-authorization.v1", identity), claimToken: claim.token, claimFence: claim.fencingToken,
    });
    const authorized = await this.store.reserve({ claim, execution });
    if (authorized.operationId) return authorized;
    const operation = await this.runtime.ensureOperation({ execution: authorized, binding: action.newBinding, rerunStages: action.rerunStages,
      idempotencyKey: `recovery:${authorized.executionId}` });
    if (operation.operationId !== authorized.plannedOperationId) throw new Error("RECOVERY_OPERATION_IDENTITY_CONFLICT");
    return this.store.link({ tenantId, executionId: authorized.executionId, ...operation });
  }

  async reconcile(tenantId: string, request: { caseId: string; planDigest: string }): Promise<DurableRecoveryCase> {
    const current = await this.read(tenantId, request.caseId);
    const planRevision = current.revisions.find(row => row.kind === "plan" && row.idempotencyKey === request.planDigest);
    if (!planRevision) throw new Error("RECOVERY_PLAN_NOT_FOUND");
    const plan = planRevision.value as VerificationRecoveryPlan;
    const failureSet = current.revisions.find(row => row.kind === "failure_set" && row.idempotencyKey === plan.failureSetDigest)?.value as VerificationFailureSet | undefined;
    if (!failureSet) throw new Error("RECOVERY_FAILURE_SET_NOT_FOUND");
    if (plan.actions.some(action => action.newBinding && !current.executions.some(execution => execution.planDigest === plan.payloadDigest && execution.originalId === action.originalId))) {
      throw new Error("RECOVERY_EXECUTION_AUTHORIZATION_REQUIRED");
    }
    for (const execution of current.executions.filter(row => row.planDigest === request.planDigest && row.state !== "settled")) {
      let linked = execution;
      if (!linked.operationId) {
        const action = plan.actions.find(item => item.originalId === linked.originalId);
        if (!action?.newBinding) throw new Error("RECOVERY_ORIGINAL_ACTION_MISSING");
        const operation = await this.runtime.ensureOperation({ execution: linked, binding: action.newBinding,
          rerunStages: action.rerunStages, idempotencyKey: `recovery:${linked.executionId}` });
        linked = await this.store.link({ tenantId, executionId: linked.executionId, ...operation });
      }
      if (linked.operationId && linked.requestDigest) await this.runtime.reconcile({ tenantId, operationId: linked.operationId, requestDigest: linked.requestDigest });
    }
    const refreshed = await this.store.read(tenantId, request.caseId);
    const settlements = new Map<string, DurableRecoveryUsage>();
    const authority = this.authority(refreshed, failureSet, plan, settlements);
    const receipt = await reconcileVerificationRecoveryReceipt({ failureSet, plan, authority });
    const invalidation = await authority.readInvalidation({ tenantId, caseId: request.caseId, planDigest: request.planDigest });
    const invalidated = await this.entry(tenantId, "invalidation", invalidation, [planRevision.artifact], invalidation.payloadDigest,
      invalidation.evaluations.flatMap(evaluation => [evaluation.observation.baseline.auditBundleArtifact.artifactId, evaluation.observation.candidate.auditBundleArtifact.artifactId]));
    const completed = await this.entry(tenantId, "receipt", receipt, [planRevision.artifact, invalidated.artifact,
      ...receipt.results.flatMap(row => row.artifacts)], receipt.payloadDigest);
    return this.store.settle({ tenantId, ...request, receipt, entries: [invalidated, completed], expectedRevision: refreshed.revision, settlements: [...settlements].map(([executionId, usage]) => ({ executionId, usage })) });
  }

  async wait(tenantId: string, request: { caseId: string; expectedRevision: number; checkpointId: string; reason: string }): Promise<DurableRecoveryCase> {
    const current = await this.read(tenantId, request.caseId);
    if (!request.reason.trim()) throw new Error("RECOVERY_WAIT_REASON_REQUIRED");
    const checkpoint = await this.checkpoints.verify({ tenantId, caseId: request.caseId, checkpointId: request.checkpointId });
    if (checkpoint.checkpointId !== request.checkpointId) throw new Error("RECOVERY_CHECKPOINT_BINDING");
    await this.custody.read({ tenantId, artifact: checkpoint.artifact });
    const value = { schemaVersion: "recovery-wait.v1", caseId: request.caseId, checkpointId: request.checkpointId,
      reason: request.reason, revision: current.revision, batch: current.batch, executions: current.executions,
      receipt: current.latestReceipt ?? null, plan: current.latestPlan ?? null,
      originalExecutionStates: current.batch.items.map(item => ({ originalId: item.originalId,
        executions: current.executions.filter(execution => execution.originalId === item.originalId).map(execution => ({ executionId: execution.executionId, state: execution.state })) })),
      reserved: current.reserved, spent: current.spent };
    const entry = await this.entry(tenantId, "wait", value, [current.revisions.at(-1)!.artifact, checkpoint.artifact], digestCanonicalJson(value));
    return this.store.append({ tenantId, caseId: request.caseId, expectedRevision: request.expectedRevision,
      entries: [{ ...entry, checkpointId: request.checkpointId }], state: "waiting", releaseClaims: true });
  }

  async resume(tenantId: string, request: { caseId: string; expectedRevision: number; authorityArtifact: VerificationArtifactHandle }): Promise<DurableRecoveryCase> {
    const current = await this.read(tenantId, request.caseId);
    if (current.state !== "waiting") throw new Error("RECOVERY_NOT_WAITING");
    const accepted = await this.evidence.authorizeResume({ tenantId, caseId: request.caseId, authorityArtifact: request.authorityArtifact });
    equal(accepted.artifact, request.authorityArtifact, "RECOVERY_RESUME_AUTHORITY_BINDING");
    if (accepted.priorAuthorityDigest !== current.authorityDigest || accepted.nextAuthorityDigest === current.authorityDigest
      || !/^sha256:[a-f0-9]{64}$/.test(accepted.nextAuthorityDigest)) throw new Error("RECOVERY_RESUME_REQUIRES_NEW_AUTHORITY");
    await this.custody.read({ tenantId, artifact: accepted.artifact });
    const entry = await this.entry(tenantId, "resume", accepted, [current.revisions.at(-1)!.artifact, accepted.artifact], accepted.nextAuthorityDigest);
    return this.store.append({ tenantId, caseId: request.caseId, expectedRevision: request.expectedRevision, entries: [entry],
      state: current.activePlanDigest ? "active" : "ready", authorityDigest: accepted.nextAuthorityDigest });
  }

  private async projectLatestCandidates(current: DurableRecoveryCase): Promise<void> {
    const planRevisions = current.revisions.filter(row => row.kind === "plan");
    for (const original of current.batch.items) {
      const initial = current.initialBatch.items.find(item => item.originalId === original.originalId)!;
      const candidates = current.executions.filter(execution => execution.originalId === original.originalId && execution.state === "settled")
        .map(execution => ({ execution, revision: planRevisions.find(row => row.idempotencyKey === execution.planDigest) }))
        .sort((left, right) => (right.revision?.revision ?? -1) - (left.revision?.revision ?? -1));
      const latest = candidates[0];
      if (!latest) continue;
      if (!latest.revision || !latest.execution.operationId) throw new Error("RECOVERY_CANDIDATE_LINEAGE_REQUIRED");
      const plan = VerificationRecoveryPlanSchema.parse(latest.revision.value);
      const action = plan.actions.find(item => item.originalId === original.originalId);
      if (!action?.newBinding || digestCanonicalJson(action.newBinding) !== latest.execution.inputDigest) throw new Error("RECOVERY_CANDIDATE_LINEAGE_MISMATCH");
      if (action.newBinding.policyDigest !== initial.binding.policyDigest || action.newBinding.profileDigest !== initial.binding.profileDigest) throw new Error("RECOVERY_CANDIDATE_POLICY_MISMATCH");
      const result = await this.evidence.readResult({ tenantId: current.tenantId, inputDigest: latest.execution.inputDigest, operationId: latest.execution.operationId });
      if (!result) throw new Error("RECOVERY_CURRENT_CANDIDATE_PROOF_REQUIRED");
      const verified = VerificationRecoveryVerifiedResultSchema.parse(result);
      if (verified.tenantId !== current.tenantId || verified.inputDigest !== latest.execution.inputDigest
        || verified.observation.operationId !== latest.execution.operationId || verified.revoked) throw new Error("RECOVERY_CURRENT_CANDIDATE_PROOF_MISMATCH");
      equal(verified.binding, action.newBinding, "RECOVERY_CURRENT_CANDIDATE_PROOF_MISMATCH");
      if (!["completed", "cancelled"].includes(verified.observation.execution)) throw new Error("RECOVERY_CURRENT_CANDIDATE_NOT_TERMINAL");
      original.binding = verified.binding;
      original.inputDigest = verified.inputDigest;
      original.observation = verified.observation;
      // Membership and required scope always remain those of the initial authoritative batch.
      original.questionIds = [...initial.questionIds];
    }
  }

  private authority(current: DurableRecoveryCase, failureSet?: VerificationFailureSet, plan?: VerificationRecoveryPlan, settlements?: Map<string, DurableRecoveryUsage>): VerificationRecoveryAuthority {
    let invalidation: ReturnType<DurableRecoveryEvidenceAuthority["readInvalidation"]> | undefined;
    return {
      now: () => this.evidence.now(), readBatch: async () => structuredClone(failureSet?.batch ?? current.batch),
      readPlan: async () => { if (!plan) throw new Error("RECOVERY_PLAN_NOT_FOUND"); return plan; },
      readInvalidation: input => invalidation ??= this.evidence.readInvalidation(input), readProbe: input => this.evidence.readProbe(input),
      readResult: async input => {
        const candidates = current.executions.filter(row => row.inputDigest === input.inputDigest && (!input.operationId || row.operationId === input.operationId));
        if (candidates.length > 1) throw new Error("RECOVERY_RESULT_OPERATION_AMBIGUOUS");
        const expected = candidates[0];
        if (!input.operationId && !expected?.operationId) return null;
        const result = await this.evidence.readResult({ ...input, ...(expected?.operationId ? { operationId: expected.operationId } : {}) });
        if (result && expected && result.observation.operationId !== expected.operationId) throw new Error("RECOVERY_RESULT_OPERATION_BINDING");
        if (result && expected && expected.planDigest === plan?.payloadDigest && ["completed", "cancelled"].includes(result.observation.execution)) settlements?.set(expected.executionId, result.usage);
        return result;
      },
    };
  }

  private async persist(tenantId: string, kind: DurableRecoveryRevision["kind"], value: unknown, parents: VerificationArtifactHandle[], identity: string, additionalParentIds: string[] = []): Promise<VerificationArtifactHandle> {
    for (const artifact of parents) await this.custody.read({ tenantId, artifact });
    const artifact = await this.custody.register({ tenantId, kind, value, parentArtifactIds: [...new Set([...parents.map(row => row.artifactId), ...additionalParentIds])].sort(), identity });
    if (artifact.tenantId !== tenantId || artifact.digest !== digestCanonicalJson(value)) throw new Error("RECOVERY_ARTIFACT_BINDING");
    equal(await this.custody.read({ tenantId, artifact }), value, "RECOVERY_ARTIFACT_READBACK");
    return artifact;
  }
  private async entry(tenantId: string, kind: DurableRecoveryRevision["kind"], value: unknown, parents: VerificationArtifactHandle[], idempotencyKey: string, additionalParentIds: string[] = []): Promise<RecoveryRevisionInput> {
    return { kind, value, idempotencyKey, artifact: await this.persist(tenantId, kind, value, parents, idempotencyKey, additionalParentIds) };
  }
}
