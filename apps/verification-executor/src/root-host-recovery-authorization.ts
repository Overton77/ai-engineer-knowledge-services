import { VerificationRecoveryLimitsSchema } from "@aiengineer/knowledge-contracts";
import { digestCanonicalJson, gatewaySemanticConfigurationDigest } from "@aiengineer/knowledge-verification";
import { z } from "zod";
import { ClaimsIntentSchema } from "./intents.js";
import { EXECUTOR_VERSION, type VerificationExecutor } from "./executor.js";
import { deterministicUuid } from "./store.js";
import { RecoveryRunAuthorizationSchema } from "./knowledge/recovery-authority.js";
import type { PostgresCanonicalRepository } from "@aiengineer/knowledge-persistence";

const Original = z.strictObject({ schemaVersion: z.literal("root-claim-submission.v1"), tenantId: z.uuid(),
  missionId: z.uuid(), attemptId: z.uuid(), runId: z.uuid(), intent: ClaimsIntentSchema,
  originalQuestions: z.array(z.strictObject({ key: z.string().min(1), question: z.string().min(1) })).min(1) });

export async function readOriginalRecoveryAuthorization(input: {
  verification: VerificationExecutor; database: Pick<PostgresCanonicalRepository, "transaction">;
  operationId: string; submission: { artifactId: string; digest: string }; policyDigest: string;
}) {
  const rows = await input.database.transaction(input.verification.store.tenantId, async client =>
    (await client.query<{ artifact_id: string }>(`select artifact_id from orchestration.verification_artifact_metadata
      where tenant_id=$1 and producer_activity_id='root-host:recovery-authorization'
        and producer_version='root-recovery-authorization.v1' and $2::uuid=any(parent_artifact_ids) limit 2`,
    [input.verification.store.tenantId, input.submission.artifactId])).rows);
  if (rows.length > 1) throw new Error("ROOT_RECOVERY_AUTHORIZATION_AMBIGUOUS");
  if (!rows[0]) return null;
  const handle = await input.verification.store.resolveHandle({ artifactId: rows[0].artifact_id });
  const authorization = RecoveryRunAuthorizationSchema.parse(await input.verification.store.json(handle));
  return retainOriginalRecoveryAuthorization({ ...input, existingArtifactId: handle.artifactId, limits: authorization.batch.limits });
}

