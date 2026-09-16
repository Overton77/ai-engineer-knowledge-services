import { createHash } from "node:crypto";
import { z } from "zod";
import { startExecutorServer, type ServeOptions } from "./serve.js";
import { loadExecutorConfig } from "./executor.js";
import { createExecutorCustody } from "./store-custody-postgres.js";
import { createRootReportAuthority, ROOT_REPORT_FORMAT } from "./root-host-report.js";
import { createRootPreparationHost } from "./root-host-preparation.js";
import { createRootSelectionComposition, type RootSelectionScope } from "./root-host-selection-composition.js";
import { createCanonicalEvidenceReader, type CanonicalEvidenceReader } from "./evidence-reader.js";
import { createRootRunInspector } from "./root-host-inspection.js";
import { digestCanonicalJson } from "@aiengineer/knowledge-verification";
import { ClaimsIntentSchema, PolicyDefinitionInputSchema } from "./intents.js";
import { PostgresCanonicalRepository, PostgresDurableVerificationRecoveryStore } from "@aiengineer/knowledge-persistence";
import { DurableVerificationRecoveryService } from "@aiengineer/knowledge-application";
import { SupabaseArtifactStore } from "@aiengineer/knowledge-runtime";
import { createRootCoverageEvaluator, RootCoverageScopeSchema, type RootCoverageScope } from "./root-host-coverage.js";
import { createVerificationReceiptRecorder } from "./root-host-verification-receipts.js";
import { readVerificationAccounting, retainVerificationAccounting, selectVerificationAccounting, type RunUsageReader } from "./root-host-accounting.js";
import { readRootRecoveryEvidence } from "./root-host-recovery-evidence.js";
import { readOriginalRecoveryAuthorization, retainOriginalRecoveryAuthorization } from "./root-host-recovery-authorization.js";
import { createExecutorRecoveryResultReader } from "./knowledge/recovery-executor-evidence.js";
import { RecoveryRunAuthority } from "./knowledge/recovery-authority.js";
import { createDurableRecoveryCustody } from "./knowledge/recovery-durable-custody.js";
import { AutomaticRecoveryRouting } from "./knowledge/recovery-routing.js";

export { GatewaySemanticJudgeAdapter } from "@aiengineer/knowledge-verification";
export { ROOT_REPORT_FORMAT };

export interface RootExecutorHostOptions extends ServeOptions {
  readonly readVerificationUsage?: RunUsageReader;
  readonly verificationAccountingLifecycle?: {
    begin(scope: { tenantId: string; runId: string }): unknown | Promise<unknown>;
    close(execution: { tenantId: string; runId: string; resultArtifactId: string; resultDigest: string }): unknown | Promise<unknown>;
  };
  readonly reportScope?: { readonly originalQuestions: readonly { key: string; question: string }[]; readonly runIds: readonly string[] };
  readonly coverageScope?: RootCoverageScope;
}

