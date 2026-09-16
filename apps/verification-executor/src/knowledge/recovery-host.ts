import { z } from "zod";
import {
  OperationContextSchema, VerificationArtifactHandleSchema, VerificationClaimsArtifactSchema,
  VerifyClaimsRequestSchema, CheckpointScopeSchema,
  type VerificationRecoveryBinding, type VerificationArtifactHandle,
} from "@aiengineer/knowledge-contracts";
import { DurableVerificationRecoveryService, type CheckpointApplicationService } from "@aiengineer/knowledge-application";
import { PostgresDurableVerificationRecoveryStore, PostgresKnowledgeOperationService,
  type PostgresCanonicalRepository, type PostgresClaimsReportReadRepository } from "@aiengineer/knowledge-persistence";
import { deterministicUuid } from "@aiengineer/knowledge-runtime";
import { canonicalizeJson, digestCanonicalJson } from "@aiengineer/knowledge-verification";
import type { FilesystemStore } from "../store.js";
import type { ArtifactCustody } from "../store-custody.js";
import { RecoveryNativeAuthorizationSchema, RecoveryRunAuthority } from "./recovery-authority.js";
import { AutomaticRecoveryRouting } from "./recovery-routing.js";
import { canonicalUnadmittedClosure, createCanonicalRecoveryResultReader } from "./recovery-host-canonical.js";
import { createDurableRecoveryCustody } from "./recovery-durable-custody.js";
import { createDurableRecoveryRuntime } from "./recovery-durable-runtime.js";
import { createDurableRecoveryCheckpoints } from "./recovery-durable-checkpoints.js";
import { CHECKPOINT_PROFILE_PINS } from "./checkpoints-policy.js";
import { RecoverySelectorProbes } from "./recovery-probes.js";

const GrantSchema = z.strictObject({
  authorizationArtifact: VerificationArtifactHandleSchema, claimsArtifact: VerificationArtifactHandleSchema,
  context: OperationContextSchema, checkpointScope: CheckpointScopeSchema,
});
export const RecoveryHostConfigSchema = z.strictObject({
  grants: z.array(GrantSchema).min(1).max(64),
  publicKeys: z.array(z.strictObject({ keyId: z.string().min(1).max(255), publicKeyPem: z.string().min(1).max(4096) })).min(1).max(32),
});
export type RecoveryHostConfig = z.infer<typeof RecoveryHostConfigSchema>;
type Grant = z.infer<typeof GrantSchema>;
const same = (left: unknown, right: unknown) => canonicalizeJson(left) === canonicalizeJson(right);
const runIdFor = (grant: Grant) => deterministicUuid("verification-claims-run", grant.context.operationId);
const NativeRequestSchema = z.strictObject({ schemaVersion: z.literal("knowledge-operation-request/v1"), kind: z.literal("verification_claims"),
  input: z.strictObject({ schemaVersion: z.literal("verification-service-request.v1"), useCase: z.literal("verifyClaims"), request: VerifyClaimsRequestSchema }),
  expectedVersions: z.record(z.string(), z.string()), authenticatedContext: OperationContextSchema });

/** Host-pinned original questions and artifact inputs; the canonical worker owns all execution. */
export class CanonicalRecoveryHost {
  readonly service: DurableVerificationRecoveryService;
  readonly routing: AutomaticRecoveryRouting;
  readonly probes: RecoverySelectorProbes;
  private readonly authority: RecoveryRunAuthority;
  private readonly custody: ReturnType<typeof createDurableRecoveryCustody>;
  private readonly persistence: PostgresDurableVerificationRecoveryStore;
  private readonly config: RecoveryHostConfig;
  private timer: ReturnType<typeof setInterval> | undefined;
  private observing: Promise<void> | undefined;
  private readonly failures = new Map<string, string>();