export async function retainOriginalRecoveryAuthorization(input: {
  verification: VerificationExecutor; operationId: string; submission: { artifactId: string; digest: string };
  policyDigest: string; limits: unknown; existingArtifactId?: string;
}) {
  const { store, config } = input.verification;
  const handle = await store.resolveHandle({ artifactId: input.submission.artifactId });
  const original = Original.parse(await store.json(handle));
  if (handle.digest !== input.submission.digest || handle.producerActivityId !== "root-host:retain-claim-submission"
    || original.tenantId !== store.tenantId || original.attemptId !== config.producerAttemptId)
    throw new Error("ROOT_RECOVERY_ORIGINAL_CUSTODY");
  const state = await store.readRun(original.runId);
  if (state.resultArtifactId && !input.existingArtifactId) throw new Error("ROOT_RECOVERY_AUTHORIZATION_TOO_LATE");
  const limits = VerificationRecoveryLimitsSchema.parse(input.limits);
  if (!input.existingArtifactId && Date.parse(limits.deadline) <= Date.now()) throw new Error("ROOT_RECOVERY_AUTHORIZATION_EXPIRED");
  const profileDigest = digestCanonicalJson({ executorVersion: EXECUTOR_VERSION, gitSha: config.gitSha,
    judge: gatewaySemanticConfigurationDigest(config.judgeModel),
    crossFamilyJudge: config.crossFamilyJudgeModel ? gatewaySemanticConfigurationDigest(config.crossFamilyJudgeModel) : null });
  const questionIds = original.originalQuestions.map(question => question.key);
  const requirements = original.originalQuestions.map(question => ({ requirementId: question.key, questionId: question.key, description: question.question }));
  if (input.existingArtifactId) {
    const artifact = await store.resolveHandle({ artifactId: input.existingArtifactId });
    const value = RecoveryRunAuthorizationSchema.parse(await store.json(artifact));
    if (artifact.producerActivityId !== "root-host:recovery-authorization" || artifact.producerVersion !== "root-recovery-authorization.v1"
      || !artifact.parentArtifactIds.includes(handle.artifactId) || value.runId !== original.runId
      || value.claimsIntentDigest !== digestCanonicalJson(original.intent) || value.batch.tenantId !== original.tenantId
      || value.batch.parentAttemptId !== original.attemptId || value.batch.callerId !== config.verifierAttemptId
      || value.batch.batchId !== deterministicUuid("root-recovery-batch.v1", input.operationId)
      || value.batch.caseId !== deterministicUuid("root-recovery-case.v1", input.operationId)
      || digestCanonicalJson(value.batch.limits) !== digestCanonicalJson(limits)
      || digestCanonicalJson(value.batch.questionIds) !== digestCanonicalJson(questionIds)
      || digestCanonicalJson(value.batch.requirements) !== digestCanonicalJson(requirements)
      || value.batch.items.some(item => item.binding.policyDigest !== input.policyDigest || item.binding.profileDigest !== profileDigest))
      throw new Error("ROOT_RECOVERY_AUTHORIZATION_IMMUTABLE");
    return { artifact, value };
  }
  const { bundle } = await input.verification.compileClaims(original.intent, original.runId);
  const items = bundle.assertions.map(assertion => {
    const evidence = assertion.evidence.map(edge => {
      const capture = bundle.captures.find(capture => capture.captureId === edge.fragment.captureId);
      if (!capture || capture.contentArtifact.artifactId !== edge.fragment.representationArtifactId)
        throw new Error("ROOT_RECOVERY_CAPTURE_BINDING");
      return { representationDigest: capture.contentArtifact.digest, selector: edge.fragment.selector,
        contextDigest: capture.contentArtifact.digest };
    });
    const binding = { claim: { statement: assertion.proposition, qualifiers: assertion.qualifiers,
      ...(assertion.value !== undefined ? { value: assertion.value } : {}) }, evidence,
      captureDigests: [...new Set(evidence.map(edge => edge.representationDigest))].sort(), policyDigest: input.policyDigest, profileDigest };
    return { originalId: assertion.assertionId, questionIds, inputDigest: digestCanonicalJson(binding), binding,
      observation: { operationId: input.operationId, runId: original.runId, execution: "pending", family: "execution",
        earliestStage: "mechanical", signature: "awaiting-original-verification", dependencyIds: [], diagnosticArtifacts: [] },
      usedRounds: 0, attemptedInputDigests: [], attemptedRepairDigests: [] };
  });
  const value = RecoveryRunAuthorizationSchema.parse({ schemaVersion: "verification-recovery-run-authorization.v1",
    runId: original.runId, claimsIntentDigest: digestCanonicalJson(original.intent), batch: {
      tenantId: original.tenantId, callerId: config.verifierAttemptId!, parentAttemptId: original.attemptId,
      batchId: deterministicUuid("root-recovery-batch.v1", input.operationId), caseId: deterministicUuid("root-recovery-case.v1", input.operationId),
      recoveryPolicyVersion: "recovery.v1", capturedAt: handle.createdAt, questionIds,
      requirements,
      items, limits, allowedActions: ["repair", "seek_evidence"], probeRounds: [] } });
  const retained = await store.putJson(value, { mediaType: "application/vnd.aiengineer.recovery-run-authorization+json",
    producerActivityId: "root-host:recovery-authorization", producerVersion: "root-recovery-authorization.v1",
    parentArtifactIds: [handle.artifactId, ...new Set(bundle.captures.map(capture => capture.contentArtifact.artifactId))],
    transformation: { kind: "root-recovery-authorization.v1", operationId: input.operationId } });
  return { artifact: retained.handle, value };
}