/** Trusted parent-process entrypoint. It must never be materialized as a child capability. */
export async function createRootExecutorHost(options: RootExecutorHostOptions) {
  if (!options.token || options.host !== "127.0.0.1") throw new Error("ROOT_HOST_LOOPBACK_AUTH_REQUIRED");
  if (typeof options.semanticJudgeAdapterFactory !== "function") throw new Error("ROOT_HOST_ACCOUNTED_JUDGE_REQUIRED");
  const config = loadExecutorConfig(options.env ?? process.env);
  for (const value of [config.tenantId, config.producerAttemptId, config.verifierAttemptId]) z.uuid().parse(value);
  const reportScope = options.reportScope ? structuredClone(options.reportScope) : undefined;
  const coverageScope = options.coverageScope ? RootCoverageScopeSchema.parse(options.coverageScope) : undefined;
  if (coverageScope && !reportScope?.originalQuestions.some(question => question.key === coverageScope.questionId))
    throw new Error("ROOT_COVERAGE_QUESTION_SCOPE");
  let preparation: ReturnType<typeof createRootPreparationHost> | undefined;
  const running = await startExecutorServer({ ...options,
    prepareCapturedSource: input => {
      if (!preparation) throw new Error("ROOT_HOST_NOT_READY");
      return preparation.prepare(input);
    },
    ...(reportScope ? { reportAssessmentAuthority: config => createRootReportAuthority({ ...config,
      originalQuestions: reportScope.originalQuestions, allowedRunIds: () => reportScope.runIds }) } : {}),
  });
  const knowledge = running.knowledge;
  try {
    if (!knowledge?.config.storage || !knowledge.config.missionId || knowledge.config.allowStale
      || knowledge.config.defaultTenantId !== config.tenantId
      || knowledge.config.producerAttemptId !== config.producerAttemptId) throw new Error("ROOT_HOST_CANONICAL_CUSTODY_REQUIRED");
    const rows = await knowledge.db.transaction({ tenantId: config.tenantId, readOnly: true }, async client =>
      (await client.query<{ id: string; agent_deployment_id: string }>(`
        select a.id,a.agent_deployment_id from orchestration.attempt a
        join orchestration.work_item w on w.tenant_id=a.tenant_id and w.id=a.work_item_id
        where a.tenant_id=$1 and a.id=any($2::uuid[]) and w.mission_id=$3`,
      [config.tenantId, [config.producerAttemptId, config.verifierAttemptId], knowledge.config.missionId])).rows);
    if (!rows.some(row => row.id === config.producerAttemptId && row.agent_deployment_id === config.producerDeploymentId)
      || !rows.some(row => row.id === config.verifierAttemptId && row.agent_deployment_id === config.verifierDeploymentId)
      || config.producerAttemptId === config.verifierAttemptId
      || config.producerDeploymentId === config.verifierDeploymentId) throw new Error("ROOT_HOST_INDEPENDENT_ATTEMPTS_REQUIRED");
    const databaseHead = await knowledge.reads.databaseHead();
    if (databaseHead !== knowledge.workspace.migrationHead) throw new Error("ROOT_HOST_SCHEMA_HEAD_MISMATCH");
  } catch (error) {
    await running.close();
    throw error;
  }
  const database = new PostgresCanonicalRepository({ connectionString: knowledge!.config.databaseUrl });
  const verificationReceipts = createVerificationReceiptRecorder(database);
  const policyVersion = knowledge!.config.evidencePolicyVersion ?? "executor-default.v1";
  const policyDigest = knowledge!.config.evidencePolicyDigest ?? digestCanonicalJson({ schemaVersion: "verification-policy.v1",
    definitionId: "policy-executor-default.v1", ...PolicyDefinitionInputSchema.parse({}) });
  const inspectRun = reportScope ? createRootRunInspector({ verification: running.executor, tenantId: config.tenantId,
    policyVersion, policyDigest, allowedRunIds: reportScope.runIds }) : undefined;
  const evaluateCoverage = coverageScope ? createRootCoverageEvaluator({ verification: running.executor,
    tenantId: config.tenantId, policyVersion, policyDigest, scope: coverageScope,
    loadReport: async reportVersionId => {
      if (!knowledge!.reportAssessment) throw new Error("ROOT_COVERAGE_REPORT_AUTHORITY_REQUIRED");
      const assessment = await knowledge!.reportAssessment.assess({ reportVersionId });
      if (assessment.admission !== "pass") throw new Error("ROOT_COVERAGE_REPORT_NOT_ADMITTED");
      const artifact = await knowledge!.artifacts.get(config.tenantId, assessment.finalMarkdown.artifactId);
      if (artifact.text === undefined || artifact.record.digest !== assessment.finalMarkdown.digest)
        throw new Error("ROOT_COVERAGE_REPORT_BYTES");
      return { ...assessment.finalMarkdown, markdown: artifact.text };
    } }) : undefined;
  let selectionEvidence: CanonicalEvidenceReader | undefined;
  let selectionConfigured = false;
  preparation = createRootPreparationHost({ database, verification: running.executor,
    artifacts: new SupabaseArtifactStore({ projectUrl: knowledge!.config.storage!.projectUrl,
      serviceRoleKey: knowledge!.config.storage!.secretKey, bucket: "ai-engineer-cloud-bucket", maximumBytes: 64_000_000 }),
    derivativeArtifacts: new SupabaseArtifactStore({ projectUrl: knowledge!.config.storage!.projectUrl,
      serviceRoleKey: knowledge!.config.storage!.secretKey, bucket: "content-derivatives", maximumBytes: 64_000_000 }),
    tenantId: config.tenantId, attemptId: config.producerAttemptId!, missionId: knowledge!.config.missionId!,
    actorId: config.producerAttemptId!, origin: running.url });
  return {
    url: running.url,
    tenantId: config.tenantId,
    migrationHead: knowledge!.workspace.migrationHead,
    workspaceFingerprint: knowledge!.workspace.fingerprint,
    policyVersion, policyDigest,
    async evaluateReportCoverage(reportVersionId: string) {
      if (!evaluateCoverage) throw new Error("ROOT_COVERAGE_SCOPE_REQUIRED");
      return evaluateCoverage(reportVersionId);
    },
    async readOperationEvidence(operationId: string) {
      z.uuid().parse(operationId);
      const operation = await database.getOperationRecord(config.tenantId, operationId);
      if (!operation || operation.correlationId !== knowledge!.config.missionId)
        throw new Error("ROOT_HOST_OPERATION_SCOPE");
      const receipts = await database.listReceipts(config.tenantId, operationId);
      const verified = await Promise.all(receipts.map(receipt => database.getReceiptResource(config.tenantId, receipt.id)));
      if (verified.some(receipt => !receipt)) throw new Error("ROOT_HOST_RECEIPT_MISSING");
      return { operation, receipts: verified };
    },
    async inspectRun(runId: string) {
      if (!inspectRun) throw new Error("ROOT_INSPECTION_SCOPE_REQUIRED");
      return inspectRun(runId);
    },
    async retainClaimSubmission(input: { runId: string; intent?: unknown; intentArtifactId?: string }) {
      if (!reportScope?.runIds.includes(input.runId)) throw new Error("ROOT_SUBMISSION_RUN_NOT_AUTHORIZED");
      if ((input.intent === undefined) === (input.intentArtifactId === undefined)) throw new Error("ROOT_SUBMISSION_ONE_INTENT_REQUIRED");
      const intent = ClaimsIntentSchema.parse(input.intent ?? await running.executor.store.json(
        await running.executor.store.resolveHandle({ artifactId: z.uuid().parse(input.intentArtifactId) })));
      const value = { schemaVersion: "root-claim-submission.v1", tenantId: config.tenantId,
        missionId: knowledge!.config.missionId!, attemptId: config.producerAttemptId!, runId: input.runId,
        originalQuestions: reportScope.originalQuestions, intent };
      const retained = await running.executor.store.putJson(value, { mediaType: "application/json",
        producerActivityId: "root-host:retain-claim-submission", producerVersion: "root-claim-submission.v1" });
      const submission = { tenantId: config.tenantId, missionId: knowledge!.config.missionId!, attemptId: config.producerAttemptId!,
        runId: input.runId, artifactId: retained.handle.artifactId, digest: retained.handle.digest };
      const receipt = await verificationReceipts.submit(submission);
      await options.verificationAccountingLifecycle?.begin({ tenantId: config.tenantId, runId: input.runId });
      return { ...receipt, artifactId: retained.handle.artifactId, digest: retained.handle.digest, value };
    },
    async recordVerificationCompletion(submission: { runId: string; artifactId: string; digest: string }) {
      if (!inspectRun) throw new Error("ROOT_INSPECTION_SCOPE_REQUIRED");
      const sealed = await inspectRun(submission.runId);
      const retained = await knowledge!.artifacts.get(config.tenantId, submission.artifactId);
      const original = z.object({ schemaVersion: z.literal("root-claim-submission.v1"), runId: z.uuid(),
        tenantId: z.uuid(), missionId: z.uuid(), attemptId: z.uuid(), intent: ClaimsIntentSchema }).parse(retained.json);
      if (retained.record.digest !== submission.digest || original.runId !== submission.runId
        || original.tenantId !== config.tenantId || original.missionId !== knowledge!.config.missionId
        || original.attemptId !== config.producerAttemptId || digestCanonicalJson(original.intent) !== sealed.intentDigest)
        throw new Error("ROOT_VERIFICATION_SUBMISSION_CUSTODY");
      const completion = await verificationReceipts.complete({ runId: submission.runId, artifactId: submission.artifactId,
        digest: submission.digest, tenantId: config.tenantId,
        missionId: knowledge!.config.missionId!, attemptId: config.producerAttemptId! }, sealed);
      if (options.verificationAccountingLifecycle) {
        const result = await running.executor.store.resolveHandle({ artifactId: completion.summary.resultArtifactId });
        await options.verificationAccountingLifecycle.close({ tenantId: config.tenantId, runId: submission.runId,
          resultArtifactId: result.artifactId, resultDigest: result.digest });
      }
      const accounting = await retainVerificationAccounting({ store: running.executor.store,
        readUsage: options.readVerificationUsage, completion });
      const recovery = await this.observeRecovery(submission.runId);
      return { ...completion, accounting, recovery };
    },
    async readVerificationHistory(runId: string) {
      if (!reportScope?.runIds.includes(runId)) throw new Error("ROOT_SUBMISSION_RUN_NOT_AUTHORIZED");
      const records = await verificationReceipts.read({ tenantId: config.tenantId, missionId: knowledge!.config.missionId!,
        attemptId: config.producerAttemptId!, runId });
      return Promise.all(records.map(async record => {
        const accounting = record.completion
        ? await readVerificationAccounting({ store: running.executor.store, database,
          completion: { operationId: record.operationId, ...record.completion } }) : [];
        return { ...record, accounting, settledAccounting: selectVerificationAccounting(accounting) };
      }));
    },
    async readRecoveryEvidence(input: { runId: string; operationId: string }) {
      if (!reportScope?.runIds.includes(input.runId)) throw new Error("ROOT_SUBMISSION_RUN_NOT_AUTHORIZED");
      const records = await verificationReceipts.read({ tenantId: config.tenantId, missionId: knowledge!.config.missionId!,
        attemptId: config.producerAttemptId!, runId: input.runId });
      const record = records.find(record => record.operationId === input.operationId);
      return record ? readRootRecoveryEvidence({ store: running.executor.store, record }) : null;
    },
    async readRecoveryResult(input: { runId: string; operationId: string; inputDigest: string; originalId?: string }) {
      if (!reportScope?.runIds.includes(input.runId)) throw new Error("ROOT_SUBMISSION_RUN_NOT_AUTHORIZED");
      const records = await verificationReceipts.read({ tenantId: config.tenantId, missionId: knowledge!.config.missionId!,
        attemptId: config.producerAttemptId!, runId: input.runId });
      const record = records.find(record => record.operationId === input.operationId);
      if (!record?.completion) return null;
      const authorization = await readOriginalRecoveryAuthorization({ verification: running.executor, database,
        operationId: record.operationId, submission: record.submission, policyDigest });
      if (!authorization) return null;
      const originals = authorization.value.batch.items.filter(item => item.inputDigest === input.inputDigest
        && item.observation.operationId === input.operationId && (input.originalId === undefined || item.originalId === input.originalId));
      if (originals.length !== 1) throw new Error("ROOT_RECOVERY_ORIGINAL_BINDING");
      const evidence = await readRootRecoveryEvidence({ store: running.executor.store, record });
      const accounting = selectVerificationAccounting(await readVerificationAccounting({ store: running.executor.store, database,
        completion: { operationId: record.operationId, ...record.completion } }));
      if (!evidence || !accounting) return null;
      const store = running.executor.store;
      const read = createExecutorRecoveryResultReader({ tenantId: config.tenantId, custody: {
        lookup: artifactId => store.resolveHandle({ artifactId }),
        async resolve(artifactId) { const handle = await store.resolveHandle({ artifactId }); return { handle, bytes: await store.bytes(handle) }; },
        async register() { throw new Error("ROOT_RECOVERY_READER_READ_ONLY"); },
      }, async lookupOperation() {
        return { ...evidence, originalId: originals[0]!.originalId, binding: originals[0]!.binding,
          usage: { calls: accounting.value.usage.calls, costMicros: accounting.value.usage.costMicros } };
      } });
      return read({ tenantId: config.tenantId, operationId: input.operationId, inputDigest: input.inputDigest, originalId: originals[0]!.originalId });
    },
    async readRecoveryBatch(runId: string) {
      if (!reportScope?.runIds.includes(runId)) throw new Error("ROOT_SUBMISSION_RUN_NOT_AUTHORIZED");
      const records = await verificationReceipts.read({ tenantId: config.tenantId, missionId: knowledge!.config.missionId!,
        attemptId: config.producerAttemptId!, runId });
      const original = records[0];
      if (!original) return null;
      const authorization = await readOriginalRecoveryAuthorization({ verification: running.executor, database,
        operationId: original.operationId, submission: original.submission, policyDigest });
      if (!authorization) return null;
      const custody = createExecutorCustody({ databaseUrl: knowledge!.config.databaseUrl,
        tenantId: config.tenantId, ...knowledge!.config.storage! });
      try {
        const authority = new RecoveryRunAuthority({ tenantId: config.tenantId,
          custody: createDurableRecoveryCustody(running.executor.store, custody),
          pins: {
            async forRun(id) { if (id !== runId) throw new Error("ROOT_RECOVERY_RUN_PIN"); return authorization.artifact; },
            async forBatch(id) { if (id !== authorization.value.batch.batchId) throw new Error("ROOT_RECOVERY_BATCH_PIN"); return authorization.artifact; },
          }, evidence: { now: () => new Date().toISOString(), readResult: request => request.operationId
            ? this.readRecoveryResult({ runId, operationId: request.operationId, inputDigest: request.inputDigest, originalId: request.originalId })
            : Promise.resolve(null) } });
        return await authority.readInitialBatch({ tenantId: config.tenantId, batchId: authorization.value.batch.batchId });
      } finally { await custody.close(); }
    },
    async observeRecovery(runId: string) {
      const initial = await this.readRecoveryBatch(runId);
      if (!initial || !initial.batch.items.some(item => item.observation.execution === "completed")) return null;
      const original = initial.batch.items.find(item => item.observation.execution === "completed")!;
      const evidence = await this.readRecoveryEvidence({ runId, operationId: original.observation.operationId });
      if (!evidence) return null;
      const remote = createExecutorCustody({ databaseUrl: knowledge!.config.databaseUrl,
        tenantId: config.tenantId, ...knowledge!.config.storage! });
      try {
        const custody = createDurableRecoveryCustody(running.executor.store, remote);
        const authority = new RecoveryRunAuthority({ tenantId: config.tenantId, custody,
          pins: {
            async forRun(id) { if (id !== runId) throw new Error("ROOT_RECOVERY_RUN_PIN"); return initial.authorityArtifact; },
            async forBatch(id) { if (id !== initial.batch.batchId) throw new Error("ROOT_RECOVERY_BATCH_PIN"); return initial.authorityArtifact; },
          }, evidence: { now: () => new Date().toISOString(), readResult: request => request.operationId
            ? this.readRecoveryResult({ runId, operationId: request.operationId, inputDigest: request.inputDigest, originalId: request.originalId })
            : Promise.resolve(null) } });
        const recovery = new DurableVerificationRecoveryService(new PostgresDurableVerificationRecoveryStore(database, "orchestration"), authority, custody);
        const routing = new AutomaticRecoveryRouting({ tenantId: config.tenantId, authority, recovery });
        return await routing.notify({ runId, authorityArtifactId: initial.authorityArtifact.artifactId,
          policyArtifact: await running.executor.store.resolveHandle({ artifactId: evidence.artifacts.policy }),
          decisionArtifact: await running.executor.store.resolveHandle({ artifactId: evidence.artifacts.decision }) });
      } finally { await remote.close(); }
    },
    async authorizeRecoverySubmission(input: { runId: string; operationId: string; limits: unknown }) {
      if (!reportScope?.runIds.includes(input.runId)) throw new Error("ROOT_SUBMISSION_RUN_NOT_AUTHORIZED");
      const records = await verificationReceipts.read({ tenantId: config.tenantId, missionId: knowledge!.config.missionId!,
        attemptId: config.producerAttemptId!, runId: input.runId });
      const original = records[0];
      if (!original || original.operationId !== input.operationId) throw new Error("ROOT_RECOVERY_FIRST_SUBMISSION_REQUIRED");
      return database.transaction(config.tenantId, async client => {
        await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`root-recovery:${original.operationId}`]);
        const prior = (await client.query<{ artifact_id: string }>(`select artifact_id from orchestration.verification_artifact_metadata
          where tenant_id=$1 and producer_activity_id='root-host:recovery-authorization'
            and producer_version='root-recovery-authorization.v1' and $2::uuid=any(parent_artifact_ids) limit 2`,
        [config.tenantId, original.submission.artifactId])).rows;
        if (prior.length > 1) throw new Error("ROOT_RECOVERY_AUTHORIZATION_AMBIGUOUS");
        return retainOriginalRecoveryAuthorization({ verification: running.executor, operationId: original.operationId,
          submission: original.submission, policyDigest, limits: input.limits, existingArtifactId: prior[0]?.artifact_id });
      });
    },
    /** Host-only composition; never install this method in a model tool catalog. */
    async configureSelection(scope: RootSelectionScope) {
      if (selectionConfigured) throw new Error("ROOT_SELECTION_ALREADY_CONFIGURED");
      if (!reportScope || scope.policyDigest !== policyDigest || scope.producer.attemptId !== config.producerAttemptId
        || digestCanonicalJson(scope.evaluationQueryTexts) !== digestCanonicalJson(reportScope.originalQuestions.map(question => ({ queryId: question.key, text: question.question }))))
        throw new Error("ROOT_SELECTION_SCOPE_PIN_MISMATCH");
      selectionConfigured = true;
      const evidence = createCanonicalEvidenceReader({ databaseUrl: knowledge!.config.databaseUrl, tenantId: config.tenantId,
        ...knowledge!.config.storage!, policyVersion, policyDigest });
      try {
        const artifactStores = Object.fromEntries(["research-ingestion-intents", "ai-engineer-cloud-bucket", "source-captures", "content-derivatives"]
          .map(bucket => [bucket, new SupabaseArtifactStore({ projectUrl: knowledge!.config.storage!.projectUrl,
            serviceRoleKey: knowledge!.config.storage!.secretKey, bucket, maximumBytes: 64_000_000 })]));
        const selection = await createRootSelectionComposition({ database, artifacts: knowledge!.artifacts, artifactStores,
          evidence, tenantId: config.tenantId, correlationId: knowledge!.config.missionId!, origin: running.url }, scope);
        selectionEvidence = evidence; return selection;
      } catch (error) { selectionConfigured = false; await evidence.close(); throw error; }
    },
    async readRun(runId: string) {
      z.string().min(1).max(200).parse(runId);
      return running.executor.runStatus({ runId });
    },
    async restoreArtifact(artifactId: string) {
      z.uuid().parse(artifactId);
      const custody = createExecutorCustody({ databaseUrl: knowledge!.config.databaseUrl,
        tenantId: config.tenantId, ...knowledge!.config.storage! });
      try {
        const artifact = await custody.resolve(artifactId);
        if (!artifact) throw new Error("ROOT_HOST_REMOTE_ARTIFACT_MISSING");
        const verifiedDigest = `sha256:${createHash("sha256").update(artifact.bytes).digest("hex")}`;
        if (verifiedDigest !== artifact.handle.digest) throw new Error("ROOT_HOST_REMOTE_ARTIFACT_DRIFT");
        return { artifactId, digest: artifact.handle.digest, byteLength: artifact.bytes.byteLength, verifiedDigest };
      } finally { await custody.close(); }
    },
    async restoreKnowledgeArtifact(binding: { artifactId: string; digest: string }) {
      z.uuid().parse(binding.artifactId);
      z.string().regex(/^sha256:[a-f0-9]{64}$/).parse(binding.digest);
      // ArtifactLedger.get reads configured remote storage and hashes the original bytes.
      const artifact = await knowledge!.artifacts.get(config.tenantId, binding.artifactId);
      if (artifact.record.storageState !== "available" || artifact.record.digest !== binding.digest
        || (artifact.json === undefined && artifact.text === undefined)) throw new Error("ROOT_HOST_REMOTE_ARTIFACT_DRIFT");
      return { artifactId: binding.artifactId, verifiedDigest: artifact.record.digest, byteLength: artifact.record.sizeBytes };
    },
    close: async () => { await selectionEvidence?.close(); await running.close(); await database.close(); },
  };
}