  constructor(private readonly input: { tenantId: string; config: RecoveryHostConfig; database: PostgresCanonicalRepository;
    store: FilesystemStore; custody: ArtifactCustody; reads: PostgresClaimsReportReadRepository; checkpoints: CheckpointApplicationService }) {
    this.config = RecoveryHostConfigSchema.parse(structuredClone(input.config));
    if (new Set(this.config.grants.map(runIdFor)).size !== this.config.grants.length
      || this.config.grants.some(grant => grant.context.tenantId !== input.tenantId
        || grant.authorizationArtifact.tenantId !== input.tenantId || grant.claimsArtifact.tenantId !== input.tenantId
        || grant.checkpointScope.tenantId !== input.tenantId)) throw new Error("RECOVERY_HOST_GRANT_BINDING");
    this.custody = createDurableRecoveryCustody(input.store, input.custody);
    this.persistence = new PostgresDurableVerificationRecoveryStore(input.database);
    const readResult = createCanonicalRecoveryResultReader({ tenantId: input.tenantId, database: input.database,
      reads: input.reads, custody: input.custody, binding: reference => this.binding(reference) });
    this.authority = new RecoveryRunAuthority({ tenantId: input.tenantId, custody: this.custody,
      unavailableObservation: operationId => this.unavailableObservation(operationId),
      pins: { forRun: async runId => this.grant(runId).authorizationArtifact,
        forBatch: async batchId => (await this.grantForBatch(batchId)).authorizationArtifact },
      evidence: { now: () => new Date().toISOString(), readResult, readProbe: request => this.probes.read(request),
        readInvalidation: request => this.invalidation(request),
        authorizeResume: request => this.authorizeResume(request) } });
    const runtime = createDurableRecoveryRuntime({ store: this.persistence, database: input.database,
      admittedOperationKinds: ["verification_claims"], origin: "verification-recovery-host.v1",
      materializer: { materialize: request => this.materialize(request) },
      reconcileOriginalOperation: async reference => { await input.database.reconcileOperation(reference.tenantId, reference.operationId); } });
    this.service = new DurableVerificationRecoveryService(this.persistence, this.authority, this.custody, runtime,
      createDurableRecoveryCheckpoints({ checkpoints: input.checkpoints, profilePins: CHECKPOINT_PROFILE_PINS,
        scopeForCase: async reference => (await this.grantForCase(reference.caseId)).checkpointScope }));
    this.routing = new AutomaticRecoveryRouting({ tenantId: input.tenantId, authority: this.authority, recovery: this.service });
    this.probes = new RecoverySelectorProbes({ tenantId: input.tenantId, recovery: this.service, custody: this.custody,
      now: () => new Date().toISOString(), representation: digest => this.representation(digest) });
  }

  async submit(runId: string) {
    const grant = this.grant(runId);
    const claims = VerificationClaimsArtifactSchema.parse(await this.custody.read({ tenantId: this.input.tenantId, artifact: grant.claimsArtifact }));
    await this.authority.authorizeNativeRun({ runId, claimsArtifact: grant.claimsArtifact, bundle: claims.bundle });
    const { batch } = await this.authorization(grant);
    if (batch.items.some(item => item.observation.operationId !== grant.context.operationId)
      || Date.parse(batch.limits.deadline) <= Date.now()) throw new Error("RECOVERY_HOST_ORIGINAL_OPERATION_BINDING");
    const request = VerifyClaimsRequestSchema.parse({ verificationContractVersion: "verification.v1",
      captureIds: claims.bundle.captures.map(capture => capture.captureId),
      assertions: { artifactId: grant.claimsArtifact.artifactId, digest: grant.claimsArtifact.digest } });
    const operations = new PostgresKnowledgeOperationService(this.input.database, { admittedOperationKinds: ["verification_claims"] });
    const result = await operations.submit("verification_claims", { context: grant.context,
      input: { schemaVersion: "verification-service-request.v1", useCase: "verifyClaims", request },
      expectedVersions: { verification: "verification.v1", service: "verification-service-request.v1" } }, "verification-recovery-host.v1");
    return { runId, operationId: grant.context.operationId, batchId: batch.batchId, caseId: batch.caseId, operation: result };
  }

  async observe(runId: string) {
    const grant = this.grant(runId);
    const { batch } = await this.authorization(grant);
    if (!await this.originalOperation(grant)) return { runId, state: "not_submitted" };
    const observed = await this.authority.readInitialBatch({ tenantId: this.input.tenantId, batchId: batch.batchId });
    const result = observed.batch.items.find(item => item.observation.execution === "completed");
    if (!result) {
      const terminal = observed.batch.items.find(item => ["unknown", "cancelled"].includes(item.observation.execution));
      if (terminal) {
        await this.service.open(this.input.tenantId, { batchId: batch.batchId,
          notificationId: digestCanonicalJson({ kind: "native-terminal-unavailable", operationId: grant.context.operationId,
            artifacts: terminal.observation.diagnosticArtifacts.map(artifact => artifact.digest) }) });
        return this.routing.read(batch.caseId);
      }
      return { runId, state: "pending", questionDenominator: batch.questionIds.length, submitted: batch.items.length };
    }
    const policyArtifact = result.observation.diagnosticArtifacts.find(artifact => artifact.digest === result.binding.policyDigest);
    const decisionArtifact = result.observation.diagnosticArtifacts.find(artifact => artifact.mediaType === "application/vnd.aiengineer.verification-policy-decision+json");
    if (!policyArtifact || !decisionArtifact) throw new Error("RECOVERY_HOST_POLICY_ARTIFACT_REQUIRED");
    return this.routing.notify({ runId, authorityArtifactId: grant.authorizationArtifact.artifactId, policyArtifact, decisionArtifact });
  }

