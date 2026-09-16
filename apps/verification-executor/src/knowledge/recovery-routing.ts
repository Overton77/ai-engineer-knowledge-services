import type { DurableRecoveryCase, VerificationArtifactHandle, VerificationBundle } from "@aiengineer/knowledge-contracts";
import { triageVerificationRecovery, type DurableVerificationRecoveryService, type VerificationRecoveryAuthority } from "@aiengineer/knowledge-application";
import { digestCanonicalJson } from "@aiengineer/knowledge-verification";
import type { ClaimsIntent } from "../intents.js";
import type { RecoveryRunAuthority } from "./recovery-authority.js";

export interface ExecutorRecoveryRouting {
  authorize(input: { runId: string; intent: ClaimsIntent; bundle: VerificationBundle }): Promise<{
    batchId: string; caseId: string; authorityArtifact: VerificationArtifactHandle;
  }>;
  notify(input: { runId: string; authorityArtifactId: string; policyArtifact: VerificationArtifactHandle;
    decisionArtifact: VerificationArtifactHandle }): Promise<RecoveryRoutingStatus>;
}

export interface RecoveryRoutingStatus {
  caseId: string; batchId: string; state: DurableRecoveryCase["state"] | "not_required";
  revision: number; questionDenominator: number; submitted: number;
  counts: Record<string, number>; cohortTriage: boolean;
  remainingLimits: DurableRecoveryCase["batch"]["limits"];
  items: { originalId: string; classification: string; route: string; family: string; earliestStage: string; diagnosticArtifactIds: string[]; latestOutcome?: string }[];
  artifacts: { artifactId: string; digest: string; kind: string }[];
}

/** Automatic notification creates custody and diagnostics; a proposed repair still needs durable admission. */
export class AutomaticRecoveryRouting implements ExecutorRecoveryRouting {
  constructor(private readonly dependencies: { tenantId: string; authority: RecoveryRunAuthority; recovery: DurableVerificationRecoveryService }) {}

  authorize(input: Parameters<ExecutorRecoveryRouting["authorize"]>[0]) {
    return this.dependencies.authority.authorizeRun(input);
  }

  async notify(input: Parameters<ExecutorRecoveryRouting["notify"]>[0]): Promise<RecoveryRoutingStatus> {
    const { authority, tenantId, recovery } = this.dependencies;
    const authorized = await authority.authorizedBatch(input.runId);
    if (authorized.authorityArtifact.artifactId !== input.authorityArtifactId
      || [input.policyArtifact, input.decisionArtifact].some(artifact => artifact.tenantId !== tenantId)
      || authorized.batch.items.some(item => item.binding.policyDigest !== input.policyArtifact.digest)) {
      throw new Error("RECOVERY_NOTIFICATION_AUTHORITY_MISMATCH");
    }
    const { batch } = await authority.readInitialBatch({ tenantId, batchId: authorized.batch.batchId });
    const triage = await triageVerificationRecovery({ tenantId, batchId: batch.batchId, authority: this.triageAuthority(batch) });
    const completed = batch.items.filter(item => item.observation.execution === "completed");
    if (!completed.length) {
      throw new Error("RECOVERY_RESULT_NOT_YET_AUTHORITATIVE");
    }
    if (completed.some(item => !item.observation.diagnosticArtifacts.some(artifact => artifact.artifactId === input.decisionArtifact.artifactId))) {
      throw new Error("RECOVERY_NOTIFICATION_RESULT_MISMATCH");
    }
    if (triage.items.every(item => item.classification === "passed")) return this.summary(triage);
    const notificationId = `verification:${digestCanonicalJson({ runId: input.runId, batchId: batch.batchId,
      policyDigest: input.policyArtifact.digest, resultDigest: input.decisionArtifact.digest })}`;
    const notification = await authority.notification({ runId: input.runId, decisionArtifact: input.decisionArtifact, notificationId });
    let current: DurableRecoveryCase;
    try {
      current = await recovery.read(tenantId, batch.caseId);
      if (current.initialAuthorityArtifact.digest !== authorized.authorityArtifact.digest) throw new Error("RECOVERY_INITIAL_AUTHORITY_IMMUTABLE");
      current = await recovery.ingestDrift(tenantId, { caseId: batch.caseId, notificationId, artifact: notification });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "RECOVERY_CASE_NOT_FOUND") throw error;
      current = await recovery.open(tenantId, { batchId: batch.batchId, notificationId: `open:${notificationId}` });
      current = await recovery.ingestDrift(tenantId, { caseId: batch.caseId, notificationId, artifact: notification });
    }
    return this.summary(triage, current);
  }

  async read(caseId: string): Promise<RecoveryRoutingStatus> {
    const current = await this.dependencies.recovery.read(this.dependencies.tenantId, caseId);
    const triage = await triageVerificationRecovery({ tenantId: current.tenantId, batchId: current.batch.batchId, authority: this.triageAuthority(current.batch) });
    return this.summary(triage, current);
  }

  private triageAuthority(batch: DurableRecoveryCase["batch"]): VerificationRecoveryAuthority {
    return {
      now: () => this.dependencies.authority.now(), readBatch: async () => structuredClone(batch),
      readResult: request => this.dependencies.authority.readResult(request),
      readProbe: request => this.dependencies.authority.readProbe(request),
      readInvalidation: request => this.dependencies.authority.readInvalidation(request),
      readPlan: async () => { throw new Error("RECOVERY_TRIAGE_HAS_NO_PLAN"); },
    };
  }

  private summary(triage: Awaited<ReturnType<typeof triageVerificationRecovery>>, current?: DurableRecoveryCase): RecoveryRoutingStatus {
    const { failureSet, items } = triage;
    return { caseId: failureSet.batch.caseId, batchId: failureSet.batch.batchId, state: current?.state ?? "not_required", revision: current?.revision ?? 0,
      questionDenominator: failureSet.questionDenominator, submitted: failureSet.counts.submitted, counts: { ...failureSet.counts }, cohortTriage: failureSet.cohortTriage,
      remainingLimits: { ...(current?.batch.limits ?? failureSet.batch.limits) },
      items: items.map(item => {
        const latest = current?.latestReceipt?.results.find(result => result.originalId === item.originalId);
        return { originalId: item.originalId, classification: item.classification, route: item.route,
          family: item.family, earliestStage: item.earliestStage, diagnosticArtifactIds: [...item.diagnosticArtifactIds],
          ...(latest ? { latestOutcome: latest.outcome } : {}) };
      }),
      artifacts: current?.revisions.map(row => ({ artifactId: row.artifact.artifactId, digest: row.artifact.digest, kind: row.kind })) ?? [],
    };
  }
}