  start(): void {
    if (this.timer) return;
    const tick = () => {
      if (this.observing) return;
      this.observing = this.observeAll().finally(() => { this.observing = undefined; });
    };
    this.timer = setInterval(tick, 3000); this.timer.unref(); tick();
  }
  async close(): Promise<void> { if (this.timer) clearInterval(this.timer); this.timer = undefined; await this.observing; }
  status() { return { runs: this.config.grants.map(grant => ({ runId: runIdFor(grant), operationId: grant.context.operationId,
    ...(this.failures.has(runIdFor(grant)) ? { error: this.failures.get(runIdFor(grant)) } : {}) })) }; }
  async authorizeCase(caseId: string) { await this.grantForCase(caseId); }
  async claim(request: { caseId: string; planDigest: string; leaseMs: number }) {
    const grant = await this.grantForCase(request.caseId);
    return this.service.claim(this.input.tenantId, { ...request, holderIdentity: `recovery-host:${grant.context.actor.id}` });
  }

  private async observeAll() {
    for (const grant of this.config.grants) {
      const runId = runIdFor(grant);
      try { await this.observe(runId); this.failures.delete(runId); }
      catch (error) { this.failures.set(runId, error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "RECOVERY_HOST_OBSERVATION_FAILED"); }
    }
  }
  private async unavailableObservation(operationId: string) {
    const grant = this.config.grants.find(row => row.context.operationId === operationId);
    if (!grant) return undefined;
    const operation = await this.originalOperation(grant);
    if (!operation || !["failed", "cancelled"].includes(operation.status)) return undefined;
    const diagnostic = await this.custody.register({ tenantId: this.input.tenantId, kind: "batch",
      identity: `native-terminal:${operationId}:${operation.status}`,
      value: { schemaVersion: "verification-recovery-native-terminal.v1", operationId, status: operation.status,
        requestDigest: `sha256:${operation.requestSha256}`, verificationResultAvailable: false },
      parentArtifactIds: [grant.authorizationArtifact.artifactId, grant.claimsArtifact.artifactId] });
    return { operationId, execution: operation.status === "cancelled" ? "cancelled" as const : "unknown" as const,
      family: "execution" as const, earliestStage: "selector" as const,
      signature: `native-terminal:${operation.status}`, dependencyIds: [], diagnosticArtifacts: [diagnostic] };
  }
  private grant(runId: string) { const grant = this.config.grants.find(item => runIdFor(item) === runId);
    if (!grant) throw new Error("RECOVERY_HOST_RUN_NOT_AUTHORIZED"); return grant; }
  private async authorization(grant: Grant) {
    const value = RecoveryNativeAuthorizationSchema.parse(await this.custody.read({ tenantId: this.input.tenantId, artifact: grant.authorizationArtifact }));
    if (value.runId !== runIdFor(grant) || value.claimsArtifactDigest !== grant.claimsArtifact.digest
      || value.batch.tenantId !== this.input.tenantId
      || new Set(value.batch.items.map(item => item.originalId)).size !== value.batch.items.length) throw new Error("RECOVERY_HOST_AUTHORIZATION_MISMATCH");
    return value;
  }
  private async grantForBatch(batchId: string) {
    for (const grant of this.config.grants) if ((await this.authorization(grant)).batch.batchId === batchId) return grant;
    throw new Error("RECOVERY_HOST_BATCH_NOT_AUTHORIZED");
  }
  private async grantForCase(caseId: string) {
    for (const grant of this.config.grants) if ((await this.authorization(grant)).batch.caseId === caseId) return grant;
    throw new Error("RECOVERY_HOST_CASE_NOT_AUTHORIZED");
  }
  private async binding(reference: { operationId: string; inputDigest: string; originalId?: string }) {
    for (const grant of this.config.grants) if (grant.context.operationId === reference.operationId) {
      if (!await this.originalOperation(grant)) return null;
      const { batch, requirementBindings } = await this.authorization(grant);
      const matching = batch.items.filter(row => row.inputDigest === reference.inputDigest
        && (reference.originalId === undefined || row.originalId === reference.originalId));
      if (matching.length > 1) throw new Error("RECOVERY_HOST_ORIGINAL_AMBIGUOUS");
      const item = matching[0];
      return item ? { originalId: item.originalId, binding: item.binding,
        coveredRequirementIds: requirementBindings.filter(row => row.originalId === item.originalId).map(row => row.requirementId) } : null;
    }
    const rows = await this.input.database.transaction(this.input.tenantId, async client => (await client.query<{ case_id: string }>(
      "select case_id from knowledge_service.recovery_execution where tenant_id=$1 and planned_operation_id=$2 limit 2",
      [this.input.tenantId, reference.operationId])).rows);
    if (!rows.length) return null;
    if (rows.length !== 1) throw new Error("RECOVERY_HOST_EXECUTION_AMBIGUOUS");
    const grant = await this.grantForCase(rows[0]!.case_id);
    const current = await this.service.read(this.input.tenantId, rows[0]!.case_id);
    const execution = current.executions.find(row => row.plannedOperationId === reference.operationId && row.inputDigest === reference.inputDigest
      && (reference.originalId === undefined || row.originalId === reference.originalId));
    const operation = await this.input.database.getOperation(this.input.tenantId, reference.operationId);
    if (!execution || !operation) return null;
    if (operation.idempotencyKey !== `recovery:${execution.executionId}`
      || (execution.requestDigest && `sha256:${operation.requestSha256}` !== execution.requestDigest)) throw new Error("RECOVERY_HOST_EXECUTION_REQUEST_MISMATCH");
    const plan = current.revisions.find(row => row.kind === "plan" && row.idempotencyKey === execution?.planDigest)?.value as typeof current.latestPlan;
    const action = plan?.actions.find(row => row.originalId === execution?.originalId);
    const authorization = await this.authorization(grant);
    const required = authorization.requirementBindings.filter(row => row.originalId === action?.originalId);
    if (action?.newBinding && required.some(row => row.claimDigest !== digestCanonicalJson(action.newBinding!.claim))) throw new Error("RECOVERY_REQUIREMENT_ASSERTION_BINDING");
    return action?.newBinding ? { originalId: action.originalId, binding: action.newBinding,
      coveredRequirementIds: required.map(row => row.requirementId) } : null;
  }
  private async originalOperation(grant: Grant) {
    const operation = await this.input.database.getOperationRecord(this.input.tenantId, grant.context.operationId);
    if (!operation) return undefined;
    const request = NativeRequestSchema.parse(operation.request);
    if (operation.operationKind !== "verification_claims" || !same(request.authenticatedContext, grant.context)
      || !same(request.input.request.assertions, { artifactId: grant.claimsArtifact.artifactId, digest: grant.claimsArtifact.digest })
      || digestCanonicalJson(request) !== `sha256:${operation.requestSha256}`) throw new Error("RECOVERY_HOST_ORIGINAL_OPERATION_BINDING");
    return operation;
  }
  private async materialize(request: Parameters<Parameters<typeof createDurableRecoveryRuntime>[0]["materializer"]["materialize"]>[0]) {
    const grant = await this.grantForCase(request.execution.caseId);
    const original = (await this.authorization(grant)).batch.items.find(item => item.originalId === request.execution.originalId);
    if (!original) throw new Error("RECOVERY_HOST_ORIGINAL_REQUIRED");
    const withoutSelectors = (binding: VerificationRecoveryBinding) => ({ ...binding, evidence: binding.evidence.map(({ selector: _selector, ...edge }) => edge) });
    if (!same(withoutSelectors(original.binding), withoutSelectors(request.binding))) throw new Error("RECOVERY_HOST_REPAIR_SCOPE_UNSUPPORTED");
    const claims = VerificationClaimsArtifactSchema.parse(await this.custody.read({ tenantId: this.input.tenantId, artifact: grant.claimsArtifact }));
    const assertion = claims.bundle.assertions.find(item => item.assertionId === original.originalId);
    if (!assertion || assertion.evidence.length !== request.binding.evidence.length) throw new Error("RECOVERY_HOST_ORIGINAL_REQUIRED");
    const repaired = structuredClone(assertion);
    repaired.evidence.forEach((edge, index) => { edge.fragment.selector = request.binding.evidence[index]!.selector; });
    claims.bundle.assertions = [repaired];
    claims.bundle.bundleId = deterministicUuid("recovery-claims-bundle", request.execution.executionId);
    const artifact = await this.input.store.putJson(VerificationClaimsArtifactSchema.parse(claims), { mediaType: "application/json",
      producerActivityId: "knowledge:recovery-materialize-claims", producerVersion: "verification-recovery-host.v1",
      parentArtifactIds: [grant.claimsArtifact.artifactId], transformation: { executionId: request.execution.executionId, inputDigest: request.execution.inputDigest } });
    const verified = VerifyClaimsRequestSchema.parse({ verificationContractVersion: "verification.v1",
      captureIds: claims.bundle.captures.map(capture => capture.captureId), assertions: { artifactId: artifact.handle.artifactId, digest: artifact.handle.digest } });
    return { kind: "verification_claims" as const, envelope: { context: { ...grant.context,
      operationId: request.execution.plannedOperationId, idempotencyKey: request.idempotencyKey, correlationId: request.execution.executionId },
      input: { schemaVersion: "verification-service-request.v1", useCase: "verifyClaims", request: verified },
      expectedVersions: { verification: "verification.v1", service: "verification-service-request.v1" } } };
  }
  private async representation(digest: string) {
    for (const grant of this.config.grants) {
      const claims = VerificationClaimsArtifactSchema.parse(await this.custody.read({ tenantId: this.input.tenantId, artifact: grant.claimsArtifact }));
      const capture = claims.bundle.captures.find(row => row.contentArtifact.digest === digest);
      if (capture) { const value = await this.input.custody.resolve(capture.contentArtifact.artifactId);
        if (!value) throw new Error("RECOVERY_HOST_REPRESENTATION_UNAVAILABLE"); return { artifact: value.handle, bytes: value.bytes }; }
    }
    throw new Error("RECOVERY_HOST_REPRESENTATION_NOT_AUTHORIZED");
  }
  private async invalidation(reference: { tenantId: string; caseId: string; planDigest: string }) {
    if (reference.tenantId !== this.input.tenantId) throw new Error("RECOVERY_HOST_TENANT_DENIED");
    await this.grantForCase(reference.caseId);
    const current = await this.service.read(reference.tenantId, reference.caseId);
    return canonicalUnadmittedClosure({ ...reference, database: this.input.database,
      operationIds: [...current.initialBatch.items.map(item => item.observation.operationId), ...current.executions.map(item => item.plannedOperationId)] });
  }
  private async authorizeResume(reference: { tenantId: string; caseId: string; authorityArtifact: VerificationArtifactHandle }) {
    if (reference.tenantId !== this.input.tenantId) throw new Error("RECOVERY_HOST_TENANT_DENIED");
    await this.grantForCase(reference.caseId);
    const current = await this.service.read(reference.tenantId, reference.caseId), artifact = reference.authorityArtifact;
    if (current.state !== "waiting" || artifact.digest === current.authorityDigest
      || current.initialBatch.items.some(item => item.observation.diagnosticArtifacts.some(prior => prior.digest === artifact.digest))
      || current.revisions.some(revision => revision.kind === "resume" && (revision.value as { artifact?: VerificationArtifactHandle }).artifact?.digest === artifact.digest)) {
      throw new Error("RECOVERY_HOST_NEW_AUTHORITY_REQUIRED");
    }
    const rows = await this.input.database.transaction(reference.tenantId, async client => (await client.query<{ operation_id: string }>(
      "select operation_id from evidence.verification_run where tenant_id=$1 and run_manifest_artifact_id=$2 limit 2",
      [reference.tenantId, artifact.artifactId])).rows);
    if (rows.length !== 1) throw new Error("RECOVERY_HOST_NEW_AUTHORITY_REQUIRED");
    const operationId = rows[0]!.operation_id;
    const execution = current.executions.find(item => item.operationId === operationId);
    const original = current.initialBatch.items.find(item => item.observation.operationId === operationId);
    const inputDigest = execution?.inputDigest ?? original?.inputDigest;
    if (!inputDigest) throw new Error("RECOVERY_HOST_NEW_AUTHORITY_REQUIRED");
    const result = await this.authority.readResult({ tenantId: reference.tenantId, inputDigest, operationId,
      originalId: execution?.originalId ?? original?.originalId });
    if (!result || result.revoked || !result.observation.diagnosticArtifacts.some(value => same(value, artifact))) {
      throw new Error("RECOVERY_HOST_NEW_AUTHORITY_REQUIRED");
    }
    return { kind: "evidence" as const, priorAuthorityDigest: current.authorityDigest, nextAuthorityDigest: artifact.digest, artifact };
  }
}
